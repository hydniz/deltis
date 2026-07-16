import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StravaCriteriaBuilder, {
  normalizeCriteria, criteriaSummary, emptyGroup, STRAVA_METRICS,
} from '../components/StravaCriteriaBuilder';

describe('normalizeCriteria', () => {
  it('returns null for empty or missing trees', () => {
    expect(normalizeCriteria(null)).toBeNull();
    expect(normalizeCriteria(emptyGroup())).toBeNull();
    expect(normalizeCriteria({ operator: 'AND', rules: [{ kind: 'sportType', values: [] }] })).toBeNull();
  });

  it('converts numeric strings and drops incomplete rules', () => {
    const result = normalizeCriteria({
      operator: 'OR',
      rules: [
        { kind: 'sportType', values: ['Run', 'Ride'] },
        { kind: 'metricRange', metric: 'movingTime', min: '20', max: '' },
        { kind: 'metricRange', metric: 'distance', min: '', max: '' }, // incomplete → dropped
        { kind: 'hrPercentInRange', minHr: '120', maxHr: '145', minPercent: '85' },
        { kind: 'hrPercentInRange', minHr: '', maxHr: '145', minPercent: '85' }, // incomplete
        { kind: 'hrZonePercent', zone: 2, minPercent: '85' },
      ],
    });
    expect(result).toEqual({
      operator: 'OR',
      rules: [
        { kind: 'sportType', values: ['Run', 'Ride'] },
        { kind: 'metricRange', metric: 'movingTime', min: 20 },
        { kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 },
        { kind: 'hrZonePercent', zone: 2, minPercent: 85 },
      ],
    });
  });

  it('normalizes nested groups and drops empty ones', () => {
    const result = normalizeCriteria({
      operator: 'AND',
      rules: [
        { kind: 'sportType', values: ['Run'] },
        { kind: 'group', operator: 'OR', rules: [{ kind: 'hrZonePercent', zone: 2, minPercent: '85' }] },
        { kind: 'group', operator: 'OR', rules: [] }, // empty → dropped
      ],
    });
    expect(result.rules).toHaveLength(2);
    expect(result.rules[1]).toEqual({
      kind: 'group', operator: 'OR', rules: [{ kind: 'hrZonePercent', zone: 2, minPercent: 85 }],
    });
  });

  it('defaults unknown operators to AND and drops unknown rule kinds', () => {
    const result = normalizeCriteria({
      operator: 'WHATEVER',
      rules: [{ kind: 'sportType', values: ['Run'] }, { kind: 'unknown' }],
    });
    expect(result.operator).toBe('AND');
    expect(result.rules).toHaveLength(1);
  });
});

describe('criteriaSummary', () => {
  it('describes empty criteria as matching everything', () => {
    expect(criteriaSummary(null)).toBe('Alle Strava-Aktivitäten');
    expect(criteriaSummary({ operator: 'AND', rules: [] })).toBe('Alle Strava-Aktivitäten');
  });

  it('renders a compact human-readable summary', () => {
    const summary = criteriaSummary({
      operator: 'AND',
      rules: [
        { kind: 'sportType', values: ['Run', 'Swim', 'Ride'] },
        { kind: 'metricRange', metric: 'movingTime', min: 20 },
        {
          kind: 'group',
          operator: 'OR',
          rules: [
            { kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 },
            { kind: 'hrZonePercent', zone: 2, minPercent: 85 },
          ],
        },
      ],
    });
    expect(summary).toContain('Run/Swim/Ride');
    expect(summary).toContain('Dauer (in Bewegung) ≥ 20 min');
    expect(summary).toContain('≥ 85 % Puls 120–145 bpm');
    expect(summary).toContain('≥ 85 % in HF-Zone 2');
    expect(summary).toContain(' und ');
    expect(summary).toContain(' oder ');
  });

  it('formats min/max ranges', () => {
    expect(criteriaSummary({
      operator: 'AND',
      rules: [{ kind: 'metricRange', metric: 'distance', min: 5, max: 10 }],
    })).toBe('Distanz 5–10 km');
    expect(criteriaSummary({
      operator: 'AND',
      rules: [{ kind: 'metricRange', metric: 'distance', max: 10 }],
    })).toBe('Distanz ≤ 10 km');
  });
});

// Interactive behaviour — a stateful harness plays the role of the goal form.
function Harness({ initial = null, sportTypes = ['Run', 'Ride'] }) {
  const [criteria, setCriteria] = useState(initial);
  return (
    <>
      <StravaCriteriaBuilder criteria={criteria} onChange={setCriteria} sportTypes={sportTypes} />
      <output data-testid="normalized">{JSON.stringify(normalizeCriteria(criteria))}</output>
    </>
  );
}

const normalized = () => JSON.parse(screen.getByTestId('normalized').textContent);

describe('StravaCriteriaBuilder component', () => {
  it('explains that empty criteria match every activity', () => {
    render(<Harness />);
    expect(screen.getByText(/Ohne Kriterien zählt jede synchronisierte Strava-Aktivität/)).toBeInTheDocument();
  });

  it('adds a sport type rule and toggles sports', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /Sportart/ }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(normalized()).toEqual({ operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] });

    await user.click(screen.getByRole('button', { name: 'Ride' }));
    expect(normalized().rules[0].values).toEqual(['Run', 'Ride']);

    // Toggle off again
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(normalized().rules[0].values).toEqual(['Ride']);
  });

  it('adds custom sport types via free text', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /Sportart/ }));
    await user.type(screen.getByPlaceholderText(/Andere Sportart/), 'Pickleball');
    await user.click(screen.getByRole('button', { name: /Hinzufügen/ }));
    expect(normalized().rules[0].values).toEqual(['Pickleball']);
  });

  it('adds a metric range rule with all backend metrics available', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /Messwert/ }));
    const select = screen.getByRole('combobox');
    expect(select.querySelectorAll('option')).toHaveLength(STRAVA_METRICS.length);

    await user.selectOptions(select, 'distance');
    await user.type(screen.getAllByPlaceholderText('km')[0], '5');
    expect(normalized()).toEqual({
      operator: 'AND',
      rules: [{ kind: 'metricRange', metric: 'distance', min: 5 }],
    });
  });

  it('shows the AND/OR toggle once there are two rules', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /Sportart/ }));
    expect(screen.queryByText('Verknüpfung:')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Puls-Anteil in Bereich/ }));
    expect(screen.getByText('Verknüpfung:')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ODER' }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(normalized().operator).toBe('OR');
  });

  it('builds the heart-rate rules of the Zone-2 example', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /Puls-Anteil in Bereich/ }));
    await user.type(screen.getByPlaceholderText('z.B. 120'), '120');
    await user.type(screen.getByPlaceholderText('z.B. 145'), '145');
    // minPercent defaults to 85
    expect(normalized().rules[0]).toEqual({ kind: 'hrPercentInRange', minHr: 120, maxHr: 145, minPercent: 85 });

    await user.click(screen.getByRole('button', { name: /Strava-Herzzone/ }));
    expect(normalized().rules[1]).toEqual({ kind: 'hrZonePercent', zone: 2, minPercent: 85 });
  });

  it('removes rules again', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] }} />);

    expect(normalized()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /Regel entfernen/ }));
    expect(normalized()).toBeNull();
  });

  it('supports one level of nested groups', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /Untergruppe/ }));
    // Inside the nested group there is no further "Untergruppe" button
    expect(screen.queryAllByRole('button', { name: /Untergruppe/ })).toHaveLength(1);
  });
});

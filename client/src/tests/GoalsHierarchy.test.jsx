import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Goals from '../pages/Goals';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const metaGoal = {
  _id: 'm1', name: 'Trainingswoche', type: 'meta',
  targetRef: 'meta', targetRefModel: 'Goal', targetName: 'Gesamtziel',
  condition: 'min', targetValue: 1, unitSymbol: 'Ziele', metric: 'count',
  childGoals: [{ _id: 'g1', name: 'Cardio' }], customFields: [], isActive: true,
};

const childGoal = {
  _id: 'g1', name: 'Cardio', type: 'periodic-strava',
  targetRef: 'strava', targetRefModel: 'StravaActivity', targetName: 'Strava',
  condition: 'min', targetValue: 3, metric: 'count', unitSymbol: 'Mal',
  parentGoalId: 'm1',
  parentGoal: { _id: 'm1', name: 'Trainingswoche' },
  stravaCriteria: null, customFields: [], isActive: true,
  intervalValue: 1, intervalUnit: 'week',
};

const freeGoal = {
  _id: 'g2', name: 'Krafttraining', type: 'periodic-strava',
  targetRef: 'strava', targetRefModel: 'StravaActivity', targetName: 'Strava',
  condition: 'min', targetValue: 2, metric: 'count', unitSymbol: 'Mal',
  stravaCriteria: null, customFields: [], isActive: true,
  intervalValue: 1, intervalUnit: 'week',
};

function useGoalHandlers() {
  server.use(
    http.get('/api/goals', () => HttpResponse.json([metaGoal, childGoal, freeGoal])),
    http.get('/api/activity-types', () => HttpResponse.json([])),
    http.get('/api/habits/definitions', () => HttpResponse.json([])),
    http.get('/api/goals/m1/progress', () => HttpResponse.json({
      conditions: [{ metric: 'subgoals', condition: 'min', targetValue: 1, unitSymbol: 'Ziele', currentValue: 1, met: true }],
      conditionOperator: 'AND', met: true, weeklyData: [], stepResults: [],
      childResults: [{
        _id: 'g1', name: 'Cardio', met: true,
        currentValue: 3, targetValue: 3, unitSymbol: 'Mal', condition: 'min',
      }],
    })),
    http.get('/api/goals/:id/heatmap', () => HttpResponse.json({ metric: 'count', days: {} })),
    http.get('/api/goals/:id/progress', () => HttpResponse.json({
      conditions: [{ metric: 'count', condition: 'min', targetValue: 3, unitSymbol: 'Mal', currentValue: 1, met: false }],
      conditionOperator: 'AND', met: false, weeklyData: [], stepResults: [],
    })),
    http.get('/api/goals/g1/items', () => HttpResponse.json({
      kind: 'strava',
      entries: [{
        integration: 'strava', id: 'a1', name: 'Morgenlauf', sportType: 'Run',
        date: '2026-07-15T07:00:00.000Z', movingTime: 1800, distance: 5200,
      }],
    })),
  );
}

function renderGoals() {
  return render(<MemoryRouter><Goals /></MemoryRouter>);
}

describe('Goals – hierarchy display', () => {
  it('nests children in the meta card: compact preview, expandable full card', async () => {
    useGoalHandlers();
    renderGoals();

    await waitFor(() => expect(screen.getByText('Gesamtziele')).toBeInTheDocument());
    expect(screen.getByText('Trainingswoche')).toBeInTheDocument();
    // Child status inside the meta card as compact preview with progress
    await waitFor(() => expect(screen.getByText('Unterziele')).toBeInTheDocument());
    expect(screen.getByText('3 / 3 Mal')).toBeInTheDocument();
    // The child no longer clutters the top-level groups
    expect(screen.queryByText('Periodische Ziele')).toBeInTheDocument();
    expect(screen.queryByText(/Teil von: Trainingswoche/)).not.toBeInTheDocument();

    // Expanding shows the full child card (with its hierarchy badge)
    await userEvent.setup().click(screen.getByRole('button', { name: /Unterziele ausklappen/ }));
    expect(await screen.findByText(/Teil von: Trainingswoche/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unterziele einklappen/ })).toBeInTheDocument();
  });

  it('reveals the contributing entries behind "Was zählt dazu?" of an expanded child', async () => {
    useGoalHandlers();
    renderGoals();

    await waitFor(() => expect(screen.getByText('Trainingswoche')).toBeInTheDocument());
    await userEvent.setup().click(await screen.findByRole('button', { name: /Unterziele ausklappen/ }));

    await waitFor(() => expect(screen.getByText('Cardio')).toBeInTheDocument());
    const childCard = screen.getByText('Cardio').closest('.card');
    await userEvent.setup().click(within(childCard).getByText('Was zählt dazu?'));

    await waitFor(() => expect(screen.getByText('Morgenlauf')).toBeInTheDocument());
    expect(within(childCard).getByText(/30 min/)).toBeInTheDocument();
  });
});

describe('Goals – meta goal creation', () => {
  it('creates a meta goal from existing free goals', async () => {
    useGoalHandlers();
    let posted = null;
    server.use(
      http.post('/api/goals', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ...metaGoal, _id: 'new' }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    renderGoals();

    await waitFor(() => expect(screen.getByText('Trainingswoche')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Neues Ziel/ }));

    await user.type(screen.getByPlaceholderText(/Öfter laufen/), 'Erfolgreiche Woche');
    await user.click(screen.getByRole('button', { name: /Gesamtziel/ }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    // Only the free goal is offered (child of another meta is excluded)
    expect(screen.queryByRole('button', { name: /Cardio/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Krafttraining/ }));
    await user.type(screen.getByPlaceholderText('1'), '1');
    await user.click(screen.getByRole('button', { name: 'Ziel erstellen' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      name: 'Erfolgreiche Woche',
      type: 'meta',
      targetValue: 1,
      childGoalIds: ['g2'],
    });
  });
});

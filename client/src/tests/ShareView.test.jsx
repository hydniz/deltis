import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import ShareView from '../pages/ShareView';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const goals = [
  { _id: 'g1', name: 'Laufziel', type: 'periodic-activity' },
  { _id: 'meta1', name: 'Gesamtziel', type: 'meta' },
];
const habits = [
  { _id: 'h1', name: 'Lesen', type: 'boolean', selected: true },
  { _id: 'h2', name: 'Abgewählt', type: 'boolean', selected: false },
];

function useHandlers() {
  server.use(
    http.get('/api/goals', () => HttpResponse.json(goals)),
    http.get('/api/habits/definitions', () => HttpResponse.json(habits)),
    http.get('/api/goals/:id/heatmap', () => HttpResponse.json({ metric: 'count', days: {} })),
    http.get('/api/habits/logs', () => HttpResponse.json([])),
  );
}

describe('ShareView', () => {
  it('offers goals (no meta) and selected habits as tiles', async () => {
    useHandlers();
    render(<MemoryRouter><ShareView /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Laufziel')).toBeInTheDocument());
    expect(screen.getByText('Lesen')).toBeInTheDocument();
    // Meta goals have no heatmap; unselected habits stay hidden
    expect(screen.queryByText('Gesamtziel')).not.toBeInTheDocument();
    expect(screen.queryByText('Abgewählt')).not.toBeInTheDocument();
  });

  it('builds the share canvas from the selection and supports reordering', async () => {
    useHandlers();
    const user = userEvent.setup();
    render(<MemoryRouter><ShareView /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Laufziel')).toBeInTheDocument());
    // Nothing selected yet — no canvas
    expect(screen.queryByTestId('share-canvas')).not.toBeInTheDocument();

    await user.click(screen.getByText('Laufziel'));
    await user.click(screen.getByText('Lesen'));

    const canvas = await screen.findByTestId('share-canvas');
    expect(canvas).toBeInTheDocument();
    // Both tiles render inside the canvas, in selection order
    const titles = [...canvas.querySelectorAll('p')].map(p => p.textContent);
    expect(titles).toContain('Laufziel');
    expect(titles).toContain('Lesen');
    expect(titles.indexOf('Laufziel')).toBeLessThan(titles.indexOf('Lesen'));

    // Move the second tile up — order flips
    await user.click(screen.getAllByLabelText('Nach oben')[1]);
    const reordered = [...screen.getByTestId('share-canvas').querySelectorAll('p')].map(p => p.textContent);
    expect(reordered.indexOf('Lesen')).toBeLessThan(reordered.indexOf('Laufziel'));

    // Deselecting removes the tile again (the picker chip is the first match)
    await user.click(screen.getAllByText('Laufziel')[0]);
    const remaining = [...screen.getByTestId('share-canvas').querySelectorAll('p')].map(p => p.textContent);
    expect(remaining).not.toContain('Laufziel');
  });
});

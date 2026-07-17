import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import TrainingTypesCard from '../components/TrainingTypesCard';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const zone2 = {
  _id: 'tt1',
  name: 'Zone 2',
  description: 'Ruhiges Ausdauertraining',
  criteria: {
    strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run', 'Ride'] }] },
  },
};

describe('TrainingTypesCard', () => {
  it('lists existing types with their criteria summary', async () => {
    server.use(http.get('/api/training-types', () => HttpResponse.json([zone2])));
    render(<TrainingTypesCard />);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    expect(screen.getByText('Ruhiges Ausdauertraining')).toBeInTheDocument();
    expect(screen.getByText('Run/Ride')).toBeInTheDocument();
  });

  it('creates a new type with normalized per-integration criteria', async () => {
    let posted = null;
    server.use(
      http.post('/api/training-types', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ...posted, _id: 'new' }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    render(<TrainingTypesCard />);

    await waitFor(() => expect(screen.getByText('Neuer Trainingstyp')).toBeInTheDocument());
    await user.click(screen.getByText('Neuer Trainingstyp'));

    await user.type(screen.getByPlaceholderText('z.B. Zone 2'), 'Langer Lauf');
    await user.click(screen.getByRole('button', { name: /Sportart$/ }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      name: 'Langer Lauf',
      criteria: { strava: { operator: 'AND', rules: [{ kind: 'sportType', values: ['Run'] }] } },
    });
  });

  it('shows the backend error when deleting a type that is in use', async () => {
    server.use(
      http.get('/api/training-types', () => HttpResponse.json([zone2])),
      http.delete('/api/training-types/tt1', () =>
        HttpResponse.json({ error: 'Trainingstyp wird noch verwendet (1 Ziel(e), 0 geplante(s) Training(s)). Bitte zuerst dort entfernen.' }, { status: 409 })
      ),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<TrainingTypesCard />);

    await waitFor(() => expect(screen.getByText('Zone 2')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await waitFor(() =>
      expect(screen.getByText(/wird noch verwendet/)).toBeInTheDocument()
    );
  });
});

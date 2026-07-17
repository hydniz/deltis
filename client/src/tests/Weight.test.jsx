import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Weight from '../pages/Weight';

const updateUser = vi.fn();
let mockUser = { name: 'Testi', weightUnit: 'kg', weightGoal: null };

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, updateUser }),
}));

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  mockUser = { name: 'Testi', weightUnit: 'kg', weightGoal: null };
});
afterAll(() => server.close());

// Chronological, as the API returns them since the limit fix
const logs = [
  { _id: 'w1', date: '2026-07-01T00:00:00.000Z', weight: 80, unit: 'kg' },
  { _id: 'w2', date: '2026-07-10T00:00:00.000Z', weight: 78, unit: 'kg' },
  { _id: 'w3', date: '2026-07-15T00:00:00.000Z', weight: 77, unit: 'kg' },
];

function useHandlers({ entries = logs } = {}) {
  server.use(
    http.get('/api/weight', () => HttpResponse.json(entries)),
  );
}

describe('Weight', () => {
  it('shows the NEWEST entry as current weight', async () => {
    useHandlers();
    render(<Weight />);

    await waitFor(() => expect(screen.getAllByText('77 kg').length).toBeGreaterThan(0));
    // "Aktuell" tile carries the newest value (77), not the oldest (80):
    // the label's sibling <p> holds the tile value.
    const label = screen.getByText('Aktuell');
    expect(label.nextElementSibling.textContent).toBe('77 kg');
  });

  it('saves a weight goal via the profile', async () => {
    useHandlers();
    let putBody = null;
    server.use(
      http.put('/api/auth/me', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ ...mockUser, weightGoal: putBody.weightGoal });
      })
    );
    const user = userEvent.setup();
    render(<Weight />);

    await screen.findByRole('heading', { name: /Zielgewicht/ });
    await user.type(screen.getByPlaceholderText('z.B. 72'), '72');
    await user.click(screen.getByRole('button', { name: 'Ziel speichern' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody.weightGoal).toMatchObject({ weight: 72 });
    expect(updateUser).toHaveBeenCalled();
  });

  it('shows the goal line info and remaining delta', async () => {
    mockUser = {
      name: 'Testi', weightUnit: 'kg',
      weightGoal: { weight: 72, date: '2026-09-30T00:00:00.000Z' },
    };
    useHandlers();
    render(<Weight />);

    await waitFor(() => expect(screen.getByText(/Zielgewicht:/)).toBeInTheDocument());
    expect(screen.getByText(/bis 30. September 2026/)).toBeInTheDocument();
    // current 77, goal 72 → 5 kg to lose
    expect(screen.getByText(/5 kg/)).toBeInTheDocument();
    expect(screen.getByText(/abzunehmen/)).toBeInTheDocument();
  });
});

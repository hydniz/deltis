import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import DailyCheckin, { duePassedSlot } from '../components/DailyCheckin';

let mockUser = { name: 'Testi', checkinTimes: ['00:00'] };
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  mockUser = { name: 'Testi', checkinTimes: ['00:00'] };
});
afterAll(() => server.close());

const dueToday = (overrides = []) => {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      date: today, habitId: 'h1', name: 'Wasser', unitSymbol: 'ml', type: 'amount',
      targetCondition: 'min', targetValue: 2000, logged: false, loggedValue: null,
      fulfilled: false, reason: { kind: 'daily' },
    },
    {
      date: today, habitId: 'h2', name: 'Vitamine', unitSymbol: '✓', type: 'boolean',
      targetCondition: 'none', targetValue: 0, logged: true, loggedValue: 1,
      fulfilled: true, reason: { kind: 'daily' },
    },
    ...overrides,
  ];
};

describe('duePassedSlot', () => {
  it('returns the latest passed time and null when none passed', () => {
    const now = new Date('2026-07-15T14:30:00');
    expect(duePassedSlot(['08:00', '13:00', '21:00'], now)).toBe('13:00');
    expect(duePassedSlot(['21:00'], now)).toBeNull();
    expect(duePassedSlot([], now)).toBeNull();
  });
});

describe('DailyCheckin', () => {
  it('opens after a configured time with the unfilled habits, corrections collapsed', async () => {
    server.use(http.get('/api/habits/due', () => HttpResponse.json(dueToday())));
    render(<DailyCheckin />);

    expect(await screen.findByText('Kurzer Check-in')).toBeInTheDocument();
    expect(screen.getByText('Wasser')).toBeInTheDocument();
    // Filled habit hides behind the collapsed corrections toggle
    expect(screen.queryByText('Vitamine')).not.toBeInTheDocument();
    expect(screen.getByText(/Bereits ausgefüllte nachbessern \(1\)/)).toBeInTheDocument();
  });

  it('logs a habit from the questionnaire', async () => {
    server.use(http.get('/api/habits/due', () => HttpResponse.json(dueToday())));
    let posted = null;
    server.use(
      http.post('/api/habits/logs', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ _id: 'l1' }, { status: 201 });
      })
    );
    const user = userEvent.setup();
    render(<DailyCheckin />);

    await screen.findByText('Wasser');
    await user.type(screen.getByPlaceholderText('ml'), '2500');
    await user.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ habitId: 'h1', value: 2500 });
  });

  it('skipping stores the slot and prevents reopening', async () => {
    server.use(http.get('/api/habits/due', () => HttpResponse.json(dueToday())));
    const user = userEvent.setup();
    const { unmount } = render(<DailyCheckin />);

    await screen.findByText('Kurzer Check-in');
    await user.click(screen.getByRole('button', { name: 'Überspringen' }));
    expect(screen.queryByText('Kurzer Check-in')).not.toBeInTheDocument();

    // A fresh mount (next page visit) stays quiet for the same slot
    unmount();
    render(<DailyCheckin />);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText('Kurzer Check-in')).not.toBeInTheDocument();
  });

  it('stays quiet when everything is already filled', async () => {
    const today = new Date().toISOString().slice(0, 10);
    server.use(http.get('/api/habits/due', () => HttpResponse.json([
      {
        date: today, habitId: 'h2', name: 'Vitamine', unitSymbol: '✓', type: 'boolean',
        targetCondition: 'none', targetValue: 0, logged: true, loggedValue: 1,
        fulfilled: true, reason: { kind: 'daily' },
      },
    ])));
    render(<DailyCheckin />);

    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText('Kurzer Check-in')).not.toBeInTheDocument();
  });

  it('does nothing without configured times', async () => {
    mockUser = { name: 'Testi', checkinTimes: [] };
    render(<DailyCheckin />);
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByText('Kurzer Check-in')).not.toBeInTheDocument();
  });
});

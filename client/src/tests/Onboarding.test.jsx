import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Onboarding from '../components/Onboarding';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { mockUser } from './mocks/handlers';

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});
afterAll(() => server.close());

const PREDEFINED_HABITS = [
  { _id: 'h1', name: 'Wasser', unitSymbol: 'ml', type: 'amount', isPredefined: true, selected: true },
  { _id: 'h2', name: 'Schlaf', unitSymbol: 'h', type: 'duration', isPredefined: true, selected: true },
  { _id: 'h3', name: 'Eigene', unitSymbol: 'x', type: 'amount', isPredefined: false, selected: true },
];

const TYPE_DEFAULTS = [
  { label: 'Joggen', showDistance: true, showDuration: true, customFields: [] },
  { label: 'Yoga', showDistance: false, showDuration: true, customFields: [] },
];

// Mirrors the OnboardingGate in App.jsx: the wizard only mounts with a
// loaded user and unmounts once onboardingPending flips to false.
function Gate() {
  const { user } = useAuth();
  if (!user?.onboardingPending) return null;
  return <Onboarding />;
}

function renderOnboarding(userOverride = {}) {
  const user = {
    ...mockUser,
    onboardingPending: true,
    onboardingStep: 0,
    ...userOverride,
  };
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(user)),
    http.get('/api/habits/definitions', () => HttpResponse.json(PREDEFINED_HABITS)),
    http.get('/api/activity-types/defaults', () => HttpResponse.json(TYPE_DEFAULTS)),
  );
  localStorage.setItem('auth_token', 'valid-token');
  return render(
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  );
}

describe('Onboarding – Anzeige & Resume', () => {
  it('shows the welcome step for a fresh user', async () => {
    renderOnboarding();
    expect(await screen.findByRole('heading', { name: /Willkommen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Los geht/ })).toBeInTheDocument();
    expect(screen.getByText('Schritt 1 von 5')).toBeInTheDocument();
  });

  it('resumes at the persisted step after re-login', async () => {
    renderOnboarding({ onboardingStep: 2 });
    expect(await screen.findByText('Deine Gewohnheiten')).toBeInTheDocument();
    expect(screen.getByText('Schritt 3 von 5')).toBeInTheDocument();
  });

  it('lists only predefined habits in the habit step', async () => {
    renderOnboarding({ onboardingStep: 2 });
    expect(await screen.findByText('Wasser')).toBeInTheDocument();
    expect(screen.getByText('Schlaf')).toBeInTheDocument();
    expect(screen.queryByText('Eigene')).not.toBeInTheDocument();
  });

  it('does not render for users without pending onboarding', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(mockUser)));
    localStorage.setItem('auth_token', 'valid-token');
    render(
      <ThemeProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ThemeProvider>
    );
    await waitFor(() => expect(screen.queryByText(/Willkommen/)).not.toBeInTheDocument());
  });
});

describe('Onboarding – Schritte & Speichern', () => {
  it('persists the step when continuing from the welcome screen', async () => {
    let savedStep = null;
    server.use(
      http.put('/api/auth/me/onboarding', async ({ request }) => {
        const body = await request.json();
        savedStep = body.step;
        return HttpResponse.json({
          ...mockUser, onboardingPending: true, onboardingStep: body.step,
        });
      })
    );
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole('button', { name: /Los geht/ }));
    await waitFor(() => expect(savedStep).toBe(1));
    expect(await screen.findByText('Dein Profil')).toBeInTheDocument();
  });

  it('saves the habit selection without the deselected habit', async () => {
    let savedSelection = null;
    server.use(
      http.put('/api/habits/selection', async ({ request }) => {
        savedSelection = (await request.json()).selectedIds;
        return HttpResponse.json({ success: true });
      }),
      http.put('/api/auth/me/onboarding', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({
          ...mockUser, onboardingPending: true, onboardingStep: body.step,
        });
      })
    );
    const user = userEvent.setup();
    renderOnboarding({ onboardingStep: 2 });

    await user.click(await screen.findByText('Schlaf'));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await waitFor(() => expect(savedSelection).toEqual(['h1']));
  });

  it('saves the chosen activity types', async () => {
    let savedLabels = null;
    server.use(
      http.post('/api/activity-types/setup', async ({ request }) => {
        savedLabels = (await request.json()).labels;
        return HttpResponse.json([], { status: 201 });
      }),
      http.put('/api/auth/me/onboarding', async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({
          ...mockUser, onboardingPending: true, onboardingStep: body.step,
        });
      })
    );
    const user = userEvent.setup();
    renderOnboarding({ onboardingStep: 3 });

    await user.click(await screen.findByText('Yoga'));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await waitFor(() => expect(savedLabels).toEqual(['Joggen']));
  });

  it('completes the onboarding and unmounts the wizard', async () => {
    let completed = false;
    server.use(
      http.put('/api/auth/me/onboarding', async ({ request }) => {
        const body = await request.json();
        completed = body.completed === true;
        return HttpResponse.json({
          ...mockUser, onboardingPending: false, onboardedAt: new Date().toISOString(),
        });
      })
    );
    const user = userEvent.setup();
    renderOnboarding({ onboardingStep: 4 });

    expect(await screen.findByText('Alles bereit!')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zur App' }));

    await waitFor(() => {
      expect(completed).toBe(true);
      expect(screen.queryByText('Alles bereit!')).not.toBeInTheDocument();
    });
  });
});

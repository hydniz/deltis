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

// Catalog templates: picking one creates a personal habit definition.
const HABIT_CATALOG = [
  { name: 'Wasser', unitSymbol: 'ml', type: 'amount' },
  { name: 'Schlaf', unitSymbol: 'h', type: 'duration' },
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
    http.get('/api/habits/catalog', () => HttpResponse.json(HABIT_CATALOG)),
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

  it('lists the habit catalog in the habit step', async () => {
    renderOnboarding({ onboardingStep: 2 });
    expect(await screen.findByText('Wasser')).toBeInTheDocument();
    expect(screen.getByText('Schlaf')).toBeInTheDocument();
  });

  it('preselects no habits – the user opts in', async () => {
    renderOnboarding({ onboardingStep: 2 });
    await screen.findByText('Wasser');
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(screen.getByText('0 von 2 ausgewählt')).toBeInTheDocument();
  });

  it('preselects no activity types – the user opts in', async () => {
    renderOnboarding({ onboardingStep: 3 });
    await screen.findByText('Joggen');
    expect(screen.getByText('0 von 2 ausgewählt')).toBeInTheDocument();
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

  it('creates personal habits for the picked catalog entries and selects them', async () => {
    let savedSelection = null;
    const postedDefs = [];
    server.use(
      http.post('/api/habits/definitions', async ({ request }) => {
        const body = await request.json();
        postedDefs.push(body);
        return HttpResponse.json({ _id: `new-${postedDefs.length}`, ...body }, { status: 201 });
      }),
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

    await user.click(await screen.findByText('Wasser'));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await waitFor(() => expect(savedSelection).toEqual(['new-1']));
    expect(postedDefs).toEqual([{ name: 'Wasser', unitSymbol: 'ml', type: 'amount' }]);
  });

  it('creates nothing when no catalog entry is picked', async () => {
    let savedStep = null;
    const postedDefs = [];
    server.use(
      http.post('/api/habits/definitions', async ({ request }) => {
        postedDefs.push(await request.json());
        return HttpResponse.json({ _id: 'x' }, { status: 201 });
      }),
      http.put('/api/auth/me/onboarding', async ({ request }) => {
        const body = await request.json();
        savedStep = body.step;
        return HttpResponse.json({
          ...mockUser, onboardingPending: true, onboardingStep: body.step,
        });
      })
    );
    const user = userEvent.setup();
    renderOnboarding({ onboardingStep: 2 });

    await screen.findByText('Wasser');
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    await waitFor(() => expect(savedStep).toBe(3));
    expect(postedDefs).toEqual([]);
  });

  it('saves only the opted-in activity types', async () => {
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

    await user.click(await screen.findByText('Joggen'));
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

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Init from '../pages/Init';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Status fixture: fresh installation, security already provided via .env,
// one env-locked setting among the editable ones.
const freshStatus = {
  initNeeded: true,
  setupMode: false,
  pepperConfigured: true,
  jwtConfigured: true,
  settings: [
    {
      key: 'UPDATE_REPO_URL', label: 'GitHub Repository URL', group: 'OTA Update',
      description: 'Repository für Updates.', type: 'url',
      default: 'https://github.com/hydniz/deltis', locked: false,
      value: 'https://github.com/hydniz/deltis',
    },
    {
      key: 'UPDATE_RELEASE_CHANNEL', label: 'Release-Kanal', group: 'OTA Update',
      description: 'Update-Kanal.', type: 'select',
      options: ['stable', 'beta', 'alpha', 'main'], default: 'stable',
      locked: false, value: 'stable',
    },
    {
      key: 'UPDATE_BRANCH', label: 'Branch (Main-Kanal)', group: 'OTA Update',
      description: 'Verfolgter Branch.', type: 'text', default: 'main',
      locked: true, lockedReason: 'env', value: null,
    },
    {
      key: 'PORT', label: 'Server-Port', group: 'Server',
      description: 'Port des Servers.', type: 'number', default: '3001',
      restartRequired: true, locked: false, value: '3001',
    },
  ],
};

function useFreshStatus(overrides = {}) {
  server.use(
    http.get('/api/init/status', () => HttpResponse.json({ ...freshStatus, ...overrides }))
  );
}

function renderInit() {
  return render(
    <MemoryRouter initialEntries={['/init']}>
      <Routes>
        <Route path="/init" element={<Init />} />
        <Route path="/login" element={<div data-testid="login-stub" />} />
      </Routes>
    </MemoryRouter>
  );
}

// Fills the account step and submits it.
async function completeAccountStep(user, { username = 'chefin', password = 'supersecret1' } = {}) {
  await screen.findByText('Admin-Konto erstellen');
  await user.type(screen.getByPlaceholderText('Mindestens 3 Zeichen (a–z, 0–9, .-_)'), username);
  await user.type(screen.getByPlaceholderText('Mindestens 8 Zeichen'), password);
  await user.type(screen.getByPlaceholderText('Passwort wiederholen'), password);
  await user.click(screen.getByRole('button', { name: /^weiter/i }));
}

describe('Init wizard', () => {
  it('redirects to /login when the instance is already initialized', async () => {
    // Default handler answers initNeeded: false
    renderInit();
    await waitFor(() => expect(screen.getByTestId('login-stub')).toBeInTheDocument());
  });

  it('shows the welcome step on a fresh installation', async () => {
    useFreshStatus();
    renderInit();
    expect(await screen.findByText(/Willkommen bei Deltis/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /los geht/i })).toBeInTheDocument();
  });

  it('skips the security step when JWT secret and pepper are configured', async () => {
    useFreshStatus();
    const user = userEvent.setup();
    renderInit();

    await user.click(await screen.findByRole('button', { name: /los geht/i }));
    expect(await screen.findByText('Admin-Konto erstellen')).toBeInTheDocument();
    expect(screen.queryByText('Sicherheit')).not.toBeInTheDocument();
  });

  it('shows the security step when the pepper is missing', async () => {
    useFreshStatus({ pepperConfigured: false });
    let captured = null;
    server.use(
      http.post('/api/admin/setup/security-config', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ ok: true, pepperConfigured: true });
      })
    );

    const user = userEvent.setup();
    renderInit();

    await user.click(await screen.findByRole('button', { name: /los geht/i }));
    expect(await screen.findByText(/vor dem Admin-Konto/)).toBeInTheDocument();
    // JWT secret is configured → shown as locked info row, not as an input.
    expect(screen.getByText('JWT Secret')).toBeInTheDocument();

    // Generate a pepper with the wand button, then continue.
    await user.click(screen.getByRole('button', { name: 'Sicheren Pepper generieren' }));
    await user.click(screen.getByRole('button', { name: /^weiter/i }));

    expect(await screen.findByText('Admin-Konto erstellen')).toBeInTheDocument();
    expect(captured.password_pepper).toBeTruthy();
    expect(captured.jwt_secret).toBeUndefined();
  });

  it('validates the account step client-side', async () => {
    useFreshStatus();
    const user = userEvent.setup();
    renderInit();

    await user.click(await screen.findByRole('button', { name: /los geht/i }));
    await screen.findByText('Admin-Konto erstellen');

    await user.type(screen.getByPlaceholderText('Mindestens 3 Zeichen (a–z, 0–9, .-_)'), 'chefin');
    await user.type(screen.getByPlaceholderText('Mindestens 8 Zeichen'), 'supersecret1');
    await user.type(screen.getByPlaceholderText('Passwort wiederholen'), 'supersecret2');

    // Mismatching passwords keep the submit disabled.
    expect(screen.getByRole('button', { name: /^weiter/i })).toBeDisabled();
  });

  it('walks through to the settings step and submits everything in one call', async () => {
    useFreshStatus();
    let captured = null;
    server.use(
      http.post('/api/init', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({
          ok: true,
          user: { username: captured.username, isAdmin: true },
          applied: Object.keys(captured.settings || {}),
          skipped: ['UPDATE_BRANCH'],
          restartRequired: true,
        }, { status: 201 });
      })
    );

    const user = userEvent.setup();
    renderInit();

    await user.click(await screen.findByRole('button', { name: /los geht/i }));
    await completeAccountStep(user, { username: 'Chefin' });

    // Settings step: env-locked entry is shown as locked, not editable.
    expect(await screen.findByRole('heading', { name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByText('Über .env festgelegt.')).toBeInTheDocument();

    // Change the release channel and finish.
    await user.selectOptions(screen.getByDisplayValue('stable'), 'beta');
    await user.click(screen.getByRole('button', { name: /einrichtung abschließen/i }));

    // Done step with confetti + restart hint.
    expect(await screen.findByText(/Alles bereit/)).toBeInTheDocument();
    expect(screen.getByText(/Server-Neustart/)).toBeInTheDocument();
    expect(screen.getByText(/UPDATE_BRANCH/)).toBeInTheDocument();
    expect(document.querySelector('.confetti-piece')).toBeTruthy();

    // The POST carried the normalized account and only unlocked settings.
    expect(captured.username).toBe('chefin');
    expect(captured.password).toBe('supersecret1');
    expect(captured.settings.UPDATE_RELEASE_CHANNEL).toBe('beta');
    expect(captured.settings.UPDATE_BRANCH).toBeUndefined();
  });

  it('shows a server error on the settings step and allows going back', async () => {
    useFreshStatus();
    server.use(
      http.post('/api/init', () =>
        HttpResponse.json({ error: 'Benutzername bereits vergeben.' }, { status: 409 }))
    );

    const user = userEvent.setup();
    renderInit();

    await user.click(await screen.findByRole('button', { name: /los geht/i }));
    await completeAccountStep(user);

    await screen.findByRole('heading', { name: 'Einstellungen' });
    await user.click(screen.getByRole('button', { name: /einrichtung abschließen/i }));

    expect(await screen.findByText('Benutzername bereits vergeben.')).toBeInTheDocument();

    // Back to the account step to fix the username.
    await user.click(screen.getByRole('button', { name: /zurück/i }));
    expect(await screen.findByText('Admin-Konto erstellen')).toBeInTheDocument();
  });

  it('shows the database step first while the server is in setup mode', async () => {
    useFreshStatus({ setupMode: true });
    const user = userEvent.setup();
    renderInit();

    await user.click(await screen.findByRole('button', { name: /los geht/i }));
    expect(await screen.findByText('Datenbank verbinden')).toBeInTheDocument();
  });
});

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import Init from '../pages/Init';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const baseStatus = {
  initNeeded: true,
  setupMode: false,
  pepperConfigured: true,
  jwtConfigured: true,
  inDocker: false,
  settings: [],
};

function mockStatus(status) {
  server.use(http.get('/api/init/status', () => HttpResponse.json(status)));
}

function renderInit() {
  return render(
    <MemoryRouter initialEntries={['/init']}>
      <Init />
    </MemoryRouter>
  );
}

describe('Init wizard – backups warning', () => {
  it('warns on the welcome step when the server holds backups but the DB is empty', async () => {
    mockStatus({ ...baseStatus, backupsPresent: true });
    renderInit();

    await waitFor(() =>
      expect(screen.getByText(/Backups gefunden/)).toBeInTheDocument()
    );
    expect(screen.getByText(/restore\.sh/)).toBeInTheDocument();
  });

  it('shows no warning on a genuinely fresh server', async () => {
    mockStatus({ ...baseStatus, backupsPresent: false });
    renderInit();

    await waitFor(() =>
      expect(screen.getByText(/Willkommen bei/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Backups gefunden/)).not.toBeInTheDocument();
  });
});

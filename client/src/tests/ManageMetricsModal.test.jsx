import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import ManageMetricsModal from '../components/ManageMetricsModal';

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => server.close());

const catalog = [
  { key: 'restingHeartRate', name: 'Ruhepuls', importable: true, added: false },
  { key: 'bodyFat', name: 'Körperfett', importable: true, added: true },
  { key: 'mood', name: 'Stimmung', importable: false, added: false },
];

function mock({ metrics = [], cat = catalog } = {}) {
  server.use(
    http.get('/api/metrics', () => HttpResponse.json(metrics)),
    http.get('/api/metrics/catalog', () => HttpResponse.json(cat)),
  );
}

const renderModal = (props = {}) =>
  render(<ManageMetricsModal onClose={() => {}} onChanged={() => {}} {...props} />);

describe('ManageMetricsModal', () => {
  it('lists catalog templates and marks the added ones', async () => {
    mock();
    renderModal();
    const added = await screen.findByRole('button', { name: /Körperfett/ });
    expect(added).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ruhepuls/ })).toBeEnabled();
  });

  it('adds a metric from the catalog', async () => {
    mock();
    const post = vi.fn();
    server.use(http.post('/api/metrics/catalog/restingHeartRate', () => {
      post();
      return HttpResponse.json({ _id: 'x', name: 'Ruhepuls' }, { status: 201 });
    }));
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole('button', { name: /Ruhepuls/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it('creates a custom metric', async () => {
    mock();
    let body = null;
    server.use(http.post('/api/metrics', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ _id: 'c', ...body }, { status: 201 });
    }));
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Eigenen Messwert anlegen' }));
    await user.type(screen.getByPlaceholderText('z. B. Ruhepuls'), 'Wasser');
    await user.type(screen.getByPlaceholderText('bpm, %, ml …'), 'ml');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(body).toMatchObject({ name: 'Wasser', unit: 'ml' }));
  });

  it('shows a server error on custom create', async () => {
    mock();
    server.use(http.post('/api/metrics', () => HttpResponse.json({ error: 'Kaputt.' }, { status: 400 })));
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole('button', { name: 'Eigenen Messwert anlegen' }));
    await user.type(screen.getByPlaceholderText('z. B. Ruhepuls'), 'X');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    expect(await screen.findByText('Kaputt.')).toBeInTheDocument();
  });

  it('edits an existing metric name and unit', async () => {
    mock({ metrics: [{ _id: 'm1', name: 'Ruhepuls', unit: 'bpm', showOnDashboard: false }] });
    let put = null;
    server.use(http.put('/api/metrics/m1', async ({ request }) => {
      put = await request.json();
      return HttpResponse.json({ _id: 'm1', ...put });
    }));
    const user = userEvent.setup();
    renderModal();

    const row = await screen.findByTestId('managed-metric');
    await user.click(within(row).getByLabelText('Bearbeiten'));
    const name = within(row).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Puls');
    await user.click(within(row).getByRole('button', { name: 'Sichern' }));

    await waitFor(() => expect(put.name).toBe('Puls'));
  });

  it('toggles a metric onto the dashboard', async () => {
    mock({ metrics: [{ _id: 'm1', name: 'Ruhepuls', unit: 'bpm', showOnDashboard: false }] });
    let put = null;
    server.use(http.put('/api/metrics/m1', async ({ request }) => {
      put = await request.json();
      return HttpResponse.json({ _id: 'm1', showOnDashboard: true });
    }));
    const user = userEvent.setup();
    renderModal();

    const row = await screen.findByTestId('managed-metric');
    await user.click(within(row).getByRole('switch'));
    await waitFor(() => expect(put).toMatchObject({ showOnDashboard: true }));
  });

  it('removes a metric after confirmation', async () => {
    mock({ metrics: [{ _id: 'm1', name: 'Ruhepuls', unit: 'bpm', showOnDashboard: false }] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = vi.fn();
    server.use(http.delete('/api/metrics/m1', () => { del(); return HttpResponse.json({ success: true }); }));
    const user = userEvent.setup();
    renderModal();

    const row = await screen.findByTestId('managed-metric');
    await user.click(within(row).getByLabelText('Entfernen'));
    await waitFor(() => expect(del).toHaveBeenCalled());
  });

  it('does not remove when the confirmation is declined', async () => {
    mock({ metrics: [{ _id: 'm1', name: 'Ruhepuls', unit: 'bpm', showOnDashboard: false }] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const del = vi.fn();
    server.use(http.delete('/api/metrics/m1', () => { del(); return HttpResponse.json({ success: true }); }));
    const user = userEvent.setup();
    renderModal();

    const row = await screen.findByTestId('managed-metric');
    await user.click(within(row).getByLabelText('Entfernen'));
    expect(del).not.toHaveBeenCalled();
  });
});

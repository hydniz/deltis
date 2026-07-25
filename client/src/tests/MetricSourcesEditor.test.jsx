import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import MetricSourcesEditor from '../components/MetricSourcesEditor';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sourcesPayload = {
  policy: { mode: 'all', sources: [] },
  sources: [
    { deviceId: 'phone-a', app: 'com.garmin.android.apps.connectmobile', appLabel: 'Garmin Connect', deviceName: 'Pixel 8' },
    { deviceId: 'phone-b', app: 'com.sec.android.app.shealth', appLabel: 'Samsung Health', deviceName: 'Galaxy S24' },
  ],
};

function mockSources(payload = sourcesPayload) {
  server.use(http.get('/api/metrics/m1/sources', () => HttpResponse.json(payload)));
}

it('shows a hint when no platform sources are detected yet', async () => {
  mockSources({ policy: { mode: 'all', sources: [] }, sources: [] });
  render(<MetricSourcesEditor metricId="m1" />);
  expect(await screen.findByText(/Noch keine Plattform-Quellen/)).toBeInTheDocument();
});

it('lists sources when switched to selection and saves the chosen policy', async () => {
  mockSources();
  let putBody = null;
  server.use(http.put('/api/metrics/m1', async ({ request }) => {
    putBody = await request.json();
    return HttpResponse.json({ ok: true });
  }));
  const user = userEvent.setup();
  render(<MetricSourcesEditor metricId="m1" />);

  // Switch mode to "Nur ausgewählte"
  await user.click(await screen.findByRole('button', { name: 'Nur ausgewählte' }));
  await waitFor(() => expect(putBody).toMatchObject({ sourcePolicy: { mode: 'selected' } }));

  // Pick a specific device+app source
  await user.click(await screen.findByRole('checkbox', { name: 'Garmin Connect · Pixel 8' }));
  await waitFor(() =>
    expect(putBody.sourcePolicy.sources).toEqual(
      expect.arrayContaining([{ deviceId: 'phone-a', app: 'com.garmin.android.apps.connectmobile' }])
    )
  );
});

it('offers an "alle Geräte" wildcard per app', async () => {
  mockSources();
  server.use(http.put('/api/metrics/m1', () => HttpResponse.json({ ok: true })));
  const user = userEvent.setup();
  render(<MetricSourcesEditor metricId="m1" />);

  await user.click(await screen.findByRole('button', { name: 'Nur ausgewählte' }));
  expect(await screen.findByRole('checkbox', { name: 'Garmin Connect · alle Geräte' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Samsung Health · alle Geräte' })).toBeInTheDocument();
});

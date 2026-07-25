import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import Todos from '../pages/Todos';

beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });
afterAll(() => server.close());

const todo = (over = {}) => ({ _id: 't1', title: 'Steuer', priority: 'normal', scheduleMode: 'once', dueDate: '2026-05-01', ...over });
const dueItem = (over = {}) => ({ todoId: 't1', title: 'Steuer', priority: 'normal', done: false, reason: { kind: 'once' }, ...over });

function mock({ todos = [], due = [] } = {}) {
  server.use(
    http.get('/api/todos', () => HttpResponse.json(todos)),
    http.get('/api/todos/due', () => HttpResponse.json(due)),
  );
}

const renderPage = () => render(<MemoryRouter><Todos /></MemoryRouter>);

describe('Todos page', () => {
  it('shows the empty state', async () => {
    mock();
    renderPage();
    expect(await screen.findByText('Noch keine Aufgaben')).toBeInTheDocument();
  });

  it('lists due todos and all tasks', async () => {
    mock({ todos: [todo()], due: [dueItem()] });
    renderPage();
    expect(await screen.findByText('Heute fällig')).toBeInTheDocument();
    expect(screen.getAllByText('Steuer').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('todo-row')).toBeInTheDocument();
  });

  it('completes a due todo', async () => {
    mock({ todos: [todo()], due: [dueItem()] });
    const post = vi.fn();
    server.use(http.post('/api/todos/t1/complete', () => { post(); return HttpResponse.json({ success: true }); }));
    const user = userEvent.setup();
    renderPage();

    const row = await screen.findByTestId('due-todo');
    await user.click(within(row).getByRole('button', { name: /erledigt/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it('opens the create modal', async () => {
    mock();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Noch keine Aufgaben');
    await user.click(screen.getAllByRole('button', { name: /Aufgabe/ })[0]);
    expect(await screen.findByText('Neue Aufgabe')).toBeInTheDocument();
  });

  it('deletes a todo after confirmation', async () => {
    mock({ todos: [todo()], due: [] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = vi.fn();
    server.use(http.delete('/api/todos/t1', () => { del(); return HttpResponse.json({ success: true }); }));
    const user = userEvent.setup();
    renderPage();

    const row = await screen.findByTestId('todo-row');
    await user.click(within(row).getByLabelText('Löschen'));
    await waitFor(() => expect(del).toHaveBeenCalled());
  });
});

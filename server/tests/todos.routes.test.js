const request = require('supertest');
const { startDb, stopDb, clearDb, buildApp, createUser, authHeader } = require('./helpers/testApp');
const Todo = require('../models/Todo');
const TodoCompletion = require('../models/TodoCompletion');
const HabitDefinition = require('../models/HabitDefinition');
const UserHabitSettings = require('../models/UserHabitSettings');
const { dueHabitsForRange } = require('../services/habitSchedule');

let app;
beforeAll(async () => { await startDb(); app = buildApp(); });
afterEach(async () => { await clearDb(); });
afterAll(async () => { await stopDb(); });

const today = () => new Date().toISOString().slice(0, 10);
const create = (token, body) => request(app).post('/api/todos').set(authHeader(token)).send(body);

describe('todo CRUD', () => {
  it('creates a one-off todo defaulting to today', async () => {
    const { token, user } = await createUser();
    const res = await create(token, { title: 'Steuer machen' });
    expect(res.status).toBe(201);
    expect(res.body.scheduleMode).toBe('once');
    expect(res.body.dueDate).toBe(today());
    expect(await Todo.countDocuments({ userId: user._id })).toBe(1);
  });

  it('requires a title', async () => {
    const { token } = await createUser();
    expect((await create(token, { title: '  ' })).status).toBe(400);
  });

  it('validates recurring config', async () => {
    const { token } = await createUser();
    expect((await create(token, { title: 'X', scheduleMode: 'weekly', scheduleDays: [] })).status).toBe(400);
    expect((await create(token, { title: 'X', scheduleMode: 'interval' })).status).toBe(400);
    expect((await create(token, { title: 'X', scheduleMode: 'trigger' })).status).toBe(400);
  });

  it('stores a weekly schedule', async () => {
    const { token } = await createUser();
    const res = await create(token, { title: 'Wäsche', scheduleMode: 'weekly', scheduleDays: [1, 3, 5] });
    expect(res.body.scheduleDays).toEqual([1, 3, 5]);
  });

  it('updates and soft-deletes', async () => {
    const { token, user } = await createUser();
    const t = await Todo.create({ userId: user._id, title: 'Alt', scheduleMode: 'once', dueDate: today() });
    const upd = await request(app).put(`/api/todos/${t._id}`).set(authHeader(token)).send({ title: 'Neu', priority: 'high' });
    expect(upd.body.title).toBe('Neu');
    expect(upd.body.priority).toBe('high');

    expect((await request(app).delete(`/api/todos/${t._id}`).set(authHeader(token))).status).toBe(200);
    expect((await request(app).get('/api/todos').set(authHeader(token))).body.length).toBe(0);
  });

  it('does not touch another user\'s todo', async () => {
    const { token } = await createUser();
    const { user: other } = await createUser({ name: 'Other' });
    const t = await Todo.create({ userId: other._id, title: 'X', dueDate: today() });
    expect((await request(app).put(`/api/todos/${t._id}`).set(authHeader(token)).send({ title: 'Y' })).status).toBe(404);
  });
});

describe('completion', () => {
  it('toggles completion for a day and reflects it in /due', async () => {
    const { token, user } = await createUser();
    const t = await Todo.create({ userId: user._id, title: 'Anrufen', scheduleMode: 'once', dueDate: today() });

    let due = (await request(app).get('/api/todos/due').set(authHeader(token))).body;
    expect(due).toHaveLength(1);
    expect(due[0].done).toBe(false);

    await request(app).post(`/api/todos/${t._id}/complete`).set(authHeader(token)).send({ date: today() });
    due = (await request(app).get('/api/todos/due').set(authHeader(token))).body;
    expect(due[0].done).toBe(true);
    expect(await TodoCompletion.countDocuments({ userId: user._id })).toBe(1);

    // Idempotent.
    await request(app).post(`/api/todos/${t._id}/complete`).set(authHeader(token)).send({ date: today() });
    expect(await TodoCompletion.countDocuments({ userId: user._id })).toBe(1);

    await request(app).delete(`/api/todos/${t._id}/complete?date=${today()}`).set(authHeader(token));
    due = (await request(app).get('/api/todos/due').set(authHeader(token))).body;
    expect(due[0].done).toBe(false);
  });
});

describe('scheduling & triggers', () => {
  it('a daily todo is due every day of the range', async () => {
    const { token, user } = await createUser();
    await Todo.create({ userId: user._id, title: 'Vitamine', scheduleMode: 'daily' });
    const res = await request(app).get(`/api/todos/due?startDate=${today()}&endDate=${today()}`).set(authHeader(token));
    expect(res.body).toHaveLength(1);
  });

  it('a habit can be triggered by a todo completion', async () => {
    const { token, user } = await createUser();
    const todo = await Todo.create({ userId: user._id, title: 'Einkaufen', scheduleMode: 'daily' });
    await TodoCompletion.create({ userId: user._id, todoId: todo._id, date: new Date(`${today()}T00:00:00.000Z`) });

    const habit = await HabitDefinition.create({ userId: user._id, name: 'Kochen', unitSymbol: 'x', type: 'boolean' });
    await UserHabitSettings.findOneAndUpdate(
      { userId: user._id },
      { $addToSet: { selectedHabitIds: habit._id },
        $set: { hasSelection: true, [`habitSettings.${habit._id}`]: {
          scheduleMode: 'trigger', scheduleTrigger: { kind: 'todo', direction: 'after', offsetDays: 0, refId: String(todo._id) },
        } } },
      { upsert: true }
    );

    const due = await dueHabitsForRange(user._id, today(), today());
    const kochen = due.find(d => d.habitId === String(habit._id));
    expect(kochen).toBeTruthy();
    expect(kochen.reason.sourceName).toBe('Einkaufen');
  });

  it('marks the trigger source name for a todo triggered by a habit', async () => {
    const { token, user } = await createUser();
    const habit = await HabitDefinition.create({ userId: user._id, name: 'Sport', unitSymbol: 'x', type: 'boolean' });
    // A todo due the day a habit was logged.
    const { HabitLog } = { HabitLog: require('../models/HabitLog') };
    await HabitLog.create({ userId: user._id, habitId: habit._id, date: new Date(`${today()}T12:00:00.000Z`), value: 1 });
    await Todo.create({
      userId: user._id, title: 'Dehnen', scheduleMode: 'trigger',
      scheduleTrigger: { kind: 'habit', direction: 'after', offsetDays: 0, refId: habit._id },
    });

    const res = await request(app).get('/api/todos/due').set(authHeader(token));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reason.kind).toBe('trigger');
    expect(res.body[0].reason.sourceName).toBe('Sport');
  });
});

describe('todo reminder time on the profile', () => {
  it('defaults to 18:00 and is updatable', async () => {
    const { token } = await createUser();
    const me = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(me.body.todoReminderTime).toBe('18:00');

    const upd = await request(app).put('/api/auth/me').set(authHeader(token)).send({ todoReminderTime: '20:30' });
    expect(upd.status).toBe(200);
    expect(upd.body.todoReminderTime).toBe('20:30');

    expect((await request(app).put('/api/auth/me').set(authHeader(token)).send({ todoReminderTime: '99:99' })).status).toBe(400);
  });
});

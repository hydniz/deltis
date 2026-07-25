// "Aufgaben" — the to-do page. Shows what's due today (checkable) and the full
// list of tasks with their schedule, and hosts create/edit. Backed by
// /api/todos; the dashboard and planner reuse the same /todos/due data.
import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { CheckSquare, Square, Plus, Pencil, Trash2, ListTodo, Flag } from 'lucide-react';
import { PageHeader, Button, Spinner, EmptyState, Chip, IconButton } from '../components/ui';
import TodoModal from '../components/TodoModal';

const todayStr = () => new Date().toISOString().slice(0, 10);

const PRIORITY = {
  high: { label: 'Hoch', color: 'rose' },
  normal: { label: 'Normal', color: 'stone' },
  low: { label: 'Niedrig', color: 'sage' },
};

function scheduleLabel(todo) {
  const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  switch (todo.scheduleMode) {
    case 'once': return todo.dueDate ? `Fällig ${format(parseISO(todo.dueDate), 'd. MMM', { locale: de })}` : 'Einmalig';
    case 'daily': return 'Täglich';
    case 'weekly': return (todo.scheduleDays || []).length
      ? `Wöchentlich · ${todo.scheduleDays.slice().sort().map(d => DAYS[d]).join(', ')}` : 'Wöchentlich';
    case 'interval': return `Alle ${todo.scheduleIntervalDays} Tage`;
    case 'trigger': return 'Durch Auslöser';
    default: return '';
  }
}

export default function Todos() {
  const [todos, setTodos] = useState(null);
  const [due, setDue] = useState([]);
  const [sources, setSources] = useState({});
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new

  const load = useCallback(async () => {
    const [todosRes, dueRes] = await Promise.all([
      api.get('/todos'),
      api.get('/todos/due', { params: { startDate: todayStr(), endDate: todayStr() } }).catch(() => ({ data: [] })),
    ]);
    setTodos(todosRes.data);
    setDue(dueRes.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Trigger-source options for the modal (best-effort).
  useEffect(() => {
    Promise.all([
      api.get('/habits/definitions').then(r => r.data.filter(h => !h.hidden)).catch(() => []),
      api.get('/activity-types').then(r => r.data).catch(() => []),
      api.get('/training-types').then(r => r.data).catch(() => []),
      api.get('/todos').then(r => r.data).catch(() => []),
      api.get('/strava/sport-types').then(r => r.data).catch(() => []),
    ]).then(([habits, activityTypes, trainingTypes, allTodos, sportTypes]) =>
      setSources({ habits, activityTypes, trainingTypes, todos: allTodos, sportTypes }));
  }, [todos]);

  const toggle = async (item) => {
    // Optimistic.
    setDue(prev => prev.map(d => d.todoId === item.todoId ? { ...d, done: !d.done } : d));
    try {
      if (item.done) await api.delete(`/todos/${item.todoId}/complete`, { params: { date: todayStr() } });
      else await api.post(`/todos/${item.todoId}/complete`, { date: todayStr() });
    } catch {
      load();
    }
  };

  const remove = async (todo) => {
    if (!confirm(`„${todo.title}“ löschen?`)) return;
    await api.delete(`/todos/${todo._id}`);
    load();
  };

  const openTodos = due.filter(d => !d.done);
  const doneTodos = due.filter(d => d.done);

  return (
    <div className="space-y-6 anim-list">
      <PageHeader
        icon={ListTodo}
        title="Aufgaben"
        subtitle="Einmalig oder wiederkehrend — mit Auslösern, die an den Rest andocken."
        tone="amber"
        action={<Button icon={Plus} onClick={() => setEditing(null)}>Aufgabe</Button>}
      />

      {todos === null ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : todos.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          tone="amber"
          title="Noch keine Aufgaben"
          text="Lege eine Aufgabe an — einmalig, wiederkehrend oder ausgelöst durch eine Gewohnheit, Aktivität oder ein Training."
          action={<Button icon={Plus} onClick={() => setEditing(null)}>Aufgabe anlegen</Button>}
        />
      ) : (
        <>
          {/* Today */}
          <div className="card p-5">
            <h2 className="display text-lg mb-3">Heute fällig</h2>
            {due.length === 0 ? (
              <p className="text-sm text-ink-400">Heute ist nichts fällig.</p>
            ) : (
              <ul className="divide-hairline">
                {[...openTodos, ...doneTodos].map(item => (
                  <li key={item.todoId} className="flex items-center gap-3 py-2.5" data-testid="due-todo">
                    <button type="button" onClick={() => toggle(item)} className="flex-shrink-0 text-brand-600" aria-label={item.done ? 'Als offen markieren' : 'Als erledigt markieren'}>
                      {item.done ? <CheckSquare size={20} /> : <Square size={20} className="text-ink-300" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${item.done ? 'line-through text-ink-400' : 'text-ink-800'}`}>{item.title}</p>
                      {item.reason?.kind === 'trigger' && (
                        <p className="text-[11px] text-ink-400 truncate">Ausgelöst durch {item.reason.sourceName}</p>
                      )}
                    </div>
                    {item.priority === 'high' && <Flag size={14} className="text-rose-500 flex-shrink-0" aria-label="Hohe Priorität" />}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* All tasks */}
          <div className="card p-5">
            <h2 className="display text-lg mb-3">Alle Aufgaben</h2>
            <ul className="divide-hairline">
              {todos.map(todo => (
                <li key={todo._id} className="flex items-center gap-3 py-2.5" data-testid="todo-row">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-800 truncate">{todo.title}</p>
                    <p className="text-[11px] text-ink-400 truncate flex items-center gap-1.5">
                      <Chip color={PRIORITY[todo.priority]?.color || 'stone'} className="!py-0 !px-1.5 !text-[10px]">
                        {PRIORITY[todo.priority]?.label}
                      </Chip>
                      {scheduleLabel(todo)}
                    </p>
                  </div>
                  <IconButton icon={Pencil} label="Bearbeiten" onClick={() => setEditing(todo)} />
                  <IconButton icon={Trash2} label="Löschen" onClick={() => remove(todo)} />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {editing !== undefined && (
        <TodoModal
          todo={editing}
          sources={sources}
          onSaved={() => { setEditing(undefined); load(); }}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

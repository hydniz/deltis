// Shareable heatmap arrangement: pick any goal and habit heatmaps, order and
// lay them out, then screenshot the framed canvas for social media. Pure
// client view — nothing is uploaded anywhere.
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ArrowLeft, ArrowUp, ArrowDown, Share2, Target, Sparkles, Camera } from 'lucide-react';
import api from '../utils/api';
import { PageHeader, Button, Chip, Segmented, PageLoader, EmptyState } from '../components/ui';
import { DeltaMark } from '../components/Logo';
import { APP_NAME } from '../config/branding';
import GoalHeatmap from '../components/GoalHeatmap';
import HabitHeatmap from '../components/HabitHeatmap';

const COLUMN_OPTIONS = [
  { value: '1', label: '1 Spalte' },
  { value: '2', label: '2 Spalten' },
];

export default function ShareView() {
  const [goals, setGoals] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  // Ordered list of selected tiles: { kind: 'goal'|'habit', id }
  const [selected, setSelected] = useState([]);
  const [columns, setColumns] = useState('1');

  useEffect(() => {
    Promise.all([
      api.get('/goals'),
      api.get('/habits/definitions'),
    ]).then(([goalsRes, habitsRes]) => {
      // Meta goals have no daily heatmap — leave them out of the picker.
      setGoals(goalsRes.data.filter(g => g.type !== 'meta'));
      setHabits(habitsRes.data.filter(h => h.selected));
    }).catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const keyOf = (item) => `${item.kind}:${item.id}`;
  const isSelected = (kind, id) => selected.some(s => s.kind === kind && s.id === id);

  const toggle = (kind, id) => {
    setSelected(prev => isSelected(kind, id)
      ? prev.filter(s => !(s.kind === kind && s.id === id))
      : [...prev, { kind, id }]
    );
  };

  const move = (index, delta) => {
    setSelected(prev => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const resolve = (item) => item.kind === 'goal'
    ? goals.find(g => g._id === item.id)
    : habits.find(h => h._id === item.id);

  const tiles = selected.map(item => ({ item, doc: resolve(item) })).filter(t => t.doc);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Share-Ansicht"
        subtitle="Heatmaps auswählen, anordnen und als Screenshot teilen"
        icon={Share2}
        tone="amber"
        action={
          <Link to="/goals">
            <Button variant="secondary" icon={ArrowLeft}>
              <span className="hidden sm:inline">Zurück</span>
            </Button>
          </Link>
        }
      />

      {loading ? (
        <PageLoader />
      ) : goals.length === 0 && habits.length === 0 ? (
        <EmptyState
          icon={Share2}
          tone="amber"
          title="Nichts zum Teilen"
          text="Lege zuerst Ziele oder Gewohnheiten an – ihre Heatmaps erscheinen dann hier."
        />
      ) : (
        <>
          {/* Picker */}
          <div className="card p-4 space-y-3">
            {goals.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400 mb-1.5 flex items-center gap-1">
                  <Target size={10} /> Ziele
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {goals.map(g => (
                    <Chip
                      key={g._id}
                      color="amber"
                      active={isSelected('goal', g._id)}
                      onClick={() => toggle('goal', g._id)}
                    >
                      {g.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {habits.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-400 mb-1.5 flex items-center gap-1">
                  <Sparkles size={10} /> Gewohnheiten
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {habits.map(h => (
                    <Chip
                      key={h._id}
                      color="sage"
                      active={isSelected('habit', h._id)}
                      onClick={() => toggle('habit', h._id)}
                    >
                      {h.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Segmented options={COLUMN_OPTIONS} value={columns} onChange={setColumns} />
              <p className="text-xs text-ink-400 flex items-center gap-1.5">
                <Camera size={12} />
                Screenshot vom Rahmen unten machen
              </p>
            </div>
          </div>

          {/* Screenshot canvas */}
          {tiles.length === 0 ? (
            <p className="text-sm text-ink-400 text-center py-6">
              Wähle oben Ziele oder Gewohnheiten aus, um dein Share-Bild zusammenzustellen.
            </p>
          ) : (
            <div className="card p-5 sm:p-6" data-testid="share-canvas">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <DeltaMark size="sm" />
                  <span className="font-display font-semibold tracking-tight text-ink-900">
                    {APP_NAME}
                  </span>
                </div>
                <p className="text-xs text-ink-400">
                  {format(new Date(), 'd. MMMM yyyy', { locale: de })}
                </p>
              </div>

              <div className={`grid gap-4 ${columns === '2' ? 'sm:grid-cols-2' : ''}`}>
                {tiles.map(({ item, doc }, index) => (
                  <div key={keyOf(item)} className="panel p-4 relative group">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink-800 truncate">{doc.name}</p>
                      {/* Order controls disappear in the screenshot when not hovered */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => move(index, -1)}
                          aria-label="Nach oben"
                          className="p-1 text-ink-300 hover:text-brand-600 transition-colors"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          onClick={() => move(index, 1)}
                          aria-label="Nach unten"
                          className="p-1 text-ink-300 hover:text-brand-600 transition-colors"
                        >
                          <ArrowDown size={13} />
                        </button>
                      </div>
                    </div>
                    {/* Cap the grid width — full-width cells blow up on
                        desktop and make the screenshot unusable */}
                    <div className="max-w-sm">
                      {item.kind === 'goal'
                        ? <GoalHeatmap goal={doc} showLegend={false} />
                        : <HabitHeatmap habit={doc} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

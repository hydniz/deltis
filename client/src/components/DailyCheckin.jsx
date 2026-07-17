// Daily check-in: on the first page visit after one of the user's configured
// reminder times, a short skippable questionnaire (Whoop-style) offers all
// due-but-unfilled habits of the day for quick logging. Already-filled
// habits are tucked away behind a collapsed "nachbessern" section so
// corrections are possible without being pushy.
import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Sparkles, Check, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { Modal, Button, Input } from './ui';

const STORAGE_PREFIX = 'deltis.checkin';

// The latest configured time that has already passed today, or null.
export function duePassedSlot(times, now = new Date()) {
  const current = format(now, 'HH:mm');
  const passed = (times || []).filter(t => t <= current).sort();
  return passed.length > 0 ? passed[passed.length - 1] : null;
}

function slotKey(dateStr, slot) {
  return `${STORAGE_PREFIX}.${dateStr}.${slot}`;
}

// One habit row inside the questionnaire: booleans confirm with one tap,
// value habits take a number. Saving posts immediately (upsert per day).
function CheckinRow({ entry, onLogged }) {
  const [value, setValue] = useState(entry.loggedValue ?? '');
  const [saving, setSaving] = useState(false);
  const isBoolean = entry.type === 'boolean';

  const submit = async (v) => {
    setSaving(true);
    try {
      await api.post('/habits/logs', {
        habitId: entry.habitId,
        date: `${entry.date}T12:00:00`,
        value: v,
      });
      onLogged(entry.habitId, v);
    } catch { /* row stays editable on failure */ } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-800 truncate">{entry.name}</p>
        {!isBoolean && entry.targetCondition !== 'none' && (
          <p className="text-xs text-ink-400">
            Ziel: {entry.targetCondition === 'max' ? 'max.' : entry.targetCondition === 'exact' ? 'genau' : 'min.'}{' '}
            {entry.targetValue} {entry.unitSymbol}
          </p>
        )}
      </div>
      {isBoolean ? (
        <Button size="sm" icon={Check} loading={saving} onClick={() => submit(1)}>
          Erledigt
        </Button>
      ) : (
        <form
          onSubmit={e => { e.preventDefault(); if (value !== '') submit(+value); }}
          className="flex items-center gap-1.5"
        >
          <Input
            type="number"
            value={value}
            onChange={e => setValue(e.target.value)}
            className="!w-24 !py-1.5 !text-sm"
            placeholder={entry.unitSymbol || ''}
            min="0"
            step="0.01"
          />
          <Button type="submit" size="sm" loading={saving} disabled={value === ''}>
            OK
          </Button>
        </form>
      )}
    </div>
  );
}

export default function DailyCheckin() {
  const { user } = useAuth();
  const [entries, setEntries] = useState(null); // today's due habits
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState(null);
  const [showFilled, setShowFilled] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  // Decide once per mount whether a check-in is pending.
  useEffect(() => {
    if (!user?.checkinTimes?.length) return;
    const due = duePassedSlot(user.checkinTimes);
    if (!due) return;
    const key = slotKey(today, due);
    if (localStorage.getItem(key)) return; // already done or skipped

    let cancelled = false;
    api.get('/habits/due', { params: { startDate: today, endDate: today } })
      .then(res => {
        if (cancelled) return;
        const list = res.data || [];
        const openEntries = list.filter(e => !(e.fulfilled ?? e.logged));
        if (openEntries.length === 0) {
          // Nothing to ask — mark the slot quietly, no dialog.
          localStorage.setItem(key, 'auto');
          return;
        }
        setEntries(list);
        setSlot(due);
        setOpen(true);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.checkinTimes?.join(',')]);

  const close = useCallback((status) => {
    if (slot) localStorage.setItem(slotKey(today, slot), status);
    setOpen(false);
  }, [slot, today]);

  const handleLogged = (habitId, value) => {
    setEntries(prev => (prev || []).map(e =>
      e.habitId === habitId ? { ...e, logged: true, fulfilled: true, loggedValue: value } : e
    ));
  };

  if (!open || !entries) return null;

  const openEntries = entries.filter(e => !(e.fulfilled ?? e.logged));
  const filledEntries = entries.filter(e => (e.fulfilled ?? e.logged));
  const allDone = openEntries.length === 0;

  return (
    <Modal
      onClose={() => close('skipped')}
      title="Kurzer Check-in"
      subtitle={format(new Date(), 'EEEE, d. MMMM', { locale: de })}
      icon={Sparkles}
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={() => close('skipped')}>
            Überspringen
          </Button>
          <Button className="flex-1" icon={Check} onClick={() => close('done')}>
            {allDone ? 'Fertig' : 'Fertig für jetzt'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-500">
          {allDone
            ? 'Alles ausgefüllt – stark!'
            : `Diese Gewohnheiten stehen heute noch aus (${openEntries.length}):`}
        </p>

        {openEntries.length > 0 && (
          <div className="divide-hairline">
            {openEntries.map(entry => (
              <CheckinRow key={entry.habitId} entry={entry} onLogged={handleLogged} />
            ))}
          </div>
        )}

        {/* Corrections — deliberately unobtrusive behind a collapsed toggle */}
        {filledEntries.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowFilled(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-ink-400 hover:text-ink-600 transition-colors"
            >
              {showFilled ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Bereits ausgefüllte nachbessern ({filledEntries.length})
            </button>
            {showFilled && (
              <div className="divide-hairline mt-1">
                {filledEntries.map(entry => (
                  <CheckinRow key={entry.habitId} entry={entry} onLogged={handleLogged} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

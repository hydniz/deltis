import { useState } from 'react';
import { GripVertical, Lock } from 'lucide-react';
import { navItems } from './Sidebar';
import { HOME_PATH, applyOrder, saveOrder } from '../utils/navOrder';

// Drag-and-drop reordering of the main navigation. Home is pinned to the first
// position (not draggable); the rest can be freely arranged and the order is
// saved instantly (device-local) and picked up live by the sidebar & tab bar.
export default function NavOrderEditor() {
  const home = navItems.find(i => i.to === HOME_PATH);
  const [items, setItems] = useState(() => applyOrder(navItems).filter(i => i.to !== HOME_PATH));
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const commit = (next) => {
    setItems(next);
    saveOrder([HOME_PATH, ...next.map(i => i.to)]);
  };

  const drop = (i) => {
    if (dragIdx !== null && dragIdx !== i) {
      const next = [...items];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(i, 0, moved);
      commit(next);
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const Row = ({ icon: Icon, label, pinned, i }) => (
    <div
      draggable={!pinned}
      onDragStart={() => setDragIdx(i)}
      onDragOver={(e) => { e.preventDefault(); if (!pinned) setOverIdx(i); }}
      onDrop={() => !pinned && drop(i)}
      onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors select-none ${
        pinned
          ? 'border-transparent bg-paper-50 text-ink-400'
          : `cursor-grab active:cursor-grabbing border-paper-200 bg-surface hover:border-ink-300 ${
              dragIdx === i ? 'opacity-40' : ''
            } ${overIdx === i && dragIdx !== i ? 'border-brand-400 ring-1 ring-brand-300' : ''}`
      }`}
    >
      {pinned ? <Lock size={14} className="text-ink-300 flex-shrink-0" />
        : <GripVertical size={16} className="text-ink-300 flex-shrink-0" />}
      <Icon size={16} className="flex-shrink-0" />
      <span className="text-sm font-medium text-ink-800">{label}</span>
      {pinned && <span className="ml-auto text-[11px] text-ink-300">Startseite</span>}
    </div>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-400">
        Ziehe die Einträge in deine Wunschreihenfolge. Die Startseite bleibt vorne.
      </p>
      <div className="space-y-1.5">
        {home && <Row icon={home.icon} label={home.label} pinned />}
        {items.map((it, i) => (
          <Row key={it.to} icon={it.icon} label={it.label} i={i} />
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import api from '../utils/api';
import { Button, Field, Input, Select, Modal } from './ui';

// Quick-create modal for a habit definition. Marks the new habit as selected
// so it appears on the Habits page and in pickers right away.
// Used by the goal wizard when no habit exists yet.
export default function NewHabitModal({ onCreated, onClose }) {
  const [form, setForm] = useState({ name: '', unitSymbol: '', type: 'amount' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.unitSymbol.trim()) return;
    setSaving(true);
    try {
      const res = await api.post('/habits/definitions', form);
      const created = res.data;
      // Keep existing selection and add the new habit to it.
      const defs = await api.get('/habits/definitions');
      const selectedIds = defs.data.filter(d => d.selected).map(d => d._id);
      if (!selectedIds.includes(created._id)) selectedIds.push(created._id);
      await api.put('/habits/selection', { selectedIds });
      onCreated({ ...created, selected: true });
    } catch (err) {
      alert('Fehler: ' + err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Neue Gewohnheit"
      subtitle="Wird direkt aktiviert"
      icon={Sparkles}
      size="sm"
      zIndex="z-[60]"
      footer={
        <>
          <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          <Button
            type="submit"
            form="new-habit-form"
            className="flex-1"
            loading={saving}
            disabled={!form.name.trim() || !form.unitSymbol.trim()}
          >
            Erstellen
          </Button>
        </>
      }
    >
      <form id="new-habit-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="z.B. Vitamine, Stretching …"
            autoFocus
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Einheit">
            <Input
              value={form.unitSymbol}
              onChange={e => setForm(f => ({ ...f, unitSymbol: e.target.value }))}
              placeholder="z.B. min, ml, Stück"
              required
            />
          </Field>
          <Field label="Typ">
            <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="amount">Menge</option>
              <option value="duration">Dauer</option>
            </Select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

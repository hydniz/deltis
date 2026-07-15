import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Button, Field, Input, Select, Checkbox, Modal, IconButton,
} from './ui';

// Shared 2-step create/edit wizard for activity types. Used by the
// Activities page (type management) and the goal wizard (inline creation).

// OptionsInput
// Keeps raw text locally – only parses on blur.
// Prevents cursor jumping in controlled inputs with split/join transformations.

function OptionsInput({ options, onChange }) {
  const [raw, setRaw] = useState((options || []).join(', '));

  const handleBlur = () => {
    const parsed = raw.split(',').map(s => s.trim()).filter(Boolean);
    onChange(parsed);
    setRaw(parsed.join(', '));
  };

  return (
    <Input
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={handleBlur}
      placeholder="z.B. Push, Pull, Legs"
    />
  );
}

// CustomFieldEditor

function CustomFieldEditor({ field, onChange, onRemove }) {
  return (
    <div className="panel p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">Feld</span>
        <IconButton icon={X} label="Feld entfernen" tone="danger" size={14} onClick={onRemove} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <Input
            value={field.label}
            onChange={e => onChange({ ...field, label: e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
            placeholder="z.B. Gesamtgewicht"
          />
        </Field>
        <Field label="Typ">
          <Select
            value={field.type}
            onChange={e => onChange({ ...field, type: e.target.value, options: [], unit: '' })}
          >
            <option value="number">Zahl</option>
            <option value="select">Auswahl (einzeln)</option>
            <option value="multiselect">Auswahl (mehrfach)</option>
          </Select>
        </Field>
      </div>
      {field.type === 'number' && (
        <Field label="Einheit">
          <Input
            value={field.unit || ''}
            onChange={e => onChange({ ...field, unit: e.target.value })}
            placeholder="z.B. kg, km, kcal"
          />
        </Field>
      )}
      {(field.type === 'select' || field.type === 'multiselect') && (
        <Field label="Optionen (kommagetrennt)">
          <OptionsInput
            options={field.options}
            onChange={parsed => onChange({ ...field, options: parsed })}
          />
        </Field>
      )}
      <Checkbox
        checked={field.showInPreview !== false}
        onChange={e => onChange({ ...field, showInPreview: e.target.checked })}
        label="In Aktivitätenvorschau anzeigen"
      />
    </div>
  );
}

// ActivityTypeWizard

export default function ActivityTypeWizard({ initialForm, title, submitLabel, onSubmit, onClose, originalFieldCount = 0 }) {
  const [form, setForm] = useState({ ...initialForm });
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const STEPS = 2;
  const stepTitles = ['Grundlagen', 'Eigene Felder'];

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addCustomField = () => setForm(f => ({
    ...f,
    customFields: [...(f.customFields || []), { key: '', label: '', type: 'number', unit: '', options: [] }]
  }));

  const updateCustomField = (i, updatedField) => setForm(f => ({
    ...f,
    customFields: f.customFields.map((cf, idx) => {
      if (idx !== i) return cf;
      if (idx < originalFieldCount) return { ...updatedField, key: cf.key };
      return updatedField;
    })
  }));

  const removeCustomField = (i) => setForm(f => ({
    ...f,
    customFields: f.customFields.filter((_, idx) => idx !== i)
  }));

  const handleSubmit = async () => {
    if (!form.label.trim()) return;
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (err) {
      alert('Fehler: ' + err.message);
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={title}
      subtitle={stepTitles[step - 1]}
      size="lg"
      zIndex="z-[60]"
      steps={STEPS}
      step={step}
      footer={
        <>
          {step > 1
            ? <Button variant="secondary" className="flex-1" onClick={() => setStep(s => s - 1)}>Zurück</Button>
            : <Button variant="secondary" className="flex-1" onClick={onClose}>Abbrechen</Button>
          }
          {step < STEPS ? (
            <Button className="flex-1" disabled={!form.label.trim()} onClick={() => setStep(s => s + 1)}>
              Weiter
            </Button>
          ) : (
            <Button className="flex-1" loading={saving} disabled={!form.label.trim()} onClick={handleSubmit}>
              {submitLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Step 1: basics */}
        {step === 1 && (<>
          <Field label="Name des Aktivitätstyps">
            <Input
              className="!text-base"
              value={form.label}
              onChange={e => setField('label', e.target.value)}
              placeholder="z.B. Joggen, Krafttraining, Klettern …"
              autoFocus
            />
          </Field>

          <div className="panel p-4 space-y-3.5">
            <p className="label !mb-0">Standard-Felder</p>
            <Checkbox
              checked={form.showDuration}
              onChange={e => setField('showDuration', e.target.checked)}
              label="Dauer"
              description="Dauer der Aktivität in Minuten"
            />
            <Checkbox
              checked={form.showDistance}
              onChange={e => setField('showDistance', e.target.checked)}
              label="Distanz"
              description="Zurückgelegte Distanz in km"
            />
          </div>
        </>)}

        {/* Step 2: custom fields */}
        {step === 2 && (<>
          <div className="flex items-center justify-between">
            <div>
              <p className="display text-base">Eigene Felder</p>
              <p className="text-xs text-ink-400 mt-0.5">Optionale Felder, die du selbst definierst</p>
            </div>
            <button
              type="button"
              onClick={addCustomField}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              <Plus size={14} /> Feld hinzufügen
            </button>
          </div>

          {(form.customFields || []).length === 0 ? (
            <button
              type="button"
              onClick={addCustomField}
              className="w-full border-2 border-dashed border-ink-200 hover:border-brand-400 rounded-2xl py-8 text-ink-400 hover:text-brand-600 transition-colors flex flex-col items-center gap-2"
            >
              <Plus size={22} />
              <span className="text-sm font-medium">Erstes Feld hinzufügen</span>
            </button>
          ) : (
            <div className="space-y-2.5">
              {(form.customFields || []).map((field, i) => (
                <CustomFieldEditor
                  key={i}
                  field={field}
                  onChange={updated => updateCustomField(i, updated)}
                  onRemove={() => removeCustomField(i)}
                />
              ))}
            </div>
          )}
        </>)}
      </div>
    </Modal>
  );
}

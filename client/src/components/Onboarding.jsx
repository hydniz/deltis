import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import api from '../utils/api';
import { DeltaMark } from './Logo';
import {
  Sun, Moon, MonitorSmartphone, Sparkles, Dumbbell, User, Scale, Check,
  ArrowRight, ArrowLeft, PartyPopper,
} from 'lucide-react';
import { Button, Field, Input, Select } from './ui';

// First-login setup wizard. The current step is persisted server-side
// (user.onboardingStep) after every transition, so the user resumes exactly
// where they left off after logging out and back in.
//
// Steps: 0 Willkommen · 1 Profil · 2 Gewohnheiten · 3 Aktivitäten · 4 Fertig

const STEP_LABELS = ['Willkommen', 'Profil', 'Gewohnheiten', 'Aktivitäten', 'Fertig'];
const LAST_STEP = STEP_LABELS.length - 1;

const THEME_OPTIONS = [
  { value: 'light', label: 'Hell', icon: Sun },
  { value: 'dark', label: 'Dunkel', icon: Moon },
  { value: 'system', label: 'System', icon: MonitorSmartphone },
];

// Selectable pill card used by the habit and activity steps.
function PickCard({ title, subtitle, selected, onToggle, delay }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      style={{ animationDelay: `${delay}ms` }}
      className={`anim-fade-up w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left
        transition-all duration-150 ${
        selected
          ? 'border-brand-400 bg-brand-50 shadow-card'
          : 'hairline bg-surface hover:border-ink-300'
      }`}
    >
      <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
        border-2 transition-colors ${
        selected ? 'bg-brand-500 border-brand-500' : 'border-ink-200 bg-surface'
      }`}>
        {selected && <Check size={13} className="text-white" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-semibold truncate ${selected ? 'text-brand-700' : 'text-ink-800'}`}>
          {title}
        </span>
        {subtitle && <span className="block text-xs text-ink-400 truncate">{subtitle}</span>}
      </span>
    </button>
  );
}

function StepHeading({ icon: Icon, title, text }) {
  return (
    <div className="text-center mb-6">
      <div className="anim-pop w-14 h-14 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-4">
        <Icon size={22} />
      </div>
      <h2 className="display text-2xl anim-fade-up">{title}</h2>
      {text && (
        <p className="text-sm text-ink-500 mt-2 max-w-sm mx-auto leading-relaxed anim-fade-up" style={{ animationDelay: '80ms' }}>
          {text}
        </p>
      )}
    </div>
  );
}

export default function Onboarding() {
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();

  const [step, setStep] = useState(() => Math.min(Math.max(user?.onboardingStep ?? 0, 0), LAST_STEP));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1 – profile
  const [name, setName] = useState(user?.name || '');
  const [weightUnit, setWeightUnit] = useState(user?.weightUnit || 'kg');
  const [weight, setWeight] = useState('');

  // Step 2 – predefined habits (opt-in: none preselected)
  const [habitDefs, setHabitDefs] = useState(null);
  const [selectedHabits, setSelectedHabits] = useState(new Set());

  // Step 3 – predefined activity types (opt-in: none preselected)
  const [typeDefaults, setTypeDefaults] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState(new Set());

  useEffect(() => {
    api.get('/habits/definitions').then(res => {
      setHabitDefs(res.data.filter(d => d.isPredefined));
    }).catch(() => setHabitDefs([]));

    api.get('/activity-types/defaults').then(res => {
      setTypeDefaults(res.data);
    }).catch(() => setTypeDefaults([]));
  }, []);

  const toggleIn = (setter) => (key) => setter(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const toggleHabit = toggleIn(setSelectedHabits);
  const toggleType = toggleIn(setSelectedTypes);

  const persistStep = async (nextStep) => {
    const res = await api.put('/auth/me/onboarding', { step: nextStep });
    updateUser(res.data);
    setStep(nextStep);
  };

  // Save the current step's data, then advance (server-persisted).
  const handleNext = async () => {
    setSaving(true);
    setError('');
    try {
      if (step === 1) {
        const res = await api.put('/auth/me', { name: name.trim() || user.name, weightUnit });
        updateUser(res.data);
        if (weight !== '' && +weight > 0) {
          await api.post('/weight', { date: new Date().toISOString(), weight: +weight });
        }
      }
      if (step === 2) {
        await api.put('/habits/selection', { selectedIds: [...selectedHabits] });
      }
      if (step === 3) {
        await api.post('/activity-types/setup', { labels: [...selectedTypes] });
      }
      await persistStep(step + 1);
    } catch (err) {
      setError(err.response?.data?.error || 'Speichern fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = async () => {
    if (step === 0 || saving) return;
    try {
      await persistStep(step - 1);
    } catch {
      setStep(s => Math.max(0, s - 1));
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.put('/auth/me/onboarding', { completed: true });
      updateUser(res.data); // onboardingPending → false unmounts the wizard
    } catch (err) {
      setError(err.response?.data?.error || 'Abschließen fehlgeschlagen.');
      setSaving(false);
    }
  };

  const progressPct = (step / LAST_STEP) * 100;

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto" style={{ background: 'var(--bg-base)' }}>
      {/* Ambient orbs, gently floating */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="orb anim-float w-80 h-80 -left-20 -top-16 bg-brand-200/50" />
        <div className="orb anim-float w-72 h-72 -right-16 top-1/4 bg-rose-200/40" style={{ animationDelay: '1.6s' }} />
        <div className="orb anim-float w-96 h-96 left-1/3 -bottom-24 bg-ocher-200/45" style={{ animationDelay: '3.2s' }} />
        <div className="orb anim-float w-60 h-60 left-[8%] bottom-[18%] bg-sage-200/40" style={{ animationDelay: '4.6s' }} />
      </div>

      <div className="relative min-h-full flex items-center justify-center p-4 py-10">
        <div className="w-full max-w-lg">

          {/* Progress */}
          <div className="mb-6 anim-fade-up">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Schritt {step + 1} von {STEP_LABELS.length}
              </p>
              <p className="text-[11px] font-semibold text-brand-600">{STEP_LABELS[step]}</p>
            </div>
            <div className="h-1.5 bg-paper-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${progressPct}%`,
                  background: 'linear-gradient(90deg, var(--brand-400), var(--brand-600))',
                }}
              />
            </div>
          </div>

          {/* Step content — key remounts so every step animates in */}
          <div key={step} className="card rounded-3xl p-6 sm:p-8 anim-fade-up">

            {step === 0 && (
              <div className="text-center">
                <div className="anim-pop flex justify-center mb-5">
                  <DeltaMark size="lg" />
                </div>
                <h1 className="display text-3xl anim-fade-up">
                  Willkommen{user?.name ? `, ${user.name}` : ''}!
                </h1>
                <p className="text-ink-500 text-sm mt-3 max-w-sm mx-auto leading-relaxed anim-fade-up" style={{ animationDelay: '90ms' }}>
                  Lass uns Deltis in zwei Minuten für dich einrichten. Alles hier
                  kannst du später jederzeit in den Einstellungen ändern.
                </p>

                <div className="mt-7 anim-fade-up" style={{ animationDelay: '180ms' }}>
                  <p className="label !mb-2.5 text-center">Wie soll Deltis aussehen?</p>
                  <div className="flex justify-center gap-2">
                    {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTheme(value)}
                        aria-pressed={theme === value}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold border transition-all ${
                          theme === value
                            ? 'border-brand-400 bg-brand-50 text-brand-700'
                            : 'hairline bg-surface text-ink-500 hover:text-ink-800'
                        }`}
                      >
                        <Icon size={13} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <>
                <StepHeading
                  icon={User}
                  title="Dein Profil"
                  text="Wie dürfen wir dich nennen — und womit misst du dein Gewicht?"
                />
                <div className="space-y-4">
                  <Field label="Name">
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Dein Name" />
                  </Field>
                  <Field label="Gewichtseinheit">
                    <Select value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
                      <option value="kg">Kilogramm (kg)</option>
                      <option value="lbs">Pfund (lbs)</option>
                    </Select>
                  </Field>
                  <Field label={`Aktuelles Gewicht in ${weightUnit} (optional)`}>
                    <div className="relative">
                      <Scale size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300" />
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        className="!pl-9"
                        value={weight}
                        onChange={e => setWeight(e.target.value)}
                        placeholder="Startpunkt für deine Gewichtskurve"
                      />
                    </div>
                  </Field>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <StepHeading
                  icon={Sparkles}
                  title="Deine Gewohnheiten"
                  text="Welche davon möchtest du täglich tracken? Wähle aus, was du brauchst — eigene kannst du später anlegen."
                />
                <div className="grid sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-0.5">
                  {habitDefs === null && <p className="text-sm text-ink-400 col-span-2 text-center py-6">Lade…</p>}
                  {habitDefs?.map((d, i) => (
                    <PickCard
                      key={d._id}
                      title={d.name}
                      subtitle={`in ${d.unitSymbol}`}
                      selected={selectedHabits.has(d._id)}
                      onToggle={() => toggleHabit(d._id)}
                      delay={i * 55}
                    />
                  ))}
                </div>
                <p className="text-xs text-ink-400 mt-3 text-center">
                  {selectedHabits.size} von {habitDefs?.length ?? 0} ausgewählt
                </p>
              </>
            )}

            {step === 3 && (
              <>
                <StepHeading
                  icon={Dumbbell}
                  title="Deine Aktivitäten"
                  text="Welche Sportarten willst du erfassen? Eigene Typen mit eigenen Feldern kannst du später hinzufügen."
                />
                <div className="grid sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-0.5">
                  {typeDefaults === null && <p className="text-sm text-ink-400 col-span-2 text-center py-6">Lade…</p>}
                  {typeDefaults?.map((d, i) => (
                    <PickCard
                      key={d.label}
                      title={d.label}
                      subtitle={[d.showDuration && 'Dauer', d.showDistance && 'Distanz'].filter(Boolean).join(' · ') || 'einfach'}
                      selected={selectedTypes.has(d.label)}
                      onToggle={() => toggleType(d.label)}
                      delay={i * 55}
                    />
                  ))}
                </div>
                <p className="text-xs text-ink-400 mt-3 text-center">
                  {selectedTypes.size} von {typeDefaults?.length ?? 0} ausgewählt
                </p>
              </>
            )}

            {step === 4 && (
              <div className="text-center py-4">
                <div className="anim-pop w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-5">
                  <PartyPopper size={26} />
                </div>
                <h2 className="display text-3xl anim-fade-up">Alles bereit!</h2>
                <p className="text-ink-500 text-sm mt-3 max-w-sm mx-auto leading-relaxed anim-fade-up" style={{ animationDelay: '90ms' }}>
                  Dein Deltis ist eingerichtet. Dein Feed auf der Startseite zeigt
                  dir jeden Tag auf einen Blick, was ansteht.
                </p>
              </div>
            )}

            {error && <p className="text-red-600 text-sm mt-4 text-center">{error}</p>}

            {/* Navigation */}
            <div className="flex items-center gap-3 mt-7">
              {step > 0 && step < LAST_STEP && (
                <Button variant="ghost" icon={ArrowLeft} onClick={handleBack} disabled={saving}>
                  Zurück
                </Button>
              )}
              <div className="flex-1" />
              {step < LAST_STEP ? (
                <Button icon={ArrowRight} loading={saving} onClick={handleNext}>
                  {step === 0 ? 'Los geht’s' : 'Weiter'}
                </Button>
              ) : (
                <Button icon={Check} loading={saving} onClick={handleFinish} className="!px-8">
                  Zur App
                </Button>
              )}
            </div>
          </div>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5 mt-5" aria-hidden="true">
            {STEP_LABELS.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i === step ? 'w-5 h-1.5 bg-brand-500' : i < step ? 'w-1.5 h-1.5 bg-brand-400' : 'w-1.5 h-1.5 bg-ink-200'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

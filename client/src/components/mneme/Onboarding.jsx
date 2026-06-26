import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Brain, Sparkles, Check, X, ArrowRight, Loader2, Ear } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { mneme } from '@/lib/mneme';

/**
 * First-run onboarding — the cold-start flow.
 *
 * Three staged screens, ~30 seconds, designed to stay honest about what Mneme
 * actually knows:
 *   1. The PRIOR — "what are you into?" (only tunes how chatty Mneme is; stores
 *      no memories).
 *   2. The BRAIN DUMP — optional things you already know, stored as weak
 *      DECAYING anchors that must be confirmed by real life or they fade.
 *   3. "I'm listening" — observation takes over.
 *
 * Shown once on first run; also reused (editMode) to edit the prior / add more
 * anchors later from the Control Center.
 */

const SUGGESTED = [
  'Computer Science', 'Finance', 'Medicine', 'Design', 'Marketing',
  'Mathematics', 'Biology', 'Law', 'History', 'Languages', 'Cooking', 'Music',
];

const LEVELS = [
  { value: 'new', label: 'New to it' },
  { value: 'learning', label: 'Learning' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'expert', label: 'Expert' },
];

const inputCls =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none';

function Field({ label, value, onChange, placeholder, required = false, multiline = false }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--accent)]">*</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={cn(inputCls, 'resize-none')}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputCls}
        />
      )}
    </label>
  );
}

function LevelPicker({ value, onChange }) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-[var(--border)]">
      {LEVELS.map((l) => (
        <button
          key={l.value}
          onClick={() => onChange(l.value)}
          className={cn(
            'px-2 py-1 text-xs transition-colors',
            value === l.value
              ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-medium'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            'h-1.5 rounded-full transition-all',
            n === step ? 'w-5 bg-[var(--accent)]' : 'w-1.5 bg-[var(--border)]'
          )}
        />
      ))}
    </div>
  );
}

export function Onboarding({ open, onClose, editMode = false, initialExpertise = [], initialProfile = null }) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [expertise, setExpertise] = useState(() =>
    Array.isArray(initialExpertise) ? initialExpertise : []
  );
  const [role, setRole] = useState(() => initialProfile?.role || '');
  const [eduCurrent, setEduCurrent] = useState(() => initialProfile?.education?.current || '');
  const [eduPast, setEduPast] = useState(() => initialProfile?.education?.past || '');
  const [focus, setFocus] = useState(() => initialProfile?.focus || '');
  const [customDomain, setCustomDomain] = useState('');
  const [dump, setDump] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  if (!open) return null;

  // Role, current education and current focus are compulsory — they give Mneme
  // an accurate picture of who you are with minimal input.
  const step1Valid = role.trim() && eduCurrent.trim() && focus.trim();

  const selectedNames = new Set(expertise.map((e) => e.domain.toLowerCase()));

  const addDomain = (domain) => {
    const name = String(domain || '').trim();
    if (!name || selectedNames.has(name.toLowerCase())) return;
    setExpertise((prev) => [...prev, { domain: name, level: 'learning' }]);
  };
  const removeDomain = (domain) =>
    setExpertise((prev) => prev.filter((e) => e.domain !== domain));
  const setLevel = (domain, level) =>
    setExpertise((prev) => prev.map((e) => (e.domain === domain ? { ...e, level } : e)));

  const parseAnchors = (text) =>
    String(text || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 20);

  // Persist everything, then advance to the "I'm listening" screen.
  const finish = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await mneme.saveOnboarding({
        expertise,
        profile: {
          role: role.trim(),
          education: { current: eduCurrent.trim(), past: eduPast.trim() },
          focus: focus.trim(),
        },
        anchors: parseAnchors(dump),
        markOnboarded: true,
      });
      setResult(res);
      qc.invalidateQueries({ queryKey: ['mneme'] });
      setStep(3);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    // Reset for next open.
    setStep(1);
    setResult(null);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-dim)]">
              <Brain size={16} className="text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {editMode ? 'Your knowledge profile' : 'Welcome to Mneme'}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {editMode ? 'Tune what Mneme assumes you know' : 'Learn what matters. Remember what lasts.'}
              </p>
            </div>
          </div>
          {editMode && (
            <button onClick={close} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="px-6 py-5 min-h-[320px] max-h-[65vh] overflow-y-auto">
          {/* ----- Screen 1: the prior ----- */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">A little about you</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  A few quick essentials so Mneme judges what matters against who you actually
                  are. The starred fields are required — everything else is optional.
                </p>
              </div>

              {/* Required structured profile */}
              <div className="space-y-3">
                <Field
                  label="Current role"
                  required
                  value={role}
                  onChange={setRole}
                  placeholder="e.g. Software Engineering Intern"
                />
                <Field
                  label="Education"
                  required
                  value={eduCurrent}
                  onChange={setEduCurrent}
                  placeholder="e.g. BSc Computer Science · MIT"
                />
                <Field
                  label="Past education"
                  value={eduPast}
                  onChange={setEduPast}
                  placeholder="e.g. High school diploma — Phillips Academy (optional)"
                />
                <Field
                  label="Main focus area"
                  required
                  multiline
                  value={focus}
                  onChange={setFocus}
                  placeholder="e.g. Backend infrastructure & APIs (or Frontend, ML, DevOps, Data…)"
                />
              </div>

              {/* Optional domain calibration */}
              <div className="pt-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Areas &amp; comfort <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Sets how chatty Mneme is — quiet where you're an expert, keener where you're new.
                </p>
              </div>

              {/* Suggested chips */}
              <div className="flex flex-wrap gap-2">
                {SUGGESTED.filter((d) => !selectedNames.has(d.toLowerCase())).map((d) => (
                  <button
                    key={d}
                    onClick={() => addDomain(d)}
                    className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                  >
                    + {d}
                  </button>
                ))}
              </div>

              {/* Custom add */}
              <form
                onSubmit={(e) => { e.preventDefault(); addDomain(customDomain); setCustomDomain(''); }}
                className="flex gap-2"
              >
                <input
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="Add your own…"
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
                />
                <Button type="submit" variant="outline" size="sm" disabled={!customDomain.trim()}>Add</Button>
              </form>

              {/* Selected with level */}
              {expertise.length > 0 && (
                <ul className="space-y-2 pt-1">
                  {expertise.map((e) => (
                    <li key={e.domain} className="flex items-center gap-2">
                      <button onClick={() => removeDomain(e.domain)} className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                        <X size={14} />
                      </button>
                      <span className="flex-1 truncate text-sm text-[var(--text-primary)]">{e.domain}</span>
                      <LevelPicker value={e.level} onChange={(l) => setLevel(e.domain, l)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ----- Screen 2: the brain dump ----- */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-[var(--text-primary)]">
                  Already know anything specific? <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                </h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  Jot down things you already know — one per line. Mneme stores these as
                  <span className="text-[var(--text-primary)]"> weak, fading hints</span>: if real life
                  confirms them they get stronger, otherwise they quietly disappear. Nothing here is
                  treated as proof you remember it.
                </p>
              </div>
              <textarea
                value={dump}
                onChange={(e) => setDump(e.target.value)}
                rows={6}
                placeholder={'compound interest\nBig-O notation\nthe Krebs cycle'}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none resize-none"
              />
              <p className="text-xs text-[var(--text-muted)]">
                {parseAnchors(dump).length} item{parseAnchors(dump).length === 1 ? '' : 's'} · totally fine to skip.
              </p>
              {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
            </div>
          )}

          {/* ----- Screen 3: I'm listening ----- */}
          {step === 3 && (
            <div className="flex flex-col items-center justify-center text-center py-6 space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-dim)]">
                <Ear size={26} className="text-[var(--accent)]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">I'm listening.</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
                  From here I quietly learn from what you read and do, and jog the right memory at the
                  right moment. You're always in control.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-muted)]">
                  <Sparkles size={12} className="text-[var(--accent)]" />
                  {result?.expertise?.length || expertise.length} domain{(result?.expertise?.length || expertise.length) === 1 ? '' : 's'} calibrated
                </span>
                {(result?.anchorsCreated ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-muted)]">
                    <Check size={12} className="text-[var(--success)]" />
                    {result.anchorsCreated} hint{result.anchorsCreated === 1 ? '' : 's'} seeded
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-4">
          <StepDots step={step} />
          <div className="flex items-center gap-2">
            {step === 1 && (
              <>
                {editMode && (
                  <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
                    Cancel
                  </Button>
                )}
                <Button size="sm" onClick={() => setStep(2)} disabled={!step1Valid}>
                  Next <ArrowRight size={14} />
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={saving}>Back</Button>
                <Button size="sm" onClick={finish} disabled={saving}>
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <>Continue <ArrowRight size={14} /></>}
                </Button>
              </>
            )}
            {step === 3 && (
              <Button size="sm" onClick={close}>
                {editMode ? 'Done' : "Let's go"} <Check size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Onboarding;

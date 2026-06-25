import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import { mneme } from '@/lib/mneme';

const DELIVERY = [
  { value: 'calm', label: 'Calm', hint: 'Pull — surfaces only when you ask' },
  { value: 'ambient', label: 'Ambient', hint: 'Push — nudges you in the moment' },
];

const INTERACTION = [
  { value: 'auto', label: 'Auto', hint: 'Quiz if shaky, show if mostly known' },
  { value: 'quiz', label: 'Quiz', hint: 'Always an active-recall question' },
  { value: 'show', label: 'Show', hint: 'Just remind, never test' },
];

function Segmented({ options, value, onChange, disabled }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg border px-3 py-2.5 text-left transition-all',
            value === o.value
              ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
              : 'border-[var(--border)] hover:bg-[var(--bg-elevated)]'
          )}
        >
          <span
            className={cn(
              'block text-sm font-medium',
              value === o.value ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'
            )}
          >
            {o.label}
          </span>
          <span className="block text-xs text-[var(--text-muted)] mt-0.5">{o.hint}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Modes & pause — the user's control over how (and whether) Mneme interrupts.
 * Calm vs ambient delivery, quiz/show/auto interaction, a sensitivity slider,
 * and a global pause.
 */
export function ModesPanel() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['mneme', 'settings'],
    queryFn: mneme.getSettings,
  });

  const save = useMutation({
    mutationFn: (patch) => mneme.updateSettings(patch),
    onSuccess: (next) => qc.setQueryData(['mneme', 'settings'], next),
  });

  if (isLoading) {
    return (
      <Card className="flex justify-center py-12">
        <Spinner size="lg" />
      </Card>
    );
  }

  const s = settings || {};
  const threshold = s.resurface_threshold ?? 0.6;

  return (
    <Card className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Modes & pause</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">You decide how Mneme shows up.</p>
        </div>
        <button
          onClick={() => save.mutate({ paused: !s.paused })}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all',
            s.paused
              ? 'bg-[var(--danger)] text-white'
              : 'bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white'
          )}
        >
          {s.paused ? <Play size={14} /> : <Pause size={14} />}
          {s.paused ? 'Paused' : 'Active'}
        </button>
      </div>

      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wide">Delivery</p>
        <Segmented
          options={DELIVERY}
          value={s.delivery_mode}
          disabled={save.isPending}
          onChange={(v) => save.mutate({ delivery_mode: v })}
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wide">Interaction</p>
        <Segmented
          options={INTERACTION}
          value={s.interaction}
          disabled={save.isPending}
          onChange={(v) => save.mutate({ interaction: v })}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Sensitivity</p>
          <span className="text-xs text-[var(--text-muted)]">
            surface below <span className="text-[var(--text-primary)] font-medium">{Math.round(threshold * 100)}%</span> recall
          </span>
        </div>
        <input
          type="range"
          min="0.3"
          max="0.9"
          step="0.05"
          defaultValue={threshold}
          onMouseUp={(e) => save.mutate({ resurface_threshold: Number(e.target.value) })}
          onTouchEnd={(e) => save.mutate({ resurface_threshold: Number(e.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Higher = nudges earlier (more reminders); lower = only when you're really forgetting.
        </p>
      </div>
    </Card>
  );
}

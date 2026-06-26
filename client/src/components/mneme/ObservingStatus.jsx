import { useQuery } from '@tanstack/react-query';
import { Ear, Pause, Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import { mneme } from '@/lib/mneme';

/**
 * Observing status strip — the "Mneme is alive" line at the top of the Control
 * Center. Reuses the settings + strength queries (no new endpoints): shows
 * whether Mneme is listening or paused, how much it has kept, and how many
 * memories are fading enough to be due for a nudge. On a fresh account it reads
 * as a calm "I'm listening" first-run state instead of empty boxes.
 */
export function ObservingStatus() {
  const { data: settings } = useQuery({
    queryKey: ['mneme', 'settings'],
    queryFn: mneme.getSettings,
  });
  const { data: stats, isLoading } = useQuery({
    queryKey: ['mneme', 'strength'],
    queryFn: mneme.strength,
    staleTime: 10_000,
  });

  const paused = settings?.paused;
  const total = stats?.total_memories ?? 0;
  const dueNow = stats?.due_now ?? 0;
  const ambient = settings?.delivery_mode === 'ambient';

  const Icon = paused ? Pause : Ear;
  const dotClass = paused
    ? 'bg-[var(--warning)]'
    : 'bg-[var(--success)] animate-pulse';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className={cn('inline-flex h-2.5 w-2.5 rounded-full', dotClass)} />
        </span>
        <Icon size={16} className={paused ? 'text-[var(--warning)]' : 'text-[var(--accent)]'} />
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {paused ? 'Paused' : "I'm listening"}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {paused
            ? 'not observing right now'
            : ambient
              ? 'observing · nudges you in the moment'
              : 'observing · surfaces when you ask'}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-4">
        {isLoading ? (
          <Spinner />
        ) : total === 0 ? (
          <span className="text-xs text-[var(--text-muted)]">
            Nothing kept yet — I stay quiet until I see something worth remembering.
          </span>
        ) : (
          <>
            <span className="text-xs text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text-primary)]">{total}</span> kept
            </span>
            {dueNow > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-dim)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)]">
                <Sparkles size={12} />
                {dueNow} fading
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ObservingStatus;

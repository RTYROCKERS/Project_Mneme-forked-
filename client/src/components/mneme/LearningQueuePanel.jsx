import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Check, X, Loader2, Layers } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { mneme } from '@/lib/mneme';

/**
 * Learning queue — the "learn later" backlog. When you defer a new concept on a
 * page ("Later"), it lands here, grouped by where you found it (the whole-topic
 * rollup). Learn it now (promote to a real memory that enters the decay loop) or
 * dismiss it.
 */
export function LearningQueuePanel() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['mneme', 'learn-queue'],
    queryFn: () => mneme.listLearnQueue('pending'),
    staleTime: 10_000,
  });

  const resolve = useMutation({
    mutationFn: ({ id, action }) => mneme.resolveQueueItem(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mneme', 'learn-queue'] });
      qc.invalidateQueries({ queryKey: ['mneme', 'memories'] });
      qc.invalidateQueries({ queryKey: ['mneme', 'strength'] });
    },
  });

  const groups = data?.groups || [];
  const total = data?.total || 0;
  const busyId = resolve.isPending ? resolve.variables?.id : null;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GraduationCap size={16} className="text-[var(--accent)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Learning queue</p>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{total} to learn</span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={18} className="animate-spin text-[var(--text-muted)]" />
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">Nothing queued to learn.</p>
          <p className="text-xs text-[var(--text-muted)]">
            On any page, hit “Learn this page” and tap <em>Later</em> on a new idea — it shows up here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.source}>
              <div className="flex items-center gap-1.5 mb-2">
                <Layers size={12} className="text-[var(--text-muted)]" />
                <span className="text-xs font-medium text-[var(--text-muted)] truncate">{g.source}</span>
                <span className="text-xs text-[var(--text-muted)]">· {g.items.length}</span>
              </div>
              <ul className="space-y-2.5">
                {g.items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--text-primary)]">{item.card}</p>
                        {item.explain || item.detail ? (
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{item.explain || item.detail}</p>
                        ) : null}
                        {item.anchor && (
                          <p className="mt-1 text-xs text-[var(--accent)]">Builds on: {item.anchor}</p>
                        )}
                        {item.difficulty && (
                          <Badge variant="muted" className="mt-1.5">{item.difficulty}</Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => resolve.mutate({ id: item.id, action: 'learn' })}
                          disabled={resolve.isPending}
                          title="Learn now — store it as a memory"
                          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
                        >
                          {busyId === item.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => resolve.mutate({ id: item.id, action: 'dismiss' })}
                          disabled={resolve.isPending}
                          title="Dismiss"
                          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--danger)] transition-colors disabled:opacity-50"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default LearningQueuePanel;

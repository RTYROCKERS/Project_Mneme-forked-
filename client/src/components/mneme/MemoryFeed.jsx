import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Sparkles, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { mneme } from '@/lib/mneme';
import { strengthMeta, pct } from '@/lib/mnemeUi';

/**
 * The memory feed — everything Mneme has kept for you, weakest first. You can
 * delete anything (full control) or ask for a plain-language refresher.
 */
export function MemoryFeed({ memories = [] }) {
  const qc = useQueryClient();
  const [explained, setExplained] = useState({});

  const del = useMutation({
    mutationFn: (id) => mneme.deleteMemory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mneme', 'memories'] });
      qc.invalidateQueries({ queryKey: ['mneme', 'strength'] });
    },
  });

  const explain = useMutation({
    mutationFn: (id) => mneme.explain(id),
    onSuccess: (data) => setExplained((e) => ({ ...e, [data.memory_id]: data.explanation })),
  });

  if (memories.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 py-12 text-center">
        <p className="text-sm text-[var(--text-muted)]">No memories yet.</p>
        <p className="text-xs text-[var(--text-muted)]">
          Mneme stays quiet until it has observed something worth keeping.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Memory feed</p>
        <span className="text-xs text-[var(--text-muted)]">{memories.length} kept · weakest first</span>
      </div>
      <ul className="space-y-3">
        {memories.map((m) => {
          const meta = strengthMeta(m.strength);
          return (
            <li key={m.id} className="border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-[var(--text-primary)]">{m.card}</span>
                    {m.is_declared && (
                      <Badge variant="muted" className="shrink-0" title="You told Mneme this — it fades unless real life confirms it">
                        declared
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Badge variant={meta.badge}>{m.strength}</Badge>
                    <span className="text-xs text-[var(--text-muted)]">{pct(m.retrievability)}% recall</span>
                    {m.recall_count > 0 && (
                      <span className="text-xs text-[var(--text-muted)]">· {m.recall_count} recalls</span>
                    )}
                    {m.days_since_review !== undefined && (
                      <span className="text-xs text-[var(--text-muted)]">· {m.days_since_review}d since review</span>
                    )}
                  </div>
                  <Progress value={m.retrievability} />
                  {explained[m.id] && (
                    <p className="mt-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-muted)]">
                      {explained[m.id]}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => explain.mutate(m.id)}
                    disabled={explain.isPending}
                    title="Refresh me on this"
                    className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] transition-colors"
                  >
                    {explain.isPending && explain.variables === m.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                  </button>
                  <button
                    onClick={() => del.mutate(m.id)}
                    disabled={del.isPending}
                    title="Forget this"
                    className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--danger)] transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

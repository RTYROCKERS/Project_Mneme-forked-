import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { mneme } from '@/lib/mneme';
import { STRENGTH_META, pct } from '@/lib/mnemeUi';
import { RetentionCurve } from './RetentionCurve';

const BUCKET_ORDER = ['solid', 'fading', 'slipping', 'almost gone'];

/**
 * The "proof you got sharper" panel: headline retention numbers, the
 * distribution of memory strength, and the forgetting curve of the memory
 * most at risk right now.
 */
export function StrengthPanel({ memories = [] }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['mneme', 'strength'],
    queryFn: mneme.strength,
    staleTime: 10_000,
  });

  if (isLoading) {
    return (
      <Card className="flex justify-center py-12">
        <Spinner size="lg" />
      </Card>
    );
  }

  const buckets = stats?.strength_buckets || {};
  const total = stats?.total_memories || 0;
  const recalls = stats?.recalls || { total: 0, strengthened: 0, lapsed: 0 };
  const weakest = memories[0]; // feed is sorted weakest-first

  const headline = [
    { label: 'memories', value: total },
    { label: 'avg recall', value: `${pct(stats?.avg_retrievability)}%` },
    { label: 'due now', value: stats?.due_now ?? 0 },
    { label: 'recalls logged', value: recalls.total },
  ];

  return (
    <div className="space-y-4">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {headline.map((h) => (
          <Card key={h.label} className="py-4">
            <p className="text-2xl font-semibold text-[var(--text-primary)]">{h.value}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">{h.label}</p>
          </Card>
        ))}
      </div>

      {/* Strength distribution */}
      <Card>
        <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">Memory strength</p>
        {total === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Nothing yet — Mneme fills this in as it observes what you read and run.
          </p>
        ) : (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
              {BUCKET_ORDER.map((b) => {
                const n = buckets[b] || 0;
                if (!n) return null;
                return (
                  <div
                    key={b}
                    style={{ width: `${(n / total) * 100}%`, background: STRENGTH_META[b].hex }}
                    title={`${b}: ${n}`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {BUCKET_ORDER.map((b) => (
                <div key={b} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: STRENGTH_META[b].hex }} />
                  <span className="text-xs text-[var(--text-muted)]">
                    {b} <span className="text-[var(--text-primary)] font-medium">{buckets[b] || 0}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-5 border-t border-[var(--border)] pt-3">
              <span className="text-xs text-[var(--text-muted)]">
                strengthened <span className="text-[var(--success)] font-medium">{recalls.strengthened}</span>
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                lapsed <span className="text-[var(--danger)] font-medium">{recalls.lapsed}</span>
              </span>
            </div>
          </>
        )}
      </Card>

      {/* Most-at-risk forgetting curve */}
      {weakest && (
        <Card>
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Most at risk</p>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            This is the memory slipping fastest — a nudge now resets the curve.
          </p>
          <RetentionCurve memory={weakest} />
        </Card>
      )}
    </div>
  );
}

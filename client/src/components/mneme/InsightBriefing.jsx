import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Lightbulb, Check, BookOpen, BookmarkPlus, Loader2, Sparkles,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { mneme } from '@/lib/mneme';
import { getErrorMessage } from '@/lib/api';
import { strengthMeta, pct } from '@/lib/mnemeUi';

/**
 * Renders a Mneme "get me ready to read this" briefing — the same data the
 * browser/VS Code surfaces show, here for documents. Three sections:
 *   🔁 Refresh first (faded) · 💡 Learn first (missing) · ✓ already solid
 * plus the per-item actions (grade a refresher, remember a gap) and a single
 * "Save to study later" that drops the whole packet into Topics/Study.
 *
 * `insight` is the response from /doc-insight (== /page-insight shape):
 *   { page:{title,url}, overview, keyPoints[], prereqs[], summary, counts }
 */
export function InsightBriefing({ insight, sourceLabel }) {
  const qc = useQueryClient();
  const [graded, setGraded] = useState({});   // concept -> 'knew' | 'forgot'
  const [learned, setLearned] = useState({}); // concept -> true
  const [busy, setBusy] = useState(null);     // concept currently mutating
  const [saved, setSaved] = useState(null);   // { topicName, conceptsAdded }
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  if (!insight) return null;
  const prereqs = insight.prereqs || [];
  const faded = prereqs.filter((p) => p.status === 'faded');
  const missing = prereqs.filter((p) => p.status === 'missing');
  const solid = prereqs.filter((p) => p.status === 'solid');
  const keyPoints = insight.keyPoints || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['mneme', 'memories'] });
    qc.invalidateQueries({ queryKey: ['mneme', 'strength'] });
  };

  async function grade(p, outcome) {
    setBusy(p.concept); setErr('');
    try {
      await mneme.recall({ memory_id: p.memoryId, outcome, mode: 'show' });
      setGraded((g) => ({ ...g, [p.concept]: outcome }));
      invalidate();
    } catch (e) { setErr(getErrorMessage(e)); }
    finally { setBusy(null); }
  }

  async function remember(p) {
    setBusy(p.concept); setErr('');
    try {
      await mneme.learnNow({
        card: p.concept,
        detail: p.explanation || p.why || '',
        difficulty: p.difficulty,
        title: insight.page?.title || sourceLabel,
        originKind: 'desktop',
      });
      setLearned((l) => ({ ...l, [p.concept]: true }));
      invalidate();
    } catch (e) { setErr(getErrorMessage(e)); }
    finally { setBusy(null); }
  }

  async function saveAll() {
    setSaving(true); setErr('');
    try {
      const res = await mneme.studyPacket({
        page: { title: insight.page?.title || sourceLabel || 'Saved document', url: insight.page?.url || null },
        overview: insight.overview,
        keyPoints,
        prereqs,
      });
      setSaved(res);
      qc.invalidateQueries({ queryKey: ['topics'] });
    } catch (e) { setErr(getErrorMessage(e)); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card className="border-[var(--accent)]/30 bg-[var(--accent-dim)]/40">
        <div className="flex items-start gap-2.5">
          <Sparkles size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {insight.page?.title || sourceLabel || 'Your briefing'}
            </p>
            <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{insight.summary}</p>
            {insight.overview && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{insight.overview}</p>
            )}
          </div>
        </div>
      </Card>

      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}

      {/* Refresh first — faded */}
      {faded.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <RefreshCw size={16} className="text-[var(--warning)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Refresh first</p>
            <span className="text-xs text-[var(--text-muted)]">— you knew these, they’re fading</span>
          </div>
          <ul className="space-y-3">
            {faded.map((p) => {
              const meta = strengthMeta(p.strength);
              return (
                <li key={p.concept} className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{p.concept}</p>
                    <Badge variant={meta.badge}>{`refresh · ${pct(p.retrievability)}%`}</Badge>
                  </div>
                  {p.why && <p className="mt-1 text-xs text-[var(--text-muted)]">needed because: {p.why}</p>}
                  {p.explanation && <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">{p.explanation}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    {graded[p.concept] ? (
                      <span className="text-xs text-[var(--success)]">
                        {graded[p.concept] === 'knew' ? '✓ strengthened' : '✓ will resurface'}
                      </span>
                    ) : (
                      <>
                        <span className="text-xs text-[var(--text-muted)]">Still got it?</span>
                        <Button size="sm" variant="subtle" disabled={busy === p.concept} onClick={() => grade(p, 'knew')}>
                          {busy === p.concept ? <Loader2 size={13} className="animate-spin" /> : 'Yes'}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy === p.concept} onClick={() => grade(p, 'forgot')}>
                          No
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Learn first — missing */}
      {missing.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb size={16} className="text-[var(--accent)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Learn first</p>
            <span className="text-xs text-[var(--text-muted)]">— new ground this document covers</span>
          </div>
          <ul className="space-y-3">
            {missing.map((p) => (
              <li key={p.concept} className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{p.concept}</p>
                  <Badge variant="default">new</Badge>
                </div>
                {p.why && <p className="mt-1 text-xs text-[var(--text-muted)]">needed because: {p.why}</p>}
                {p.explanation && <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">{p.explanation}</p>}
                {p.anchor && <p className="mt-1 text-xs text-[var(--accent)]">Builds on what you know: {p.anchor}</p>}
                <div className="mt-2 flex items-center gap-2">
                  {learned[p.concept] ? (
                    <span className="text-xs text-[var(--success)]">✓ remembered</span>
                  ) : (
                    <Button size="sm" variant="subtle" disabled={busy === p.concept} onClick={() => remember(p)}>
                      {busy === p.concept ? <Loader2 size={13} className="animate-spin" /> : 'Remember this'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* All caught up */}
      {faded.length === 0 && missing.length === 0 && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-[var(--success)]">
            <Check size={16} /> You’re all caught up — nothing to refresh or learn here.
          </div>
        </Card>
      )}

      {/* Solid */}
      {solid.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          ✓ You’re solid on {solid.length}: {solid.map((p) => p.concept).join(' · ')}
        </p>
      )}

      {/* Key points */}
      {keyPoints.length > 0 && (
        <Card>
          <div className="mb-2 flex items-center gap-2">
            <BookOpen size={16} className="text-[var(--text-secondary)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">What this document covers</p>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
            {keyPoints.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
        </Card>
      )}

      {/* Save to study later */}
      <div className="flex items-center gap-3">
        {saved ? (
          <span className="text-sm text-[var(--success)]">
            ✓ Saved to “{saved.topicName}” · {saved.conceptsAdded} to study. Open Topics →
          </span>
        ) : (
          <Button variant="default" disabled={saving} onClick={saveAll}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <BookmarkPlus size={15} />}
            Save to study later
          </Button>
        )}
      </div>
    </div>
  );
}

export default InsightBriefing;

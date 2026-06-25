import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, Send, Sparkles, Wand2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { strengthMeta, pct } from '@/lib/mnemeUi';
import { getErrorMessage } from '@/lib/api';
import { mneme } from '@/lib/mneme';

/**
 * Live recall — the demo centerpiece. Type what you're "doing" and Mneme
 * decides whether one of your fading memories is worth jogging right now,
 * shows it (with a "why am I seeing this?" line), and lets you self-rate so
 * the forgetting model updates in front of you.
 */
export function RecallTester() {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [candidate, setCandidate] = useState(undefined); // undefined=idle, null=nothing
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['mneme', 'memories'] });
    qc.invalidateQueries({ queryKey: ['mneme', 'strength'] });
  };

  const ask = useMutation({
    mutationFn: () => mneme.context(text, { force: true }),
    onSuccess: (c) => {
      setCandidate(c ?? null);
      setAnswer('');
      setResult(null);
    },
  });

  const rate = useMutation({
    mutationFn: (payload) => mneme.recall(payload),
    onSuccess: (r) => {
      setResult(r);
      refresh();
    },
  });

  const seed = useMutation({
    mutationFn: () => mneme.seedDemo(),
    onSuccess: () => refresh(),
  });

  const meta = candidate ? strengthMeta(candidate.strength) : null;

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Live recall</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Type what you're working on — Mneme jogs what's slipping.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => seed.mutate()}
          disabled={seed.isPending}
          title="Plant a demo memory pre-aged to ~40% recall"
        >
          <Wand2 size={14} /> {seed.isPending ? 'Seeding…' : 'Seed demo'}
        </Button>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) ask.mutate();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. how do I double my money at 6 percent"
        />
        <Button type="submit" disabled={ask.isPending || !text.trim()}>
          <Send size={14} /> {ask.isPending ? '…' : 'Recall'}
        </Button>
      </form>

      {ask.isError && (
        <p className="text-xs text-[var(--danger)]">{getErrorMessage(ask.error)}</p>
      )}

      {/* Nothing relevant */}
      {candidate === null && !ask.isPending && (
        <p className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-muted)]">
          Nothing worth resurfacing for that — you're not forgetting anything relevant.
        </p>
      )}

      {/* A candidate surfaced */}
      {candidate && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <Brain size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--text-primary)]">{candidate.memory.card}</p>
              {candidate.memory.detail && (
                <p className="text-xs text-[var(--text-muted)] mt-1">{candidate.memory.detail}</p>
              )}
            </div>
          </div>

          <p className="text-xs italic text-[var(--text-muted)]">{candidate.why}</p>

          <div className="flex items-center gap-2">
            <Badge variant={meta.badge}>{candidate.strength}</Badge>
            <span className="text-xs text-[var(--text-muted)]">{pct(candidate.retrievability)}% recall</span>
            <span className="text-xs text-[var(--text-muted)]">· {pct(candidate.relevance)}% relevant</span>
          </div>

          {/* Quiz interaction */}
          {candidate.interaction === 'quiz' && candidate.quiz?.question && !result && (
            <form
              className="space-y-2 border-t border-[var(--border)] pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                rate.mutate({
                  memory_id: candidate.memory.id,
                  question: candidate.quiz.question,
                  answer,
                  mode: 'quiz',
                });
              }}
            >
              <p className="text-sm text-[var(--text-primary)]">{candidate.quiz.question}</p>
              <div className="flex gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Answer from memory…"
                />
                <Button type="submit" disabled={rate.isPending || !answer.trim()}>
                  {rate.isPending ? '…' : 'Check'}
                </Button>
              </div>
            </form>
          )}

          {/* Show interaction — simple self-rating */}
          {(candidate.interaction !== 'quiz' || !candidate.quiz?.question) && !result && (
            <div className="flex gap-2 border-t border-[var(--border)] pt-3">
              <Button
                variant="subtle"
                size="sm"
                disabled={rate.isPending}
                onClick={() => rate.mutate({ memory_id: candidate.memory.id, outcome: 'knew', mode: 'show' })}
              >
                I knew it
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={rate.isPending}
                onClick={() => rate.mutate({ memory_id: candidate.memory.id, outcome: 'forgot', mode: 'show' })}
              >
                I forgot
              </Button>
            </div>
          )}

          {/* Result of a recall */}
          {result && (
            <div className="border-t border-[var(--border)] pt-3 space-y-1">
              {result.grading && (
                <p className={result.grading.correct ? 'text-sm text-[var(--success)]' : 'text-sm text-[var(--warning)]'}>
                  <Sparkles size={13} className="inline mr-1" />
                  {result.grading.feedback}
                </p>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                Recall logged — strength now{' '}
                <span className="font-medium text-[var(--text-primary)]">{result.strength}</span>{' '}
                ({pct(result.retrievability)}%). Memory half-life{' '}
                {result.stability_before != null && result.stability_after != null && (
                  <span className="text-[var(--text-primary)]">
                    {Math.round(result.stability_before * 10) / 10}d → {Math.round(result.stability_after * 10) / 10}d
                  </span>
                )}.
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

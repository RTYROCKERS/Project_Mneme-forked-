import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, BookOpen, Zap, Timer, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Spinner } from '@/components/ui/Spinner';
import { useAuthStore } from '@/store/authStore';
import api from '@/lib/api';

// ── Quiz component ─────────────────────────────────────────────
function QuizView({ content, conceptId, onDone }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  const questions = content.content_blob?.questions || [];
  const q = questions[current];

  const updateMastery = useMutation({
    mutationFn: (data) => api.patch('/mastery/update', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mastery'] }),
  });

  const handleAnswer = (idx) => {
    if (answered) return;
    setSelected(idx);
    setAnswered(true);
    if (idx === q.correct_index) setScore((s) => s + 1);
  };

  const handleNext = () => {
    if (current + 1 < questions.length) {
      setCurrent((c) => c + 1);
      setSelected(null);
      setAnswered(false);
    } else {
      const finalScore = score / questions.length;
      setFinished(true);
      updateMastery.mutate({ concept_id: conceptId, quiz_score: finalScore });
    }
  };

  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="text-center space-y-4 py-4">
        <div className="flex justify-center">
          {pct >= 60 ? <CheckCircle2 size={40} className="text-[var(--success)]" /> : <XCircle size={40} className="text-[var(--danger)]" />}
        </div>
        <div>
          <p className="text-2xl font-semibold text-[var(--text-primary)]">{pct}%</p>
          <p className="text-sm text-[var(--text-muted)]">{score}/{questions.length} correct</p>
        </div>
        <Button onClick={onDone}>Back to study</Button>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between text-sm text-[var(--text-muted)]">
        <span>Question {current + 1} of {questions.length}</span>
        <span>{score} correct</span>
      </div>
      <Progress value={(current) / questions.length} colorClass="bg-[var(--accent)]" />

      <p className="text-sm font-medium text-[var(--text-primary)] leading-relaxed">{q.question}</p>

      <div className="space-y-2">
        {q.options.map((opt, idx) => {
          let base = 'text-left w-full rounded-lg border px-4 py-3 text-sm transition-all cursor-pointer';
          let color = 'border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]';
          if (answered) {
            if (idx === q.correct_index) color = 'border-[var(--success)] bg-[rgba(76,175,140,0.1)] text-[var(--success)]';
            else if (idx === selected) color = 'border-[var(--danger)] bg-[rgba(229,107,111,0.1)] text-[var(--danger)]';
            else color = 'border-[var(--border)] text-[var(--text-muted)] opacity-50';
          }
          return (
            <button key={idx} className={`${base} ${color}`} onClick={() => handleAnswer(idx)}>
              {opt}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="rounded-lg bg-[var(--bg-elevated)] p-3 space-y-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">Explanation</p>
          <p className="text-sm text-[var(--text-primary)]">{q.explanation}</p>
          <Button size="sm" onClick={handleNext}>
            {current + 1 < questions.length ? 'Next question' : 'See results'} <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Revision view ──────────────────────────────────────────────
function RevisionView({ content, conceptId, onDone }) {
  const qc = useQueryClient();
  const [elapsed, setElapsed] = useState(0);
  const [started] = useState(Date.now());

  const updateMastery = useMutation({
    mutationFn: (data) => api.patch('/mastery/update', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mastery'] }),
  });

  const handleDone = () => {
    const seconds = Math.round((Date.now() - started) / 1000);
    updateMastery.mutate({ concept_id: conceptId, time_spent_seconds: seconds });
    onDone();
  };

  const blob = content.content_blob;
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{blob.title}</h3>
        <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">{blob.summary}</p>
      </div>

      {blob.key_points?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wider">Key points</p>
          <ul className="space-y-2">
            {blob.key_points.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blob.analogy && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
          <p className="text-xs font-medium text-[var(--accent)] mb-1">Analogy</p>
          <p className="text-sm text-[var(--text-muted)]">{blob.analogy}</p>
        </div>
      )}

      {blob.common_mistakes?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[var(--danger)] mb-2 uppercase tracking-wider">Common mistakes</p>
          <ul className="space-y-1">
            {blob.common_mistakes.map((m, i) => (
              <li key={i} className="text-sm text-[var(--text-muted)] flex items-start gap-2">
                <XCircle size={13} className="mt-0.5 shrink-0 text-[var(--danger)]" /> {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button onClick={handleDone} className="w-full">
        <CheckCircle2 size={14} /> Mark as reviewed
      </Button>
    </div>
  );
}

// ── Main Study page ────────────────────────────────────────────
export default function Study() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [activeConcept, setActiveConcept] = useState(null);
  const [activeContent, setActiveContent] = useState(null);
  const [mode, setMode] = useState(null); // 'revision' | 'quiz'

  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => api.get(`/recommendations/${user.id}`).then((r) => r.data),
    enabled: !!user,
  });

  const generateContent = useMutation({
    mutationFn: ({ conceptId, type }) =>
      api.post('/content/generate', { concept_id: conceptId, type }).then((r) => r.data),
    onSuccess: (data) => setActiveContent(data),
  });

  const handleStudy = (rec, type) => {
    setActiveConcept(rec);
    setMode(type);
    setActiveContent(null);
    generateContent.mutate({ conceptId: rec.concept_id, type });
  };

  if (activeConcept && mode) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="mb-5 flex items-center gap-3">
          <button onClick={() => { setActiveConcept(null); setMode(null); setActiveContent(null); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-sm">
            ← Back
          </button>
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{activeConcept.concept_name}</h2>
            <Badge variant={mode === 'quiz' ? 'warning' : 'default'}>{mode}</Badge>
          </div>
        </div>

        <Card>
          <CardContent>
            {generateContent.isPending ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Spinner size="lg" />
                <p className="text-sm text-[var(--text-muted)]">Generating {mode} content…</p>
              </div>
            ) : generateContent.isError ? (
              <p className="text-sm text-[var(--danger)]">Failed to generate content. Check your OpenAI key.</p>
            ) : activeContent ? (
              mode === 'quiz'
                ? <QuizView content={activeContent} conceptId={activeConcept.concept_id}
                    onDone={() => { setActiveConcept(null); setMode(null); qc.invalidateQueries({ queryKey: ['recommendations'] }); }} />
                : <RevisionView content={activeContent} conceptId={activeConcept.concept_id}
                    onDone={() => { setActiveConcept(null); setMode(null); qc.invalidateQueries({ queryKey: ['recommendations'] }); }} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Study</h1>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">AI-recommended concepts to focus on today</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : recommendations.length === 0 ? (
        <Card className="flex flex-col items-center py-14 gap-3">
          <Brain size={32} className="text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">No recommendations yet. Add topics and extract concepts first.</p>
        </Card>
      ) : (
        <div className="grid gap-3 max-w-2xl">
          {recommendations.map((rec, i) => (
            <Card key={rec.concept_id} className="hover:border-[var(--accent)] transition-colors">
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-dim)] text-sm font-semibold text-[var(--accent)]">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{rec.concept_name}</p>
                    <Badge variant="muted">score: {rec.priority_score}</Badge>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{rec.reason}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <Button size="sm" variant="subtle" onClick={() => handleStudy(rec, 'revision')}>
                      <BookOpen size={13} /> Revise
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleStudy(rec, 'quiz')}>
                      <Zap size={13} /> Quiz me
                    </Button>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-[var(--text-muted)]">Mastery</p>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {Math.round((rec.effective_mastery || 0) * 100)}%
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

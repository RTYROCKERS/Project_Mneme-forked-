import { useRef, useState } from 'react';
import { FileText, UploadCloud, Loader2, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { mneme } from '@/lib/mneme';
import { getErrorMessage } from '@/lib/api';
import { InsightBriefing } from '@/components/mneme/InsightBriefing';

/**
 * The universal document surface — "get me ready to read this", for any
 * occupation. Drop a PDF, Word, PowerPoint, Excel, or text file (or paste
 * text), and Mneme briefs you: refresh what's fading, learn the gaps,
 * understand what it covers — then save it to study later.
 *
 * Same brain as the browser "Learn this page"; only the doorway is new.
 */
const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.odp,.ods,.txt,.md,.markdown,.csv,.json,.rtf';

export default function Documents() {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [insight, setInsight] = useState(null);

  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    setText('');
    setError('');
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  };

  async function analyse() {
    if (!file && !text.trim()) {
      setError('Drop a document or paste some text first.');
      return;
    }
    setLoading(true); setError(''); setInsight(null);
    try {
      const res = file
        ? await mneme.docInsight({ file, title: title.trim() || undefined })
        : await mneme.docInsight({ text: text.trim(), title: title.trim() || 'Pasted text' });
      setInsight(res);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null); setText(''); setTitle(''); setInsight(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-dim)]">
          <FileText size={16} className="text-[var(--accent)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Documents</h1>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Get ready to read anything — a contract, a paper, a report, a chapter.
          </p>
        </div>
      </div>

      {/* Input card */}
      <Card>
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={[
            'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging
              ? 'border-[var(--accent)] bg-[var(--accent-dim)]/40'
              : 'border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]',
          ].join(' ')}
        >
          <UploadCloud size={28} className="mb-2 text-[var(--accent)]" />
          {file ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">{file.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                title="Remove"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Drop a document here, or click to choose
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                PDF · Word · PowerPoint · Excel · text — up to 20 MB
              </p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </div>

        {/* Or paste */}
        {!file && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-medium text-[var(--text-muted)]">…or paste text</p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Paste an article, email, contract clause, abstract…"
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
        )}

        {/* Optional title */}
        <div className="mt-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional) — e.g. “Q3 Earnings Report”"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        {error && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={analyse} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            {loading ? 'Reading…' : 'Get me ready'}
          </Button>
          {(insight || file || text) && (
            <Button variant="ghost" onClick={reset} disabled={loading}>Clear</Button>
          )}
        </div>
      </Card>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Working out what you need to know…
        </div>
      )}

      {insight && <InsightBriefing insight={insight} sourceLabel={title || file?.name} />}
    </div>
  );
}

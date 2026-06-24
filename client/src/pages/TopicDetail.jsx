import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, ArrowLeft, Sparkles, RefreshCw, ChevronDown, Pencil, Save,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import api, { getErrorMessage } from '@/lib/api';

// ── Add / edit concept modal ───────────────────────────────────
function ConceptModal({ open, onClose, topicId, concept }) {
  const qc = useQueryClient();
  const editing = !!concept;
  const [form, setForm] = useState({ name: '', description: '', difficulty_level: 'intermediate' });
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      setForm(
        concept
          ? { name: concept.name, description: concept.description || '', difficulty_level: concept.difficulty_level || 'intermediate' }
          : { name: '', description: '', difficulty_level: 'intermediate' }
      );
    }
  }, [open, concept]);

  const mutation = useMutation({
    mutationFn: (data) =>
      editing
        ? api.patch(`/concepts/${concept.id}`, data).then((r) => r.data)
        : api.post('/concepts', { ...data, topic_id: topicId }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['concepts', topicId] });
      qc.invalidateQueries({ queryKey: ['topics'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit concept' : 'Add concept'}>
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4">
        <Input
          label="Name"
          placeholder="e.g. Binary Search Trees"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <Textarea
          label="Description"
          placeholder="Short explanation of this concept…"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="min-h-[100px]"
        />
        <Select
          label="Difficulty"
          value={form.difficulty_level}
          onChange={(e) => setForm((f) => ({ ...f, difficulty_level: e.target.value }))}
        >
          <option value="easy">Easy</option>
          <option value="intermediate">Intermediate</option>
          <option value="hard">Hard</option>
        </Select>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add concept'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Single concept row (collapsible description) ───────────────
function ConceptRow({ concept, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] group">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center gap-2 min-w-0 text-left"
        >
          <ChevronDown
            size={15}
            className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
          />
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">{concept.name}</span>
          <Badge variant={concept.difficulty_level}>{concept.difficulty_level}</Badge>
        </button>
        <span className="text-xs text-[var(--text-muted)] shrink-0 w-10 text-right">
          {Math.round((concept.mastery_score || 0) * 100)}%
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(concept)} className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors" title="Edit">
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(concept)} className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3 pl-9 space-y-2">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            {concept.description || 'No description.'}
          </p>
          <Progress value={concept.mastery_score || 0} />
        </div>
      )}
    </li>
  );
}

export default function TopicDetail() {
  const { id } = useParams();
  const qc = useQueryClient();

  const [conceptModalOpen, setConceptModalOpen] = useState(false);
  const [editingConcept, setEditingConcept] = useState(null);
  const [actionError, setActionError] = useState('');

  // Editable topic description (drives concept generation)
  const [description, setDescription] = useState('');
  const [descDirty, setDescDirty] = useState(false);

  const { data: topic } = useQuery({
    queryKey: ['topic', id],
    queryFn: () => api.get(`/topics/${id}`).then((r) => r.data),
  });

  useEffect(() => {
    if (topic && !descDirty) setDescription(topic.description || '');
  }, [topic, descDirty]);

  const { data: concepts = [], isLoading: loadingConcepts } = useQuery({
    queryKey: ['concepts', id],
    queryFn: () => api.get(`/concepts?topic_id=${id}`).then((r) => r.data),
  });

  const saveDescription = useMutation({
    mutationFn: () => api.patch(`/topics/${id}`, { description }).then((r) => r.data),
    onSuccess: () => {
      setDescDirty(false);
      qc.invalidateQueries({ queryKey: ['topic', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  const generateConcepts = useMutation({
    mutationFn: (replace) => {
      // Persist any edited description first so generation uses it
      const persist = descDirty ? api.patch(`/topics/${id}`, { description }) : Promise.resolve();
      return persist.then(() =>
        api.post('/concepts/generate', { topic_id: id, replace }).then((r) => r.data)
      );
    },
    onMutate: () => setActionError(''),
    onSuccess: () => {
      setDescDirty(false);
      qc.invalidateQueries({ queryKey: ['concepts', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
      qc.invalidateQueries({ queryKey: ['topic', id] });
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  const deleteConcept = useMutation({
    mutationFn: (conceptId) => api.delete(`/concepts/${conceptId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['concepts', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  const openAdd = () => { setEditingConcept(null); setConceptModalOpen(true); };
  const openEdit = (c) => { setEditingConcept(c); setConceptModalOpen(true); };
  const handleDelete = (c) => { if (confirm(`Delete "${c.name}"?`)) deleteConcept.mutate(c.id); };

  const generating = generateConcepts.isPending;

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/topics" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">{topic?.name || '…'}</h1>
          {topic && (
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={topic.depth_level}>{topic.depth_level}</Badge>
              <Badge variant="muted">{topic.learning_goal}</Badge>
            </div>
          )}
        </div>
      </div>

      {actionError && (
        <p className="rounded-lg bg-[rgba(229,107,111,0.1)] border border-[rgba(229,107,111,0.3)] px-3 py-2 text-sm text-[var(--danger)]">
          {actionError}
        </p>
      )}

      {/* Topic description → drives concept generation */}
      <Card>
        <CardHeader>
          <CardTitle>Topic description</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Describe what you want to learn and how deep to go. More detail → more granular concepts; brief → fewer, broader concepts."
            value={description}
            onChange={(e) => { setDescription(e.target.value); setDescDirty(true); }}
            className="min-h-[110px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            {descDirty && (
              <Button variant="outline" size="sm" onClick={() => saveDescription.mutate()} disabled={saveDescription.isPending}>
                <Save size={13} /> {saveDescription.isPending ? 'Saving…' : 'Save description'}
              </Button>
            )}
            <Button size="sm" onClick={() => generateConcepts.mutate(false)} disabled={generating}>
              <Sparkles size={13} /> {generating ? 'Generating…' : concepts.length ? 'Generate more' : 'Generate concepts'}
            </Button>
            {concepts.length > 0 && (
              <Button
                variant="subtle" size="sm"
                onClick={() => { if (confirm('Replace all existing concepts with a freshly generated set?')) generateConcepts.mutate(true); }}
                disabled={generating}
              >
                <RefreshCw size={13} /> Regenerate all
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Concepts list (scrollable window, collapsible descriptions) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Concepts ({concepts.length})</CardTitle>
            <Button size="sm" variant="outline" onClick={openAdd}>
              <Plus size={14} /> Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingConcepts || generating ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <Spinner size="lg" />
              {generating && <p className="text-sm text-[var(--text-muted)]">Generating concepts from your description…</p>}
            </div>
          ) : concepts.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-6">
              No concepts yet. Write a description above and click “Generate concepts”, or add one manually.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {concepts.map((c) => (
                <ConceptRow key={c.id} concept={c} onEdit={openEdit} onDelete={handleDelete} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConceptModal
        open={conceptModalOpen}
        onClose={() => setConceptModalOpen(false)}
        topicId={id}
        concept={editingConcept}
      />
    </div>
  );
}

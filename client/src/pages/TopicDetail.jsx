import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, Link2, AlignLeft, Cpu, Trash2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import api from '@/lib/api';

const typeIcons = { link: Link2, text: AlignLeft, file: FileText };

function AddResourceModal({ open, onClose, topicId }) {
  const qc = useQueryClient();
  const [type, setType] = useState('link');
  const [form, setForm] = useState({ title: '', url: '', content_text: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async (data) => {
      const fd = new FormData();
      fd.append('topic_id', topicId);
      fd.append('type', type);
      if (data.title) fd.append('title', data.title);
      if (type === 'link') fd.append('url', data.url);
      if (type === 'text') fd.append('content_text', data.content_text);
      if (type === 'file' && file) fd.append('file', file);
      return api.post('/resources', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', topicId] });
      qc.invalidateQueries({ queryKey: ['topics'] });
      onClose();
      setForm({ title: '', url: '', content_text: '' });
      setFile(null);
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to add resource'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add resource">
      <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(form); }} className="space-y-4">
        <Select label="Resource type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="link">Link / URL</option>
          <option value="text">Text / Notes</option>
          <option value="file">File upload</option>
        </Select>
        <Input label="Title (optional)" placeholder="e.g. Intro to Binary Trees" value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />

        {type === 'link' && (
          <Input label="URL" type="url" placeholder="https://..." value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
        )}
        {type === 'text' && (
          <Textarea label="Content" placeholder="Paste notes, summaries, or any text…"
            value={form.content_text} onChange={(e) => setForm((f) => ({ ...f, content_text: e.target.value }))}
            className="min-h-[120px]" required />
        )}
        {type === 'file' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-[var(--text-muted)]">File</label>
            <input type="file" onChange={(e) => setFile(e.target.files[0])}
              className="text-sm text-[var(--text-muted)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent-dim)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--accent)] hover:file:bg-[var(--accent)] hover:file:text-white file:transition-colors" />
          </div>
        )}

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add resource'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function TopicDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [resourceModalOpen, setResourceModalOpen] = useState(false);

  const { data: topic } = useQuery({
    queryKey: ['topic', id],
    queryFn: () => api.get(`/topics/${id}`).then((r) => r.data),
  });

  const { data: resources = [], isLoading: loadingResources } = useQuery({
    queryKey: ['resources', id],
    queryFn: () => api.get(`/resources?topic_id=${id}`).then((r) => r.data),
  });

  const { data: concepts = [], isLoading: loadingConcepts } = useQuery({
    queryKey: ['concepts', id],
    queryFn: () => api.get(`/concepts?topic_id=${id}`).then((r) => r.data),
  });

  const processResource = useMutation({
    mutationFn: (resourceId) => api.post(`/resources/${resourceId}/process`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['concepts', id] }),
  });

  const deleteResource = useMutation({
    mutationFn: (resourceId) => api.delete(`/resources/${resourceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources', id] });
      qc.invalidateQueries({ queryKey: ['topics'] });
    },
  });

  return (
    <div className="p-6 space-y-5">
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Resources */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Resources ({resources.length})</CardTitle>
              <Button size="sm" onClick={() => setResourceModalOpen(true)}>
                <Plus size={14} /> Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingResources ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : resources.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">No resources yet</p>
            ) : (
              <ul className="space-y-2">
                {resources.map((r) => {
                  const Icon = typeIcons[r.type] || FileText;
                  return (
                    <li key={r.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-[var(--bg-elevated)] group transition-colors">
                      <Icon size={14} className="text-[var(--text-muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--text-primary)] truncate">{r.title || r.file_name || r.url || 'Text resource'}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="muted">{r.type}</Badge>
                          {r.processed && <span className="flex items-center gap-1 text-xs text-[var(--success)]"><CheckCircle2 size={10} /> processed</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!r.processed && (
                          <Button
                            variant="subtle" size="sm"
                            disabled={processResource.isPending}
                            onClick={() => processResource.mutate(r.id)}
                          >
                            <Cpu size={12} />
                            {processResource.isPending ? '…' : 'Extract'}
                          </Button>
                        )}
                        <button
                          onClick={() => { if (confirm('Delete?')) deleteResource.mutate(r.id); }}
                          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Concepts */}
        <Card>
          <CardHeader>
            <CardTitle>Concepts ({concepts.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingConcepts ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : concepts.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">
                Add resources and click "Extract" to generate concepts
              </p>
            ) : (
              <ul className="space-y-3">
                {concepts.map((c) => (
                  <li key={c.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                        <Badge variant={c.difficulty_level}>{c.difficulty_level}</Badge>
                      </div>
                      <span className="text-xs text-[var(--text-muted)] shrink-0 ml-2">
                        {Math.round((c.mastery_score || 0) * 100)}%
                      </span>
                    </div>
                    <Progress value={c.mastery_score || 0} />
                    {c.description && (
                      <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{c.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <AddResourceModal open={resourceModalOpen} onClose={() => setResourceModalOpen(false)} topicId={id} />
    </div>
  );
}

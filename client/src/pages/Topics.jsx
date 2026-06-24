import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, BookOpen, ChevronRight, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import api from '@/lib/api';

function NewTopicModal({ open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '', learning_goal: 'general', depth_level: 'intermediate' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (data) => api.post('/topics', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['topics'] });
      onClose();
      setForm({ name: '', description: '', learning_goal: 'general', depth_level: 'intermediate' });
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to create topic'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New topic">
      <form
        onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(form); }}
        className="space-y-4"
      >
        <Input
          label="Topic name"
          placeholder="e.g. System Design, React Hooks"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <Textarea
          label="Description (optional)"
          placeholder="What do you want to learn?"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <Select
          label="Learning goal"
          value={form.learning_goal}
          onChange={(e) => setForm((f) => ({ ...f, learning_goal: e.target.value }))}
        >
          <option value="general">General knowledge</option>
          <option value="interviews">Interview prep</option>
          <option value="exams">Exam prep</option>
        </Select>
        <Select
          label="Depth level"
          value={form.depth_level}
          onChange={(e) => setForm((f) => ({ ...f, depth_level: e.target.value }))}
        >
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </Select>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create topic'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function Topics() {
  const [modalOpen, setModalOpen] = useState(false);
  const qc = useQueryClient();

  const { data: topics = [], isLoading } = useQuery({
    queryKey: ['topics'],
    queryFn: () => api.get('/topics').then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/topics/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['topics'] }),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Topics</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Your learning subjects</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus size={16} /> New topic
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : topics.length === 0 ? (
        <Card className="flex flex-col items-center py-14 gap-3">
          <BookOpen size={32} className="text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">No topics yet. Create your first one!</p>
          <Button onClick={() => setModalOpen(true)}><Plus size={14} /> New topic</Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {topics.map((t) => (
            <Card key={t.id} className="hover:border-[var(--accent)] transition-colors group">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-dim)]">
                  <BookOpen size={16} className="text-[var(--accent)]" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{t.name}</p>
                    <Badge variant={t.depth_level}>{t.depth_level}</Badge>
                    <Badge variant="muted">{t.learning_goal}</Badge>
                  </div>
                  {t.description && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{t.description}</p>
                  )}
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {t.concept_count} concepts
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      if (confirm('Delete this topic?')) deleteMutation.mutate(t.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--bg-elevated)] transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                  <Link to={`/topics/${t.id}`} className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-elevated)] transition-all">
                    <ChevronRight size={16} />
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewTopicModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import { mneme } from '@/lib/mneme';
import { Onboarding } from '@/components/mneme/Onboarding';

const LEVEL_STYLE = {
  new: 'text-[var(--accent)]',
  learning: 'text-[var(--accent)]',
  comfortable: 'text-[var(--warning)]',
  expert: 'text-[var(--success)]',
};
const LEVEL_LABEL = {
  new: 'new', learning: 'learning', comfortable: 'comfortable', expert: 'expert',
};

/**
 * Knowledge profile — the editable face of the onboarding prior. Shows the
 * domains Mneme is calibrated to and how many "declared" hints are still in
 * play, with a way to edit the prior or add more hints later.
 */
export function KnowledgeProfilePanel() {
  const [editing, setEditing] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['mneme', 'onboarding'],
    queryFn: mneme.getOnboarding,
  });

  const expertise = data?.expertise || [];
  const declared = data?.declaredCount || 0;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
            <Sparkles size={14} className="text-[var(--accent)]" /> Knowledge profile
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            What Mneme assumes you already know.
          </p>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <Pencil size={12} /> Edit
        </button>
      </div>

      <div className="mt-3">
        {isLoading ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : expertise.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-2">
            No domains yet — Mneme treats everything as new. Hit Edit to calibrate.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {expertise.map((e) => (
              <span
                key={e.domain}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-primary)]"
              >
                {e.domain}
                <span className={cn('font-medium', LEVEL_STYLE[e.level] || 'text-[var(--text-muted)]')}>
                  {LEVEL_LABEL[e.level] || e.level}
                </span>
              </span>
            ))}
          </div>
        )}

        {declared > 0 && (
          <p className="text-xs text-[var(--text-muted)] mt-3">
            {declared} declared hint{declared === 1 ? '' : 's'} still fading — they'll firm up if real
            life confirms them.
          </p>
        )}
      </div>

      <Onboarding
        open={editing}
        editMode
        initialExpertise={expertise}
        onClose={() => { setEditing(false); refetch(); }}
      />
    </Card>
  );
}

export default KnowledgeProfilePanel;

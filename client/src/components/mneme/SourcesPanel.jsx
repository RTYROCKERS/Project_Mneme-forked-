import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Terminal, Monitor, CircleHelpIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import { mneme } from '@/lib/mneme';

const KIND_ICON = { browser: Globe, terminal: Terminal, desktop: Monitor, other: CircleHelpIcon };
const PERMISSIONS = ['always', 'once', 'never'];
const PERM_STYLE = {
  always: 'text-[var(--success)]',
  once: 'text-[var(--warning)]',
  never: 'text-[var(--danger)]',
  pending: 'text-[var(--text-muted)]',
};

/**
 * Sources & permissions — the "you control everything" layer. Each place Mneme
 * observes (a site, the terminal) can be set to always / once / never.
 */
export function SourcesPanel() {
  const qc = useQueryClient();
  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['mneme', 'sources'],
    queryFn: mneme.listSources,
  });

  const setPerm = useMutation({
    mutationFn: ({ source, permission }) =>
      mneme.setSource({
        kind: source.kind,
        identifier: source.identifier,
        label: source.label,
        permission,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mneme', 'sources'] }),
  });

  return (
    <Card>
      <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Sources & permissions</p>
      <p className="text-xs text-[var(--text-muted)] mb-3">
        Mneme only learns from places you allow.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : sources.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-4">
          No sources yet. They appear here the first time Mneme observes one.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {sources.map((src) => {
            const Icon = KIND_ICON[src.kind] || CircleHelpIcon;
            return (
              <li key={src.id} className="flex items-center gap-3">
                <Icon size={15} className="shrink-0 text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm text-[var(--text-primary)]">{src.label || src.identifier}</p>
                  <p className={cn('text-xs', PERM_STYLE[src.permission])}>
                    {src.is_sensitive ? 'sensitive · blocked' : src.permission}
                  </p>
                </div>
                <div className="flex shrink-0 overflow-hidden rounded-lg border border-[var(--border)]">
                  {PERMISSIONS.map((p) => (
                    <button
                      key={p}
                      disabled={setPerm.isPending}
                      onClick={() => setPerm.mutate({ source: src, permission: p })}
                      className={cn(
                        'px-2.5 py-1 text-xs transition-colors',
                        src.permission === p
                          ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-medium'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

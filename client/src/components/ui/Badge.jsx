import { cn } from '@/lib/utils';

export function Badge({ children, variant = 'default', className }) {
  const variants = {
    default:      'bg-[var(--accent-dim)] text-[var(--accent)]',
    success:      'bg-[rgba(76,175,140,0.15)] text-[var(--success)]',
    warning:      'bg-[rgba(229,164,86,0.15)] text-[var(--warning)]',
    danger:       'bg-[rgba(229,107,111,0.15)] text-[var(--danger)]',
    muted:        'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
    easy:         'bg-[rgba(76,175,140,0.15)] text-[var(--success)]',
    intermediate: 'bg-[rgba(229,164,86,0.15)] text-[var(--warning)]',
    hard:         'bg-[rgba(229,107,111,0.15)] text-[var(--danger)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variants[variant] || variants.default,
        className
      )}
    >
      {children}
    </span>
  );
}

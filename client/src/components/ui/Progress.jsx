import { cn } from '@/lib/utils';

export function Progress({ value = 0, className, colorClass }) {
  const clamped = Math.min(Math.max(value * 100, 0), 100);

  const getColor = () => {
    if (colorClass) return colorClass;
    if (value >= 0.7) return 'bg-[var(--success)]';
    if (value >= 0.4) return 'bg-[var(--warning)]';
    return 'bg-[var(--danger)]';
  };

  return (
    <div className={cn('h-1.5 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', getColor())}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

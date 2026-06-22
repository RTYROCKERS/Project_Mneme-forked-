import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

export const Input = forwardRef(({ className, label, error, ...props }, ref) => (
  <div className="flex flex-col gap-1.5">
    {label && (
      <label className="text-sm font-medium text-[var(--text-muted)]">{label}</label>
    )}
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-all',
        error && 'border-[var(--danger)]',
        className
      )}
      {...props}
    />
    {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
  </div>
));

Input.displayName = 'Input';

export const Textarea = forwardRef(({ className, label, error, ...props }, ref) => (
  <div className="flex flex-col gap-1.5">
    {label && <label className="text-sm font-medium text-[var(--text-muted)]">{label}</label>}
    <textarea
      ref={ref}
      className={cn(
        'min-h-[80px] w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-all resize-none',
        error && 'border-[var(--danger)]',
        className
      )}
      {...props}
    />
    {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
  </div>
));

Textarea.displayName = 'Textarea';

export function Select({ label, children, className, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-[var(--text-muted)]">{label}</label>}
      <select
        className={cn(
          'h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-all cursor-pointer',
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

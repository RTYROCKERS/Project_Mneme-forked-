import { cn } from '@/lib/utils';

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }) {
  return <div className={cn('mb-4', className)}>{children}</div>;
}

export function CardTitle({ className, children }) {
  return <h3 className={cn('text-base font-semibold text-[var(--text-primary)]', className)}>{children}</h3>;
}

export function CardDescription({ className, children }) {
  return <p className={cn('text-sm text-[var(--text-muted)] mt-0.5', className)}>{children}</p>;
}

export function CardContent({ className, children }) {
  return <div className={cn(className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return <div className={cn('mt-4 flex items-center', className)}>{children}</div>;
}

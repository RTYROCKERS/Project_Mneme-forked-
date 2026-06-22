import { cn } from '@/lib/utils';

export function Spinner({ className, size = 'md' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]',
        sizes[size],
        className
      )}
    />
  );
}

export function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-base)]">
      <Spinner size="lg" />
    </div>
  );
}

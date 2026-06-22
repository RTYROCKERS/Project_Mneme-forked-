import { cn } from '@/lib/utils';
import { cva } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
  {
    variants: {
      variant: {
        default:  'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] shadow-sm',
        outline:  'border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
        ghost:    'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
        danger:   'bg-[var(--danger)] text-white hover:opacity-90',
        subtle:   'bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white',
      },
      size: {
        sm:   'h-8 px-3 text-sm',
        md:   'h-9 px-4 text-sm',
        lg:   'h-10 px-5 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  }
);

export function Button({ className, variant, size, children, ...props }) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </button>
  );
}

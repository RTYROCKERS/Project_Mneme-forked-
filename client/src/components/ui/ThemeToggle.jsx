import { Sun, Moon } from 'lucide-react';
import { useThemeStore } from '@/store/themeStore';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }) {
  const { theme, toggle } = useThemeStore();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'flex items-center justify-center h-7 w-7 rounded-lg transition-all duration-150',
        'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
        className
      )}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

import { NavLink, useNavigate } from 'react-router-dom';
import { Brain, LayoutDashboard, BookOpen, Lightbulb, BarChart3, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/topics',    icon: BookOpen,        label: 'Topics' },
  { to: '/study',     icon: Brain,           label: 'Study' },
  { to: '/stats',     icon: BarChart3,       label: 'Progress' },
];

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)]">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[var(--border)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-dim)]">
          <Brain size={16} className="text-[var(--accent)]" />
        </div>
        <span className="text-sm font-semibold text-[var(--text-primary)] tracking-wide">Mneme</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150',
                isActive
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)] font-medium'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
              )
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-[var(--border)] px-3 py-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-dim)] text-xs font-semibold text-[var(--accent)]">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-[var(--text-primary)]">{user?.name}</p>
            <p className="truncate text-xs text-[var(--text-muted)]">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
            title="Logout"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

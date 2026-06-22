import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggle: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        set({ theme: next });
      },
      apply: () => {
        document.documentElement.setAttribute('data-theme', get().theme);
      },
    }),
    { name: 'mneme_theme', partialize: (s) => ({ theme: s.theme }) }
  )
);

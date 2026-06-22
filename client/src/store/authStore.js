import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => {
        localStorage.setItem('mneme_token', token);
        set({ user, token });
      },
      logout: () => {
        localStorage.removeItem('mneme_token');
        set({ user: null, token: null });
      },
    }),
    { name: 'mneme_auth', partialize: (s) => ({ user: s.user, token: s.token }) }
  )
);

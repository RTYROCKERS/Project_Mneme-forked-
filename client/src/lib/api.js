import axios from 'axios';
import { useAuthStore } from '@/store/authStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mneme_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 globally — but never hijack the auth screens.
// A failed login/register returns 401 and must surface its error message to the
// form instead of triggering a redirect (this is a SPA, so we navigate via the
// router, not by reloading to a non-existent server route).
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const isAuthRequest = url.includes('/auth/login') || url.includes('/auth/register');
    const hadToken = !!localStorage.getItem('mneme_token');

    // Only treat a 401 as an expired session for authenticated requests.
    if (err.response?.status === 401 && !isAuthRequest && hadToken) {
      // Clearing auth state lets <ProtectedRoute> redirect to /login via the
      // router — no full page reload, which would break the SPA.
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  }
);

/**
 * Normalize any axios/network error into a human-readable message.
 * Use this everywhere instead of digging into err.response manually.
 */
export function getErrorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.response?.status === 401) return 'Your session expired. Please sign in again.';
  if (err?.response?.status === 403) return 'You do not have permission to do that.';
  if (err?.response?.status === 404) return 'The requested item could not be found.';
  if (err?.response?.status >= 500) return 'The server ran into a problem. Please try again shortly.';
  if (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return err?.message || fallback;
}

export default api;

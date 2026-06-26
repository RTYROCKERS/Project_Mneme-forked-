import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Dashboard from '@/pages/Dashboard';
import ControlCenter from '@/pages/ControlCenter';
import Topics from '@/pages/Topics';
import TopicDetail from '@/pages/TopicDetail';
import Documents from '@/pages/Documents';
import Study from '@/pages/Study';
import Stats from '@/pages/Stats';
import Profile from '@/pages/Profile';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function ProtectedRoute({ children }) {
  const { token } = useAuthStore();
  return token ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { token } = useAuthStore();
  return !token ? children : <Navigate to="/dashboard" replace />;
}

export default function App() {
  const { apply } = useThemeStore();
  useEffect(() => { apply(); }, [apply]);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/dashboard"    element={<Dashboard />} />
              <Route path="/mneme"        element={<ControlCenter />} />
              <Route path="/topics"       element={<Topics />} />
              <Route path="/topics/:id"   element={<TopicDetail />} />
              <Route path="/documents"    element={<Documents />} />
              <Route path="/study"        element={<Study />} />
              <Route path="/stats"        element={<Stats />} />
              <Route path="/profile"      element={<Profile />} />
            </Route>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            {/* Unknown routes (e.g. a stale deep link after reload) fall back gracefully */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}


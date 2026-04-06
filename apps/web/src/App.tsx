import { useEffect, useState, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'styled-components';
import styled from 'styled-components';
import { DbClient } from '@fresh/core/db';
import { theme } from './theme';
import GlobalStyle from './GlobalStyle';
import { initDb } from './store/db';
import { apiFetch } from './utils/api';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { Transactions } from './pages/Transactions';
import { Budget } from './pages/Budget';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Register } from './pages/Register';
import { Landing } from './pages/Landing';

// ---------------------------------------------------------------------------
// DB context — available to all authenticated pages
// ---------------------------------------------------------------------------

const DbContext = createContext<DbClient | null>(null);

export const useDb = () => {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used within DbContext');
  return ctx;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const SplashScreen = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-size: ${({ theme }) => theme.font.size.md};
  color: ${({ theme }) => theme.color.textMuted};
  background: ${({ theme }) => theme.color.bg};
`;

const ErrorScreen = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: ${({ theme }) => theme.space[6]};
  color: ${({ theme }) => theme.color.danger};
  font-size: ${({ theme }) => theme.font.size.md};
`;

const AppShell = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: ${({ theme }) => theme.color.bg};
`;

const Sidebar = styled.nav`
  width: ${({ theme }) => theme.sidebar.width};
  min-width: ${({ theme }) => theme.sidebar.width};
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.color.surface};
  border-right: 1px solid ${({ theme }) => theme.color.border};
  padding: ${({ theme }) => theme.space[5]} 0;
  overflow-y: auto;
`;

const Logo = styled.div`
  padding: 0 ${({ theme }) => theme.space[5]};
  margin-bottom: ${({ theme }) => theme.space[6]};
  font-size: ${({ theme }) => theme.font.size['2xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.green600};
  letter-spacing: -0.5px;
`;

const NavList = styled.ul`
  list-style: none;
  flex: 1;
  padding: 0 ${({ theme }) => theme.space[3]};
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const NavItem = styled.li`
  a {
    display: flex;
    align-items: center;
    padding: ${({ theme }) => theme.space[2]} ${({ theme }) => theme.space[3]};
    border-radius: ${({ theme }) => theme.radius.md};
    font-size: ${({ theme }) => theme.font.size.base};
    font-weight: ${({ theme }) => theme.font.weight.medium};
    color: ${({ theme }) => theme.color.textSub};
    text-decoration: none;
    transition: ${({ theme }) => theme.transition.fast};

    &:hover {
      background: ${({ theme }) => theme.color.green50};
      color: ${({ theme }) => theme.color.text};
    }

    &.active {
      background: ${({ theme }) => theme.color.green50};
      color: ${({ theme }) => theme.color.green700};
    }
  }
`;

const Content = styled.main`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.space[8]};
`;

// ---------------------------------------------------------------------------
// Model version check — runs on mount for authenticated users
// ---------------------------------------------------------------------------

type ModelEntry = { model_type: string; version: string; cdn_url: string; checksum: string };

function useModelVersionCheck() {
  useEffect(() => {
    const controller = new AbortController();

    apiFetch('/api/v1/models/current', { signal: controller.signal })
      .then((r) => r.json())
      .then(({ models }: { models: ModelEntry[] }) => {
        for (const model of models) {
          const cachedVersion = localStorage.getItem(`model_version_${model.model_type}`);
          if (cachedVersion !== model.version) {
            fetch(model.cdn_url, { cache: 'force-cache' }).catch(() => {});
            localStorage.setItem(`model_version_${model.model_type}`, model.version);
          }
        }
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);
}

// ---------------------------------------------------------------------------
// Authenticated shell — includes local DB
// ---------------------------------------------------------------------------

function AuthenticatedShell({ db }: { db: DbClient }) {
  useModelVersionCheck();

  return (
    <DbContext.Provider value={db}>
      <AppShell>
        <Sidebar>
          <Logo>Fresh</Logo>
          <NavList>
            {[
              { to: '/dashboard',    label: 'Dashboard' },
              { to: '/accounts',     label: 'Accounts' },
              { to: '/transactions', label: 'Transactions' },
              { to: '/budget',       label: 'Budget' },
              { to: '/settings',     label: 'Settings' },
            ].map(({ to, label }) => (
              <NavItem key={to}>
                <NavLink to={to}>{label}</NavLink>
              </NavItem>
            ))}
          </NavList>
        </Sidebar>
        <Content>
          <Routes>
            <Route path="/dashboard"    element={<Dashboard />} />
            <Route path="/accounts"     element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/budget"       element={<Budget />} />
            <Route path="/settings"     element={<Settings />} />
            <Route path="*"             element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Content>
      </AppShell>
    </DbContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// App routes — consumes AuthProvider, handles DB init
// ---------------------------------------------------------------------------

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  const [db, setDb] = useState<DbClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setDb(null);
      setInitError(null);
      return;
    }
    initDb()
      .then(setDb)
      .catch((err: Error) => setInitError(err.message));
  }, [isAuthenticated]);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/"        element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/login"   element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/signup"  element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Signup />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />} />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          !isAuthenticated ? (
            <Navigate to="/login" replace />
          ) : initError ? (
            <ErrorScreen>Failed to initialize local database: {initError}</ErrorScreen>
          ) : !db ? (
            <SplashScreen>Loading your data…</SplashScreen>
          ) : (
            <AuthenticatedShell db={db} />
          )
        }
      />
    </Routes>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

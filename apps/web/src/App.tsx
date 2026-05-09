import { useEffect, useState, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ThemeProvider } from 'styled-components';
import styled from 'styled-components';
import { DbClient } from '@fresh/core/db';
import { FinanceSocket, type SyncCompletePayload } from '@fresh/core/channels';
import { processSyncBatch } from '@fresh/core/sync';
import { theme } from './theme';
import GlobalStyle from './GlobalStyle';
import { initDb } from './store/db';
import { apiFetch } from './utils/api';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { getStoredCloudAdapter } from './cloud/oauth';
import { DbContext, SocketRefContext, DeviceKeyContext } from './context';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { Transactions } from './pages/Transactions';
import { Budget } from './pages/Budget';
import { Settings } from './pages/Settings';
import { OAuthCallback } from './pages/OAuthCallback';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Register } from './pages/Register';
import { Landing } from './pages/Landing';

// Use window.location so the WebSocket goes through Vite's proxy in dev
// and through the reverse proxy in production — never directly to Phoenix.
const WS_URL = `${window.location.origin.replace(/^http/, 'ws')}/socket`;

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

  const { token } = useAuth();
  const qc = useQueryClient();
  const socketRef = useRef<FinanceSocket | null>(null);
  const [deviceKey, setDeviceKey] = useState<CryptoKey | null>(null);
  // Stable ref so the sync:complete closure always calls the latest ackSync
  const ackSyncRef = useRef<(ref: string) => void>((ref) => socketRef.current?.ackSync(ref));

  useEffect(() => {
    if (!token) return;

    const socket = new FinanceSocket({
      url: WS_URL,
      deviceToken: token,
      onDeviceKey: (key) => setDeviceKey(key),
      onError: (err) => console.error('[Socket]', err.message),
    });

    socket.connect();
    socketRef.current = socket;

    const unsub = socket.on<SyncCompletePayload>('sync:complete', (payload) => {
      console.log('[Sync] sync:complete received', { txCount: payload.transaction_count, hasKey: !!socket.deviceKey });
      const key = socket.deviceKey;
      if (!key) {
        console.warn('[Sync] no device key — dropping sync:complete');
        return;
      }
      processSyncBatch(payload, { db: db.raw, deviceKey: key, ackSync: ackSyncRef.current })
        .catch((err) => console.error('[Sync] batch failed:', err))
        .finally(() => {
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
        });
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
    });

    return () => {
      unsub();
      socket.disconnect();
      socketRef.current = null;
      setDeviceKey(null);
    };
  }, [token, db, qc]);

  return (
    <SocketRefContext.Provider value={socketRef}>
      <DeviceKeyContext.Provider value={deviceKey}>
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
      </DeviceKeyContext.Provider>
    </SocketRefContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// App routes — consumes AuthProvider, handles DB init
// ---------------------------------------------------------------------------

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  const [db, setDb] = useState<DbClient | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [splashMsg, setSplashMsg] = useState('Loading your data…');

  useEffect(() => {
    if (!isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear DB state on logout
      setDb(null);
      setInitError(null);
      setSplashMsg('Loading your data…');
      return;
    }

    const cloudAdapter = getStoredCloudAdapter();
    if (cloudAdapter) setSplashMsg('Syncing from cloud…');

    const timeout = setTimeout(() => {
      setInitError('Database took too long to initialize. Check the browser console for details.');
    }, 15_000);

    initDb(cloudAdapter ?? undefined, (status) => {
      if (status !== 'no_cloud') setSplashMsg('Syncing from cloud…');
    })
      .then((client) => { clearTimeout(timeout); setDb(client); })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[initDb] failed:', err);
        setInitError(msg || 'Unknown error initializing database');
      });

    return () => clearTimeout(timeout);
  }, [isAuthenticated]);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/"               element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/login"          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/signup"         element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Signup />} />
      <Route path="/register"       element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Register />} />
      <Route path="/oauth/callback" element={<OAuthCallback />} />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          !isAuthenticated ? (
            <Navigate to="/login" replace />
          ) : initError ? (
            <ErrorScreen>Failed to initialize local database: {initError}</ErrorScreen>
          ) : !db ? (
            <SplashScreen>{splashMsg}</SplashScreen>
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

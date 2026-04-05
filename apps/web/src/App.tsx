import React, { useEffect, useState, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'styled-components';
import { DbClient } from '@fresh/core/db';
import { useFinanceSocket } from '@fresh/core/channels';
import { TransactionCategorizer, AnomalyDetector } from '@fresh/core/ml';
import { InferenceSession } from 'onnxruntime-web';
import styled from 'styled-components';
import { initDb } from './store/db';
import { theme } from './theme';
import GlobalStyle from './GlobalStyle';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { Transactions } from './pages/Transactions';
import { Budget } from './pages/Budget';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { Landing } from './pages/Landing';

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const DbContext = createContext<DbClient | null>(null);
export const useDb = () => {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used within DbContext');
  return ctx;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
  },
});

const CDN_BASE = import.meta.env.VITE_CDN_BASE_URL ?? 'https://cdn.fresh.app';

const webModelStore = {
  async get(type: string): Promise<ArrayBuffer | null> {
    const cache = await caches.open('fresh-models');
    const resp = await cache.match(`/models/${type}`);
    return resp ? resp.arrayBuffer() : null;
  },
  async set(type: string, _version: string, data: ArrayBuffer): Promise<void> {
    const cache = await caches.open('fresh-models');
    await cache.put(`/models/${type}`, new Response(data));
  },
  async getVersion(type: string): Promise<string | null> {
    return localStorage.getItem(`fresh_model_version_${type}`);
  },
};

const onnxFactory = async (buffer: ArrayBuffer) =>
  InferenceSession.create(buffer) as any;

const categorizer = new TransactionCategorizer(onnxFactory, webModelStore, CDN_BASE);
const anomalyDetector = new AnomalyDetector(onnxFactory, webModelStore, CDN_BASE);

// ---------------------------------------------------------------------------
// Styled components — app shell
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
    gap: ${({ theme }) => theme.space[2]};
    padding: ${({ theme }) => theme.space[2]} ${({ theme }) => theme.space[3]};
    border-radius: ${({ theme }) => theme.radius.md};
    font-size: ${({ theme }) => theme.font.size.base};
    font-weight: ${({ theme }) => theme.font.weight.medium};
    color: ${({ theme }) => theme.color.textSub};
    transition: ${({ theme }) => theme.transition.fast};
    text-decoration: none;

    &:hover {
      background: ${({ theme }) => theme.color.green50};
      color: ${({ theme }) => theme.color.green700};
      text-decoration: none;
    }

    &.active {
      background: ${({ theme }) => theme.color.green100};
      color: ${({ theme }) => theme.color.green700};
      font-weight: ${({ theme }) => theme.font.weight.semibold};
    }
  }
`;

const StatusBadge = styled.div<{ $connected: boolean }>`
  margin: 0 ${({ theme }) => theme.space[5]};
  margin-top: auto;
  padding-top: ${({ theme }) => theme.space[5]};
  border-top: 1px solid ${({ theme }) => theme.color.border};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ $connected, theme }) =>
    $connected ? theme.color.success : theme.color.textMuted};

  &::before {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${({ $connected, theme }) =>
      $connected ? theme.color.success : theme.color.border};
    flex-shrink: 0;
  }
`;

const Content = styled.main`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.space[8]};
`;

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export default function App() {
  const [db, setDb] = useState<DbClient | null>(null);
  const [deviceToken] = useState<string | null>(() => localStorage.getItem('device_token'));
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    initDb()
      .then(setDb)
      .catch((err) => setInitError(err.message));
  }, []);

  const { isConnected } = useFinanceSocket({
    url: `${import.meta.env.VITE_API_URL ?? 'ws://localhost:4000'}/socket`,
    deviceToken,
    onSyncComplete: async (payload) => {
      console.log('[Socket] Sync complete:', payload.account_token_ref);
    },
    onModelUpdated: async (payload) => {
      if (payload.model_type === 'categorizer') {
        await categorizer.load(payload.version);
      } else {
        await anomalyDetector.load(payload.version);
      }
    },
    onAlertTriggered: (payload) => {
      console.log('[Socket] Alert triggered:', payload.rule_token_ref);
    },
  });

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <BrowserRouter>
        {initError && (
          <ErrorScreen>Failed to initialize local database: {initError}</ErrorScreen>
        )}
        {!initError && !db && (
          <SplashScreen>Initializing secure local database…</SplashScreen>
        )}
        {!initError && db && (
          <QueryClientProvider client={queryClient}>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<Landing />} />
              <Route
                path="/login"
                element={deviceToken ? <Navigate to="/dashboard" replace /> : <Login />}
              />

              {/* Authenticated app shell */}
              <Route
                path="/*"
                element={
                  !deviceToken ? (
                    <Navigate to="/" replace />
                  ) : (
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
                          <StatusBadge $connected={isConnected}>
                            {isConnected ? 'Live' : 'Offline'}
                          </StatusBadge>
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
                  )
                }
              />
            </Routes>
          </QueryClientProvider>
        )}
      </BrowserRouter>
    </ThemeProvider>
  );
}

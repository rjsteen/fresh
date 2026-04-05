import React, { useEffect, useState, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DbClient } from '@privacyfinance/core/db';
import { useFinanceSocket } from '@privacyfinance/core/channels';
import { TransactionCategorizer, AnomalyDetector } from '@privacyfinance/core/ml';
import { InferenceSession } from 'onnxruntime-web';
import { initDb } from './store/db';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { Transactions } from './pages/Transactions';
import { Budget } from './pages/Budget';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';

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

const CDN_BASE = import.meta.env.VITE_CDN_BASE_URL ?? 'https://cdn.privacyfinance.app';

// Simple model store backed by Cache API
const webModelStore = {
  async get(type: string): Promise<ArrayBuffer | null> {
    const cache = await caches.open('pf-models');
    const resp = await cache.match(`/models/${type}`);
    return resp ? resp.arrayBuffer() : null;
  },
  async set(type: string, _version: string, data: ArrayBuffer): Promise<void> {
    const cache = await caches.open('pf-models');
    await cache.put(`/models/${type}`, new Response(data));
  },
  async getVersion(type: string): Promise<string | null> {
    return localStorage.getItem(`pf_model_version_${type}`);
  },
};

const onnxFactory = async (buffer: ArrayBuffer) =>
  InferenceSession.create(buffer) as any;

const categorizer = new TransactionCategorizer(onnxFactory, webModelStore, CDN_BASE);
const anomalyDetector = new AnomalyDetector(onnxFactory, webModelStore, CDN_BASE);

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
      // Device pulls encrypted transaction batch and writes to local DB
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

  if (initError) {
    return (
      <div style={{ padding: 24, color: 'red' }}>
        Failed to initialize local database: {initError}
      </div>
    );
  }

  if (!db) {
    return <div style={{ padding: 24 }}>Initializing secure local database...</div>;
  }

  if (!deviceToken) {
    return (
      <QueryClientProvider client={queryClient}>
        <Login />
      </QueryClientProvider>
    );
  }

  return (
    <DbContext.Provider value={db}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <div className="app-shell">
            <nav className="sidebar">
              <div className="logo">PrivacyFinance</div>
              <div className="connection-status" data-connected={isConnected}>
                {isConnected ? 'Live' : 'Offline'}
              </div>
              <ul>
                <li><a href="/dashboard">Dashboard</a></li>
                <li><a href="/accounts">Accounts</a></li>
                <li><a href="/transactions">Transactions</a></li>
                <li><a href="/budget">Budget</a></li>
                <li><a href="/settings">Settings</a></li>
              </ul>
            </nav>
            <main className="content">
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/budget" element={<Budget />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </QueryClientProvider>
    </DbContext.Provider>
  );
}

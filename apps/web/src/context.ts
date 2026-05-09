import { createContext, useContext } from 'react';
import type { DbClient } from '@fresh/core/db';
import type { FinanceSocket } from '@fresh/core/channels';

// ---------------------------------------------------------------------------
// DB context — available to all authenticated pages
// ---------------------------------------------------------------------------

export const DbContext = createContext<DbClient | null>(null);

export const useDb = () => {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used within DbContext');
  return ctx;
};

// ---------------------------------------------------------------------------
// Socket context — socket stays alive for the whole authenticated session
// ---------------------------------------------------------------------------

export const SocketRefContext = createContext<React.RefObject<FinanceSocket | null>>({ current: null });
export const DeviceKeyContext = createContext<CryptoKey | null>(null);

export const useSocketRef = () => useContext(SocketRefContext);
export const useDeviceKey = () => useContext(DeviceKeyContext);

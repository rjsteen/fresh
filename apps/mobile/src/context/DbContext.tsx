import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { DbClient } from '@fresh/core/db';
import { useFinanceSocket } from '@fresh/core/channels';
import { processSyncBatch } from '@fresh/core/sync';
import { NativeSqliteDriver } from '../db/driver';
import { useAuthStore } from '../store/auth';

const DbContext = createContext<DbClient | null>(null);

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const WS_URL = API.replace(/^http/, 'ws') + '/socket';

export function useDb(): DbClient {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used within DbProvider');
  return ctx;
}

function SyncHandler({ db }: { db: DbClient }) {
  const token = useAuthStore((s) => s.token);
  const ackSyncRef = useRef<(ref: string) => void>(() => {});

  const { ackSync } = useFinanceSocket({
    url: WS_URL,
    deviceToken: token,
    onSyncComplete: (payload) => {
      NativeSqliteDriver.getDeviceKey()
        .then((key) =>
          processSyncBatch(payload, {
            db: db.raw,
            deviceKey: key,
            ackSync: ackSyncRef.current,
          })
        )
        .catch((err) => console.error('[DbProvider] sync batch failed:', err));
    },
    onSyncError: ({ account_token_ref, reason }) => {
      console.warn('[DbProvider] sync error for', account_token_ref, reason);
    },
  });

  // eslint-disable-next-line react-hooks/refs -- stable ref pattern: keeps ackSync current without re-subscribing
  ackSyncRef.current = ackSync;

  return null;
}

export function DbProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DbClient | null>(null);

  useEffect(() => {
    NativeSqliteDriver.create()
      .then((driver) => setDb(new DbClient(driver)))
      .catch(console.error);
  }, []);

  if (!db) return null;

  return (
    <DbContext.Provider value={db}>
      <SyncHandler db={db} />
      {children}
    </DbContext.Provider>
  );
}

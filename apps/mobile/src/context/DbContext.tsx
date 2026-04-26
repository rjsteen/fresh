import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { DbClient } from '@fresh/core/db';
import { CloudSyncManager } from '@fresh/core/cloud';
import { useFinanceSocket } from '@fresh/core/channels';
import { processSyncBatch } from '@fresh/core/sync';
import * as FileSystem from 'expo-file-system';
import { NativeSqliteDriver } from '../db/driver';
import { useAuthStore } from '../store/auth';
import { useCloudStore } from '../store/cloud';
import { handleModelUpdated } from '../ml';

const DbContext = createContext<DbClient | null>(null);

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
const WS_URL = API.replace(/^http/, 'ws') + '/socket';

export function useDb(): DbClient {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used within DbProvider');
  return ctx;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // atob is not available in Hermes — use Buffer which is polyfilled by React Native
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  return bytes.buffer;
}

export function SyncHandler({ db }: { db: DbClient }) {
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
    onModelUpdated: (payload) => {
      handleModelUpdated(payload).catch((err) =>
        console.error('[DbProvider] model update failed:', err)
      );
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
  const syncRef = useRef<CloudSyncManager | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Hydrate cloud config before building the adapter so the right provider
      // is selected on startup. Cloud changes take effect on next app launch.
      await useCloudStore.getState().hydrate();
      const adapter = useCloudStore.getState().buildAdapter();

      const driver = await NativeSqliteDriver.create();
      if (cancelled) {
        await driver.close();
        return;
      }

      const client = new DbClient(driver);
      const sync = new CloudSyncManager(driver, adapter);

      // Migrations must run before hydrate() so that sync_meta exists when
      // a real adapter queries it for the local cursor.
      await client.runMigrations();

      const status = await sync.hydrate();
      console.log('[DbProvider] cloud hydration status:', status);

      if (status === 'first_sync') {
        // No backup exists yet — push the full encrypted DB so other devices
        // (and the web app) can hydrate from it.
        if (!cancelled) {
          try {
            const base64 = await FileSystem.readAsStringAsync(NativeSqliteDriver.dbPath, {
              encoding: FileSystem.EncodingType.Base64,
            });
            if (!cancelled) {
              await sync.pushFullFile(base64ToArrayBuffer(base64));
            }
          } catch (err) {
            console.error('[DbProvider] full file push failed:', err);
          }
        }
      }

      if (cancelled) return;

      // Note: 'hydrated' means a full file was pulled from cloud. On mobile,
      // reinitializing the DB from the pulled bytes requires closing the op-sqlite
      // handle, replacing the file, and reopening — this is deferred until
      // NativeSqliteDriver exposes reinitializeFrom(). The foreground hydrate()
      // call in the AppState listener will also be a no-op until then.

      sync.startDeltaPush(30_000);
      syncRef.current = sync;

      setDb(client);
    }

    init().catch(console.error);

    return () => {
      cancelled = true;
      syncRef.current?.stopDeltaPush();
    };
  }, []);

  // Push pending deltas when the app moves to background; pull deltas when
  // returning to foreground (covers multi-device use).
  useEffect(() => {
    const prevStateRef = { current: AppState.currentState };

    const sub = AppState.addEventListener('change', (next) => {
      const prev = prevStateRef.current;
      prevStateRef.current = next;

      if (!syncRef.current) return;

      if (next === 'background' || next === 'inactive') {
        syncRef.current.pushPendingDeltas().catch(console.error);
      } else if (next === 'active' && (prev === 'background' || prev === 'inactive')) {
        syncRef.current.hydrate().catch(console.error);
      }
    });

    return () => sub.remove();
  }, []);

  if (!db) return null;

  return (
    <DbContext.Provider value={db}>
      <SyncHandler db={db} />
      {children}
    </DbContext.Provider>
  );
}

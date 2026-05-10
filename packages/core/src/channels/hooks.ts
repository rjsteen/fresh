/**
 * React hooks wrapping the FinanceSocket for use in both web and React Native.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { FinanceSocket, type SignalEvent, type ModelUpdatedPayload, type SyncCompletePayload, type AlertTriggeredPayload } from './socket';

export interface UseFinanceSocketOptions {
  url: string;
  deviceToken: string | null;
  onSyncComplete?: (payload: SyncCompletePayload) => void;
  onAlertTriggered?: (payload: AlertTriggeredPayload) => void;
  onModelUpdated?: (payload: ModelUpdatedPayload) => void;
  onSyncError?: (payload: { account_token_ref: string; reason: string }) => void;
  onAccountDeleted?: () => void;
  onDeviceKey?: (key: CryptoKey) => void;
}

export function useFinanceSocket(opts: UseFinanceSocketOptions) {
  const socketRef = useRef<FinanceSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceKey, setDeviceKey] = useState<CryptoKey | null>(null);

  const stableOpts = useRef(opts);
  // eslint-disable-next-line react-hooks/refs -- stable ref pattern: keeps opts current without re-subscribing
  stableOpts.current = opts;

  useEffect(() => {
    if (!opts.deviceToken) return;

    const socket = new FinanceSocket({
      url: opts.url,
      deviceToken: opts.deviceToken,
      onError: (err) => {
        console.error('[Socket]', err.message);
        setIsConnected(false);
      },
      onDeviceKey: (key) => {
        setDeviceKey(key);
        stableOpts.current.onDeviceKey?.(key);
      },
    });

    socketRef.current = socket;
    socket.connect();
    setIsConnected(true);

    const unsubscribers = [
      socket.on<SyncCompletePayload>('sync:complete', (p) =>
        stableOpts.current.onSyncComplete?.(p)
      ),
      socket.on<AlertTriggeredPayload>('alert:triggered', (p) =>
        stableOpts.current.onAlertTriggered?.(p)
      ),
      socket.on<ModelUpdatedPayload>('model:updated', (p) =>
        stableOpts.current.onModelUpdated?.(p)
      ),
      socket.on<{ account_token_ref: string; reason: string }>('sync:error', (p) =>
        stableOpts.current.onSyncError?.(p)
      ),
      socket.on('account:deleted', () => stableOpts.current.onAccountDeleted?.()),
    ];

    return () => {
      unsubscribers.forEach((unsub) => unsub());
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setDeviceKey(null);
    };
  }, [opts.deviceToken, opts.url]);

  const ackSync = useCallback((accountTokenRef: string) => {
    socketRef.current?.ackSync(accountTokenRef);
  }, []);

  const registerAlertToken = useCallback((ruleTokenRef: string) => {
    socketRef.current?.registerAlertToken(ruleTokenRef);
  }, []);

  const deregisterAlertToken = useCallback((ruleTokenRef: string) => {
    socketRef.current?.deregisterAlertToken(ruleTokenRef);
  }, []);

  return { isConnected, deviceKey, ackSync, registerAlertToken, deregisterAlertToken };
}

/** Minimal hook for a single event subscription */
export function useSocketEvent<T>(
  socketRef: React.RefObject<FinanceSocket | null>,
  event: SignalEvent,
  handler: (payload: T) => void
): void {
  const stableHandler = useRef(handler);
  // eslint-disable-next-line react-hooks/refs -- stable ref pattern: keeps handler current without re-subscribing
  stableHandler.current = handler;

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    return socket.on<T>(event, (p) => stableHandler.current(p));
  }, [socketRef, event]);
}

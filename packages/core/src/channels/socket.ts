/**
 * Phoenix socket connection manager.
 *
 * PRIVACY CONTRACT: The backend never receives financial data through channels.
 * Payloads sent TO the server: device registration, ack tokens, rule token refs.
 * Payloads received FROM the server: signals only (no amounts, no descriptions).
 */

import { Socket, Channel } from 'phoenix';

export type SignalEvent =
  | 'transaction:new'       // New transactions ready to be fetched (device pulls from bank API)
  | 'sync:complete'         // Bank sync job finished
  | 'sync:error'            // Bank sync job failed
  | 'alert:triggered'       // An alert rule fired (identified by opaque token_ref)
  | 'model:updated'         // New ONNX model weights available on CDN
  | 'rules:updated'         // New categorization rules available on CDN
  | 'account:deleted'       // User account was deleted — device should wipe local DB and log out
  | 'presence_state'        // Phoenix Presence state
  | 'presence_diff';        // Phoenix Presence diff

export interface SyncCompletePayload {
  account_token_ref: string;   // Opaque — backend maps this to the account
  transaction_count: number;   // How many transactions are ready to fetch
  cursor: string;              // Continuation cursor for the bank API fetch
  encrypted_batch?: string;    // Base64-encoded AES-256-GCM ciphertext of Transaction[]
  encrypted_accounts?: string; // Base64-encoded AES-256-GCM ciphertext of SyncedAccount[]
}

export interface AlertTriggeredPayload {
  rule_token_ref: string;     // Opaque token — device maps this to its local rule
  fired_at: string;           // ISO 8601
}

export interface ModelUpdatedPayload {
  model_type: 'categorizer' | 'anomaly';
  version: string;
  cdn_path: string;           // Path on CDN (not full URL — device constructs it)
  checksum_sha256: string;
}

export interface SocketOptions {
  url: string;               // e.g. wss://api.fresh.app/socket
  deviceToken: string;       // JWT issued at device registration
  onError?: (error: Error) => void;
  onDeviceKey?: (key: CryptoKey) => void;  // Called once per join with the session decryption key
  logger?: (kind: string, msg: string, data: unknown) => void;
}

export class FinanceSocket {
  private socket: Socket;
  private deviceChannel: Channel | null = null;
  private readonly handlers = new Map<SignalEvent, Set<(payload: unknown) => void>>();
  private _deviceKey: CryptoKey | null = null;

  get deviceKey(): CryptoKey | null {
    return this._deviceKey;
  }

  constructor(private readonly opts: SocketOptions) {
    this.socket = new Socket(opts.url, {
      params: { token: opts.deviceToken },
      logger: opts.logger ?? undefined,
    });
  }

  connect(): void {
    this.socket.onError((error: unknown) => {
      this.opts.onError?.(new Error(`Phoenix socket error: ${JSON.stringify(error)}`));
    });
    this.socket.connect();
    this.joinDeviceChannel();
  }

  disconnect(): void {
    this.deviceChannel?.leave();
    this.socket.disconnect();
  }

  on<T = unknown>(event: SignalEvent, handler: (payload: T) => void): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    const wrapper = (payload: unknown) => handler(payload as T);
    set.add(wrapper);

    // Subscribe on the channel if already joined
    this.deviceChannel?.on(event, wrapper);

    return () => {
      set.delete(wrapper);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- phoenix Channel.off types don't match wrapper
      this.deviceChannel?.off(event, wrapper as any);
    };
  }

  /** Acknowledge that device has processed a sync and pull is complete */
  ackSync(accountTokenRef: string): void {
    this.deviceChannel?.push('sync:ack', { account_token_ref: accountTokenRef });
  }

  /** Register a new alert rule's opaque token with the backend */
  registerAlertToken(ruleTokenRef: string): void {
    this.deviceChannel?.push('alert:register', { rule_token_ref: ruleTokenRef });
  }

  /** Deregister an alert rule token (when the user deletes a rule) */
  deregisterAlertToken(ruleTokenRef: string): void {
    this.deviceChannel?.push('alert:deregister', { rule_token_ref: ruleTokenRef });
  }

  /** Notify the backend that an alert rule fired so it can relay a push notification */
  notifyAlertFired(ruleTokenRef: string): void {
    this.deviceChannel?.push('alert:fire', { rule_token_ref: ruleTokenRef });
  }

  private joinDeviceChannel(): void {
    this.deviceChannel = this.socket.channel('device:me', {});

    // Re-register all handlers on the new channel
    for (const [event, handlerSet] of this.handlers.entries()) {
      for (const handler of handlerSet) {
        this.deviceChannel.on(event, handler);
      }
    }

    this.deviceChannel
      .join()
      .receive('ok', (resp: { status: string; session_key?: string }) => {
        console.log('[Socket] Joined device channel');
        if (resp.session_key) {
          const keyBytes = Uint8Array.from(atob(resp.session_key), c => c.charCodeAt(0));
          crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
            .then(key => {
              this._deviceKey = key;
              this.opts.onDeviceKey?.(key);
            })
            .catch(err => this.opts.onError?.(new Error(`Failed to import session key: ${err}`)));
        }
      })
      .receive('error', (err: unknown) =>
        this.opts.onError?.(new Error(`Channel join failed: ${JSON.stringify(err)}`))
      )
      .receive('timeout', () =>
        this.opts.onError?.(new Error('Channel join timed out'))
      );
  }

  get isConnected(): boolean {
    return this.socket.isConnected();
  }
}

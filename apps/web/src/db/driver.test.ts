/**
 * Unit tests for the web SQLite driver's key management and
 * plaintext-to-encrypted migration logic.
 *
 * - IDB key storage runs against fake-indexeddb (set up in test/setup.ts).
 * - OPFS is not available in jsdom; loadFromOpfs tests inject a fake
 *   navigator.storage via Object.defineProperty.
 * - encryptDb / decryptDb are exercised end-to-end without mocks.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  getOrCreateDbKey,
  encryptDb,
  decryptDb,
  loadFromOpfs,
  isSqliteMagic,
} from './driver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset IDB state between tests by swapping in a fresh factory instance. */
function freshIDB() {
  Object.defineProperty(globalThis, 'indexedDB', {
    value: new IDBFactory(),
    writable: true,
    configurable: true,
  });
}

/** Inject a fake navigator.storage for tests that exercise OPFS paths. */
function setFakeStorage(root: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      ...globalThis.navigator,
      storage: { getDirectory: vi.fn().mockResolvedValue(root) },
    },
    writable: true,
    configurable: true,
  });
}

/** Build a minimal fake OPFS handle backed by an in-memory Uint8Array. */
function makeOpfsMock(initialData?: Uint8Array) {
  let stored: Uint8Array | null = initialData ?? null;

  const writableStream = {
    write: vi.fn(async (data: ArrayBuffer) => {
      stored = new Uint8Array(data);
    }),
    close: vi.fn(async () => {}),
  };

  const fileHandle = {
    getFile: vi.fn(async () => ({
      arrayBuffer: async () => (stored ? stored.buffer : new ArrayBuffer(0)),
    })),
    createWritable: vi.fn(async () => writableStream),
  };

  const root = {
    getFileHandle: vi.fn(async (_name: string, _opts?: unknown) => fileHandle),
  };

  return { root, fileHandle, writableStream, getStored: () => stored };
}

/** The SQLite 3 magic header bytes. */
const SQLITE_MAGIC_BYTES = new Uint8Array([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);

function makePlaintextSqlite(extraBytes = 64): Uint8Array {
  const data = new Uint8Array(16 + extraBytes);
  data.set(SQLITE_MAGIC_BYTES, 0);
  for (let i = 16; i < data.length; i++) data[i] = i & 0xff;
  return data;
}

// ---------------------------------------------------------------------------
// isSqliteMagic
// ---------------------------------------------------------------------------

describe('isSqliteMagic', () => {
  it('returns true for data starting with SQLite magic bytes', () => {
    expect(isSqliteMagic(makePlaintextSqlite())).toBe(true);
  });

  it('returns false for encrypted / random bytes', () => {
    const random = crypto.getRandomValues(new Uint8Array(64));
    expect(isSqliteMagic(random)).toBe(false);
  });

  it('returns false for data shorter than 16 bytes', () => {
    expect(isSqliteMagic(SQLITE_MAGIC_BYTES.slice(0, 8))).toBe(false);
  });

  it('returns false when magic is correct length but wrong content', () => {
    const wrong = new Uint8Array(16).fill(0x41);
    expect(isSqliteMagic(wrong)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encryptDb / decryptDb
// ---------------------------------------------------------------------------

describe('encryptDb / decryptDb', () => {
  it('round-trips arbitrary bytes', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);
    const original = crypto.getRandomValues(new Uint8Array(256));
    const encrypted = await encryptDb(original, key);
    const decrypted = await decryptDb(encrypted, key);
    expect(decrypted).toEqual(original);
  });

  it('produces different ciphertext each call (random IV)', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);
    const data = new Uint8Array(32).fill(0xab);
    const a = await encryptDb(data, key);
    const b = await encryptDb(data, key);
    // IVs (first 12 bytes) must differ
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12));
  });

  it('throws when decrypted with the wrong key', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);
    const wrongKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);
    const encrypted = await encryptDb(new Uint8Array(32).fill(1), key);
    await expect(decryptDb(encrypted, wrongKey)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getOrCreateDbKey — IDB key storage
// ---------------------------------------------------------------------------

describe('getOrCreateDbKey', () => {
  beforeEach(() => {
    freshIDB();
    localStorage.clear();
  });

  it('creates a CryptoKey on first call', async () => {
    const key = await getOrCreateDbKey();
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('returns a non-extractable key', async () => {
    const key = await getOrCreateDbKey();
    expect(key.extractable).toBe(false);
  });

  it('key persists across calls — second call returns a functionally identical key', async () => {
    const k1 = await getOrCreateDbKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await encryptDb(plaintext, k1);

    // Reload from IDB
    const k2 = await getOrCreateDbKey();
    const decrypted = await decryptDb(encrypted, k2);
    expect(decrypted).toEqual(plaintext);
  });

  it('migrates a legacy localStorage key to IDB and clears localStorage', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const base64 = btoa(String.fromCharCode(...rawKey));
    localStorage.setItem('fresh_db_key', base64);

    const key = await getOrCreateDbKey();

    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.extractable).toBe(false);
    expect(localStorage.getItem('fresh_db_key')).toBeNull();

    // Subsequent call still works
    const k2 = await getOrCreateDbKey();
    const plaintext = new Uint8Array([1, 2, 3]);
    const encrypted = await encryptDb(plaintext, key);
    expect(await decryptDb(encrypted, k2)).toEqual(plaintext);
  });

  it('migrated legacy key is functionally compatible with the original raw bytes', async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    // Encrypt data with the original extractable key
    const extractableKey = await crypto.subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'],
    );
    const plaintext = new Uint8Array([1, 2, 3, 4]);
    const encrypted = await encryptDb(plaintext, extractableKey);

    // Migrate via localStorage
    localStorage.setItem('fresh_db_key', btoa(String.fromCharCode(...rawKey)));
    const migratedKey = await getOrCreateDbKey();

    // Migrated key must decrypt what the original key encrypted
    expect(await decryptDb(encrypted, migratedKey)).toEqual(plaintext);
  });
});

// ---------------------------------------------------------------------------
// loadFromOpfs — plaintext migration
// ---------------------------------------------------------------------------

describe('loadFromOpfs — plaintext migration', () => {
  it('returns null when OPFS throws (no file)', async () => {
    const root = {
      getFileHandle: vi.fn().mockRejectedValue(new DOMException('not found', 'NotFoundError')),
    };
    setFakeStorage(root);

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);
    expect(await loadFromOpfs(key)).toBeNull();
  });

  it('returns null when OPFS file is empty', async () => {
    const { root } = makeOpfsMock(new Uint8Array(0));
    setFakeStorage(root);

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);
    expect(await loadFromOpfs(key)).toBeNull();
  });

  it('detects plaintext SQLite, re-encrypts in place, and returns the plaintext', async () => {
    const plaintext = makePlaintextSqlite(512);
    const { root, writableStream, getStored } = makeOpfsMock(plaintext);
    setFakeStorage(root);

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);

    const result = await loadFromOpfs(key);

    // Returns the original plaintext bytes
    expect(result).toEqual(plaintext);

    // The file was re-written
    expect(writableStream.write).toHaveBeenCalledOnce();

    // Stored bytes are now encrypted (no longer start with SQLite magic)
    const stored = getStored()!;
    expect(isSqliteMagic(stored)).toBe(false);

    // The stored ciphertext decrypts back to the original
    const roundTripped = await decryptDb(stored, key);
    expect(roundTripped).toEqual(plaintext);
  });

  it('decrypts an already-encrypted file normally', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt', 'decrypt',
    ]);
    const original = crypto.getRandomValues(new Uint8Array(128));
    const encrypted = await encryptDb(original, key);

    const { root } = makeOpfsMock(encrypted);
    setFakeStorage(root);

    const result = await loadFromOpfs(key);
    expect(result).toEqual(original);
  });
});

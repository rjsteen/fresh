import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TransactionCategorizer,
  AnomalyDetector,
  type ModelStore,
  type OnnxSessionFactory,
  type OnnxSession,
} from './inference';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer as ArrayBuffer;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function makeStore(
  initial?: { data: ArrayBuffer; version: string },
  modelType = 'categorizer'
): ModelStore & { _store: Map<string, { data: ArrayBuffer; version: string }> } {
  const _store = new Map<string, { data: ArrayBuffer; version: string }>();
  if (initial) _store.set(modelType, initial);

  return {
    _store,
    get: vi.fn(async (type) => _store.get(type)?.data ?? null),
    getVersion: vi.fn(async (type) => _store.get(type)?.version ?? null),
    set: vi.fn(async (type, version, data) => { _store.set(type, { data, version }); }),
    delete: vi.fn(async (type) => { _store.delete(type); }),
  };
}

function makeSessionFactory(): OnnxSessionFactory {
  const session: OnnxSession = {
    run: vi.fn().mockResolvedValue({
      output: { data: new Float32Array(5).fill(0.2), dims: [1, 5], type: 'float32' },
    }),
  };
  return vi.fn().mockResolvedValue(session);
}

// ---------------------------------------------------------------------------
// TransactionCategorizer
// ---------------------------------------------------------------------------

describe('TransactionCategorizer.load()', () => {
  const CDN = 'https://cdn.example.com';
  const VERSION = '1.0.0';
  const MODEL_BYTES = makeBuffer('fake-onnx-categorizer');
  const CATEGORY_MAP = JSON.stringify({ category_ids: ['food', 'transport', 'shopping'] });

  let correctChecksum: string;

  beforeEach(async () => {
    correctChecksum = await sha256Hex(MODEL_BYTES);
  });

  function stubFetch(modelBytes = MODEL_BYTES) {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.onnx')) {
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(modelBytes) });
      }
      if (url.endsWith('categories.json')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(CATEGORY_MAP)) });
      }
      return Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
    }));
  }

  it('loads from cache when version matches and no checksum provided', async () => {
    const store = makeStore({ data: MODEL_BYTES, version: VERSION });
    const factory = makeSessionFactory();
    const cat = new TransactionCategorizer(factory, store, CDN);

    await cat.load(VERSION);

    expect(store.get).toHaveBeenCalledWith('categorizer');
    expect(factory).toHaveBeenCalledWith(MODEL_BYTES);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('loads from cache when checksum matches', async () => {
    const store = makeStore({ data: MODEL_BYTES, version: VERSION });
    const factory = makeSessionFactory();
    const cat = new TransactionCategorizer(factory, store, CDN);

    await cat.load(VERSION, correctChecksum);

    expect(factory).toHaveBeenCalledWith(MODEL_BYTES);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('purges cache and re-downloads when cached checksum mismatches', async () => {
    const corruptBytes = makeBuffer('corrupt-model');
    const store = makeStore({ data: corruptBytes, version: VERSION });
    const factory = makeSessionFactory();
    const cat = new TransactionCategorizer(factory, store, CDN);
    stubFetch();

    await cat.load(VERSION, correctChecksum);

    expect(store.delete).toHaveBeenCalledWith('categorizer');
    expect(store.set).toHaveBeenCalledWith('categorizer', VERSION, MODEL_BYTES);
    expect(factory).toHaveBeenCalledWith(MODEL_BYTES);
  });

  it('downloads and stores model when cache is empty', async () => {
    const store = makeStore();
    const factory = makeSessionFactory();
    const cat = new TransactionCategorizer(factory, store, CDN);
    stubFetch();

    await cat.load(VERSION, correctChecksum);

    expect(store.set).toHaveBeenCalledWith('categorizer', VERSION, MODEL_BYTES);
    expect(factory).toHaveBeenCalledWith(MODEL_BYTES);
  });

  it('retries once on checksum mismatch during download then succeeds', async () => {
    const badBytes = makeBuffer('bad-download');
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('.onnx')) {
        callCount++;
        const bytes = callCount === 1 ? badBytes : MODEL_BYTES;
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(bytes) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(CATEGORY_MAP)) });
    }));

    const store = makeStore();
    const factory = makeSessionFactory();
    const cat = new TransactionCategorizer(factory, store, CDN);

    await cat.load(VERSION, correctChecksum);

    expect(callCount).toBe(2);
    expect(factory).toHaveBeenCalledWith(MODEL_BYTES);
  });

  it('throws a descriptive error if both download attempts fail checksum', async () => {
    const badBytes = makeBuffer('bad-download');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(badBytes),
    }));

    const store = makeStore();
    const factory = makeSessionFactory();
    const cat = new TransactionCategorizer(factory, store, CDN);

    await expect(cat.load(VERSION, correctChecksum)).rejects.toThrow(
      /categorizer model checksum mismatch after 2 download attempts/
    );
  });

  it('throws when no version provided and store is empty', async () => {
    const store = makeStore();
    const factory = makeSessionFactory();
    const cat = new TransactionCategorizer(factory, store, CDN);

    await expect(cat.load()).rejects.toThrow('No categorizer model in store and no version specified');
  });
});

// ---------------------------------------------------------------------------
// AnomalyDetector
// ---------------------------------------------------------------------------

describe('AnomalyDetector.load()', () => {
  const CDN = 'https://cdn.example.com';
  const VERSION = '2.0.0';
  const MODEL_BYTES = makeBuffer('fake-onnx-anomaly');

  let correctChecksum: string;

  beforeEach(async () => {
    correctChecksum = await sha256Hex(MODEL_BYTES);
  });

  function stubFetch(modelBytes = MODEL_BYTES) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(modelBytes),
    }));
  }

  it('loads from cache when checksum matches', async () => {
    const store = makeStore({ data: MODEL_BYTES, version: VERSION }, 'anomaly');
    const factory = makeSessionFactory();
    const det = new AnomalyDetector(factory, store, CDN);

    await det.load(VERSION, correctChecksum);

    expect(factory).toHaveBeenCalledWith(MODEL_BYTES);
    expect(store.delete).not.toHaveBeenCalled();
  });

  it('purges cache and re-downloads when cached checksum mismatches', async () => {
    const corruptBytes = makeBuffer('corrupt-anomaly');
    const store = makeStore({ data: corruptBytes, version: VERSION }, 'anomaly');
    const factory = makeSessionFactory();
    const det = new AnomalyDetector(factory, store, CDN);
    stubFetch();

    await det.load(VERSION, correctChecksum);

    expect(store.delete).toHaveBeenCalledWith('anomaly');
    expect(store.set).toHaveBeenCalledWith('anomaly', VERSION, MODEL_BYTES);
    expect(factory).toHaveBeenCalledWith(MODEL_BYTES);
  });

  it('throws a descriptive error if both download attempts fail checksum', async () => {
    const badBytes = makeBuffer('bad-download');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(badBytes),
    }));

    const store = makeStore(undefined, 'anomaly');
    const factory = makeSessionFactory();
    const det = new AnomalyDetector(factory, store, CDN);

    await expect(det.load(VERSION, correctChecksum)).rejects.toThrow(
      /anomaly model checksum mismatch after 2 download attempts/
    );
  });
});

/**
 * On-device ML singletons for the mobile app.
 *
 * Session factory uses onnxruntime-react-native.
 * Model weights are cached on disk via ExpoModelStore.
 * Downloads use expo-file-system downloadAsync so large files
 * stream natively without buffering in the JS heap.
 */

import { InferenceSession } from 'onnxruntime-react-native';
import * as FileSystem from 'expo-file-system';
import { TransactionCategorizer, AnomalyDetector, sha256Hex } from '@fresh/core/ml';
import type { OnnxSession, OnnxTensor } from '@fresh/core/ml';
import type { ModelUpdatedPayload } from '@fresh/core/channels';
import { ExpoModelStore, MODELS_DIR } from './modelStore';

const CDN_BASE_URL = process.env.EXPO_PUBLIC_CDN_BASE_URL ?? '';

const modelStore = new ExpoModelStore();

async function sessionFactory(buffer: ArrayBuffer): Promise<OnnxSession> {
  // InferenceSession.create accepts ArrayBuffer directly
  return InferenceSession.create(buffer) as unknown as OnnxSession;
}

export const categorizer = new TransactionCategorizer(sessionFactory, modelStore, CDN_BASE_URL);
export const anomalyDetector = new AnomalyDetector(sessionFactory, modelStore, CDN_BASE_URL);

// ---------------------------------------------------------------------------
// Known model types — used to validate server-pushed payloads before the
// model_type string is interpolated into a filesystem path.
// ---------------------------------------------------------------------------

const KNOWN_MODEL_TYPES = ['categorizer', 'anomaly_detector'] as const;
type KnownModelType = (typeof KNOWN_MODEL_TYPES)[number];

function isKnownModelType(value: string): value is KnownModelType {
  return (KNOWN_MODEL_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Concurrency guard — one in-flight download per model type at a time.
// If an event arrives while a download is already running for the same model,
// we discard it (the in-flight download will land the latest weights that were
// pushed before it started; a subsequent event will re-trigger if needed).
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<void>>();

// ---------------------------------------------------------------------------
// Background model download + load
// ---------------------------------------------------------------------------

/**
 * Download an updated ONNX model from the CDN using expo-file-system
 * downloadAsync (native, non-blocking), verify its SHA-256 checksum,
 * persist it to ExpoModelStore via atomic rename, then hot-swap the
 * in-memory ONNX session.
 *
 * Call this fire-and-forget from the `model:updated` socket handler.
 */
export async function handleModelUpdated(payload: ModelUpdatedPayload): Promise<void> {
  const { model_type, version, cdn_path, checksum_sha256 } = payload;

  if (!CDN_BASE_URL) {
    throw new Error('[ML] EXPO_PUBLIC_CDN_BASE_URL is not set — cannot download model weights');
  }

  if (!isKnownModelType(model_type)) {
    throw new Error(`[ML] Received unknown model_type "${model_type}" — ignoring`);
  }

  // Deduplicate concurrent downloads for the same model type.
  if (inFlight.has(model_type)) {
    return inFlight.get(model_type)!;
  }

  const download = doDownload(model_type, version, cdn_path, checksum_sha256);
  inFlight.set(model_type, download);
  return download.finally(() => inFlight.delete(model_type));
}

async function doDownload(
  model_type: KnownModelType,
  version: string,
  cdn_path: string,
  checksum_sha256: string,
): Promise<void> {
  const url = `${CDN_BASE_URL}/${cdn_path}`;
  const tempPath = `${MODELS_DIR}${model_type}.onnx.tmp`;

  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });

  // Stream the model file to disk natively — no JS-heap buffering during download
  const { status } = await FileSystem.downloadAsync(url, tempPath);
  if (status !== 200) {
    await FileSystem.deleteAsync(tempPath, { idempotent: true });
    throw new Error(`[ML] ${model_type} download failed: HTTP ${status}`);
  }

  // Read back once to verify checksum; the buffer is discarded afterward.
  // setFromFile then commits the already-on-disk file via rename, so the model
  // bytes are never re-encoded to base64 or duplicated in the JS heap.
  const base64 = await FileSystem.readAsStringAsync(tempPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const buffer = Uint8Array.from(Buffer.from(base64, 'base64')).buffer;
  const actual = await sha256Hex(buffer);
  if (actual !== checksum_sha256) {
    await FileSystem.deleteAsync(tempPath, { idempotent: true });
    throw new Error(
      `[ML] ${model_type} checksum mismatch — expected ${checksum_sha256}, got ${actual}`,
    );
  }

  // Atomically rename the temp file into the store, then write the version.
  // The model bytes are in place before the version string is committed, so a
  // crash between the two leaves stale version metadata (safe: triggers a
  // re-download) rather than corrupt bytes.
  await modelStore.setFromFile(model_type, version, tempPath);

  // Hot-swap the ONNX session; load() will pick up the now-cached version.
  if (model_type === 'categorizer') {
    await categorizer.load(version);
  } else {
    await anomalyDetector.load(version);
  }
}

// Re-export types callers may need
export type { OnnxTensor };

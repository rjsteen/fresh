/**
 * expo-file-system implementation of the ModelStore interface.
 *
 * Each model type is persisted as two files under fresh_models/:
 *   {modelType}.onnx    — raw model bytes encoded as base64
 *   {modelType}.version — plain text version string
 */

import * as FileSystem from 'expo-file-system';
import type { ModelStore } from '@fresh/core/ml';

export interface ModelStoreWithFile extends ModelStore {
  /** Atomically commit a downloaded file into the store via rename, skipping the base64 round-trip. */
  setFromFile(modelType: string, version: string, filePath: string): Promise<void>;
}

export const MODELS_DIR = `${FileSystem.documentDirectory}fresh_models/`;

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64');
}

export class ExpoModelStore implements ModelStoreWithFile {
  async get(modelType: string): Promise<ArrayBuffer | null> {
    const path = `${MODELS_DIR}${modelType}.onnx`;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      const base64 = await FileSystem.readAsStringAsync(path, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return base64ToArrayBuffer(base64);
    } catch {
      return null;
    }
  }

  async set(modelType: string, version: string, data: ArrayBuffer): Promise<void> {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    // Write model bytes before version so a crash mid-write leaves the store
    // with stale version metadata rather than corrupt bytes.
    await FileSystem.writeAsStringAsync(
      `${MODELS_DIR}${modelType}.onnx`,
      arrayBufferToBase64(data),
      { encoding: FileSystem.EncodingType.Base64 },
    );
    await FileSystem.writeAsStringAsync(`${MODELS_DIR}${modelType}.version`, version);
  }

  /**
   * Commit a downloaded temp file into the store using a native rename (atomic
   * on the same filesystem), then write the version string. Avoids reading the
   * model file back into the JS heap, which is important for large ONNX weights.
   */
  async setFromFile(modelType: string, version: string, filePath: string): Promise<void> {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    // moveAsync is a rename syscall when src and dst are on the same volume —
    // the bytes land atomically before we commit the version string.
    await FileSystem.moveAsync({ from: filePath, to: `${MODELS_DIR}${modelType}.onnx` });
    await FileSystem.writeAsStringAsync(`${MODELS_DIR}${modelType}.version`, version);
  }

  async getVersion(modelType: string): Promise<string | null> {
    const path = `${MODELS_DIR}${modelType}.version`;
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      return FileSystem.readAsStringAsync(path);
    } catch {
      return null;
    }
  }

  async delete(modelType: string): Promise<void> {
    await FileSystem.deleteAsync(`${MODELS_DIR}${modelType}.onnx`, { idempotent: true });
    await FileSystem.deleteAsync(`${MODELS_DIR}${modelType}.version`, { idempotent: true });
  }
}

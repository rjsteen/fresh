/**
 * iCloud Drive CloudStorageAdapter stub.
 *
 * On iOS/macOS: uses NSUbiquitousKeyValueStore + NSFileManager ubiquity container.
 * Requires native module — not available on web or Android.
 *
 * React Native: expo-file-system provides iCloud backup automatically for files
 * in the Documents directory. For explicit iCloud Drive sync, a custom native
 * module or react-native-cloud-store is required.
 *
 * TODO: implement using react-native-cloud-store or a custom native module.
 * https://github.com/Kuatsu/react-native-cloud-store
 */

import type { CloudStorageAdapter, DbDelta } from '../adapter';

export class ICloudAdapter implements CloudStorageAdapter {
  async pullFile(): Promise<ArrayBuffer | null> {
    throw new Error('ICloudAdapter: not yet implemented');
  }

  async pushFile(_data: ArrayBuffer): Promise<void> {
    throw new Error('ICloudAdapter: not yet implemented');
  }

  async pullDeltas(_sinceCursor: string): Promise<DbDelta[]> {
    throw new Error('ICloudAdapter: not yet implemented');
  }

  async pushDeltas(_deltas: DbDelta[]): Promise<void> {
    throw new Error('ICloudAdapter: not yet implemented');
  }

  async getRemoteCursor(): Promise<string | null> {
    throw new Error('ICloudAdapter: not yet implemented');
  }
}

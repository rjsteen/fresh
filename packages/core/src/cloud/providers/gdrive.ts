/**
 * Google Drive CloudStorageAdapter stub.
 *
 * Auth flow: OAuth2 PKCE with drive.appdata scope (hidden app folder).
 * File: appDataFolder/fresh.db (encrypted blob)
 * Deltas: appDataFolder/deltas/<cursor>.json
 *
 * TODO: implement using the Google Drive REST API v3.
 * https://developers.google.com/drive/api/v3/appdata
 */

import type { CloudStorageAdapter, DbDelta } from '../adapter';

export class GDriveAdapter implements CloudStorageAdapter {
  constructor(private readonly accessToken: string) {}

  async pullFile(): Promise<ArrayBuffer | null> {
    throw new Error('GDriveAdapter: not yet implemented');
  }

  async pushFile(_data: ArrayBuffer): Promise<void> {
    throw new Error('GDriveAdapter: not yet implemented');
  }

  async pullDeltas(_sinceCursor: string): Promise<DbDelta[]> {
    throw new Error('GDriveAdapter: not yet implemented');
  }

  async pushDeltas(_deltas: DbDelta[]): Promise<void> {
    throw new Error('GDriveAdapter: not yet implemented');
  }

  async getRemoteCursor(): Promise<string | null> {
    throw new Error('GDriveAdapter: not yet implemented');
  }
}

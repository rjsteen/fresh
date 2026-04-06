/**
 * Dropbox CloudStorageAdapter stub.
 *
 * Auth flow: OAuth2 PKCE → access token stored in secure storage.
 * File path: /Apps/Fresh/fresh.db (encrypted blob)
 * Deltas path: /Apps/Fresh/deltas/<cursor>.json
 *
 * TODO: implement using the Dropbox JavaScript SDK.
 * https://github.com/dropbox/dropbox-sdk-js
 */

import type { CloudStorageAdapter, DbDelta } from '../adapter';

export class DropboxAdapter implements CloudStorageAdapter {
  constructor(private readonly accessToken: string) {}

  async pullFile(): Promise<ArrayBuffer | null> {
    throw new Error('DropboxAdapter: not yet implemented');
  }

  async pushFile(_data: ArrayBuffer): Promise<void> {
    throw new Error('DropboxAdapter: not yet implemented');
  }

  async pullDeltas(_sinceCursor: string): Promise<DbDelta[]> {
    throw new Error('DropboxAdapter: not yet implemented');
  }

  async pushDeltas(_deltas: DbDelta[]): Promise<void> {
    throw new Error('DropboxAdapter: not yet implemented');
  }

  async getRemoteCursor(): Promise<string | null> {
    throw new Error('DropboxAdapter: not yet implemented');
  }
}

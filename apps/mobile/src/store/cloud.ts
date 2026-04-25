import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { NoopCloudAdapter, ICloudAdapter, DropboxAdapter, GDriveAdapter } from '@fresh/core/cloud';
import type { CloudStorageAdapter } from '@fresh/core/cloud';

export type CloudProvider = 'icloud' | 'dropbox' | 'gdrive';

const CLOUD_CONFIG_KEY = 'fresh_cloud_config';

export interface CloudConfig {
  provider: CloudProvider;
  /** OAuth2 access token — required for Dropbox and GDrive, omitted for iCloud. */
  accessToken?: string;
}

interface CloudState {
  config: CloudConfig | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setProvider: (config: CloudConfig) => Promise<void>;
  clearProvider: () => Promise<void>;
  buildAdapter: () => CloudStorageAdapter;
}

export const useCloudStore = create<CloudState>((set, get) => ({
  config: null,
  hydrated: false,

  async hydrate() {
    const raw = await SecureStore.getItemAsync(CLOUD_CONFIG_KEY);
    if (raw) {
      try {
        set({ config: JSON.parse(raw) as CloudConfig, hydrated: true });
        return;
      } catch {
        console.warn('[CloudStore] failed to parse stored cloud config — clearing');
        await SecureStore.deleteItemAsync(CLOUD_CONFIG_KEY);
      }
    }
    set({ hydrated: true });
  },

  async setProvider(config: CloudConfig) {
    await SecureStore.setItemAsync(CLOUD_CONFIG_KEY, JSON.stringify(config));
    set({ config });
  },

  async clearProvider() {
    await SecureStore.deleteItemAsync(CLOUD_CONFIG_KEY);
    set({ config: null });
  },

  buildAdapter(): CloudStorageAdapter {
    const { config } = get();
    if (!config) return new NoopCloudAdapter();
    switch (config.provider) {
      case 'icloud':
        return new ICloudAdapter();
      case 'dropbox':
        if (!config.accessToken) throw new Error('Dropbox adapter requires an access token');
        return new DropboxAdapter(config.accessToken);
      case 'gdrive':
        if (!config.accessToken) throw new Error('GDrive adapter requires an access token');
        return new GDriveAdapter(config.accessToken);
    }
  },
}));

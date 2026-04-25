import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { Router } from 'expo-router';
import { useAuthStore } from '../store/auth';
import { DEVICE_ID_KEY } from '../constants';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Call once at app startup (module-level side effect) to configure how
 * notifications appear while the app is in the foreground.
 */
export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Hook: requests push-notification permission on first use and registers the
 * Expo push token with the backend for the current device.
 *
 * Must be called inside an authenticated route so `token` is available.
 * Safe to call on simulators — `getExpoPushTokenAsync` will throw and the
 * error is swallowed gracefully.
 */
export function useNotificationSetup() {
  const { token, isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || !token) return;

    let cancelled = false;

    (async () => {
      // Request permission (shows the system dialog on first call)
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted' || cancelled) return;

      // Android requires an explicit notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
        });
      }

      // getExpoPushTokenAsync throws on simulators — caught by outer try/catch
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);

      if (!deviceId || cancelled) return;

      await fetch(`${API}/api/v1/devices/${deviceId}/push-token`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ push_token: expoPushToken }),
      });
    })().catch(() => {
      // Permission denied, simulator, or network error — non-fatal
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, token]);
}

/**
 * Hook: listens for notification taps (background/quit state) and deep-links
 * to the relevant screen based on `data.event`.
 *
 * Pass the Expo Router `router` instance from the calling layout.
 */
export function useNotificationResponseListener(router: Router) {
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as Record<string, unknown>;
        const event = data?.event;

        if (event === 'sync:complete' || event === 'alert:triggered') {
          routerRef.current.push('/(app)/transactions');
        }
        // model:updated requires no navigation — device pulls weights on next open
      }
    );

    return () => subscription.remove();
  }, []);
}

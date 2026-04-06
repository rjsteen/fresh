import { Stack } from 'expo-router';
import { DbProvider } from '../../src/context/DbContext';

export default function AppLayout() {
  return (
    <DbProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0f172a' } }} />
    </DbProvider>
  );
}

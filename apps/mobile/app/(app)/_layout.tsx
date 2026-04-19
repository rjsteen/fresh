import { Text } from 'react-native';
import { Tabs } from 'expo-router';
import { DbProvider } from '../../src/context/DbContext';

function tabIcon(symbol: string) {
  return ({ color }: { color: string }) => (
    <Text style={{ fontSize: 20, color }}>{symbol}</Text>
  );
}

export default function AppLayout() {
  return (
    <DbProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#0f172a',
            borderTopColor: '#1e293b',
            borderTopWidth: 1,
          },
          tabBarActiveTintColor: '#6366f1',
          tabBarInactiveTintColor: '#64748b',
          tabBarLabelStyle: { fontSize: 11, marginBottom: 2 },
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{ title: 'Home', tabBarIcon: tabIcon('⌂') }}
        />
        <Tabs.Screen
          name="transactions"
          options={{ title: 'Transactions', tabBarIcon: tabIcon('≡') }}
        />
        <Tabs.Screen
          name="budget"
          options={{ title: 'Budget', tabBarIcon: tabIcon('▦') }}
        />
        <Tabs.Screen
          name="accounts"
          options={{ title: 'Accounts', tabBarIcon: tabIcon('◈') }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: 'Settings', tabBarIcon: tabIcon('⚙') }}
        />
        {/* OAuth callback — navigable but hidden from the tab bar */}
        <Tabs.Screen name="oauth/gocardless" options={{ href: null }} />
      </Tabs>
    </DbProvider>
  );
}

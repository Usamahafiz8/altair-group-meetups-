import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyView, LoadingView, colors, s } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { configProblem } from '../lib/config';

function RootStack() {
  const { session, ready } = useAuth();
  if (!ready) return <LoadingView label="Starting…" />;
  const signedIn = !!session;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      {/* Signed-out users can only reach sign-in; signed-in users never see it. */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" options={{ title: 'Meetups' }} />
        <Stack.Screen name="meetups/new" options={{ title: 'New meetup' }} />
        <Stack.Screen name="meetups/[id]/index" options={{ title: 'Meetup' }} />
        <Stack.Screen name="meetups/[id]/edit" options={{ title: 'Edit meetup' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  if (configProblem) {
    return (
      <SafeAreaView style={s.screen}>
        <EmptyView title="App not configured" body={configProblem} />
      </SafeAreaView>
    );
  }
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootStack />
    </AuthProvider>
  );
}

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { Button, Field, Notice, colors, s } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

const Credentials = z.object({
  email: z.email({ error: 'Enter a valid email address' }),
  password: z.string().min(1, { error: 'Enter your password' }),
});

// Seed accounts (synthetic test data from the challenge), for quick sign-in.
const SEED = ['avery', 'jordan', 'sam', 'riley', 'morgan', 'casey', 'quinn', 'taylor'];

function authMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect.';
  if (/network|fetch/i.test(message)) return "Can't reach the sign-in service. Check your connection.";
  return message;
}

export default function SignIn() {
  const { notice, clearNotice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Credentials.safeParse({ email: email.trim(), password });
  const fieldError = (key: 'email' | 'password') =>
    submitted && !parsed.success ? parsed.error.issues.find((i) => i.path[0] === key)?.message : undefined;

  const submit = async () => {
    setSubmitted(true);
    if (!parsed.success || pending) return;
    setPending(true);
    setError(null);
    clearNotice();
    try {
      const { error: authError } = await supabase.auth.signInWithPassword(parsed.data);
      // On success the auth listener switches to the signed-in screens.
      if (authError) setError(authMessage(authError.message));
    } catch {
      setError("Can't reach the sign-in service. Check your connection.");
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[s.content, { paddingTop: 48 }]} keyboardShouldPersistTaps="handled">
          <Text style={s.h1}>Altair meetups</Text>
          <Text style={s.muted}>Sign in to see your walking groups’ meetups.</Text>
          {notice ? <Notice text={notice} tone="info" /> : null}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
            placeholder="you@example.test"
            error={fieldError('email')}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            onSubmitEditing={submit}
            returnKeyType="go"
            error={fieldError('password')}
          />
          {error ? <Notice text={error} /> : null}
          <Button title="Sign in" onPress={submit} loading={pending} />

          <View style={{ gap: 6, marginTop: 16 }}>
            <Text style={s.hint}>Test accounts (password altair-fixture-pass):</Text>
            <View style={[s.row, { flexWrap: 'wrap' }]}>
              {SEED.map((name) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  onPress={() => setEmail(`${name}@example.test`)}
                  style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
                >
                  <Text style={s.muted}>{name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

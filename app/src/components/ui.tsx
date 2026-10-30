import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import type { ClientError } from '../lib/api';

export const colors = {
  bg: '#f6f7f9',
  card: '#ffffff',
  text: '#1d232b',
  muted: '#5b6673',
  line: '#d9dee4',
  primary: '#2f5d8a',
  danger: '#b3261e',
  success: '#1e7a46',
  warning: '#8a5a00',
  errorBg: '#fdecea',
  infoBg: '#e8f0f8',
};

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled }: ButtonProps) {
  const inactive = disabled || loading;
  const filled = variant !== 'secondary';
  const tint = variant === 'danger' ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        filled ? { backgroundColor: tint } : { borderColor: tint, borderWidth: 1, backgroundColor: colors.card },
        (pressed || inactive) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={filled ? '#fff' : tint} />
      ) : (
        <Text style={[s.buttonText, { color: filled ? '#fff' : tint }]}>{title}</Text>
      )}
    </Pressable>
  );
}

type FieldProps = TextInputProps & { label: string; error?: string; hint?: string };

export function Field({ label, error, hint, style, ...input }: FieldProps) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        style={[s.input, error ? { borderColor: colors.danger } : null, style]}
        {...input}
      />
      {error ? <Text style={s.fieldError}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ text, tone = 'error' }: { text: string; tone?: 'error' | 'info' }) {
  return (
    <View accessibilityRole="alert" style={[s.notice, { backgroundColor: tone === 'error' ? colors.errorBg : colors.infoBg }]}>
      <Text style={{ color: tone === 'error' ? colors.danger : colors.primary }}>{text}</Text>
    </View>
  );
}

export function Badge({ text, tone }: { text: string; tone: 'danger' | 'success' | 'muted' | 'warning' }) {
  const color = { danger: colors.danger, success: colors.success, muted: colors.muted, warning: colors.warning }[tone];
  return (
    <View style={[s.badge, { borderColor: color }]}>
      <Text style={[s.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

// Full-area states, used by every screen for loading / error / empty.
export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: ClientError; onRetry?: () => void }) {
  return (
    <View style={s.center}>
      <Text style={s.title}>Couldn’t load this</Text>
      <Text style={[s.muted, s.centerText]}>{error.message}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyView({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={s.center}>
      <Text style={s.title}>{title}</Text>
      {body ? <Text style={[s.muted, s.centerText]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 6 },
  title: { fontSize: 18, fontWeight: '600', color: colors.text },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text },
  text: { fontSize: 15, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centerText: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: { minHeight: 46, borderRadius: 8, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  field: { gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.card,
  },
  fieldError: { fontSize: 13, color: colors.danger },
  hint: { fontSize: 13, color: colors.muted },
  notice: { borderRadius: 8, padding: 12 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
});

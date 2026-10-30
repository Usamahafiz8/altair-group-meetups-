import { CreateMeetupRequest, type ErrorIssue, type MeetingPointInput } from '@altair/contract';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import type { LatLng } from 'react-native-maps';
import type { ClientError } from '../lib/api';
import { formatDate, formatTime } from '../lib/format';
import { MeetupMap } from './MeetupMap';
import { Button, Card, Field, Notice, colors, s } from './ui';

export type MeetupFormValues = {
  title: string;
  startsAt: string;
  meetingPoint: MeetingPointInput;
};

// Same rules as the server: the contract's create schema minus the group.
const FormSchema = CreateMeetupRequest.omit({ groupId: true });

// The point is chosen on the map only; coordinates are never typed or shown.
type FieldKey = 'title' | 'startsAt' | 'place' | 'point' | 'form';
const FIELD_BY_PATH: Record<string, FieldKey> = {
  title: 'title',
  startsAt: 'startsAt',
  'meetingPoint.name': 'place',
  'meetingPoint.lat': 'point',
  'meetingPoint.lng': 'point',
  meetingPoint: 'place',
};
type Errors = Partial<Record<FieldKey, string>>;

const NO_PIN = 'Drop a pin on the map to set the meeting point.';
const sentence = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);

function errorsFrom(issues: ErrorIssue[], hasPin: boolean): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = FIELD_BY_PATH[i.path] ?? 'form';
    // A coordinate error with no pin just means "pick a spot", in user terms.
    out[key] ??= key === 'point' && !hasPin ? NO_PIN : sentence(i.message);
  }
  return out;
}

// 6 decimals ≈ 0.1 m: plenty for a meeting point, and stable for edit diffs.
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

type Props = {
  initial: { title: string; startsAt: Date; meetingPoint: MeetingPointInput | null };
  submitLabel: string;
  // Resolves to a ClientError to display, or undefined on success.
  onSubmit: (values: MeetupFormValues) => Promise<ClientError | undefined>;
  pending: boolean;
};

export function MeetupForm({ initial, submitLabel, onSubmit, pending }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [place, setPlace] = useState(initial.meetingPoint?.name ?? '');
  const [pin, setPin] = useState<LatLng | null>(
    initial.meetingPoint ? { latitude: initial.meetingPoint.lat, longitude: initial.meetingPoint.lng } : null,
  );
  const [mapTouched, setMapTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [iosPicker, setIosPicker] = useState<'date' | 'time' | null>(null);

  const values = {
    title,
    startsAt: startsAt.toISOString(),
    // No pin yet: NaN fails the schema, which the form reports as "drop a pin".
    meetingPoint: { name: place, lat: pin?.latitude ?? Number.NaN, lng: pin?.longitude ?? Number.NaN },
  };
  const result = FormSchema.safeParse(values);
  // Show client errors once the user has tried to submit; server errors until edited.
  const clientErrors =
    submitted && !result.success
      ? errorsFrom(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })), !!pin)
      : {};
  const errors: Errors = { ...serverErrors, ...clientErrors };

  const edit = <T,>(setter: (v: T) => void, ...keys: FieldKey[]) => (v: T) => {
    setter(v);
    setServerErrors((e) => {
      const next = { ...e };
      for (const k of [...keys, 'form' as const]) delete next[k];
      return next;
    });
  };

  const setPinFrom = edit(setPin, 'point');
  const onMapPick = (p: LatLng) => setPinFrom({ latitude: round6(p.latitude), longitude: round6(p.longitude) });

  // Changing the date keeps the chosen time of day, and vice versa.
  const applyPicked = (mode: 'date' | 'time', d: Date) => {
    const next = new Date(startsAt);
    if (mode === 'date') next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    edit(setStartsAt, 'startsAt')(next);
  };
  const openPicker = (mode: 'date' | 'time') => {
    if (Platform.OS !== 'android') return setIosPicker(mode);
    DateTimePickerAndroid.open({
      value: startsAt,
      mode,
      is24Hour: true,
      minimumDate: mode === 'date' ? new Date() : undefined,
      onChange: (e: DateTimePickerEvent, d?: Date) => {
        if (e.type === 'set' && d) applyPicked(mode, d);
      },
    });
  };

  const submit = async () => {
    setSubmitted(true);
    if (!result.success || pending) return;
    const err = await onSubmit(result.data);
    if (!err) return;
    setServerErrors(err.code === 'validation_error' && err.issues.length ? errorsFrom(err.issues, !!pin) : { form: err.message });
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" scrollEnabled={!mapTouched}>
        <Field
          label="Title"
          value={title}
          onChangeText={edit(setTitle, 'title')}
          placeholder="e.g. Saturday morning loop"
          maxLength={100}
          error={errors.title}
          hint={`${title.trim().length}/80`}
          returnKeyType="next"
        />

        <View style={s.field}>
          <Text style={s.label}>Start</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" title={formatDate(startsAt)} onPress={() => openPicker('date')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" title={formatTime(startsAt)} onPress={() => openPicker('time')} />
            </View>
          </View>
          {errors.startsAt ? <Text style={s.fieldError}>{errors.startsAt}</Text> : null}
          {iosPicker ? (
            <DateTimePicker
              value={startsAt}
              mode={iosPicker}
              minimumDate={iosPicker === 'date' ? new Date() : undefined}
              onChange={(_e, d) => {
                setIosPicker(null);
                if (d) applyPicked(iosPicker, d);
              }}
            />
          ) : null}
        </View>

        <Card>
          <Field
            label="Meeting point"
            value={place}
            onChangeText={edit(setPlace, 'place')}
            placeholder="e.g. North gate, Linden Park"
            maxLength={140}
            error={errors.place}
            hint="A public place everyone can find."
          />
          <MeetupMap pick={{ value: pin, onChange: onMapPick }} height={300} onTouchActive={setMapTouched} />
          {errors.point ? (
            <Text style={s.fieldError}>{errors.point}</Text>
          ) : pin ? (
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={[s.hint, { color: colors.success, fontWeight: '600' }]}>✓ Pin placed. Tap elsewhere or drag it to move.</Text>
              <Pressable accessibilityRole="button" onPress={() => setPinFrom(null)} hitSlop={10}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Clear</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.hint}>Tap the map where everyone should meet. Pinch or use + / − to zoom.</Text>
          )}
        </Card>

        {errors.form ? <Notice text={errors.form} /> : null}
        {submitted && !result.success && !errors.form ? <Notice text="Please fix the highlighted fields." /> : null}
        <Button title={submitLabel} onPress={submit} loading={pending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

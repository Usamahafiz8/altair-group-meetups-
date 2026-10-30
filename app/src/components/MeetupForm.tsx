import { CreateMeetupRequest, type ErrorIssue, type MeetingPointInput } from '@altair/contract';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import type { LatLng } from 'react-native-maps';
import type { ClientError } from '../lib/api';
import { formatDate, formatTime } from '../lib/format';
import { MeetupMap } from './MeetupMap';
import { Button, Card, Field, Notice, s } from './ui';

export type MeetupFormValues = {
  title: string;
  startsAt: string;
  meetingPoint: MeetingPointInput;
};

// Same rules as the server: the contract's create schema minus the group.
const FormSchema = CreateMeetupRequest.omit({ groupId: true });

type FieldKey = 'title' | 'startsAt' | 'place' | 'lat' | 'lng' | 'form';
const FIELD_BY_PATH: Record<string, FieldKey> = {
  title: 'title',
  startsAt: 'startsAt',
  'meetingPoint.name': 'place',
  'meetingPoint.lat': 'lat',
  'meetingPoint.lng': 'lng',
  meetingPoint: 'place',
};
type Errors = Partial<Record<FieldKey, string>>;

const sentence = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);

function errorsFrom(issues: ErrorIssue[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = FIELD_BY_PATH[i.path] ?? 'form';
    out[key] ??= sentence(i.message);
  }
  return out;
}

const fmtCoord = (n: number) => n.toFixed(6);
// "" stays NaN so the schema reports "must be a number" instead of using 0.
const toNumber = (v: string) => (v.trim() === '' ? Number.NaN : Number(v.trim().replace(',', '.')));

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
  const [lat, setLat] = useState(initial.meetingPoint ? fmtCoord(initial.meetingPoint.lat) : '');
  const [lng, setLng] = useState(initial.meetingPoint ? fmtCoord(initial.meetingPoint.lng) : '');
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [iosPicker, setIosPicker] = useState<'date' | 'time' | null>(null);

  const values = {
    title,
    startsAt: startsAt.toISOString(),
    meetingPoint: { name: place, lat: toNumber(lat), lng: toNumber(lng) },
  };
  const result = FormSchema.safeParse(values);
  // Show client errors once the user has tried to submit; server errors until edited.
  const clientErrors =
    submitted && !result.success
      ? errorsFrom(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
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

  const picked: LatLng | null =
    Number.isFinite(toNumber(lat)) && Number.isFinite(toNumber(lng)) ? { latitude: toNumber(lat), longitude: toNumber(lng) } : null;
  const onMapPick = (p: LatLng) => {
    edit(setLat, 'lat')(fmtCoord(p.latitude));
    edit(setLng, 'lng')(fmtCoord(p.longitude));
  };

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
    setServerErrors(err.code === 'validation_error' && err.issues.length ? errorsFrom(err.issues) : { form: err.message });
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
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
          <Text style={s.hint}>Tap the map or drag the pin, or type coordinates.</Text>
          <MeetupMap pick={{ value: picked, onChange: onMapPick }} height={200} />
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Field label="Latitude" value={lat} onChangeText={edit(setLat, 'lat')} keyboardType="numbers-and-punctuation" placeholder="e.g. 40.0123" error={errors.lat} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Longitude" value={lng} onChangeText={edit(setLng, 'lng')} keyboardType="numbers-and-punctuation" placeholder="e.g. -99.9845" error={errors.lng} />
            </View>
          </View>
        </Card>

        {errors.form ? <Notice text={errors.form} /> : null}
        {submitted && !result.success && !errors.form ? <Notice text="Please fix the highlighted fields." /> : null}
        <Button title={submitLabel} onPress={submit} loading={pending} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

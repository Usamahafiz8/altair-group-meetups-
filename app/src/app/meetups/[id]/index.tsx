import { Uuid, type MeetupDetail } from '@altair/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { MeetupMap } from '../../../components/MeetupMap';
import { MeetupStatusBadge } from '../../../components/MeetupStatusBadge';
import { Button, Card, EmptyView, ErrorView, LoadingView, Notice, s } from '../../../components/ui';
import { api, type ClientError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { formatDateTime, hasStarted, plural } from '../../../lib/format';
import { useAction, useResource, type ActionResult } from '../../../lib/hooks';

// Why the RSVP button is not offered, when it is not.
function rsvpBlockedReason(m: MeetupDetail): string | null {
  if (m.status === 'cancelled') return 'This meetup was cancelled. It no longer takes RSVPs.';
  if (hasStarted(m.startsAt)) return 'This meetup has already started.';
  return null;
}

export default function MeetupDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Uuid.safeParse(params.id).data ?? null;
  const { session } = useAuth();
  const me = session?.user.id;

  const detail = useResource(id && `meetup:${id}`, () => api.meetup(id!));
  const action = useAction(async (kind: 'rsvp' | 'withdraw' | 'cancel') => {
    if (kind === 'cancel') return (await api.cancelMeetup(id!)).meetup;
    await (kind === 'rsvp' ? api.rsvp(id!) : api.withdraw(id!));
    return (await api.meetup(id!)).meetup; // fresh viewer flags + attendee list
  });

  // After any action, show the server's view. If it failed because the
  // meetup changed meanwhile (cancelled, started, gone), reload it too.
  const settle = (res: ActionResult<MeetupDetail>) => {
    if (res.ok) detail.setData({ meetup: res.data });
    else if (res.error && isStale(res.error)) detail.reload();
  };
  const perform = async (kind: 'rsvp' | 'withdraw' | 'cancel') => settle(await action.run(kind));

  const confirmCancel = () =>
    Alert.alert(
      'Cancel this meetup?',
      'Members will see it as cancelled and no one can RSVP. This can’t be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel meetup', style: 'destructive', onPress: () => void perform('cancel') },
      ],
    );

  if (!id) return <EmptyView title="Meetup not found" action={<Button title="Back to meetups" variant="secondary" onPress={() => router.back()} />} />;
  if (detail.loading) return <LoadingView label="Loading meetup…" />;
  if (detail.error && !detail.data) {
    return detail.error.code === 'not_found' ? (
      <EmptyView
        title="This meetup isn’t available"
        body="It may not exist, or it belongs to a group you’re not in."
        action={<Button title="Back to meetups" variant="secondary" onPress={() => router.back()} />}
      />
    ) : (
      <ErrorView error={detail.error} onRetry={detail.reload} />
    );
  }
  const m = detail.data!.meetup;
  const blocked = rsvpBlockedReason(m);

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={detail.refreshing} onRefresh={detail.refresh} />}
    >
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
        <Text style={[s.h1, { flex: 1 }]}>{m.title}</Text>
        <MeetupStatusBadge meetup={m} />
      </View>
      <Text style={s.text}>{formatDateTime(m.startsAt)}</Text>
      <Text style={s.muted}>
        Organised by {m.createdBy.displayName}
        {m.viewer.isCreator ? ' (you)' : ''}
      </Text>
      {m.status === 'cancelled' ? (
        <Notice text={`Cancelled${m.cancelledAt ? ` on ${formatDateTime(m.cancelledAt)}` : ''}.`} />
      ) : null}

      <Card>
        <Text style={s.label}>Meeting point</Text>
        <Text style={s.text}>{m.meetingPoint.name}</Text>
        <MeetupMap point={m.meetingPoint} />
      </Card>

      {detail.error ? <Notice text={detail.error.message} /> : null}
      {action.error ? <Notice text={action.error.message} /> : null}

      <View style={{ gap: 8 }}>
        {m.viewer.canRsvp ? <Button title="RSVP — I’m going" onPress={() => void perform('rsvp')} loading={action.pending} /> : null}
        {m.viewer.hasRsvp ? (
          <>
            <Notice text="You’re going." tone="info" />
            <Button title="Withdraw my RSVP" variant="secondary" onPress={() => void perform('withdraw')} loading={action.pending} />
          </>
        ) : blocked ? (
          <Text style={s.muted}>{blocked}</Text>
        ) : null}
        {m.viewer.canEdit ? (
          <Button title="Edit meetup" variant="secondary" onPress={() => router.push(`/meetups/${m.id}/edit`)} disabled={action.pending} />
        ) : null}
        {m.viewer.canCancel ? <Button title="Cancel meetup" variant="danger" onPress={confirmCancel} loading={action.pending} /> : null}
      </View>

      <Card>
        <Text style={s.label}>Attendees · {plural(m.attendees.length, 'person', 'people')}</Text>
        {m.attendees.length === 0 ? (
          <Text style={s.muted}>No one has RSVP’d yet.</Text>
        ) : (
          m.attendees.map((a) => (
            <Text key={a.id} style={s.text}>
              {a.displayName}
              {a.id === me ? ' (you)' : ''}
            </Text>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const isStale = (e: ClientError) => ['meetup_cancelled', 'meetup_started', 'not_found', 'forbidden'].includes(e.code);

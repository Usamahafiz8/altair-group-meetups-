import { Uuid, type EditMeetupRequest, type MeetupDetail } from '@altair/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { MeetupForm, type MeetupFormValues } from '../../../components/MeetupForm';
import { Button, EmptyView, ErrorView, LoadingView } from '../../../components/ui';
import { api, ClientError } from '../../../lib/api';
import { useAction, useResource } from '../../../lib/hooks';

// Only send what changed: an untouched start time is not re-validated, and
// an empty edit is caught here instead of by the server.
function changes(m: MeetupDetail, v: MeetupFormValues): EditMeetupRequest | null {
  const out: EditMeetupRequest = {};
  if (v.title !== m.title) out.title = v.title;
  if (Date.parse(v.startsAt) !== Date.parse(m.startsAt)) out.startsAt = v.startsAt;
  const p = m.meetingPoint;
  if (v.meetingPoint.name !== p.name || v.meetingPoint.lat !== p.lat || v.meetingPoint.lng !== p.lng) {
    out.meetingPoint = v.meetingPoint;
  }
  return Object.keys(out).length ? out : null;
}

export default function EditMeetup() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Uuid.safeParse(params.id).data ?? null;
  const detail = useResource(id && `meetup:${id}`, () => api.meetup(id!));
  const save = useAction((body: EditMeetupRequest) => api.editMeetup(id!, body));

  const back = <Button title="Back" variant="secondary" onPress={() => router.back()} />;
  if (!id) return <EmptyView title="Meetup not found" action={back} />;
  if (detail.loading) return <LoadingView label="Loading meetup…" />;
  if (detail.error && !detail.data) {
    return detail.error.code === 'not_found' ? <EmptyView title="This meetup isn’t available" action={back} /> : <ErrorView error={detail.error} onRetry={detail.reload} />;
  }
  const m = detail.data!.meetup;
  if (!m.viewer.canEdit) {
    return (
      <EmptyView
        title="This meetup can’t be edited"
        body={m.viewer.isCreator ? 'It has been cancelled or has already started.' : 'Only the person who created it can edit it.'}
        action={back}
      />
    );
  }

  const onSubmit = async (values: MeetupFormValues) => {
    // Coordinates round-trip through the form at 6 decimals (~0.1 m); stored
    // points have at most that precision, so an untouched point compares equal.
    const body = changes(m, values);
    if (!body) return new ClientError('validation_error', 'Nothing has changed.');
    const res = await save.run(body);
    if (!res.ok) return res.error ?? undefined;
    router.back();
    return undefined;
  };

  return (
    <MeetupForm
      initial={{ title: m.title, startsAt: new Date(m.startsAt), meetingPoint: { name: m.meetingPoint.name, lat: m.meetingPoint.lat, lng: m.meetingPoint.lng } }}
      submitLabel="Save changes"
      onSubmit={onSubmit}
      pending={save.pending}
    />
  );
}

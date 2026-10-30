import { Uuid } from '@altair/contract';
import { router, useLocalSearchParams } from 'expo-router';
import { MeetupForm, type MeetupFormValues } from '../../components/MeetupForm';
import { EmptyView } from '../../components/ui';
import { api } from '../../lib/api';
import { defaultStart } from '../../lib/format';
import { useAction } from '../../lib/hooks';

export default function NewMeetup() {
  const params = useLocalSearchParams<{ groupId?: string }>();
  const groupId = Uuid.safeParse(params.groupId);
  const create = useAction((values: MeetupFormValues) => api.createMeetup({ groupId: groupId.data!, ...values }));

  if (!groupId.success) return <EmptyView title="Choose a group first" body="Open a group’s meetup list and tap New meetup." />;

  const onSubmit = async (values: MeetupFormValues) => {
    const res = await create.run(values);
    if (!res.ok) return res.error ?? undefined;
    // Replace the form so Back goes to the list, not to a stale form.
    router.replace(`/meetups/${res.data.meetup.id}`);
    return undefined;
  };

  return (
    <MeetupForm
      initial={{ title: '', startsAt: defaultStart(), meetingPoint: null }}
      submitLabel="Create meetup"
      onSubmit={onSubmit}
      pending={create.pending}
    />
  );
}

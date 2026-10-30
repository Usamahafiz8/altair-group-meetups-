import type { MeetupSummary } from '@altair/contract';
import { hasStarted } from '../lib/format';
import { Badge } from './ui';

export function MeetupStatusBadge({ meetup }: { meetup: MeetupSummary }) {
  if (meetup.status === 'cancelled') return <Badge text="Cancelled" tone="danger" />;
  if (hasStarted(meetup.startsAt)) return <Badge text="Started" tone="warning" />;
  if (meetup.viewer.hasRsvp) return <Badge text="You’re going" tone="success" />;
  return null;
}

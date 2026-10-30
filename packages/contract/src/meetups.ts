import { z } from 'zod';
import {
  futureDateTime,
  IsoDateTime,
  Latitude,
  Longitude,
  MeetingPointInput,
  PlaceName,
  StartsAt,
  Title,
  Uuid,
} from './primitives';

// ---------------------------------------------------------------------------
// Requests. strictObject: unknown keys are an error, so a client cannot slip
// in createdBy / userId / status. The creator always comes from the session.
// ---------------------------------------------------------------------------

export const MeetupIdParams = z.strictObject({ meetupId: Uuid });
export type MeetupIdParams = z.infer<typeof MeetupIdParams>;

export const GroupIdParams = z.strictObject({ groupId: Uuid });
export type GroupIdParams = z.infer<typeof GroupIdParams>;

export const CreateMeetupRequest = z.strictObject({
  groupId: Uuid,
  title: Title,
  startsAt: StartsAt,
  meetingPoint: MeetingPointInput,
});
export type CreateMeetupRequest = z.infer<typeof CreateMeetupRequest>;

// Cancel, RSVP and withdraw carry no body: the meetup id is in the path and
// the member is the session. An empty strict object rejects anything else.
export const EmptyBody = z.strictObject({});

// Bonus (a): creator-only edit. At least one field; a changed start time must
// still be in the future. Group and creator can never change.
export const editMeetupRequest = (now?: () => number) =>
  z
    .strictObject({
      title: Title.optional(),
      startsAt: futureDateTime(now).optional(),
      meetingPoint: MeetingPointInput.optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
      error: 'nothing to update',
    });
export const EditMeetupRequest = editMeetupRequest();
export type EditMeetupRequest = z.infer<typeof EditMeetupRequest>;

// ---------------------------------------------------------------------------
// Responses. Parsed with z.object (strip), so the server's outbound parse
// drops any field not named here: a stray column such as a home location
// cannot reach the client even if a query selected it by mistake.
// ---------------------------------------------------------------------------

export const MeetupStatus = z.enum(['scheduled', 'cancelled']);
export type MeetupStatus = z.infer<typeof MeetupStatus>;

// Product decision (spec section 7): every group member sees the exact
// meeting point. `kind` gives the app a stable discriminator to render.
export const MeetingPoint = z.object({
  kind: z.literal('exact'),
  name: PlaceName,
  lat: Latitude,
  lng: Longitude,
});
export type MeetingPoint = z.infer<typeof MeetingPoint>;

export const Person = z.object({
  id: Uuid,
  displayName: z.string(),
});
export type Person = z.infer<typeof Person>;

export const MeetupSummary = z.object({
  id: Uuid,
  groupId: Uuid,
  title: z.string(),
  startsAt: IsoDateTime,
  status: MeetupStatus,
  cancelledAt: IsoDateTime.nullable(),
  meetingPoint: MeetingPoint,
  createdBy: Person,
  attendeeCount: z.number().int().nonnegative(),
  // Facts about the caller, computed on the server.
  viewer: z.object({
    isCreator: z.boolean(),
    hasRsvp: z.boolean(),
    canRsvp: z.boolean(), // scheduled, not started, not already attending
    canCancel: z.boolean(), // creator and still scheduled
    canEdit: z.boolean(), // creator, scheduled, not started (bonus edit)
  }),
});
export type MeetupSummary = z.infer<typeof MeetupSummary>;

export const MeetupDetail = MeetupSummary.extend({
  attendees: z.array(Person),
});
export type MeetupDetail = z.infer<typeof MeetupDetail>;

export const ListMeetupsResponse = z.object({ meetups: z.array(MeetupSummary) });
export type ListMeetupsResponse = z.infer<typeof ListMeetupsResponse>;

export const MeetupResponse = z.object({ meetup: MeetupDetail });
export type MeetupResponse = z.infer<typeof MeetupResponse>;

export const RsvpResponse = z.object({
  meetupId: Uuid,
  attending: z.boolean(),
});
export type RsvpResponse = z.infer<typeof RsvpResponse>;

import { z } from 'zod';

// Field rules from the spec (section 4). The database enforces the same rules
// (CHECK constraints + triggers); these give the caller a clear error first.

export const Uuid = z.uuid({ error: 'must be a valid id' });

export const Title = z
  .string({ error: 'title is required' })
  .trim()
  .min(1, { error: 'title must not be empty' })
  .max(80, { error: 'title must be at most 80 characters' });

export const PlaceName = z
  .string({ error: 'place name is required' })
  .trim()
  .min(1, { error: 'place name must not be empty' })
  .max(120, { error: 'place name must be at most 120 characters' });

export const Latitude = z
  .number({ error: 'latitude must be a number' })
  .min(-90, { error: 'latitude must be between -90 and 90' })
  .max(90, { error: 'latitude must be between -90 and 90' });

export const Longitude = z
  .number({ error: 'longitude must be a number' })
  .min(-180, { error: 'longitude must be between -180 and 180' })
  .max(180, { error: 'longitude must be between -180 and 180' });

// ISO 8601 with an explicit offset, e.g. 2026-11-07T08:00:00Z or ...+02:00.
// A naive local time is rejected: the server cannot know the caller's zone.
export const IsoDateTime = z.iso.datetime({
  offset: true,
  error: 'must be an ISO 8601 date-time with a time zone (e.g. 2026-11-07T08:00:00Z)',
});

// Strictly after "now" (a start equal to now is rejected, as the spec says).
// `now` is injectable for tests; on the server it is the server clock, which
// is the authority. The database trigger re-checks against its own now().
export const futureDateTime = (now: () => number = Date.now) =>
  IsoDateTime.refine((v) => Date.parse(v) > now(), { error: 'start time must be in the future' });

export const StartsAt = futureDateTime();

export const MeetingPointInput = z.strictObject({
  name: PlaceName,
  lat: Latitude,
  lng: Longitude,
});
export type MeetingPointInput = z.infer<typeof MeetingPointInput>;

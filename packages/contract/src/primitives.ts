import { z } from 'zod';

// Field rules from the spec (section 4). The database enforces the same rules
// (CHECK constraints + triggers); these give the caller a clear error first.

export const Uuid = z.uuid({ error: 'must be a valid id' });

// Single-line display text: no control characters (NUL cannot be stored in a
// Postgres text column and would otherwise surface as a 500) and no unpaired
// UTF-16 surrogates (malformed Unicode, stored as U+FFFD otherwise).
export function isCleanText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
    if (c >= 0xdc00 && c <= 0xdfff) return false; // low surrogate without a high one
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++; // skip the valid pair
    }
  }
  return true;
}

export const Title = z
  .string({ error: 'title is required' })
  .trim()
  .min(1, { error: 'title must not be empty' })
  .max(80, { error: 'title must be at most 80 characters' })
  .refine(isCleanText, { error: 'title contains characters that are not allowed' });

export const PlaceName = z
  .string({ error: 'place name is required' })
  .trim()
  .min(1, { error: 'place name must not be empty' })
  .max(120, { error: 'place name must be at most 120 characters' })
  .refine(isCleanText, { error: 'place name contains characters that are not allowed' });

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

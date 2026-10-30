import { z } from 'zod';

// One error envelope for every endpoint.
//
// `not_found` deliberately covers both "does not exist" and "exists but you
// cannot see it" (outsiders), so an error never confirms to an outsider that
// a meetup exists (spec section 6). `forbidden` is only ever returned to a
// group member, who can already see the meetup and its creator.
export const ErrorCode = z.enum([
  'validation_error', // 400: request failed the shared schema
  'unauthorized', // 401: missing / invalid / expired session
  'forbidden', // 403: a member who is not the creator tries to cancel / edit
  'not_found', // 404: no such meetup or group, or not visible to the caller
  'meetup_cancelled', // 409: RSVP to a cancelled meetup; edit/cancel of a cancelled one
  'meetup_started', // 409: RSVP to a meetup that has already started
  'internal', // 500
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorIssue = z.object({
  path: z.string(), // dotted path, e.g. "meetingPoint.lat"; "" for the whole body
  message: z.string(),
});
export type ErrorIssue = z.infer<typeof ErrorIssue>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    issues: z.array(ErrorIssue).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const HTTP_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  meetup_cancelled: 409,
  meetup_started: 409,
  internal: 500,
};

// Flatten Zod issues into the envelope's issue list (shared so the app can
// show the same messages for client-side pre-validation).
export function toIssues(error: z.ZodError): ErrorIssue[] {
  return error.issues.map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
}

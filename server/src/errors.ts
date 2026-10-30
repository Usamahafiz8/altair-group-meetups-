import type { ErrorCode, ErrorIssue } from '@altair/contract';

// A failure the client is allowed to see: code + safe message (+ issues).
export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: ErrorIssue[],
  ) {
    super(message);
  }
}

type PgError = { code?: string; message?: string };
const isPgError = (e: unknown): e is PgError =>
  typeof e === 'object' && e !== null && 'code' in e && typeof (e as PgError).code === 'string';

// Translate a database refusal into the contract's error. The database is the
// final authority (triggers + RLS); this only picks the response. Anything
// unrecognised is rethrown and becomes a generic 500.
export function fromDatabase(e: unknown): ApiFailure {
  if (!isPgError(e)) throw e;
  const msg = e.message ?? '';

  // RLS WITH CHECK failure (insert into a group / meetup you cannot see) and
  // the triggers' membership checks all read as "not found" to the caller.
  if (e.code === '42501' && msg.includes('row-level security')) {
    return new ApiFailure('not_found', 'Not found');
  }
  if (msg.includes('meetup not found')) return new ApiFailure('not_found', 'Meetup not found');
  if (msg.includes('creator must be a member')) return new ApiFailure('not_found', 'Group not found');
  if (msg.includes('meetup is cancelled')) {
    return new ApiFailure('meetup_cancelled', 'This meetup has been cancelled');
  }
  if (msg.includes('already started')) {
    return new ApiFailure('meetup_started', 'This meetup has already started');
  }
  if (msg.includes('starts_at must be in the future')) {
    return new ApiFailure('validation_error', 'Invalid request', [
      { path: 'startsAt', message: 'start time must be in the future' },
    ]);
  }
  // Remaining CHECK / NOT NULL violations and text Postgres cannot store
  // (22021 invalid byte sequence, 22P05 untranslatable character): the schema
  // should have caught them; never let them become a 500.
  if (['23514', '23502', '22021', '22P05'].includes(e.code!)) {
    return new ApiFailure('validation_error', 'Invalid request');
  }
  throw e;
}

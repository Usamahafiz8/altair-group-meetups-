import {
  ApiError,
  ListMeetupsResponse,
  MeetupResponse,
  MyGroupsResponse,
  RsvpResponse,
  routes,
  type CreateMeetupRequest,
  type EditMeetupRequest,
  type ErrorCode,
  type ErrorIssue,
} from '@altair/contract';
import type { z } from 'zod';
import { expireSession } from './auth';
import { config } from './config';
import { supabase } from './supabase';

const TIMEOUT_MS = 15_000;

// Every failure the UI can see, server-side or not, has this one shape.
export type ClientErrorCode = ErrorCode | 'network' | 'timeout' | 'bad_response';

export class ClientError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly issues: ErrorIssue[] = [],
  ) {
    super(message);
  }
}

export function toClientError(e: unknown): ClientError {
  return e instanceof ClientError ? e : new ClientError('internal', 'Something went wrong. Please try again.');
}

const LOCAL_MESSAGES: Partial<Record<ClientErrorCode, string>> = {
  network: "Can't reach the meetups server. Check your connection and that the API is running.",
  timeout: 'The server took too long to respond. Please try again.',
  bad_response: 'The server sent an unexpected response.',
};

async function request<S extends z.ZodType>(
  schema: S,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<z.infer<S>> {
  if (!config) throw new ClientError('internal', 'The app is not configured.');
  const { data } = await supabase.auth.getSession(); // refreshes an expired token
  const token = data.session?.access_token;
  if (!token) {
    expireSession();
    throw new ClientError('unauthorized', 'Please sign in again.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    const code = controller.signal.aborted ? 'timeout' : 'network';
    throw new ClientError(code, LOCAL_MESSAGES[code]!);
  } finally {
    clearTimeout(timer);
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiError.safeParse(json);
    const err = parsed.success
      ? new ClientError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.issues)
      : new ClientError(res.status === 401 ? 'unauthorized' : 'internal', `Request failed (${res.status}).`);
    if (err.code === 'unauthorized') expireSession();
    throw err;
  }

  // Responses are checked against the shared contract too.
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ClientError('bad_response', LOCAL_MESSAGES.bad_response!);
  return parsed.data;
}

export const api = {
  myGroups: () => request(MyGroupsResponse, 'GET', routes.myGroups()),
  groupMeetups: (groupId: string) => request(ListMeetupsResponse, 'GET', routes.groupMeetups(groupId)),
  meetup: (id: string) => request(MeetupResponse, 'GET', routes.meetup(id)),
  createMeetup: (body: CreateMeetupRequest) => request(MeetupResponse, 'POST', routes.createMeetup(), body),
  editMeetup: (id: string, body: EditMeetupRequest) => request(MeetupResponse, 'PATCH', routes.editMeetup(id), body),
  cancelMeetup: (id: string) => request(MeetupResponse, 'POST', routes.cancelMeetup(id)),
  rsvp: (id: string) => request(RsvpResponse, 'POST', routes.rsvp(id)),
  withdraw: (id: string) => request(RsvpResponse, 'DELETE', routes.rsvp(id)),
};

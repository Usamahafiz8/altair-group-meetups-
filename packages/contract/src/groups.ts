import { z } from 'zod';
import { Uuid } from './primitives';

// "My groups" (spec section 4): read-only, only the caller's own groups.
export const Group = z.object({
  id: Uuid,
  name: z.string(),
});
export type Group = z.infer<typeof Group>;

export const MyGroupsResponse = z.object({ groups: z.array(Group) });
export type MyGroupsResponse = z.infer<typeof MyGroupsResponse>;

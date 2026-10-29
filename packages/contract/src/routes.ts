// HTTP routes shared by the server and the app's API client, so a path is
// written once. Writes are the four required ones plus the edit bonus.
export const routes = {
  myGroups: () => '/groups',
  groupMeetups: (groupId: string) => `/groups/${groupId}/meetups`,
  meetup: (meetupId: string) => `/meetups/${meetupId}`,
  createMeetup: () => '/meetups', // POST
  editMeetup: (meetupId: string) => `/meetups/${meetupId}`, // PATCH (bonus)
  cancelMeetup: (meetupId: string) => `/meetups/${meetupId}/cancel`, // POST
  rsvp: (meetupId: string) => `/meetups/${meetupId}/rsvp`, // POST = RSVP, DELETE = withdraw
} as const;

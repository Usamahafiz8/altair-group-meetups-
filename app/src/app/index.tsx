import type { Group, MeetupSummary } from '@altair/contract';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeetupStatusBadge } from '../components/MeetupStatusBadge';
import { Button, Card, EmptyView, ErrorView, LoadingView, colors, s } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime, plural } from '../lib/format';
import { useResource } from '../lib/hooks';

function GroupPicker({ groups, selected, onSelect }: { groups: Group[]; selected: string; onSelect: (id: string) => void }) {
  if (groups.length === 1) return <Text style={[s.muted, { paddingHorizontal: 16, paddingTop: 12 }]}>{groups[0]!.name}</Text>;
  return (
    // flexGrow 0: a horizontal ScrollView in a column otherwise stretches to fill the screen.
    <ScrollView
      horizontal
      style={{ flexGrow: 0 }}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[s.row, { padding: 16, paddingBottom: 0 }]}
    >
      {groups.map((g) => {
        const active = g.id === selected;
        return (
          <Pressable
            key={g.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(g.id)}
            style={{
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderWidth: 1,
              borderColor: colors.primary,
              backgroundColor: active ? colors.primary : colors.card,
            }}
          >
            <Text style={{ color: active ? '#fff' : colors.primary, fontWeight: '600' }}>{g.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function MeetupRow({ meetup }: { meetup: MeetupSummary }) {
  const cancelled = meetup.status === 'cancelled';
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/meetups/${meetup.id}`)}>
      <Card style={cancelled ? { opacity: 0.7 } : undefined}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={[s.title, { flex: 1 }, cancelled && { textDecorationLine: 'line-through' }]} numberOfLines={2}>
            {meetup.title}
          </Text>
          <MeetupStatusBadge meetup={meetup} />
        </View>
        <Text style={s.text}>{formatDateTime(meetup.startsAt)}</Text>
        <Text style={s.muted} numberOfLines={1}>
          {meetup.meetingPoint.name} · {plural(meetup.attendeeCount, 'attendee')}
        </Text>
      </Card>
    </Pressable>
  );
}

function GroupMeetups({ groupId }: { groupId: string }) {
  const meetups = useResource(`group:${groupId}`, () => api.groupMeetups(groupId));
  const newMeetup = () => router.push({ pathname: '/meetups/new', params: { groupId } });

  if (meetups.loading) return <LoadingView label="Loading meetups…" />;
  if (meetups.error && !meetups.data) return <ErrorView error={meetups.error} onRetry={meetups.reload} />;
  const list = meetups.data?.meetups ?? [];

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MeetupRow meetup={item} />}
        contentContainerStyle={[s.content, list.length === 0 && { flexGrow: 1 }]}
        refreshControl={<RefreshControl refreshing={meetups.refreshing} onRefresh={meetups.refresh} />}
        ListHeaderComponent={meetups.error ? <Text style={s.fieldError}>{meetups.error.message}</Text> : undefined}
        ListEmptyComponent={
          <EmptyView title="No meetups yet" body="Be the first to post a walk for this group." action={<Button title="Create a meetup" onPress={newMeetup} />} />
        }
      />
      {list.length > 0 ? (
        <View style={{ padding: 16, paddingTop: 0 }}>
          <Button title="New meetup" onPress={newMeetup} />
        </View>
      ) : null}
    </View>
  );
}

export default function MeetupList() {
  const { signOut } = useAuth();
  const groups = useResource('groups', api.myGroups);
  const [chosen, setChosen] = useState<string | null>(null);
  const list = groups.data?.groups ?? [];
  // Keep the user's choice while it is still one of their groups.
  const groupId = list.find((g) => g.id === chosen)?.id ?? list[0]?.id ?? null;

  const confirmSignOut = () =>
    Alert.alert('Sign out?', undefined, [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <SafeAreaView style={s.screen} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={confirmSignOut} hitSlop={12}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      {groups.loading ? (
        <LoadingView label="Loading your groups…" />
      ) : groups.error && !groups.data ? (
        <ErrorView error={groups.error} onRetry={groups.reload} />
      ) : !groupId ? (
        <EmptyView
          title="You’re not in a walking group yet"
          body="Meetups are shared within neighbourhood groups. Once you join one, its meetups show up here."
          action={<Button title="Check again" variant="secondary" onPress={groups.reload} />}
        />
      ) : (
        <>
          <GroupPicker groups={list} selected={groupId} onSelect={setChosen} />
          <GroupMeetups key={groupId} groupId={groupId} />
        </>
      )}
    </SafeAreaView>
  );
}

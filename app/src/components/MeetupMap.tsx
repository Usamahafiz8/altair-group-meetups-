import type { MeetingPoint } from '@altair/contract';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type LatLng, type MapPressEvent } from 'react-native-maps';
import { colors, s } from './ui';

const DELTA = { latitudeDelta: 0.012, longitudeDelta: 0.012 };
// The seed town's reference point, used before a point has been picked.
export const TOWN_CENTER: LatLng = { latitude: 40.0, longitude: -100.0 };

type Props = {
  // What the server says this member may see. Rendered as-is: the app never
  // receives, and so cannot show, more than that.
  point?: MeetingPoint | null;
  // Picker mode (create/edit): tap or drag to choose a point.
  pick?: { value: LatLng | null; onChange: (p: LatLng) => void };
  height?: number;
};

export function MeetupMap({ point, pick, height = 220 }: Props) {
  const [ready, setReady] = useState(false);
  const marker = pick ? pick.value : point ? { latitude: point.lat, longitude: point.lng } : null;

  if (!pick && !point) {
    return (
      <View style={[styles.frame, styles.empty, { height }]}>
        <Text style={s.muted}>No meeting point to show.</Text>
      </View>
    );
  }

  const center = marker ?? TOWN_CENTER;
  const onPick = (e: MapPressEvent) => pick?.onChange(e.nativeEvent.coordinate);

  return (
    <View style={[styles.frame, { height }]}>
      <MapView
        // Re-centre when the server's point changes (e.g. after an edit).
        key={pick ? 'picker' : `${point!.lat},${point!.lng}`}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...center, ...DELTA }}
        onMapReady={() => setReady(true)}
        onPress={pick ? onPick : undefined}
        toolbarEnabled={false}
        accessibilityLabel={pick ? 'Map: tap to choose the meeting point' : `Map of ${point!.name}`}
      >
        {marker ? (
          <Marker
            coordinate={marker}
            title={pick ? 'Meeting point' : point!.name}
            draggable={!!pick}
            onDragEnd={pick ? (e) => pick.onChange(e.nativeEvent.coordinate) : undefined}
          />
        ) : null}
      </MapView>
      {!ready ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
          <Text style={s.muted}>Loading map…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: '#e9edf1' },
  empty: { alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 6 },
});

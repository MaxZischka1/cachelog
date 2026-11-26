import { Linking, Platform } from 'react-native';
import { centroid } from '../core/plan';
import type { LngLat, PinEntry, Piece } from '../core/types';

export interface Destination {
  position: LngLat;
  /** What the planter is being sent to, e.g. "Block access (quad trail)". */
  label: string;
}

/**
 * Where "directions to the block" should go: the crew boss's newest Access pin, else the planter's
 * piece. Driving directions need roads, so the pin is the right target: where the truck can get to.
 */
export function blockDestination(openPins: PinEntry[], piece: Piece | null): Destination | null {
  const access = openPins.filter((p) => p.kind === 'access').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (access) return { position: access.position, label: access.note?.trim() ? `Block access · ${access.note.trim()}` : 'Block access' };
  if (piece && piece.polygon.length >= 3) return { position: centroid(piece.polygon), label: piece.name };
  return null;
}

/** Open turn-by-turn directions in the phone's maps app (needs signal for the route). */
export async function openDirections(dest: Destination): Promise<void> {
  const [lng, lat] = dest.position;
  const q = encodeURIComponent(dest.label);
  const url =
    Platform.OS === 'ios'
      ? `maps://?daddr=${lat},${lng}&dirflg=d&q=${q}`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  const fallback = `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(fallback);
  }
}

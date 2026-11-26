/**
 * When iOS hands the app a file (tapping an AirDropped .cachelog file, "Open in Cachelog" from
 * Files or Mail) the incoming "path" is a file URL. Send it to the /open screen, which imports it.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const bare = path.split('?')[0].split('#')[0];
    if (path.startsWith('file:') || /\.(cachelog|pdf|tiff?|kml|geojson)$/i.test(bare)) {
      return `/open?uri=${encodeURIComponent(path)}`;
    }
    return path;
  } catch {
    return '/';
  }
}

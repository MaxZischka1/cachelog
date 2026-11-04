/**
 * Coordinate reference systems used on Canadian (BC / Alberta) planting maps, and
 * helpers to transform to WGS84 with proj4.
 *
 * NAD83 and NAD83(CSRS) are treated as identical to WGS84 (difference is ~1-2 m in
 * western Canada, well under a GPS fix in the bush). NAD27 needs a grid shift that is
 * not bundled, so it is approximated with a plain Helmert-free datum and flagged.
 */
import proj4 from 'proj4';
import type { LngLat } from '../core/types';

const NAD83 = '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const WGS84 = '+datum=WGS84 +units=m +no_defs';
const NAD27 = '+datum=NAD27 +units=m +no_defs';

const utm = (zone: number, datum: string, south = false) =>
  `+proj=utm +zone=${zone}${south ? ' +south' : ''} ${datum}`;

/** NAD83(CSRS) UTM codes (they are not contiguous). */
const CSRS_UTM: Record<number, number> = {
  3154: 7, 3155: 8, 3156: 9, 3157: 10, 2955: 11, 2956: 12, 2957: 13,
  3158: 14, 3159: 15, 3160: 16, 2958: 17, 2959: 18, 2960: 19, 2961: 20, 2962: 21,
};

/** EPSG codes whose datum shift we cannot do accurately (NAD27). */
export function isApproximateDatum(epsg: number): boolean {
  return epsg === 4267 || (epsg >= 26701 && epsg <= 26722);
}

/** proj4 definition string for an EPSG code we know, or null. */
export function crsDefinition(epsg: number): string | null {
  // Geographic
  if (epsg === 4326 || epsg === 4269 || epsg === 4617 || epsg === 4140 || epsg === 4955) {
    return '+proj=longlat +datum=WGS84 +no_defs';
  }
  if (epsg === 4267) return '+proj=longlat +datum=NAD27 +no_defs';
  // Web mercator
  if (epsg === 3857 || epsg === 900913 || epsg === 3785 || epsg === 102100) {
    return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs';
  }
  // NAD83 / UTM zones 1-23 N
  if (epsg >= 26901 && epsg <= 26923) return utm(epsg - 26900, NAD83);
  // NAD27 / UTM zones 1-22 N
  if (epsg >= 26701 && epsg <= 26722) return utm(epsg - 26700, NAD27);
  // WGS84 / UTM N and S
  if (epsg >= 32601 && epsg <= 32660) return utm(epsg - 32600, WGS84);
  if (epsg >= 32701 && epsg <= 32760) return utm(epsg - 32700, WGS84, true);
  // NAD83(CSRS) / UTM
  if (CSRS_UTM[epsg]) return utm(CSRS_UTM[epsg], NAD83);
  // BC Albers (NAD83 and NAD83(CSRS))
  if (epsg === 3005 || epsg === 3153) {
    return `+proj=aea +lat_0=45 +lon_0=-126 +lat_1=50 +lat_2=58.5 +x_0=1000000 +y_0=0 ${NAD83}`;
  }
  // Alberta 10-TM Forest (3400 NAD83, 3402 CSRS) and Resource (3401, 3403)
  if (epsg === 3400 || epsg === 3402) {
    return `+proj=tmerc +lat_0=0 +lon_0=-115 +k=0.9992 +x_0=500000 +y_0=0 ${NAD83}`;
  }
  if (epsg === 3401 || epsg === 3403) {
    return `+proj=tmerc +lat_0=0 +lon_0=-115 +k=0.9992 +x_0=0 +y_0=0 ${NAD83}`;
  }
  // Statistics Canada Lambert (NAD83) — sometimes used for overview maps
  if (epsg === 3347) {
    return `+proj=lcc +lat_0=63.390675 +lon_0=-91.8666666666667 +lat_1=49 +lat_2=77 +x_0=6200000 +y_0=3000000 ${NAD83}`;
  }
  return null;
}

export function isGeographic(epsg: number): boolean {
  const def = crsDefinition(epsg);
  return def !== null && def.startsWith('+proj=longlat');
}

const LONLAT = '+proj=longlat +datum=WGS84 +no_defs';

/** Transform [x, y] in the given proj4 definition to [lng, lat] WGS84. */
export function toWgs84(def: string, xy: [number, number]): LngLat {
  if (def === LONLAT) return [xy[0], xy[1]];
  const out = proj4(def, LONLAT, [xy[0], xy[1]]) as number[];
  return [out[0], out[1]];
}

/** Transform [lng, lat] WGS84 to the given proj4 definition. */
export function fromWgs84(def: string, ll: LngLat): [number, number] {
  if (def === LONLAT) return [ll[0], ll[1]];
  const out = proj4(LONLAT, def, [ll[0], ll[1]]) as number[];
  return [out[0], out[1]];
}

/** A WGS84 UTM definition for the zone containing a point (used as a local planar frame). */
export function localUtmFor(ll: LngLat): string {
  const zone = Math.min(60, Math.max(1, Math.floor((ll[0] + 180) / 6) + 1));
  return utm(zone, WGS84, ll[1] < 0);
}

/**
 * Best-effort guess of an EPSG code from a free-text citation / WKT name,
 * e.g. "NAD83 / UTM zone 10N", "NAD83(CSRS) / UTM zone 11N", "NAD83 / BC Albers".
 */
export function epsgFromName(name: string): number | null {
  const s = name.toUpperCase();
  const csrs = /CSRS/.test(s);
  const m = /UTM[ _]*ZONE[ _]*(\d{1,2})\s*([NS])?/.exec(s) ?? /UTM[ _]*(\d{1,2})([NS])\b/.exec(s);
  if (m) {
    const zone = parseInt(m[1], 10);
    const south = m[2] === 'S';
    if (/NAD.?83/.test(s) && !south) {
      if (csrs) {
        const hit = Object.entries(CSRS_UTM).find(([, z]) => z === zone);
        if (hit) return Number(hit[0]);
      }
      if (zone <= 23) return 26900 + zone;
    }
    if (/NAD.?27/.test(s) && !south && zone <= 22) return 26700 + zone;
    return (south ? 32700 : 32600) + zone;
  }
  if (/ALBERS/.test(s) && /BC|BRITISH/.test(s)) return csrs ? 3153 : 3005;
  if (/10.?TM/.test(s)) return /RESOURCE/.test(s) ? (csrs ? 3403 : 3401) : (csrs ? 3402 : 3400);
  if (/PSEUDO.?MERCATOR|WEB.?MERCATOR/.test(s)) return 3857;
  if (/WGS.?84/.test(s) && !/UTM/.test(s)) return 4326;
  if (/NAD.?83/.test(s)) return 4269;
  return null;
}

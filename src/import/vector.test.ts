import type { GeoJSONFeatureCollection } from '../core/types';
import { featuresToPieces, kmlToGeoJSON, normalizeGeoJSON } from './index';
import { chooseGeoPdfPage, describeGeoPdf, extensionOf, isMapFileName, layerName, vectorResult } from './helpers';

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Block 42</name>
    <Folder>
      <Placemark>
        <name>Piece A</name>
        <ExtendedData>
          <Data name="density"><value>1600</value></Data>
          <Data name="spacing"><value>2.5 m</value></Data>
          <Data name="species"><value>Sx, Pl</value></Data>
        </ExtendedData>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>
          -120.0,52.0,0 -119.99,52.0,0 -119.99,52.01,0 -120.0,52.01,0 -120.0,52.0,0
        </coordinates></LinearRing></outerBoundaryIs></Polygon>
      </Placemark>
      <Placemark>
        <name>Piece B</name>
        <Polygon><outerBoundaryIs><LinearRing><coordinates>
          -119.98,52.0 -119.97,52.0 -119.975,52.01 -119.98,52.0
        </coordinates></LinearRing></outerBoundaryIs></Polygon>
      </Placemark>
      <Placemark>
        <name>Road</name>
        <LineString><coordinates>-120,52 -119.9,52.1</coordinates></LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

describe('kmlToGeoJSON + featuresToPieces', () => {
  test('two placemark polygons become two pieces', () => {
    const fc = kmlToGeoJSON(KML);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(3);
    const pieces = featuresToPieces(fc);
    expect(pieces.map((p) => p.name)).toEqual(['Piece A', 'Piece B']);
    expect(pieces[0].polygon).toEqual([[-120, 52], [-119.99, 52], [-119.99, 52.01], [-120, 52.01]]);
    expect(pieces[1].polygon).toHaveLength(3);
    expect(pieces[0].prescription).toEqual({ densityPerHa: 1600, spacingM: 2.5, species: ['Sx', 'Pl'] });
    expect(pieces[1].prescription).toBeUndefined();
    expect(pieces[0].id).not.toEqual(pieces[1].id);
    expect(pieces[0].id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  test('invalid XML throws a readable error', () => {
    expect(() => kmlToGeoJSON('<kml><Placemark>')).toThrow(/Could not read KML/);
  });
});

describe('GeoJSON', () => {
  const multi: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { Name: 'Unit 7', DENSITY: '1,400 sph' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[-118, 54], [-117.99, 54], [-117.99, 54.01], [-118, 54]], [[-117.995, 54.001], [-117.994, 54.001], [-117.994, 54.002], [-117.995, 54.001]]],
            [[[-117.9, 54], [-117.89, 54], [-117.89, 54.01], [-117.9, 54.01], [-117.9, 54]]],
          ],
        },
      },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { type: 'Feature', properties: { name: 'Cache' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ],
  };

  test('MultiPolygon -> one piece per part; fallback names; closing point dropped; holes ignored', () => {
    const pieces = featuresToPieces(multi);
    expect(pieces.map((p) => p.name)).toEqual(['Unit 7 (1)', 'Unit 7 (2)', 'Piece 3']);
    expect(pieces[0].polygon).toEqual([[-118, 54], [-117.99, 54], [-117.99, 54.01]]);
    expect(pieces[1].polygon).toHaveLength(4);
    expect(pieces[0].prescription).toEqual({ densityPerHa: 1400 });
    expect(pieces[2].prescription).toBeUndefined();
  });

  test('normalizeGeoJSON accepts Feature / bare geometry', () => {
    expect(normalizeGeoJSON(multi.features[0]).features).toHaveLength(1);
    expect(normalizeGeoJSON({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }).features[0].geometry?.type).toBe('Polygon');
    expect(() => normalizeGeoJSON({ foo: 1 })).toThrow(/GeoJSON/);
  });

  test('vectorResult warns on projected coordinates', () => {
    const r = vectorResult('x', normalizeGeoJSON({ type: 'Polygon', coordinates: [[[500000, 5800000], [500100, 5800000], [500100, 5800100]]] }));
    expect(r.kind).toBe('vector');
    if (r.kind === 'vector') expect(r.pieces).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/WGS84/);
  });
});

describe('helpers', () => {
  test('extension and layer name', () => {
    expect(extensionOf('file:///a/b/Block%2042.TIF')).toBe('tif');
    expect(extensionOf('noext')).toBe('');
    expect(layerName('file:///a/b/Block%2042.tif')).toBe('Block 42');
  });

  const ground = { def: '+proj=longlat +datum=WGS84 +no_defs', affine: [1, 0, 0, 0, 1, 0] as [number, number, number, number, number, number] };

  test('GeoPDF message includes georeference and conversion hint', () => {
    const msg = describeGeoPdf({ pages: [{ pageIndex: 0, crs: 'EPSG:26910', corners: [[-123, 52], [-122.9, 52], [-122.9, 51.9], [-123, 51.9]], ground }] });
    expect(msg).toMatch(/gdal_translate/);
    expect(msg).toMatch(/GeoTIFF/);
    expect(msg).toMatch(/52\.00000, -123\.00000/);
    expect(msg).toMatch(/EPSG:26910/);
    expect(describeGeoPdf(null)).toMatch(/no georeferencing/);
  });

  test('map files are told apart from Cachelog files', () => {
    expect(isMapFileName('BLK_5050853586.pdf')).toBe(true);
    expect(isMapFileName('file:///tmp/Block%2042.TIF')).toBe(true);
    expect(isMapFileName('bounds.kml')).toBe(true);
    expect(isMapFileName('plan-v3.cachelog')).toBe(false);
    expect(isMapFileName('export.json')).toBe(false);
    expect(isMapFileName('noext')).toBe(false);
  });

  test('GeoPDF import uses the first map page and warns about the others', () => {
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [[-123, 52], [-122.9, 52], [-122.9, 51.9], [-123, 51.9]];
    const one = chooseGeoPdfPage({ pages: [{ pageIndex: 2, corners, ground }] });
    expect(one.page.pageIndex).toBe(2);
    expect(one.warnings).toEqual([]);

    const three = chooseGeoPdfPage({ pages: [{ pageIndex: 0, corners, ground }, { pageIndex: 1, corners, ground }, { pageIndex: 3, corners, ground }] });
    expect(three.page.pageIndex).toBe(0);
    expect(three.warnings).toHaveLength(1);
    expect(three.warnings[0]).toMatch(/3 map pages\. Page 1 was imported; to use page 2, 4 as well, save each/);
  });
});

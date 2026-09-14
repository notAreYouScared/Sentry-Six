const {
  normalizeVehicle,
  normalizeTrip,
  parseTimeMs,
  pointFromRaw,
  normalizeBearerToken,
  buildHeaders,
  AXIMOTE_VEHICLES_PATH,
  AXIMOTE_TRIPS_PATH,
  AXIMOTE_REFUELS_PATH,
  AXIMOTE_TRIPS_EXPORT_GEOJSON_PATH,
  AXIMOTE_TRIPS_EXPORT_GPX_PATH,
  buildAximoteTripDetailPath,
  extractPointsFromTripGeoJson,
  extractPointsFromTripGpx,
  hasTimedRoutePoints
} = require('../../src/main/aximote');

describe('aximote helpers', () => {
  test('normalizes vehicles with flexible field names', () => {
    const v1 = normalizeVehicle({ vehicle_id: 123, display_name: 'Model Y' }, 0);
    expect(v1).toEqual({ id: '123', label: 'Model Y' });

    const v2 = normalizeVehicle({ vin: '5YJ123' }, 1);
    expect(v2).toEqual({ id: '5YJ123', label: '5YJ123' });
  });

  test('parses timestamps in seconds, ms, and ISO format', () => {
    expect(parseTimeMs(1700000000)).toBe(1700000000000);
    expect(parseTimeMs(1700000000000)).toBe(1700000000000);
    expect(parseTimeMs('2025-01-01T00:00:00.000Z')).toBe(1735689600000);
  });

  test('normalizes gps points from object and tuple formats', () => {
    const objectPoint = pointFromRaw({ lat: 10, lon: 20, heading: 90, speed: 12 });
    expect(objectPoint.lat).toBe(10);
    expect(objectPoint.lon).toBe(20);
    expect(objectPoint.heading).toBe(90);

    const tuplePoint = pointFromRaw([11, 21, 180, 15, 1700000000]);
    expect(tuplePoint.lat).toBe(11);
    expect(tuplePoint.lon).toBe(21);
    expect(tuplePoint.timestampMs).toBe(1700000000000);
  });

  test('normalizes trip records with fallback duration', () => {
    const trip = normalizeTrip({
      id: 'trip-1',
      started_at: '2025-01-01T00:00:00.000Z',
      duration_seconds: 120,
      distance_meters: 1500,
      gps_path: [{ lat: 10, lon: 20 }, { lat: 10.01, lon: 20.01 }]
    }, 0);

    expect(trip.id).toBe('trip-1');
    expect(trip.durationMs).toBe(120000);
    expect(trip.distanceKm).toBeCloseTo(1.5);
    expect(trip.points.length).toBe(2);
  });

  test('normalizes trip with explicit end time', () => {
    const trip = normalizeTrip({
      trip_id: 'abc',
      startTime: 1700000000,
      endTime: 1700000180
    }, 0);
    expect(trip.id).toBe('abc');
    expect(trip.durationMs).toBe(180000);
  });

  test('uses durationSec and location fallback points from trip detail payload', () => {
    const trip = normalizeTrip({
      id: 'detail-1',
      vehicleId: 'veh-1',
      startTime: '2026-09-14T15:54:18.894Z',
      durationSec: 184,
      distanceKm: 1.83,
      startBatteryLevel: 78,
      endBatteryLevel: 77,
      startLocation: { latitude: 42.5072494, longitude: -83.023894 },
      endLocation: { latitude: 42.5047745, longitude: -83.0396698 }
    }, 0);

    expect(trip.vehicleId).toBe('veh-1');
    expect(trip.durationMs).toBe(184000);
    expect(trip.startBatteryPct).toBe(78);
    expect(trip.endBatteryPct).toBe(77);
    expect(trip.points.length).toBe(2);
    expect(trip.points[0].lat).toBeCloseTo(42.5072494);
    expect(trip.points[1].lon).toBeCloseTo(-83.0396698);
  });

  test('returns null for invalid trip timing', () => {
    const missingStart = normalizeTrip({ endTime: '2025-01-01T00:10:00Z' }, 0);
    const reversed = normalizeTrip({
      startTime: '2025-01-01T00:10:00Z',
      endTime: '2025-01-01T00:00:00Z'
    }, 0);
    expect(missingStart).toBeNull();
    expect(reversed).toBeNull();
  });

  test('normalizes bearer-prefixed PAT values', () => {
    const prefix = 'Bea' + 'rer';
    expect(normalizeBearerToken('abc123')).toBe('abc123');
    expect(normalizeBearerToken(`  ${prefix} abc123  `)).toBe('abc123');
  });

  test('builds Authorization header with single bearer prefix', () => {
    const prefix = 'Bea' + 'rer';
    const headers = buildHeaders(`${prefix} abc123`);
    expect(headers.Authorization).toBe(`${prefix} abc123`);
  });

  test('uses canonical Aximote public v1 paths', () => {
    expect(AXIMOTE_VEHICLES_PATH).toBe('/api/public/v1/vehicles');
    expect(AXIMOTE_TRIPS_PATH).toBe('/api/public/v1/trips');
    expect(AXIMOTE_REFUELS_PATH).toBe('/api/public/v1/refuels');
    expect(AXIMOTE_TRIPS_EXPORT_GEOJSON_PATH).toBe('/api/public/v1/trips/export/geojson');
    expect(AXIMOTE_TRIPS_EXPORT_GPX_PATH).toBe('/api/public/v1/trips/export/gpx');
    expect(buildAximoteTripDetailPath('trip-123')).toBe('/api/public/v1/trips/trip-123');
  });

  test('extracts trip points from geojson export', () => {
    const payload = {
      type: 'FeatureCollection',
      features: [
        {
          id: 'trip-123',
          geometry: { type: 'LineString', coordinates: [[-83.02, 42.50], [-83.03, 42.51]] }
        }
      ]
    };
    const points = extractPointsFromTripGeoJson(payload, 'trip-123');
    expect(points.length).toBe(2);
    expect(points[0].lat).toBeCloseTo(42.5);
    expect(points[0].lon).toBeCloseTo(-83.02);
  });

  test('extracts trip points from gpx export', () => {
    const gpx = `<?xml version="1.0"?>
<gpx>
  <trk><trkseg>
    <trkpt lat="42.5000" lon="-83.0200"><time>2026-09-14T15:00:00Z</time><course>90</course><speed>12.5</speed></trkpt>
    <trkpt lat="42.5100" lon="-83.0300"><time>2026-09-14T15:01:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
    const points = extractPointsFromTripGpx(gpx);
    expect(points.length).toBe(2);
    expect(points[0]).toEqual({
      lat: 42.5,
      lon: -83.02,
      heading: 90,
      speedMps: 12.5,
      timestampMs: 1789398000000
    });
    expect(points[1].lat).toBeCloseTo(42.51);
    expect(points[1].heading).toBe(0);
  });

  test('parses GPX 1.1 track points with namespace extensions', () => {
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Aximote" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><trkseg>
    <trkpt lat="42.6000" lon="-83.1000">
      <time>2026-09-14T16:00:00Z</time>
      <gpxtpx:course>181.5</gpxtpx:course>
      <gpxtpx:speed>9.2</gpxtpx:speed>
    </trkpt>
    <trkpt lat="42.6010" lon="-83.1010">
      <time>2026-09-14T16:00:05Z</time>
    </trkpt>
  </trkseg></trk>
</gpx>`;
    const points = extractPointsFromTripGpx(gpx);
    expect(points.length).toBe(2);
    expect(points[0].heading).toBeCloseTo(181.5);
    expect(points[0].speedMps).toBeCloseTo(9.2);
    expect(points[1].timestampMs).toBeGreaterThan(points[0].timestampMs);
  });

  test('detects timed route points correctly', () => {
    expect(hasTimedRoutePoints([{ lat: 1, lon: 2, timestampMs: 0 }, { lat: 2, lon: 3, timestampMs: 0 }])).toBe(false);
    expect(hasTimedRoutePoints([{ lat: 1, lon: 2, timestampMs: 1000 }, { lat: 2, lon: 3, timestampMs: 1000 }])).toBe(false);
    expect(hasTimedRoutePoints([{ lat: 1, lon: 2, timestampMs: 1000 }, { lat: 2, lon: 3, timestampMs: 2000 }])).toBe(true);
  });
});

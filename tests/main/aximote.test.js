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
  buildAximoteTripDetailPath
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
    expect(buildAximoteTripDetailPath('trip-123')).toBe('/api/public/v1/trips/trip-123');
  });
});

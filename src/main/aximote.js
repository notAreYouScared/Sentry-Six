const https = require('https');

const AXIMOTE_BASE_URL = 'https://api.aximote.com';
const AXIMOTE_PUBLIC_V1_BASE = '/api/public/v1';
const AXIMOTE_VEHICLES_PATH = `${AXIMOTE_PUBLIC_V1_BASE}/vehicles`;
const AXIMOTE_TRIPS_PATH = `${AXIMOTE_PUBLIC_V1_BASE}/trips`;
const AXIMOTE_REFUELS_PATH = `${AXIMOTE_PUBLIC_V1_BASE}/refuels`;
const REQUEST_TIMEOUT_MS = 20_000;

function buildHeaders(token) {
  const trimmed = normalizeBearerToken(token);
  if (!trimmed) return null;
  return {
    Accept: 'application/json',
    Authorization: 'Bearer ' + trimmed,
    'X-API-Key': trimmed,
    'Personal-Access-Token': trimmed,
    'User-Agent': 'Sentry-Studio/aximote-integration'
  };
}

function normalizeBearerToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : raw;
}

function requestJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status >= 400) {
          const err = new Error(`HTTP ${status}`);
          err.status = status;
          err.body = body.slice(0, 300);
          reject(err);
          return;
        }
        try {
          const parsed = body ? JSON.parse(body) : null;
          resolve(parsed);
        } catch (err) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

function extractArray(payload, candidateKeys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  for (const key of candidateKeys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseTimeMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (value > 1e11) return Math.round(value);
    if (value > 1e9) return Math.round(value * 1000);
    return Math.round(value * 1000);
  }
  const n = asNumber(value);
  if (n !== null) return parseTimeMs(n);
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

function pointFromRaw(raw) {
  if (Array.isArray(raw) && raw.length >= 2) {
    const lat = asNumber(raw[0]);
    const lon = asNumber(raw[1]);
    if (lat === null || lon === null) return null;
    const heading = asNumber(raw[2]) ?? 0;
    const speedMps = asNumber(raw[3]) ?? 0;
    const timestampMs = parseTimeMs(raw[4]) ?? 0;
    return { lat, lon, heading, speedMps, timestampMs };
  }
  if (!raw || typeof raw !== 'object') return null;
  const lat = asNumber(raw.lat ?? raw.latitude ?? raw.latitudeDeg ?? raw.latitude_deg ?? raw.y);
  const lon = asNumber(raw.lng ?? raw.lon ?? raw.longitude ?? raw.longitudeDeg ?? raw.longitude_deg ?? raw.x);
  if (lat === null || lon === null) return null;
  const heading = asNumber(raw.heading ?? raw.headingDeg ?? raw.bearing ?? raw.course) ?? 0;
  const speedMps = asNumber(raw.speedMps ?? raw.speed_mps ?? raw.speed ?? raw.velocity) ?? 0;
  const timestampMs = parseTimeMs(raw.timestamp ?? raw.time ?? raw.ts ?? raw.recordedAt ?? raw.recorded_at) ?? 0;
  return { lat, lon, heading, speedMps, timestampMs };
}

function normalizeVehicle(vehicle, idx) {
  const idValue =
    vehicle?.id ??
    vehicle?.vehicleId ??
    vehicle?.vehicle_id ??
    vehicle?.uuid ??
    vehicle?.vin;
  const id = idValue !== undefined && idValue !== null ? String(idValue) : `vehicle-${idx + 1}`;

  const label =
    vehicle?.name ??
    vehicle?.displayName ??
    vehicle?.display_name ??
    vehicle?.model ??
    vehicle?.vin ??
    `Vehicle ${idx + 1}`;

  return { id, label: String(label) };
}

function normalizeTrip(trip, idx) {
  const startMs = parseTimeMs(
    trip?.startTime ??
    trip?.startedAt ??
    trip?.started_at ??
    trip?.startDate ??
    trip?.start_date ??
    trip?.beginTime
  );
  const endMsRaw = parseTimeMs(
    trip?.endTime ??
    trip?.endedAt ??
    trip?.ended_at ??
    trip?.endDate ??
    trip?.end_date ??
    trip?.finishTime
  );

  const durationMinutes = asNumber(trip?.durationMinutes);
  const durationSeconds =
    asNumber(trip?.durationSeconds ?? trip?.duration_seconds) ??
    (durationMinutes !== null ? durationMinutes * 60 : null);
  const durationMsRaw =
    asNumber(trip?.durationMs ?? trip?.duration_ms) ??
    (durationSeconds !== null ? durationSeconds * 1000 : null);

  const endMs = endMsRaw ?? (startMs !== null && Number.isFinite(durationMsRaw) ? startMs + durationMsRaw : null);
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  const pointArrays = [
    trip?.gpsPath,
    trip?.gps_path,
    trip?.routePoints,
    trip?.route_points,
    trip?.path,
    trip?.coordinates,
    trip?.route?.points,
    trip?.route?.coordinates
  ];

  let pointsRaw = [];
  for (const candidate of pointArrays) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      pointsRaw = candidate;
      break;
    }
  }

  const points = pointsRaw.map(pointFromRaw).filter(Boolean);

  const distanceKmRaw = asNumber(trip?.distanceKm ?? trip?.distance_km);
  const distanceMetersRaw = asNumber(trip?.distanceMeters ?? trip?.distance_meters ?? trip?.distance);
  const distanceMilesRaw = asNumber(trip?.distanceMiles ?? trip?.distance_miles ?? trip?.miles);
  const distanceKm =
    distanceKmRaw ??
    (distanceMetersRaw !== null ? distanceMetersRaw / 1000 : null) ??
    (distanceMilesRaw !== null ? distanceMilesRaw * 1.60934 : null) ??
    0;

  return {
    id: String(
      trip?.id ??
      trip?.tripId ??
      trip?.trip_id ??
      trip?.uuid ??
      `trip-${idx + 1}`
    ),
    startMs,
    endMs,
    durationMs: endMs - startMs,
    distanceKm: Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0,
    points
  };
}

async function queryAximote(paths, headers) {
  let lastError = null;
  for (const p of paths) {
    try {
      const url = new URL(p, AXIMOTE_BASE_URL);
      const payload = await requestJson(url, headers);
      return { ok: true, payload };
    } catch (err) {
      lastError = err;
      if (err?.status === 401 || err?.status === 403) break;
    }
  }
  return { ok: false, error: lastError || new Error('Aximote request failed') };
}

function buildAximoteTripDetailPath(tripId) {
  return `${AXIMOTE_TRIPS_PATH}/${encodeURIComponent(String(tripId || '').trim())}`;
}

function registerAximoteIpc({ ipcMain, loadSettings, saveSettings, safeStorage } = {}) {
  function saveTokenSecure(token) {
    const settings = typeof loadSettings === 'function' ? loadSettings() : {};
    const trimmed = String(token || '').trim();
    if (!trimmed) {
      delete settings.aximotePatEncrypted;
      delete settings.aximotePat;
      if (typeof saveSettings === 'function') saveSettings(settings);
      return true;
    }

    if (!safeStorage?.isEncryptionAvailable?.()) return false;
    const enc = safeStorage.encryptString(trimmed);
    settings.aximotePatEncrypted = enc.toString('base64');
    delete settings.aximotePat;
    if (typeof saveSettings === 'function') saveSettings(settings);
    return true;
  }

  function readTokenSecure() {
    const settings = typeof loadSettings === 'function' ? loadSettings() : {};
    const encrypted = settings?.aximotePatEncrypted;
    if (typeof encrypted === 'string' && encrypted.length > 0 && safeStorage?.isEncryptionAvailable?.()) {
      try {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {
        return null;
      }
    }
    return typeof settings?.aximotePat === 'string' ? settings.aximotePat : null;
  }

  ipcMain.handle('aximote:isConfigured', async () => {
    const token = readTokenSecure();
    return !!(token && String(token).trim().length > 0);
  });

  ipcMain.handle('aximote:setToken', async (_event, token) => {
    try {
      const ok = saveTokenSecure(token);
      return { success: ok, error: ok ? null : 'Secure token storage unavailable on this system' };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('aximote:listVehicles', async (_event, token) => {
    try {
      const settings = typeof loadSettings === 'function' ? loadSettings() : {};
      if (settings?.devDisableApiRequests === true) {
        return { success: false, error: 'API requests are disabled in developer settings' };
      }

      const tokenValue = token || readTokenSecure();
      const headers = buildHeaders(tokenValue);
      if (!headers) return { success: false, error: 'Missing Personal Access Token' };

      const response = await queryAximote(
        [AXIMOTE_VEHICLES_PATH],
        headers
      );
      if (!response.ok) return { success: false, error: response.error?.message || 'Failed to load vehicles' };

      const vehicles = extractArray(response.payload, ['vehicles'])
        .map((item, index) => normalizeVehicle(item, index))
        .filter(v => v && v.id);
      return { success: true, vehicles };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('aximote:listTrips', async (_event, { token, vehicleId } = {}) => {
    try {
      const settings = typeof loadSettings === 'function' ? loadSettings() : {};
      if (settings?.devDisableApiRequests === true) {
        return { success: false, error: 'API requests are disabled in developer settings' };
      }

      const tokenValue = token || readTokenSecure();
      const headers = buildHeaders(tokenValue);
      const id = String(vehicleId || '').trim();
      if (!headers) return { success: false, error: 'Missing Personal Access Token' };
      if (!id) return { success: false, error: 'Missing vehicle id' };

      const response = await queryAximote(
        [
          `${AXIMOTE_TRIPS_PATH}?vehicleId=${encodeURIComponent(id)}`
        ],
        headers
      );
      if (!response.ok) return { success: false, error: response.error?.message || 'Failed to load trips' };

      const trips = extractArray(response.payload, ['trips'])
        .map((item, index) => normalizeTrip(item, index))
        .filter(Boolean)
        .sort((a, b) => a.startMs - b.startMs);

      return { success: true, trips };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });
}

module.exports = {
  AXIMOTE_VEHICLES_PATH,
  AXIMOTE_TRIPS_PATH,
  AXIMOTE_REFUELS_PATH,
  buildAximoteTripDetailPath,
  registerAximoteIpc,
  buildHeaders,
  normalizeBearerToken,
  normalizeVehicle,
  normalizeTrip,
  pointFromRaw,
  parseTimeMs
};

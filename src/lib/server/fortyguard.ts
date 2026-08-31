// FortyGuard API: submit a request, poll the status endpoint til it's done.
//
// Supported endpoints (all async POST except status check):
//   /v1/heatmap, /v1/env_params, /v1/satellite, /v1/streetview,
//   /v1/heat_intelligence, /v1/status/{id}

import { config } from './config';
import { isDemoMode } from './config';
import { demoHeatmapResult, demoEnvParamsResult } from './demo-data';

export type ActivityStatus = 'Processing' | 'Completed' | 'Failed';

export interface SubmitResult {
  activityId: string;
  raw: Record<string, unknown>;
}

export interface PollResult {
  activityId: string;
  status: ActivityStatus;
  result?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export class FortyGuardError extends Error {
  statusCode?: number;
  payload?: unknown;
  constructor(message: string, statusCode?: number, payload?: unknown) {
    super(message);
    this.name = 'FortyGuardError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exact env_params analysis names the API emits (verified against the official
 * Python client's _ENV_PARAMS_ANALYSES). Passing an explicit subset keeps the
 * request inside plan limits (Free = 3 params) and guarantees the fields the
 * risk engine depends on are actually returned.
 */
export const ENV_ANALYSIS = {
  wetBulb: 'wet_bulb_temperature_celsius',
  aqi: 'air_quality:idx',
  solar: 'solar_irradiance',
  heatIndex: 'heat_index_celsius',
  humidity: 'relative_humidity_percent',
} as const;

/** The core set the risk engine + dashboard need (3 — safe on every plan). */
export const CORE_ENV_ANALYSES: string[] = [
  ENV_ANALYSIS.wetBulb,
  ENV_ANALYSIS.aqi,
  ENV_ANALYSIS.solar,
];

/** Extended set when the plan allows more (Basic/Startup = 5, Premium = all). */
export const EXTENDED_ENV_ANALYSES: string[] = [
  ...CORE_ENV_ANALYSES,
  ENV_ANALYSIS.heatIndex,
  ENV_ANALYSIS.humidity,
];

export class FortyGuardClient {
  private base: string;
  private headers: Record<string, string>;

  constructor() {
    this.base = config.fortyguard.baseUrl.replace(/\/$/, '');
    this.headers = {
      'api-key': config.fortyguard.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // -- Submit endpoints -------------------------------------------------------

  private async submit(
    endpoint: string,
    payload: Record<string, unknown>,
  ): Promise<SubmitResult> {
    let resp: Response;
    try {
      resp = await fetch(`${this.base}/${endpoint}`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new FortyGuardError(`Network error submitting ${endpoint}: ${String(e)}`);
    }

    if (resp.status === 429) throw new FortyGuardError(`429 rate limited on ${endpoint}`, 429);
    if (resp.status === 401 || resp.status === 403) {
      throw new FortyGuardError(`${resp.status} auth error on ${endpoint}: ${await resp.text()}`, resp.status);
    }
    if (resp.status === 400 || resp.status === 422) {
      throw new FortyGuardError(`${resp.status} validation error on ${endpoint}: ${await resp.text()}`, resp.status);
    }
    if (resp.status >= 500) {
      throw new FortyGuardError(`${resp.status} server error on ${endpoint}: ${await resp.text()}`, resp.status);
    }
    if (resp.status !== 200) {
      throw new FortyGuardError(`Unexpected ${resp.status} on ${endpoint}: ${await resp.text()}`, resp.status);
    }

    const body = (await resp.json()) as {
      data?: { activity_id?: string };
      activity_id?: string;
    };
    // Official envelope: {data: {activity_id}}; tolerate flat activity_id too.
    const activityId = body?.data?.activity_id ?? body?.activity_id;
    if (!activityId) {
      throw new FortyGuardError(`No activity_id in 200 response from ${endpoint}`, 200, body);
    }
    return { activityId, raw: body as Record<string, unknown> };
  }

  async submitHeatmap(args: {
    polygonAoi: Record<string, unknown>;
    startDate: string;               // YYYY-MM-DD
    filterType?: number;             // 1=hour 2=range of hours 3=day 4=range of days
    startTime?: string;              // HH:MM
    endTime?: string;
    endDate?: string;
    granularity?: number;            // 60 | 80 | 100 meters
    analyticType?: string;           // tcm | time_of_measure | exceedance | persistence
    threshold?: number;              // °C — required for exceedance/persistence
    direction?: 'above' | 'below';
  }): Promise<SubmitResult> {
    const dateTime: Record<string, unknown> = {
      start_date: args.startDate,
      filter_type: args.filterType ?? 1,
    };
    if (args.startTime) dateTime.start_time = args.startTime;
    if (args.endTime) dateTime.end_time = args.endTime;
    if (args.endDate) dateTime.end_date = args.endDate;

    const payload: Record<string, unknown> = {
      polygon_aoi: args.polygonAoi,
      date_time: dateTime,
      granularity: args.granularity ?? 100,
      analytic_type: args.analyticType ?? 'tcm',
    };
    if (args.threshold !== undefined) payload.threshold = args.threshold;
    if (args.direction !== undefined) payload.direction = args.direction;
    return this.submit('heatmap', payload);
  }

  async submitEnvParams(args: {
    latitude: number;
    longitude: number;
    temperature: number;            // °C — REQUIRED input (from heatmap first!)
    startDate: string;
    filterType?: number;            // 1=single hour 2=range 3=month/day
    startTime?: string;
    endTime?: string;
    /** Exact API parameter names — see ENV_ANALYSIS / EXTENDED_ENV_ANALYSES. */
    analysis?: string[];
  }): Promise<SubmitResult> {
    const dateTime: Record<string, unknown> = {
      start_date: args.startDate,
      filter_type: args.filterType ?? 1,
    };
    if (args.startTime) dateTime.start_time = args.startTime;
    if (args.endTime) dateTime.end_time = args.endTime;

    const payload: Record<string, unknown> = {
      latitude: args.latitude,
      longitude: args.longitude,
      temperature: args.temperature,
      date_time: dateTime,
    };
    // Explicit analysis list keeps us inside plan param limits (Free=3).
    payload.analysis = args.analysis ?? CORE_ENV_ANALYSES;
    return this.submit('env_params', payload);
  }

  async submitSatellite(args: {
    latitude: number;
    longitude: number;
    startDate: string;
    filterType?: number;
    startTime?: string;
    endTime?: string;
    granularity?: number;
  }): Promise<SubmitResult> {
    const dateTime: Record<string, unknown> = {
      start_date: args.startDate,
      filter_type: args.filterType ?? 3,
    };
    if (args.startTime) dateTime.start_time = args.startTime;
    if (args.endTime) dateTime.end_time = args.endTime;
    return this.submit('satellite', {
      sat: { latitude: args.latitude, longitude: args.longitude },
      date_time: dateTime,
      granularity: args.granularity ?? 100,
    });
  }

  async submitStreetView(args: {
    latitude: number;
    longitude: number;
    verticalAngle?: number;
    horizontalAngle?: number;
    backView?: boolean;
  }): Promise<SubmitResult> {
    // Payload shape per the official Python client (flat, not nested).
    return this.submit('streetview', {
      latitude: args.latitude,
      longitude: args.longitude,
      vertical_angle: args.verticalAngle ?? 0,
      horizontal_angle: args.horizontalAngle ?? 0,
      back_view: args.backView ?? false,
    });
  }

  /**
   * Heat Intelligence — multi-dimensional PDF report.
   * NOTE: `temperature` is in °FAHRENHEIT per the docs (the only endpoint that
   * is not °C). Available on all plans per docs-api.fortyguard.com.
   */
  async submitHeatIntelligence(args: {
    latitude: number;
    longitude: number;
    temperatureF: number;
    date: string;
    analysis: string[]; // ["geographic","environmental","urban","events","anthropogenic"]
  }): Promise<SubmitResult> {
    return this.submit('heat_intelligence', {
      latitude: args.latitude,
      longitude: args.longitude,
      temperature: args.temperatureF,
      date: args.date,
      analysis: args.analysis,
    });
  }

  // -- Poll -------------------------------------------------------------------

  async checkStatus(activityId: string): Promise<PollResult> {
    let resp: Response;
    try {
      resp = await fetch(`${this.base}/status/${activityId}`, {
        headers: this.headers,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new FortyGuardError(`Network error polling ${activityId}: ${String(e)}`);
    }

    if (resp.status === 404) {
      // Activity not visible yet — common immediately after submit.
      return { activityId, status: 'Processing', raw: { status_code: 404 } };
    }
    if (resp.status === 429) throw new FortyGuardError(`429 rate limited polling ${activityId}`, 429);
    if (resp.status === 401 || resp.status === 403) {
      throw new FortyGuardError(`${resp.status} auth error polling ${activityId}`, resp.status);
    }
    if (resp.status !== 200) {
      throw new FortyGuardError(`Unexpected ${resp.status} polling ${activityId}`, resp.status);
    }

    const body = (await resp.json()) as { data?: { status?: string; result?: Record<string, unknown> } };
    const statusStr = body?.data?.status ?? 'Processing';
    const status: ActivityStatus =
      statusStr === 'Completed' || statusStr === 'Failed' || statusStr === 'Succeeded'
        ? (statusStr === 'Succeeded' ? 'Completed' : statusStr)
        : 'Processing';

    return {
      activityId,
      status,
      result: status === 'Completed' ? body?.data?.result : undefined,
      raw: body as Record<string, unknown>,
    };
  }

  async pollUntilCompleted(
    activityId: string,
    opts?: { maxSeconds?: number; intervalSeconds?: number },
  ): Promise<PollResult> {
    const maxSeconds = opts?.maxSeconds ?? config.fortyguard.maxPollSeconds;
    const intervalSeconds = opts?.intervalSeconds ?? config.fortyguard.pollIntervalSeconds;
    let elapsed = 0;
    let lastStatus: ActivityStatus | null = null;

    while (elapsed <= maxSeconds) {
      const poll = await this.checkStatus(activityId);
      if (poll.status !== lastStatus) {
        console.log(`[fortyguard] activity ${activityId} → ${poll.status} (after ${elapsed}s)`);
        lastStatus = poll.status;
      }
      if (poll.status === 'Completed') return poll;
      if (poll.status === 'Failed') {
        throw new FortyGuardError(`Activity ${activityId} failed`, undefined, poll.raw);
      }
      await sleep(intervalSeconds * 1000);
      elapsed += intervalSeconds;
    }
    throw new FortyGuardError(`Activity ${activityId} did not complete within ${maxSeconds}s`);
  }

  // -- Combined convenience methods --------------------------------------------

  async callEnvParamsBlocking(args: {
    latitude: number;
    longitude: number;
    temperature: number;
    startDate: string;
    startTime?: string;
    analysis?: string[];
  }): Promise<Record<string, unknown>> {
    if (isDemoMode()) return demoEnvParamsResult(args.latitude, args.longitude, args.temperature);
    // Use filter_type=3 (Single Day) to get full 24h time series with all
    // parameters populated. filter_type=1 (Single Hour) returns empty arrays
    // for wet-bulb, AQI, and other derived params.
    const submit = await this.submitEnvParams({ ...args, filterType: 3 });
    const poll = await this.pollUntilCompleted(submit.activityId);
    return poll.result ?? {};
  }

  async callHeatmapBlocking(args: {
    polygonAoi: Record<string, unknown>;
    startDate: string;
    startTime?: string;
    filterType?: number;
    granularity?: number;
  }): Promise<Record<string, unknown>> {
    if (isDemoMode()) return demoHeatmapResult(args.polygonAoi);
    // Default to filter_type 3 (Single Day) for maximum data availability.
    // filter_type 1 (Single Hour) often returns n_cells:0 when the UTC hour
    // doesn't align with satellite thermal coverage for US locations.
    const submit = await this.submitHeatmap({ ...args, filterType: args.filterType ?? 3 });
    const poll = await this.pollUntilCompleted(submit.activityId);
    return poll.result ?? {};
  }

  /**
   * Run satellite segmentation to completion (Premium). Returns the raw result
   * containing `segmentation.segments` (class %) + base64 imagery.
   */
  async callSatelliteBlocking(args: {
    latitude: number;
    longitude: number;
    startDate: string;
  }): Promise<Record<string, unknown>> {
    const submit = await this.submitSatellite({ ...args, filterType: 3 });
    const poll = await this.pollUntilCompleted(submit.activityId, { maxSeconds: 300 });
    return poll.result ?? {};
  }

  /**
   * Run street-view segmentation to completion (Premium).
   */
  async callStreetViewBlocking(args: {
    latitude: number;
    longitude: number;
  }): Promise<Record<string, unknown>> {
    const submit = await this.submitStreetView(args);
    const poll = await this.pollUntilCompleted(submit.activityId, { maxSeconds: 300 });
    return poll.result ?? {};
  }

  /**
   * Submit a Heat Intelligence job and poll until the download_link appears.
   * Reports can take minutes — callers decide whether to await or background.
   */
  async callHeatIntelligenceBlocking(args: {
    latitude: number;
    longitude: number;
    temperatureC: number;
    date: string;
    analysis?: string[];
  }): Promise<{ downloadLink: string | null; result: Record<string, unknown> }> {
    const temperatureF = args.temperatureC * 9 / 5 + 32; // endpoint wants °F
    const submit = await this.submitHeatIntelligence({
      latitude: args.latitude,
      longitude: args.longitude,
      temperatureF,
      date: args.date,
      analysis: args.analysis ?? ['environmental', 'urban', 'anthropogenic'],
    });
    return this.callHeatIntelligenceFromActivity(submit.activityId);
  }

  async callHeatIntelligenceFromActivity(
    activityId: string,
  ): Promise<{ downloadLink: string | null; result: Record<string, unknown> }> {
    const poll = await this.pollUntilCompleted(activityId, {
      maxSeconds: Math.min(900, config.fortyguard.maxPollSeconds),
      intervalSeconds: 10,
    });
    const r = (poll.result ?? {}) as Record<string, unknown>;
    let link: string | null =
      (r.download_link as string) ??
      (r.downloadLink as string) ??
      (r.pdf_url as string) ??
      (r.pdfUrl as string) ??
      (r.report_url as string) ??
      (r.file_url as string) ??
      (r.url as string) ??
      (r.link as string) ??
      null;

    if (!link && typeof r === 'object') {
      const findUrl = (obj: unknown, depth = 0): string | null => {
        if (!obj || depth > 5) return null;
        if (typeof obj === 'string') {
          if ((obj.startsWith('http://') || obj.startsWith('https://')) && (obj.includes('.pdf') || obj.includes('download') || obj.includes('report'))) {
            return obj;
          }
        } else if (typeof obj === 'object') {
          for (const v of Object.values(obj as Record<string, unknown>)) {
            const found = findUrl(v, depth + 1);
            if (found) return found;
          }
        }
        return null;
      };
      link = findUrl(r);
    }

    return { downloadLink: link, result: r };
  }

  /** Download the temporary pre-signed PDF from a completed report. */
  async downloadPdf(downloadLink: string): Promise<Buffer> {
    let resp: Response;
    try {
      resp = await fetch(downloadLink, { signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new FortyGuardError(`Failed to download report PDF: ${String(e)}`);
    }
    if (!resp.ok) {
      throw new FortyGuardError(`Report PDF download returned ${resp.status}`, resp.status);
    }
    return Buffer.from(await resp.arrayBuffer());
  }
}

// -- Helpers -------------------------------------------------------------------

export function makeSmallAoi(latitude: number, longitude: number, halfSideMeters = 100): Record<string, unknown> {
  // 1 degree lat ≈ 111000 m; 1 degree lon ≈ 111000 m * cos(lat).
  const metersToDegLat = halfSideMeters / 111000;
  const metersToDegLon = halfSideMeters / (111000 * Math.max(0.01, Math.cos((latitude * Math.PI) / 180)));

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [longitude - metersToDegLon, latitude - metersToDegLat],
              [longitude + metersToDegLon, latitude - metersToDegLat],
              [longitude + metersToDegLon, latitude + metersToDegLat],
              [longitude - metersToDegLon, latitude + metersToDegLat],
              [longitude - metersToDegLon, latitude - metersToDegLat],
            ],
          ],
        },
      },
    ],
  };
}

export function extractTileTemperature(
  heatmapResult: Record<string, unknown>,
  targetLat: number,
  targetLng: number,
): number | null {
  // FortyGuard response shape (verified against the official quickstart sample):
  //   { map_data: { type: "FeatureCollection", features: [...] },
  //     stats_data: { temperature_stats: {minimum, maximum, mean}, ... } }
  // Tile temperatures live in properties.average_temperature (°C, tcm).
  // Older/alternative shapes may have tiles/features at the top level.

  const result = heatmapResult as {
    map_data?: { type?: string; features?: TileShape[] };
    tiles?: TileShape[];
    features?: TileShape[];
    stats_data?: {
      max_temp?: number | string;
      mean_temp?: number | string;
      temperature_stats?: { max?: number; mean?: number; maximum?: number };
    };
  };

  // Unwrap map_data if present (primary FortyGuard response shape)
  const tiles = result.map_data?.features ?? result.tiles ?? result.features ?? [];

  if (!tiles.length) {
    // No tile features — try aggregate stats as fallback
    const max =
      result.stats_data?.max_temp ??
      result.stats_data?.mean_temp ??
      result.stats_data?.temperature_stats?.maximum ??
      result.stats_data?.temperature_stats?.mean;
    if (max !== undefined && max !== null) {
      const n = Number(max);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  let bestTile: TileShape | null = null;
  let bestDist = Infinity;
  for (const tile of tiles) {
    let lat: number | undefined;
    let lng: number | undefined;
    const coords = (tile.coordinates ?? tile.center ?? tile.geometry?.coordinates) as
      | unknown;

    if (Array.isArray(coords)) {
      // Could be [lng, lat] (point) or [[[lng,lat],...]] (polygon rings)
      if (coords.length >= 2 && typeof coords[0] === 'number') {
        // Simple [lng, lat] point
        lng = coords[0] as number;
        lat = coords[1] as number;
      } else if (Array.isArray(coords[0])) {
        // GeoJSON Polygon: [[[lng,lat], [lng,lat], ...]] — compute centroid
        const ring = Array.isArray(coords[0][0]) ? coords[0] as number[][] : coords as number[][];
        if (ring.length > 0) {
          let sumLng = 0, sumLat = 0, count = 0;
          for (const pt of ring) {
            if (Array.isArray(pt) && pt.length >= 2) {
              sumLng += pt[0];
              sumLat += pt[1];
              count++;
            }
          }
          if (count > 0) {
            lng = sumLng / count;
            lat = sumLat / count;
          }
        }
      }
    } else if (coords && typeof coords === 'object') {
      const c = coords as {
        lat?: number; latitude?: number; lng?: number; lon?: number; longitude?: number;
      };
      lat = c.lat ?? c.latitude;
      lng = c.lng ?? c.lon ?? c.longitude;
    }
    if (lat === undefined || lat === null || lng === undefined || lng === null) continue;
    const d = (lat - targetLat) ** 2 + (lng - targetLng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestTile = tile;
    }
  }
  if (!bestTile) return null;

  const props = (bestTile.properties ?? {}) as Record<string, unknown>;
  const temp =
    (bestTile.temperature as number | undefined) ??
    (bestTile.temp_c as number | undefined) ??
    (bestTile.value as number | undefined) ??
    (props.average_temperature as number | undefined) ??
    (props.temperature as number | undefined) ??
    (props.max_temperature as number | undefined) ??
    (props.temp_c as number | undefined) ??
    (props.value as number | undefined);
  if (temp === undefined || temp === null) return null;
  const n = Number(temp);
  return Number.isFinite(n) ? n : null;
}

interface TileShape {
  coordinates?: unknown;
  center?: unknown;
  geometry?: { type?: string; coordinates?: unknown };
  temperature?: number;
  temp_c?: number;
  value?: number;
  properties?: Record<string, unknown>;
}

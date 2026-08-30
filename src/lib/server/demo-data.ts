// Demo mode API responses (no key configured).
// Shapes match the real API, so extraction logic is identical.
// Seeded per-site/hour for realistic evolution across polls.

import type { Site } from '@prisma/client';

// Deterministic seeded PRNG

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Regional climate profiles (August, US)

interface ClimateProfile {
  baseTempC: number;      // afternoon high at latitude 35 baseline
  diurnalSwingC: number;  // peak-to-trough across the day
  wetBulbDepression: number; // temp minus wet-bulb at afternoon peak (humidity proxy)
  aqiBaseline: number;
}

function climateFor(latitude: number, longitude: number, state?: string | null): ClimateProfile {
  // Desert SW, humid Gulf, temperate Mid/NE
  const southWest = latitude < 35.5 && longitude > -115;
  const gulfCoast = latitude < 33 && longitude > -98 && longitude < -85;
  if (southWest) {
    return { baseTempC: 42.0, diurnalSwingC: 14, wetBulbDepression: 12, aqiBaseline: 95 };
  }
  if (gulfCoast) {
    return { baseTempC: 35.5, diurnalSwingC: 8, wetBulbDepression: 5, aqiBaseline: 108 };
  }
  // ~2.2°C cooler per degree latitude above 35
  const latFactor = Math.max(0, 35 - latitude) * 2.2;
  return {
    baseTempC: 33.0 - latFactor,
    diurnalSwingC: 10,
    wetBulbDepression: 7,
    aqiBaseline: 48,
  };
}

function timezoneForState(state?: string | null): string {
  switch (state) {
    case 'AZ': return 'America/Phoenix';
    case 'TX': case 'IL': case 'AL': case 'AR': case 'LA': case 'MS': case 'MO': case 'IA':
    case 'KS': case 'NE': case 'ND': case 'SD': case 'MN': case 'WI': case 'OK': case 'TN':
      return 'America/Chicago';
    case 'CO': case 'UT': case 'NM': case 'MT': case 'WY': case 'ID': return 'America/Denver';
    case 'CA': case 'NV': case 'OR': case 'WA': return 'America/Los_Angeles';
    case 'NY': case 'PA': case 'OH': case 'MA': case 'FL': case 'GA': case 'NC': case 'SC':
    case 'VA': case 'MD': case 'NJ': case 'CT': case 'ME': case 'NH': case 'VT': case 'RI':
    case 'DE': case 'WV': case 'KY': case 'IN': case 'MI': return 'America/New_York';
    default: return 'UTC';
  }
}

/** August (DST) UTC offsets in hours for the timezones we model. */
const TZ_OFFSET_HOURS: Record<string, number> = {
  'America/Phoenix': -7,
  'America/Chicago': -5,
  'America/Denver': -6,
  'America/Los_Angeles': -7,
  'America/New_York': -4,
  UTC: 0,
};

function inferState(latitude: number, longitude: number): string | undefined {
  if (latitude < 35.5 && longitude > -115) return 'AZ';
  if (longitude > -98 && latitude < 33 && longitude < -85) return 'TX';
  if (longitude > -98 && latitude >= 33 && longitude < -85) return 'IL';
  return undefined;
}

/** Local hour (0-24, fractional) at the site, from its timezone. */
function localHour(latitude: number, longitude: number, state?: string | null): number {
  const tz = timezoneForState(state ?? inferState(latitude, longitude));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h + m / 60;
}

// Demo heatmap (mirrors /v1/heatmap result)

interface AoiFeature {
  geometry?: { coordinates?: number[][][] };
}
interface AoiShape {
  features?: AoiFeature[];
}

export function demoHeatmapResult(polygonAoi: Record<string, unknown>): Record<string, unknown> {
  // Extract AOI center from the polygon we generated upstream.
  const aoi = polygonAoi as AoiShape;
  const ring = aoi.features?.[0]?.geometry?.coordinates?.[0] ?? [];
  const centerLat = ring.length ? (ring[0][1] + ring[2][1]) / 2 : 35;
  const centerLng = ring.length ? (ring[0][0] + ring[2][0]) / 2 : -95;

  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const rng = mulberry32(hashString(`heat-${centerLat.toFixed(3)}-${centerLng.toFixed(3)}-${hourBucket}`));
  const pseudoState = { state: inferState(centerLat, centerLng) };
  const climate = climateFor(centerLat, centerLng, pseudoState.state);
  const hour = localHour(centerLat, centerLng, pseudoState.state);
  const diurnal = Math.sin(((hour - 9) / 12) * Math.PI); // peaks ~15:00
  const temp =
    climate.baseTempC - climate.diurnalSwingC / 2 + climate.diurnalSwingC / 2 * diurnal + (rng() * 2 - 1);

  return {
    tiles: [
      {
        center: [centerLng, centerLat],
        temperature: Number(temp.toFixed(1)),
      },
    ],
    stats_data: { max_temp: Number(temp.toFixed(1)), min_temp: Number((temp - 3).toFixed(1)) },
  };
}

// Demo env_params (mirrors /v1/env_params result)
// REAL API: 24-point time series + site-local ISO timestamps.
// Demo does the same, so capture path is identical.

function buildTimestamps(tz: string, offsetHours: number): string[] {
  const tzKey = tz in TZ_OFFSET_HOURS ? tz : 'UTC';
  const off = TZ_OFFSET_HOURS[tzKey];
  void offsetHours;
  // Local "today" = UTC shifted by tz offset
  const localNow = new Date(Date.now() + off * 3_600_000);
  const y = localNow.getUTCFullYear();
  const m = String(localNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(localNow.getUTCDate()).padStart(2, '0');
  const sign = off <= 0 ? '+' : '-'; // ISO sign inverted from UTC shift
  const absH = String(Math.abs(off)).padStart(2, '0');
  const suffix = `${sign}${absH}:00`;
  return Array.from({ length: 24 }, (_, h) => {
    const hh = String(h).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:00:00${suffix}`;
  });
}

/** Steadman apparent-temperature style heat index approximation (°C). */
function heatIndexC(tempC: number, rhPct: number): number {
  const e = (rhPct / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return tempC + 0.33 * e - 4.0;
}

export function demoEnvParamsResult(
  latitude: number,
  longitude: number,
  temperature: number,
): Record<string, unknown> {
  const state = inferState(latitude, longitude);
  const tz = timezoneForState(state);
  const hourBucket = Math.floor(Date.now() / 1_800_000); // evolves every 30 min
  const dayKey = new Date().toISOString().slice(0, 10);
  const rng = mulberry32(hashString(`env-${latitude.toFixed(3)}-${longitude.toFixed(3)}-${dayKey}`));

  const climate = climateFor(latitude, longitude, state);
  const hour = localHour(latitude, longitude, state);

  const timestamps = buildTimestamps(tz, TZ_OFFSET_HOURS[tz] ?? 0);

  const wetBulbSeries: number[] = [];
  const aqiSeries: number[] = [];
  const heatIndexSeries: number[] = [];
  const humiditySeries: number[] = [];
  const tempSeries: number[] = [];

  for (let h = 0; h < 24; h++) {
    const diurnal = Math.sin(((h - 9) / 12) * Math.PI); // peaks ~15:00
    const t =
      climate.baseTempC - climate.diurnalSwingC / 2 + climate.diurnalSwingC / 2 * diurnal;
    // High humidity overnight/morning, drops midday
    const rh = Math.max(12, Math.min(96, 70 - 28 * diurnal + (rng() * 8 - 4)));
    // Depression shrinks off-peak (mornings more humid)
    const offPeak = 1 - Math.abs(diurnal);
    const depression = climate.wetBulbDepression * (1 - 0.35 * offPeak);
    const wb = Math.max(16, t - depression + (rng() * 0.8 - 0.4));
    // AQI peaks afternoon (like real urban), so cool mornings are SAFE hours
    const aqi = Math.max(8, climate.aqiBaseline + 16 * diurnal + rng() * 12 - 6);
    wetBulbSeries.push(Number(wb.toFixed(1)));
    aqiSeries.push(Number(aqi.toFixed(0)));
    heatIndexSeries.push(Number(heatIndexC(t, rh).toFixed(1)));
    humiditySeries.push(Number(rh.toFixed(0)));
    tempSeries.push(Number(t.toFixed(1)));
  }
  void hour; // real extractor picks current hour
  void temperature; // ignored

  // GHI: clear-sky scalars (matches real shape)
  const ghi = Math.max(0, Math.cos(((hour - 12) / 12) * Math.PI) * 850);

  return {
    metadata: {
      timezone: tz,
      timezone_offset_hours: TZ_OFFSET_HOURS[tz] ?? 0,
      time_range: { start: timestamps[0], end: timestamps[23], interval: 'PT1H', count: 24 },
      timestamps,
    },
    locations: [
      {
        lat: latitude,
        lon: longitude,
        elevation: 250 + Math.round(rng() * 400),
        temperature,
        parameters: {
          wet_bulb_temperature_celsius: wetBulbSeries,
          'air_quality:idx': aqiSeries,
          heat_index_celsius: heatIndexSeries,
          relative_humidity_percent: humiditySeries,
        },
        solar_irradiance: {
          clear_sky: {
            ghi: Number(ghi.toFixed(1)),
            dni: Number((ghi * 1.19).toFixed(1)),
            dhi: Number((ghi * 0.16).toFixed(1)),
          },
          description:
            'The above values provide insights into the average daytime solar energy available at the specific location.',
        },
      },
    ],
  };
}

// Demo satellite segmentation (mirrors /v1/satellite result)

const SAT_LEGEND: Record<string, [number, number, number]> = {
  building: [180, 120, 120],
  tree: [4, 200, 3],
  'earth, ground': [120, 120, 70],
  plant: [204, 255, 4],
  others: [255, 255, 255],
};

function segmentsForClimate(latitude: number, longitude: number): Record<string, number> {
  const desert = latitude < 35.5 && longitude > -115;
  const gulf = latitude < 33 && longitude > -98 && longitude < -85;
  const urban = !desert && !gulf;
  const base = desert
    ? { building: 14.0, tree: 1.6, 'earth, ground': 48.0, plant: 0.8 }
    : gulf
      ? { building: 28.0, tree: 12.0, 'earth, ground': 22.0, plant: 6.0 }
      : { building: 32.0, tree: 6.5, 'earth, ground': 24.0, plant: 2.5 };
  if (urban) base.building += 4;
  const used = Object.values(base).reduce((a, b) => a + b, 0);
  const others = Math.max(0, 100 - used);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) out[k] = Number(v.toFixed(2));
  out.others = Number(others.toFixed(2));
  return out;
}

/** Build a renderable data-URL "satellite tile" mosaic from segment shares. */
function segmentsToSvgDataUrl(segments: Record<string, number>): string {
  const grid = 15;
  const cells: string[] = [];
  const entries = Object.entries(segments).filter(([k]) => SAT_LEGEND[k]);
  let cellIdx = 0;
  const rng = mulberry32(hashString(JSON.stringify(segments)));
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      // Weighted segment pick for this cell
      let r = rng() * 100;
      let chosen = entries[0]?.[0] ?? 'others';
      for (const [k, v] of entries) {
        if (r < v) { chosen = k; break; }
        r -= v;
      }
      const [cr, cg, cb] = SAT_LEGEND[chosen] ?? [80, 80, 80];
      cells.push(`<rect x="${x * 16}" y="${y * 16}" width="16" height="16" fill="rgb(${cr},${cg},${cb})"/>`);
      cellIdx++;
    }
  }
  void cellIdx;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#1a1a2e"/>${cells.join('')}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function demoSatelliteResult(latitude: number, longitude: number): Record<string, unknown> {
  const segments = segmentsForClimate(latitude, longitude);
  const imgUrl = segmentsToSvgDataUrl(segments);
  return {
    coordinates: { latitude: String(latitude), longitude: String(longitude) },
    image_year: '2026',
    original_image: imgUrl,
    segmentation: {
      request_id: `demo-${hashString(`${latitude},${longitude}`).toString(16).slice(0, 8)}`,
      processing_time_seconds: 3.2,
      image_dimensions: { width: 240, height: 240 },
      mode: 'sat',
      segments,
      image_legend: SAT_LEGEND,
      image_content: imgUrl,
    },
  };
}

// Demo street view segmentation (mirrors /v1/streetview result)

const SV_LEGEND: Record<string, [number, number, number]> = {
  building: [150, 100, 100],
  road: [90, 90, 95],
  vegetation: [30, 160, 40],
  sky: [110, 160, 220],
};

function svSvgDataUrl(): string {
  const rng = mulberry32(hashString(`sv-${new Date().toISOString().slice(0, 10)}`));
  const parts: string[] = [];
  // Sky top, road bottom, buildings + vegetation between
  parts.push(`<rect x="0" y="0" width="240" height="70" fill="rgb(110,160,220)"/>`);
  parts.push(`<rect x="0" y="170" width="240" height="70" fill="rgb(90,90,95)"/>`);
  let x = 0;
  while (x < 240) {
    const w = 30 + Math.round(rng() * 45);
    const h = 55 + Math.round(rng() * 75);
    if (rng() > 0.35) {
      parts.push(`<rect x="${x}" y="${170 - h}" width="${w}" height="${h}" fill="rgb(150,100,100)"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${170 - h * 0.6}" width="${w}" height="${h * 0.6}" fill="rgb(30,160,40)"/>`);
      parts.push(`<rect x="${x + w / 2 - 2}" y="${170 - h}" width="4" height="${h * 0.4}" fill="rgb(60,110,50)"/>`);
    }
    x += w + 2;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">${parts.join('')}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function demoStreetViewResult(latitude: number, longitude: number): Record<string, unknown> {
  const url = svSvgDataUrl();
  const rng = mulberry32(hashString(`svq-${latitude.toFixed(2)},${longitude.toFixed(2)}`));
  return {
    coordinates: { latitude: String(latitude), longitude: String(longitude) },
    front: {
      original_image: url,
      segmented: {
        building: `${(35 + rng() * 20).toFixed(1)}%`,
        road: `${(22 + rng() * 12).toFixed(1)}%`,
        vegetation: `${(8 + rng() * 12).toFixed(1)}%`,
        sky: `${(12 + rng() * 8).toFixed(1)}%`,
      },
      image_data_url: url,
      segmented_image: url,
      image_date: '2026-05-14',
    },
  };
}

// Demo Heat Intelligence PDF
// Real: pre-signed download link to PDF.
// Demo: synthesize a real PDF so the full flow works end-to-end.

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Minimal but valid single-page PDF with a title + wrapped text lines. */
export function buildDemoPdf(title: string, lines: string[]): Buffer {
  const objects: string[] = [];
  const content: string[] = ['BT', '/F1 18 Tf', `1 0 0 1 56 760 Tm`, `(${pdfEscape(title)}) Tj`, 'ET'];
  let y = 730;
  for (const line of lines) {
    content.push('BT', '/F1 10 Tf', `1 0 0 1 56 ${y} Tm`, `(${pdfEscape(line)}) Tj`, 'ET');
    y -= 16;
    if (y < 40) break; // one page is fine for demo
  }
  const contentStr = content.join('\n');

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[5] = `<< /Length ${Buffer.byteLength(contentStr, 'latin1')} >>\nstream\n${contentStr}\nendstream`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

export function demoHeatIntelligenceResult(
  siteLabel: string,
  tempC: number,
  wetBulbC: number | null,
  sviOverall: number | null,
): { downloadLink: string | null; result: Record<string, unknown>; pdfBase64: string } {
  const wb = wetBulbC ?? 26.0;
  const svi = sviOverall ?? 0.5;
  const lines = [
    `Site: ${siteLabel}`,
    `Generated: ${new Date().toISOString()}  (demo mode - simulated FortyGuard Heat Intelligence)`,
    '',
    `Air temperature: ${tempC.toFixed(1)} C    Wet-bulb: ${wb.toFixed(1)} C`,
    `CDC SVI (RPL Themes): ${(svi * 100).toFixed(1)} percentile`,
    '',
    'KEY FINDINGS',
    `- Peak heat window: 12:00-17:00 local (wet-bulb ${
      wb >= 30 ? 'exceeds NIOSH danger threshold' : 'approaching advisory threshold'
    })`,
    '- Urban surface context: high solar absorption, limited tree canopy',
    '- Anthropogenic heat sources: machinery + paving activity compound radiant load',
    '',
    'RECOMMENDED ACTIONS',
    '- Shift heavy exertion to 05:00-10:00 local',
    '- Deploy shaded rest stations and hydration points by 10:00',
    '- Acclimatize new crew members over 14 days per OSHA guidance',
  ];
  const pdf = buildDemoPdf(`ThermalOps Heat Intelligence Report - ${siteLabel}`, lines);
  return {
    downloadLink: null,
    result: {
      demo: true,
      generated_at: new Date().toISOString(),
      modules: ['environmental', 'urban', 'anthropogenic'],
    },
    pdfBase64: pdf.toString('base64'),
  };
}

// Re-export the Site type so demo helpers can be typed without extra imports.
export type { Site };

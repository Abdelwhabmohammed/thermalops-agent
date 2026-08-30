// State Watch: curated sentinel sweep per state (regional triage layer).
// Each state has real work locations (yards, depots, campuses). We sweep
// them through a free instant chain: Open-Meteo, wet-bulb calc, AQI, SVI, scoring.
// Zero credits spent — only used when operator promotes a sentinel to monitored.
// Results cached 10min per state, coalescing concurrent requests.

import type { AgentAction, RiskLevel, WetBulbTier } from './schemas';
import { assess } from './risk-scorer';
import { sviLookup } from './svi';
import { fetchCurrentConditions, stullWetBulb } from './weather';

// -- Curated catalog ----------------------------------------------------------------

export interface SentinelDef {
    id: string; // stable slug — used as React/map key
    label: string; // human name shown in UI + used as site label on register
    lat: number;
    lng: number;
    city: string;
    type: string; // construction | logistics | municipal | agriculture | industrial
    crewSize: number; // nominal crew exposure for the rollup
}

export interface StateDef {
    code: string; // USPS two-letter code
    name: string;
    sentinels: SentinelDef[];
}

// Order = heat-relevance for the demo (Phoenix first). All coordinates are
// real, named districts inside the hackathon's continental-US bounds.
export const STATE_CATALOG: readonly StateDef[] = [
    {
        code: 'AZ',
        name: 'Arizona',
        sentinels: [
            { id: 'az-phx-downtown', label: 'Phoenix Downtown Yard', lat: 33.4484, lng: -112.0740, city: 'Phoenix', type: 'construction', crewSize: 24 },
            { id: 'az-phx-south-mtn', label: 'South Mountain Works', lat: 33.3850, lng: -112.0820, city: 'Phoenix', type: 'construction', crewSize: 18 },
            { id: 'az-tempe-asu', label: 'Tempe ASU Campus', lat: 33.4255, lng: -111.9390, city: 'Tempe', type: 'municipal', crewSize: 15 },
            { id: 'az-sky-harbor', label: 'Sky Harbor Cargo', lat: 33.4342, lng: -112.0089, city: 'Phoenix', type: 'logistics', crewSize: 30 },
            { id: 'az-mesa-hub', label: 'Mesa Distribution Hub', lat: 33.4152, lng: -111.8315, city: 'Mesa', type: 'logistics', crewSize: 22 },
            { id: 'az-glendale', label: 'Glendale Stadium District', lat: 33.5280, lng: -112.2630, city: 'Glendale', type: 'municipal', crewSize: 12 },
        ],
    },
    {
        code: 'TX',
        name: 'Texas',
        sentinels: [
            { id: 'tx-hou-east-end', label: 'Houston East End Terminal', lat: 29.7560, lng: -95.3170, city: 'Houston', type: 'logistics', crewSize: 28 },
            { id: 'tx-hou-sunnyside', label: 'Houston Sunnyside Yard', lat: 29.6700, lng: -95.3900, city: 'Houston', type: 'construction', crewSize: 16 },
            { id: 'tx-dal-trinity', label: 'Dallas Trinity Works', lat: 32.7767, lng: -96.7970, city: 'Dallas', type: 'construction', crewSize: 20 },
            { id: 'tx-aus-riverside', label: 'Austin Riverside Site', lat: 30.2672, lng: -97.7431, city: 'Austin', type: 'construction', crewSize: 14 },
            { id: 'tx-sa-depot', label: 'San Antonio Depot', lat: 29.4241, lng: -98.4936, city: 'San Antonio', type: 'logistics', crewSize: 18 },
        ],
    },
    {
        code: 'NV',
        name: 'Nevada',
        sentinels: [
            { id: 'nv-strip-works', label: 'Las Vegas Strip Works', lat: 36.1147, lng: -115.1728, city: 'Las Vegas', type: 'construction', crewSize: 22 },
            { id: 'nv-sunrise-manor', label: 'Sunrise Manor Site', lat: 36.2111, lng: -115.0744, city: 'Las Vegas', type: 'construction', crewSize: 12 },
            { id: 'nv-nlv-yard', label: 'North Las Vegas Yard', lat: 36.1989, lng: -115.1175, city: 'North Las Vegas', type: 'logistics', crewSize: 15 },
            { id: 'nv-enterprise', label: 'Enterprise Depot', lat: 36.0250, lng: -115.2740, city: 'Las Vegas', type: 'logistics', crewSize: 10 },
        ],
    },
    {
        code: 'FL',
        name: 'Florida',
        sentinels: [
            { id: 'fl-mia-downtown', label: 'Miami Downtown', lat: 25.7743, lng: -80.1937, city: 'Miami', type: 'construction', crewSize: 20 },
            { id: 'fl-mia-cargo', label: 'MIA Airport Cargo', lat: 25.7959, lng: -80.2870, city: 'Miami', type: 'logistics', crewSize: 24 },
            { id: 'fl-homestead-ag', label: 'Homestead Ag Hub', lat: 25.4687, lng: -80.4473, city: 'Homestead', type: 'agriculture', crewSize: 30 },
            { id: 'fl-tampa-port', label: 'Tampa Port Works', lat: 27.9506, lng: -82.4613, city: 'Tampa', type: 'logistics', crewSize: 18 },
        ],
    },
    {
        code: 'CA',
        name: 'California',
        sentinels: [
            { id: 'ca-dtla', label: 'Downtown LA', lat: 34.0522, lng: -118.2437, city: 'Los Angeles', type: 'construction', crewSize: 25 },
            { id: 'ca-fresno-ag', label: 'Fresno Ag Hub', lat: 36.7378, lng: -119.7871, city: 'Fresno', type: 'agriculture', crewSize: 28 },
            { id: 'ca-sac-railyards', label: 'Sacramento Railyards', lat: 38.5816, lng: -121.4944, city: 'Sacramento', type: 'construction', crewSize: 16 },
            { id: 'ca-el-centro', label: 'El Centro Depot', lat: 32.7920, lng: -115.5630, city: 'El Centro', type: 'logistics', crewSize: 14 },
        ],
    },
    {
        code: 'IL',
        name: 'Illinois',
        sentinels: [
            { id: 'il-west-loop', label: 'Chicago West Loop', lat: 41.8858, lng: -87.6516, city: 'Chicago', type: 'construction', crewSize: 20 },
            { id: 'il-south-works', label: 'South Works Site', lat: 41.7180, lng: -87.5580, city: 'Chicago', type: 'construction', crewSize: 15 },
            { id: 'il-ohare-cargo', label: "O'Hare Cargo", lat: 41.9803, lng: -87.9090, city: 'Chicago', type: 'logistics', crewSize: 26 },
            { id: 'il-midway-depot', label: 'Midway Depot', lat: 41.7868, lng: -87.7522, city: 'Chicago', type: 'logistics', crewSize: 12 },
        ],
    },
    {
        code: 'MA',
        name: 'Massachusetts',
        sentinels: [
            { id: 'ma-seaport', label: 'Boston Seaport', lat: 42.3517, lng: -71.0444, city: 'Boston', type: 'construction', crewSize: 18 },
            { id: 'ma-dorchester', label: 'Dorchester Fields', lat: 42.3016, lng: -71.0576, city: 'Boston', type: 'municipal', crewSize: 10 },
            { id: 'ma-kendall', label: 'Cambridge Kendall Sq', lat: 42.3629, lng: -71.0901, city: 'Cambridge', type: 'construction', crewSize: 14 },
            { id: 'ma-allston', label: 'Allston Railyard', lat: 42.3601, lng: -71.1355, city: 'Boston', type: 'logistics', crewSize: 12 },
            { id: 'ma-quincy', label: 'Quincy Shipyard', lat: 42.2489, lng: -71.0068, city: 'Quincy', type: 'industrial', crewSize: 16 },
        ],
    },
];

export function findStateDef(code: string): StateDef | undefined {
    const c = code.trim().toUpperCase();
    return STATE_CATALOG.find((s) => s.code === c);
}

// -- Sweep types ----------------------------------------------------------------------

export interface SentinelReading {
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    city: string;
    site_type: string;
    crew_size: number;
    temp_c: number | null;
    humidity_pct: number | null;
    wet_bulb_c: number | null;
    aqi: number | null;
    svi_pct: number | null; // CDC SVI RPL_THEMES percentile (0-100)
    tier: WetBulbTier | null;
    risk_level: RiskLevel | null;
    action: AgentAction | null;
    composite_score: number | null;
    source: string | null;
    error: string | null;
    monitored_site_id: number | null; // set when a registered site already covers this point
}

export interface StateSweepSummary {
    total: number;
    monitored: number;
    elevated: number;
    critical: number;
    crews_exposed: number; // crew sum of UNMONITORED elevated+critical sentinels
    avg_wet_bulb_c: number | null;
}

export interface StateSweepResult {
    state: string;
    state_name: string;
    swept_at: string;
    cached: boolean;
    sentinels: SentinelReading[];
    summary: StateSweepSummary;
}

// -- Free instant reading (same chain as the single-pin probe) --------------------------

async function readSentinel(s: SentinelDef): Promise<SentinelReading> {
    const base = {
        id: s.id,
        label: s.label,
        latitude: s.lat,
        longitude: s.lng,
        city: s.city,
        site_type: s.type,
        crew_size: s.crewSize,
    };

    // SVI is soft-fail — a sweep must never die on one bad census lookup.
    let sviPct: number | null = null;
    try {
        const sv = await sviLookup(s.lat, s.lng);
        if (sv?.rplThemes != null && sv.rplThemes >= 0) sviPct = Math.round(sv.rplThemes * 100);
    } catch {
        /* no CSV / geocoder hiccup — keep going */
    }

    try {
        const wx = await fetchCurrentConditions(s.lat, s.lng);
        if (wx.tempC === null) {
            return {
                ...base,
                temp_c: null,
                humidity_pct: wx.humidityPct,
                wet_bulb_c: null,
                aqi: wx.aqi,
                svi_pct: sviPct,
                tier: null,
                risk_level: null,
                action: null,
                composite_score: null,
                source: null,
                error: 'weather lookup failed',
                monitored_site_id: null,
            };
        }
        const wetBulbC =
            wx.humidityPct !== null && wx.humidityPct >= 5
                ? stullWetBulb(wx.tempC, wx.humidityPct)
                : null;
        const a = assess({
            tempC: wx.tempC,
            wetBulbC,
            aqi: wx.aqi,
            solarGhi: null,
            sviOverall: sviPct !== null ? sviPct / 100 : null,
            sviHousingTransport: null,
            crewSize: s.crewSize,
        });
        return {
            ...base,
            temp_c: wx.tempC,
            humidity_pct: wx.humidityPct,
            wet_bulb_c: wetBulbC !== null ? Number(wetBulbC.toFixed(1)) : null,
            aqi: wx.aqi,
            svi_pct: sviPct,
            tier: a.wetBulbTier,
            risk_level: a.ruleRiskLevel,
            action: a.ruleAction,
            composite_score: Number(a.compositeScore.toFixed(0)),
            source: `${wx.source} + Stull (2011)`,
            error: null,
            monitored_site_id: null,
        };
    } catch (e) {
        return {
            ...base,
            temp_c: null,
            humidity_pct: null,
            wet_bulb_c: null,
            aqi: null,
            svi_pct: sviPct,
            tier: null,
            risk_level: null,
            action: null,
            composite_score: null,
            source: null,
            error: String((e as Error).message || e).slice(0, 140),
            monitored_site_id: null,
        };
    }
}

// -- Monitored-site dedupe -------------------------------------------------------------

const MONITORED_RADIUS_M = 1500; // a registered site within 1.5 km covers a sentinel

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6_371_000;
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function findMonitoredSite(
    lat: number,
    lng: number,
    sites: Array<{ id: number; latitude: number; longitude: number }>,
): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const site of sites) {
        // cheap prefilter before the trig
        if (Math.abs(site.latitude - lat) > 0.05 || Math.abs(site.longitude - lng) > 0.05) continue;
        const d = haversineMeters(lat, lng, site.latitude, site.longitude);
        if (d < bestDist) {
            bestDist = d;
            best = site.id;
        }
    }
    return bestDist <= MONITORED_RADIUS_M ? best : null;
}

// -- Sweep engine ----------------------------------------------------------------------

const SWEEP_TTL_MS = 10 * 60 * 1000;

// globalThis survives Next dev HMR module swaps (same pattern as svi.ts).
const globalForSweep = globalThis as unknown as {
    thermalopsSweepCache?: Map<string, { at: number; result: StateSweepResult }>;
    thermalopsSweepInFlight?: Map<string, Promise<StateSweepResult>>;
};
const sweepCache: Map<string, { at: number; result: StateSweepResult }> =
    (globalForSweep.thermalopsSweepCache ??= new Map());
const sweepInFlight: Map<string, Promise<StateSweepResult>> =
    (globalForSweep.thermalopsSweepInFlight ??= new Map());

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const idx = next++;
            results[idx] = await fn(items[idx]);
        }
    });
    await Promise.all(workers);
    return results;
}

export async function sweepState(
    code: string,
    monitoredSites: Array<{ id: number; latitude: number; longitude: number }>,
    fresh = false,
): Promise<StateSweepResult> {
    const def = findStateDef(code);
    if (!def) throw new Error(`unknown state code: ${code}`);

    const cacheKey = def.code;
    if (!fresh) {
        const hit = sweepCache.get(cacheKey);
        if (hit && Date.now() - hit.at < SWEEP_TTL_MS) {
            return { ...hit.result, cached: true };
        }
        const inflight = sweepInFlight.get(cacheKey);
        if (inflight) return inflight;
    }

    const promise = (async (): Promise<StateSweepResult> => {
        const started = Date.now();
        // Concurrency 3 — polite to Open-Meteo / NWS / Census.
        const readings = await mapWithConcurrency(def.sentinels, 3, readSentinel);

        const sentinels = readings.map((r) => ({
            ...r,
            monitored_site_id: findMonitoredSite(r.latitude, r.longitude, monitoredSites),
        }));

        const withWb = sentinels.filter((s) => s.wet_bulb_c !== null);
        const summary: StateSweepSummary = {
            total: sentinels.length,
            monitored: sentinels.filter((s) => s.monitored_site_id !== null).length,
            elevated: sentinels.filter((s) => s.risk_level === 'ELEVATED').length,
            critical: sentinels.filter((s) => s.risk_level === 'CRITICAL').length,
            crews_exposed: sentinels
                .filter(
                    (s) =>
                        s.monitored_site_id === null &&
                        (s.risk_level === 'ELEVATED' || s.risk_level === 'CRITICAL'),
                )
                .reduce((acc, s) => acc + s.crew_size, 0),
            avg_wet_bulb_c:
                withWb.length > 0
                    ? Number((withWb.reduce((a, s) => a + (s.wet_bulb_c ?? 0), 0) / withWb.length).toFixed(1))
                    : null,
        };

        const result: StateSweepResult = {
            state: def.code,
            state_name: def.name,
            swept_at: new Date().toISOString(),
            cached: false,
            sentinels,
            summary,
        };

        sweepCache.set(cacheKey, { at: Date.now(), result });
        console.log(
            `[state-watch] swept ${def.code}: ${summary.elevated} elevated / ${summary.critical} critical ` +
            `of ${summary.total} sentinels in ${Date.now() - started}ms ` +
            `(${summary.monitored} already monitored)`,
        );
        return result;
    })();

    sweepInFlight.set(cacheKey, promise);
    try {
        return await promise;
    } finally {
        sweepInFlight.delete(cacheKey);
    }
}

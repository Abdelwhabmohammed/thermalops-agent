// Scout conditions for any map coordinate (instant weather or deep satellite thermal).

import { NextRequest, NextResponse } from 'next/server';
import { FortyGuardClient, makeSmallAoi, extractTileTemperature } from '@/lib/server/fortyguard';
import { assess } from '@/lib/server/risk-scorer';
import { sviLookup } from '@/lib/server/svi';
import { fetchCurrentConditions } from '@/lib/server/weather';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// US geographic bounds for service coverage
const US_LAT_MIN = 24.0, US_LAT_MAX = 49.5, US_LNG_MIN = -125.0, US_LNG_MAX = -66.5;

const STATE_FIPS: Record<string, string> = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
    '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL',
    '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
    '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE',
    '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
    '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
    '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV',
    '55': 'WI', '56': 'WY', '72': 'PR',
};

// Stull wet-bulb estimation from temp and relative humidity.
function stullWetBulb(tempC: number, rh: number): number {
    return (
        tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
        Math.atan(tempC + rh) -
        Math.atan(rh - 1.676331) +
        0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
        4.686035
    );
}

export async function POST(req: NextRequest) {
    let body: Record<string, unknown>;
    try {
        body = (await req.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const deep = body.deep === true;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return NextResponse.json({ error: 'latitude/longitude required' }, { status: 400 });
    }
    if (latitude < US_LAT_MIN || latitude > US_LAT_MAX || longitude < US_LNG_MIN || longitude > US_LNG_MAX) {
        return NextResponse.json(
            { error: `outside coverage — this build monitors continental US (24–49.5°N, 125–66.5°W)` },
            { status: 400 },
        );
    }

    // SVI and location lookup
    let svi: {
        county: string | null;
        tract: string | null;
        rplThemes: number | null;
        stateCode: string | null;
    } | null = null;
    try {
        const s = await sviLookup(latitude, longitude);
        if (s) {
            svi = {
                county: s.countyName,
                tract: s.tractName,
                rplThemes: s.rplThemes,
                stateCode: STATE_FIPS[s.fipsTract.slice(0, 2)] ?? null,
            };
        }
    } catch (e) {
        console.warn(`[probe] SVI lookup failed: ${String(e).slice(0, 120)}`);
    }

    // Instant weather conditions
    const wx = await fetchCurrentConditions(latitude, longitude);
    let instant: Record<string, unknown> | null = null;
    if (wx.tempC !== null) {
        const wetBulbC =
            wx.humidityPct !== null && wx.humidityPct >= 5 ? stullWetBulb(wx.tempC, wx.humidityPct) : null;
        const a = assess({
            tempC: wx.tempC,
            wetBulbC,
            aqi: wx.aqi,
            solarGhi: null,
            sviOverall: svi?.rplThemes ?? null,
            sviHousingTransport: null,
            crewSize: 0, // unknown at probe time
        });
        instant = {
            temp_c: wx.tempC,
            humidity_pct: wx.humidityPct,
            aqi: wx.aqi,
            wet_bulb_c: wetBulbC !== null ? Number(wetBulbC.toFixed(1)) : null,
            wet_bulb_estimated: true,
            tier: a.wetBulbTier,
            risk_level: a.ruleRiskLevel,
            action: a.ruleAction,
            composite_score: Number(a.compositeScore.toFixed(0)),
            source: `${wx.source} + Stull (2011)`,
        };
    }

    // Optional FortyGuard satellite thermal probe
    let deepResult: Record<string, unknown> | null = null;
    if (deep) {
        try {
            const fg = new FortyGuardClient();
            const now = new Date();
            const result = await fg.callHeatmapBlocking({
                polygonAoi: makeSmallAoi(latitude, longitude, 100),
                startDate: now.toISOString().slice(0, 10),
                startTime: now.toISOString().slice(11, 16),
                granularity: 100,
            });
            const tileTemp = extractTileTemperature(result, latitude, longitude);
            const stats = (result.stats_data as Record<string, unknown> | undefined) ?? null;
            deepResult = {
                temp_c: tileTemp,
                stats,
                source: 'fortyguard /v1/heatmap (satellite-derived land surface)',
            };
        } catch (e) {
            deepResult = { error: String((e as Error).message || e) };
        }
    }

    // Suggested site name and location
    const city = svi?.county ? svi.county.replace(/ County$/i, '') : null;
    const state = svi?.stateCode ?? null;
    const label =
        city && state
            ? `${city} pin — ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
            : `Pin — ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`;

    return NextResponse.json({
        latitude,
        longitude,
        instant,
        deep: deepResult,
        svi,
        suggested: { label, city, state },
    });
}
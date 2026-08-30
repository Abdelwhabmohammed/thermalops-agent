
const NWS_HEADERS = { 'User-Agent': 'ThermalOps-Agent/1.0 (heat-safety monitoring)' };

/**
 * Stull (2011) wet-bulb approximation from dry-bulb temp (°C) + RH (%).
 * Valid for RH 5–99%, −20…50 °C — RMS error ~0.3 °C. Labeled "estimated"
 * in the UI; registered sites switch to FortyGuard env_params wet-bulb.
 *
 * Shared by the map probe (single pin) and the state-watch sentinel sweep.
 */
export function stullWetBulb(tempC: number, rh: number): number {
    return (
        tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
        Math.atan(tempC + rh) -
        Math.atan(rh - 1.676331) +
        0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
        4.686035
    );
}

export interface CurrentConditions {
    tempC: number | null;
    humidityPct: number | null;
    aqi: number | null;
    source: string; // which chain produced the temp reading
}

export async function fetchOpenMeteoConditions(
    lat: number,
    lng: number,
): Promise<{ tempC: number | null; humidityPct: number | null; aqi: number | null }> {
    const out = { tempC: null as number | null, humidityPct: null as number | null, aqi: null as number | null };
    const [wx, aq] = await Promise.allSettled([
        fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
            `&current=temperature_2m,relative_humidity_2m&temperature_unit=celsius`,
            { signal: AbortSignal.timeout(10_000) },
        ).then(async (r) => {
            if (!r.ok) throw new Error(`open-meteo ${r.status}`);
            const d = (await r.json()) as {
                current?: { temperature_2m?: number; relative_humidity_2m?: number };
            };
            out.tempC = d.current?.temperature_2m ?? null;
            out.humidityPct = d.current?.relative_humidity_2m ?? null;
        }),
        fetch(
            `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}` +
            `&current=us_aqi`,
            { signal: AbortSignal.timeout(10_000) },
        ).then(async (r) => {
            if (!r.ok) throw new Error(`open-meteo-aqi ${r.status}`);
            const d = (await r.json()) as { current?: { us_aqi?: number } };
            out.aqi = d.current?.us_aqi ?? null;
        }),
    ]);
    if (wx.status === 'rejected') console.warn('[weather] open-meteo failed:', String(wx.reason));
    if (aq.status === 'rejected') console.warn('[weather] open-meteo aqi failed:', String(aq.reason));
    return out;
}

// Station observation URLs cached per rounded point (~1 km) — repeat lookups
// collapse to a single hop.
const nwsStationCache = new Map<string, string>();

async function fetchNwsStationObsUrl(lat: number, lng: number): Promise<string | null> {
    const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const cached = nwsStationCache.get(key);
    if (cached) return cached;

    // api.weather.gov/points → properties.observationStations → features[0].id
    const points = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, {
        headers: NWS_HEADERS,
        signal: AbortSignal.timeout(8_000),
    });
    if (!points.ok) return null;
    const p = (await points.json()) as { properties?: { observationStations?: string } };
    const stationsUrl = p.properties?.observationStations;
    if (!stationsUrl) return null;

    const stations = await fetch(stationsUrl, { headers: NWS_HEADERS, signal: AbortSignal.timeout(8_000) });
    if (!stations.ok) return null;
    const s = (await stations.json()) as { features?: Array<{ id?: string }> };
    const stationId = s.features?.[0]?.id; // e.g. https://api.weather.gov/stations/KMDW
    if (!stationId) return null;

    const obsUrl = `${stationId.replace(/\/$/, '')}/observations/latest`;
    nwsStationCache.set(key, obsUrl);
    return obsUrl;
}

export async function fetchNwsConditions(
    lat: number,
    lng: number,
): Promise<{ tempC: number | null; humidityPct: number | null }> {
    try {
        const obsUrl = await fetchNwsStationObsUrl(lat, lng);
        if (!obsUrl) return { tempC: null, humidityPct: null };
        const r = await fetch(obsUrl, { headers: NWS_HEADERS, signal: AbortSignal.timeout(8_000) });
        if (!r.ok) return { tempC: null, humidityPct: null };
        const d = (await r.json()) as {
            properties?: {
                temperature?: { value?: number | null };
                relativeHumidity?: { value?: number | null };
            };
        };
        const t = d.properties?.temperature?.value;
        const h = d.properties?.relativeHumidity?.value;
        return {
            tempC: typeof t === 'number' && Number.isFinite(t) ? t : null,
            humidityPct: typeof h === 'number' && Number.isFinite(h) ? h : null,
        };
    } catch {
        return { tempC: null, humidityPct: null };
    }
}

/** Open-Meteo first, official NWS observation as fallback. */
export async function fetchCurrentConditions(lat: number, lng: number): Promise<CurrentConditions> {
    const om = await fetchOpenMeteoConditions(lat, lng);
    if (om.tempC !== null) {
        return { tempC: om.tempC, humidityPct: om.humidityPct, aqi: om.aqi, source: 'open-meteo' };
    }
    console.warn('[weather] open-meteo unavailable — falling back to NWS station observation');
    const nws = await fetchNwsConditions(lat, lng);
    if (nws.tempC !== null) {
        return {
            tempC: nws.tempC,
            humidityPct: om.humidityPct ?? nws.humidityPct,
            aqi: om.aqi,
            source: 'nws-station',
        };
    }
    return { tempC: null, humidityPct: om.humidityPct, aqi: om.aqi, source: 'none' };
}

// /api/sites — GET (list with latest decision state) and POST (register).
// POST triggers the Census Geocoder + SVI lookup eagerly, then kicks an
// initial heatmap fetch (via after()) so the next poll cycle has a temperature.

import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { sviLookup } from '@/lib/server/svi';
import { FortyGuardClient, makeSmallAoi, extractTileTemperature } from '@/lib/server/fortyguard';
import { config, isDemoMode } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

// -- GET /api/sites ----------------------------------------------------------------

export async function GET(req: NextRequest) {
  const includeInactive = ['1', 'true', 'yes'].includes(
    (req.nextUrl.searchParams.get('include_inactive') ?? '0').toLowerCase(),
  );

  const sites = await db.site.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { id: 'asc' },
    include: { svi: true, polling: true },
  });

  const enriched = await Promise.all(
    sites.map(async (s) => {
      const lastEvent = await db.event.findFirst({
        where: { siteId: s.id },
        orderBy: { id: 'desc' },
      });
      return {
        id: s.id,
        label: s.label,
        latitude: s.latitude,
        longitude: s.longitude,
        city: s.city,
        state: s.state,
        site_type: s.siteType,
        crew_size: s.crewSize,
        is_active: s.isActive,
        created_at: s.createdAt.toISOString(),
        current_risk_level: s.polling?.lastDecisionRisk ?? null,
        current_action: s.polling?.lastDecisionAction ?? null,
        current_confidence: s.polling?.lastDecisionConfidence ?? null,
        current_temp_c: s.polling?.lastHeatmapTempC ?? null,
        current_temp_at: s.polling?.lastHeatmapAt?.toISOString() ?? null,
        last_env_params_at: s.polling?.lastEnvParamsAt?.toISOString() ?? null,
        svi_overall: s.svi?.rplThemes ?? null,
        svi_housing_transport: s.svi?.rplTheme4 ?? null,
        fips_tract: s.svi?.fipsTract ?? null,
        last_event_id: lastEvent?.id ?? null,
        last_event_at: lastEvent?.polledAt.toISOString() ?? null,
      };
    }),
  );

  return NextResponse.json({ sites: enriched, count: enriched.length });
}

// -- POST /api/sites ------------------------------------------------------------------

async function initialHeatmapFetch(siteId: number, lat: number, lng: number): Promise<void> {
  try {
    const fg = new FortyGuardClient();
    const now = new Date();
    const result = await fg.callHeatmapBlocking({
      polygonAoi: makeSmallAoi(lat, lng, 100),
      startDate: now.toISOString().slice(0, 10),
      startTime: now.toISOString().slice(11, 16),
      granularity: 100,
    });
    const tempC = extractTileTemperature(result, lat, lng);
    if (tempC !== null) {
      await db.pollingState.upsert({
        where: { siteId },
        create: { siteId, lastHeatmapTempC: tempC, lastHeatmapAt: now },
        update: { lastHeatmapTempC: tempC, lastHeatmapAt: now },
      });
      console.log(`[sites] initial heatmap for site ${siteId}: ${tempC.toFixed(1)}°C`);
    } else {
      console.warn(`[sites] initial heatmap for site ${siteId}: temp extraction failed`);
    }
  } catch (e) {
    console.error(`[sites] initial heatmap fetch failed for site ${siteId}: ${String(e)}`);
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const label = body.label as string | undefined;
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);

  if (!label || body.latitude === undefined || body.longitude === undefined) {
    return NextResponse.json(
      { error: 'label, latitude, longitude are required' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'latitude/longitude must be numbers' }, { status: 400 });
  }
  if (!(-90 <= lat && lat <= 90) || !(-180 <= lng && lng <= 180)) {
    return NextResponse.json({ error: 'latitude/longitude out of range' }, { status: 400 });
  }

  // US-only
  if (!(24.0 <= lat && lat <= 49.5 && -125.0 <= lng && lng <= -66.5)) {
    return NextResponse.json(
      {
        error:
          'FortyGuard hackathon requires U.S. locations only. ' +
          'Latitude must be 24-49.5, longitude -125 to -66.5.',
      },
      { status: 400 },
    );
  }

  const site = await db.site.create({
    data: {
      label,
      latitude: lat,
      longitude: lng,
      city: (body.city as string) ?? null,
      state: (body.state as string) ?? null,
      siteType: (body.site_type as string) ?? 'construction',
      crewSize: Math.trunc(Number(body.crew_size ?? 0)) || 0,
      notes: (body.notes as string) ?? null,
    },
  });

  let sviError: string | null = null;
  try {
    const sviData = await sviLookup(lat, lng);
    if (sviData) {
      await db.sviCache.upsert({
        where: { siteId: site.id },
        create: {
          siteId: site.id,
          fipsTract: sviData.fipsTract,
          countyName: sviData.countyName,
          tractName: sviData.tractName,
          rplThemes: sviData.rplThemes,
          rplTheme1: sviData.rplTheme1,
          rplTheme2: sviData.rplTheme2,
          rplTheme3: sviData.rplTheme3,
          rplTheme4: sviData.rplTheme4,
        },
        update: {
          fipsTract: sviData.fipsTract,
          countyName: sviData.countyName,
          tractName: sviData.tractName,
          rplThemes: sviData.rplThemes,
          rplTheme1: sviData.rplTheme1,
          rplTheme2: sviData.rplTheme2,
          rplTheme3: sviData.rplTheme3,
          rplTheme4: sviData.rplTheme4,
        },
      });
    } else {
      sviError = 'Census geocoder or SVI lookup returned no data for these coordinates';
    }
  } catch (e) {
    console.warn(`[sites] SVI lookup failed for site ${site.id}: ${String(e)}`);
    sviError = String(e);
  }

  // Initial heatmap fetch — runs after the response is flushed
  let heatmapStatus = 'skipped (no api key)';
  if (config.fortyguard.apiKey.length > 0 || isDemoMode()) {
    after(() => initialHeatmapFetch(site.id, lat, lng));
    heatmapStatus = 'scheduled';
  }

  return NextResponse.json(
    {
      site_id: site.id,
      label,
      latitude: lat,
      longitude: lng,
      svi_lookup_status: sviError ? 'failed' : 'ok',
      svi_error: sviError,
      initial_heatmap: heatmapStatus,
      message: 'Site registered.',
    },
    { status: 201 },
  );
}

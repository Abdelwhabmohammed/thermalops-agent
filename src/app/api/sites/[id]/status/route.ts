// current status + last 20 events for a site.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

import { sviLookup } from '@/lib/server/svi';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) {
    return NextResponse.json({ error: 'invalid site id' }, { status: 400 });
  }

  const site = await db.site.findUnique({
    where: { id: siteId },
    include: { svi: true, polling: true },
  });
  if (!site) return NextResponse.json({ error: 'site not found' }, { status: 404 });

  // Self-heal: populate SVI if not yet cached
  if (!site.svi) {
    try {
      const svi = await sviLookup(site.latitude, site.longitude);
      if (svi) {
        site.svi = await db.sviCache.upsert({
          where: { siteId: site.id },
          create: { siteId: site.id, ...svi },
          update: { ...svi },
        });
      }
    } catch {
      // ignore
    }
  }

  const events = await db.event.findMany({
    where: { siteId },
    orderBy: { id: 'desc' },
    take: 20,
  });

  return NextResponse.json({
    site_id: siteId,
    label: site.label,
    latitude: site.latitude,
    longitude: site.longitude,
    city: site.city,
    state: site.state,
    current_risk_level: site.polling?.lastDecisionRisk ?? null,
    current_action: site.polling?.lastDecisionAction ?? null,
    current_confidence: site.polling?.lastDecisionConfidence ?? null,
    current_temp_c: site.polling?.lastHeatmapTempC ?? null,
    current_temp_at: site.polling?.lastHeatmapAt?.toISOString() ?? null,
    last_env_params_at: site.polling?.lastEnvParamsAt?.toISOString() ?? null,
    svi_overall: site.svi?.rplThemes ?? null,
    svi_theme4_housing_transport: site.svi?.rplTheme4 ?? null,
    fips_tract: site.svi?.fipsTract ?? null,
    recent_events: events.map((ev) => ({
      id: ev.id,
      site_id: ev.siteId,
      polled_at: ev.polledAt.toISOString(),
      temp_c: ev.tempC,
      wet_bulb_c: ev.wetBulbC,
      aqi: ev.aqi,
      solar_ghi: ev.solarGhi,
      heat_index_c: ev.heatIndexC,
      humidity_pct: ev.humidityPct,
      risk_level: ev.riskLevel,
      action: ev.action,
      agent_tier: ev.agentTier,
      explanation: ev.explanation,
      confidence: ev.confidence,
    })),
  });
}

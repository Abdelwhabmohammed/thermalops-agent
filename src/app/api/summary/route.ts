// portfolio-level KPIs for the dashboard header band.
//
// One DB pass: sites + latest events + today's forecasts →
//   crews protected, crew-hours at risk, average wet-bulb,
//   $ productivity at risk today, decision counts by tier (agent economics),
//   data freshness. This is the "command center" view an EHS director sees
//   first — the numbers that make the product commercially legible.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classifySeries, computeRoi, type SeriesPoint } from '@/lib/server/forecast';
import type { EnvSeriesPoint } from '@/lib/server/agent';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sites = await db.site.findMany({
    where: { isActive: true },
    include: { polling: true },
  });

  const today = new Date().toISOString().slice(0, 10);

  let crewsProtected = 0;
  let crewHoursAtRisk = 0;
  let dailyLossUsd = 0;
  let hotSeasonLossUsd = 0;
  let incidentExposureUsd = 0;
  let avgWetBulb: number | null = null;
  let wbSum = 0;
  let wbCount = 0;

  for (const s of sites) {
    crewsProtected += s.crewSize;

    const latestEvent = await db.event.findFirst({
      where: { siteId: s.id },
      orderBy: { id: 'desc' },
    });
    if (latestEvent?.wetBulbC !== null && latestEvent?.wetBulbC !== undefined) {
      wbSum += latestEvent.wetBulbC;
      wbCount += 1;
    }

    const forecast = await db.forecast.findFirst({
      where: { siteId: s.id, date: today },
      orderBy: { generatedAt: 'desc' },
    });
    if (forecast) {
      try {
        const raw = JSON.parse(forecast.seriesJson) as EnvSeriesPoint[];
        const series: SeriesPoint[] = classifySeries(raw);
        const roi = computeRoi(series, s.crewSize);
        crewHoursAtRisk += roi.crewHoursAtRisk;
        dailyLossUsd += roi.dailyProductivityLossUsd;
        hotSeasonLossUsd += roi.hotSeasonLossUsd;
        incidentExposureUsd += roi.incidentExposureUsd;
      } catch {
        // malformed row — skip
      }
    }
  }

  if (wbCount > 0) avgWetBulb = Math.round((wbSum / wbCount) * 10) / 10;

  const activeAlerts = await db.alert.count({
    where: { isAcknowledged: false },
  });
  const criticalAlerts = await db.alert.count({
    where: { isAcknowledged: false, severity: 'CRITICAL' },
  });
  const elevatedSites = sites.filter((s) => s.polling?.lastDecisionRisk === 'ELEVATED').length;
  const criticalSites = sites.filter((s) => s.polling?.lastDecisionRisk === 'CRITICAL').length;

  // Agent economics: how many decisions went through each tier.
  const tierCounts = await db.event.groupBy({
    by: ['agentTier'],
    _count: { id: true },
    where: { polledAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  const tierMap: Record<string, number> = { rule: 0, flash: 0, pro: 0 };
  for (const t of tierCounts) {
    if (t.agentTier) tierMap[t.agentTier] = t._count.id;
  }
  const decisions24h = tierMap.rule + tierMap.flash + tierMap.pro;

  // Data freshness — newest reading across all sites.
  const newest = await db.event.findFirst({ orderBy: { id: 'desc' } });

  return NextResponse.json({
    sites: sites.length,
    crews_protected: crewsProtected,
    elevated_sites: elevatedSites,
    critical_sites: criticalSites,
    active_alerts: activeAlerts,
    critical_alerts: criticalAlerts,
    avg_wet_bulb_c: avgWetBulb,
    crew_hours_at_risk_today: Math.round(crewHoursAtRisk),
    productivity_loss_today_usd: dailyLossUsd,
    hot_season_loss_usd: hotSeasonLossUsd,
    incident_exposure_usd: incidentExposureUsd,
    decisions_24h: decisions24h,
    decisions_by_tier: tierMap,
    last_reading_at: newest?.polledAt.toISOString() ?? null,
  });
}

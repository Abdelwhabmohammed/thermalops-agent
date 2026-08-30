// trigger one agent decision cycle out-of-schedule.
//
// Self-healing: if the site has no cached temperature yet (seeded while the
// server was running, before the hourly heatmap job), fetch the heatmap
// first, then run the agent — so "Poll now" always produces a decision.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runAgentForSite } from '@/lib/server/agent';
import { refreshHeatmapForSite } from '@/lib/server/heatmap';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // live mode polls can take a while

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) {
    return NextResponse.json({ error: 'invalid site id' }, { status: 400 });
  }

  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ error: 'site not found' }, { status: 404 });

  try {
    // Self-heal: no cached temperature → fetch heatmap first.
    const polling = await db.pollingState.findUnique({ where: { siteId } });
    if (!polling?.lastHeatmapTempC) {
      await refreshHeatmapForSite({ id: site.id, latitude: site.latitude, longitude: site.longitude });
    }

    const result = await runAgentForSite(siteId);
    return NextResponse.json({
      site_id: siteId,
      tier: result.tier,
      decision: result.decision,
      event_id: result.eventId,
      alert_id: result.alertId,
      reason: result.reason ?? null,
    });
  } catch (e) {
    console.error(`[poll] manual poll failed for site ${siteId}: ${String(e)}`);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

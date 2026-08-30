// GET /api/alerts/feed — paginated alert feed, newest first.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  let limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10);
  if (!Number.isFinite(limit)) limit = 100;
  limit = Math.max(1, Math.min(500, limit));

  let sinceId = parseInt(req.nextUrl.searchParams.get('since') ?? '0', 10);
  if (!Number.isFinite(sinceId)) sinceId = 0;

  const alerts = await db.alert.findMany({
    where: { id: { gt: sinceId } },
    orderBy: { id: 'desc' },
    take: limit,
    include: {
      site: { select: { label: true, latitude: true, longitude: true } },
    },
  });

  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      site_id: a.siteId,
      event_id: a.eventId,
      severity: a.severity,
      action: a.action,
      title: a.title,
      message: a.message,
      created_at: a.createdAt.toISOString(),
      is_acknowledged: a.isAcknowledged,
      acknowledged_at: a.acknowledgedAt?.toISOString() ?? null,
      site_label: a.site.label,
      latitude: a.site.latitude,
      longitude: a.site.longitude,
    })),
    count: alerts.length,
    since_id: sinceId,
  });
}

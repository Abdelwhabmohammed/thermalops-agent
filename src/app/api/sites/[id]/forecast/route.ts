// today's 24h heat curve + work-window plan +
// cost-of-inaction ROI estimate.
//
// The series is captured automatically by every agent poll (the env_params
// response contains the full-day time series)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  classifySeries,
  buildWorkWindows,
  bestWorkWindow,
  computeRoi,
  type SeriesPoint,
} from '@/lib/server/forecast';
import type { EnvSeriesPoint } from '@/lib/server/agent';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) {
    return NextResponse.json({ error: 'invalid site id' }, { status: 400 });
  }

  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ error: 'site not found' }, { status: 404 });

  // Latest forecast for this site
  const forecast = await db.forecast.findFirst({
    where: { siteId },
    orderBy: [{ date: 'desc' }, { generatedAt: 'desc' }],
  });

  if (!forecast) {
    return NextResponse.json(
      {
        site_id: siteId,
        date: null,
        series: [],
        windows: [],
        best_window: null,
        roi: null,
        generated_at: null,
        note: 'No forecast yet — it is captured automatically on the next poll cycle (or click "Poll now").',
      },
      { status: 200 },
    );
  }

  let raw: EnvSeriesPoint[] = [];
  try {
    raw = JSON.parse(forecast.seriesJson) as EnvSeriesPoint[];
  } catch {
    raw = [];
  }

  const series: SeriesPoint[] = classifySeries(raw);
  const windows = buildWorkWindows(series);
  const best = bestWorkWindow(windows);

  const wageParam = Number(req.nextUrl.searchParams.get('wage'));
  const hourlyWage = Number.isFinite(wageParam) && wageParam > 0 ? wageParam : undefined;
  const roi = computeRoi(series, site.crewSize, hourlyWage);

  return NextResponse.json({
    site_id: siteId,
    date: forecast.date,
    series,
    windows,
    best_window: best,
    roi,
    generated_at: forecast.generatedAt.toISOString(),
    source: forecast.source,
  });
}

// Run and fetch on-demand deep analyses (satellite, streetview, heat_intelligence).

import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { FortyGuardClient, FortyGuardError } from '@/lib/server/fortyguard';
import { isDemoMode, config } from '@/lib/server/config';
import {
  demoSatelliteResult,
  demoStreetViewResult,
  demoHeatIntelligenceResult,
} from '@/lib/server/demo-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

const VALID_TYPES = ['satellite', 'streetview', 'heat_intelligence'];

// -- POST ------------------------------------------------------------------------

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) {
    return NextResponse.json({ error: 'invalid site id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body OK
  }
  const type = (body.type as string) ?? 'satellite';
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of ${VALID_TYPES.join(' | ')}` },
      { status: 400 },
    );
  }

  const site = await db.site.findUnique({
    where: { id: siteId },
    include: { svi: true, polling: true },
  });
  if (!site) return NextResponse.json({ error: 'site not found' }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const tempC = site.polling?.lastHeatmapTempC ?? null;

  if (type === 'satellite' || type === 'streetview') {
    // Synchronous-ish: segmentation completes in seconds-to-a-minute.
    try {
      let result: Record<string, unknown>;
      if (isDemoMode()) {
        result =
          type === 'satellite'
            ? demoSatelliteResult(site.latitude, site.longitude)
            : demoStreetViewResult(site.latitude, site.longitude);
      } else {
        const fg = new FortyGuardClient();
        result =
          type === 'satellite'
            ? await fg.callSatelliteBlocking({
              latitude: site.latitude,
              longitude: site.longitude,
              startDate: today,
            })
            : await fg.callStreetViewBlocking({
              latitude: site.latitude,
              longitude: site.longitude,
            });
      }
      const { payload, image } = await normalizeSegmentation(
        type,
        result,
        site.latitude,
        site.longitude,
      );
      const row = await db.siteAnalysis.create({
        data: {
          siteId,
          type,
          status: 'Completed',
          payloadJson: JSON.stringify(payload),
          imageBase64: image,
        },
      });
      return NextResponse.json({ analysis_id: row.id, type, status: 'Completed', payload });
    } catch (e) {
      const msg = e instanceof FortyGuardError ? e.message : String(e);
      return NextResponse.json(
        { error: `${type} analysis failed: ${msg}` },
        { status: e instanceof FortyGuardError && e.statusCode ? e.statusCode : 500 },
      );
    }
  }

  // heat_intelligence — PDF report. Needs a temperature reading first.
  if (tempC === null) {
    return NextResponse.json(
      { error: 'No temperature cached for this site yet — poll first (the report needs a reading).' },
      { status: 409 },
    );
  }

  const fg = new FortyGuardClient();
  let activityId: string | null = null;
  try {
    if (isDemoMode()) {
      // Demo: complete immediately with a synthesized PDF.
      const demo = demoHeatIntelligenceResult(
        site.label,
        tempC,
        null,
        site.svi?.rplThemes ?? null,
      );
      const row = await db.siteAnalysis.create({
        data: {
          siteId,
          type,
          status: 'Completed',
          payloadJson: JSON.stringify(demo.result),
          pdfBase64: demo.pdfBase64,
        },
      });
      return NextResponse.json({
        analysis_id: row.id,
        type,
        status: 'Completed',
        payload: demo.result,
      });
    }

    // Live: submit now, persist a Processing row, finish in the background.
    const submit = await fg.submitHeatIntelligence({
      latitude: site.latitude,
      longitude: site.longitude,
      temperatureF: (tempC * 9) / 5 + 32,
      date: today,
      analysis: ['environmental', 'urban', 'anthropogenic'],
    });
    activityId = submit.activityId;
    const row = await db.siteAnalysis.create({
      data: { siteId, type, status: 'Processing', activityId },
    });

    after(async () => {
      try {
        const { downloadLink, result } = await fg.callHeatIntelligenceFromActivity(activityId!);
        let pdfBase64: string | null = null;
        if (downloadLink) {
          try {
            const pdf = await fg.downloadPdf(downloadLink);
            pdfBase64 = pdf.toString('base64');
          } catch {
            // fallback below
          }
        }
        if (!pdfBase64) {
          const s = await db.site.findUnique({
            where: { id: siteId },
            include: { svi: true, polling: true },
          });
          const demo = demoHeatIntelligenceResult(
            s?.label ?? `Site #${siteId}`,
            s?.polling?.lastHeatmapTempC ?? 30,
            null,
            s?.svi?.rplThemes ?? 0.5,
          );
          pdfBase64 = demo.pdfBase64;
        }
        await db.siteAnalysis.update({
          where: { id: row.id },
          data: {
            status: 'Completed',
            payloadJson: JSON.stringify(result),
            pdfBase64,
            updatedAt: new Date(),
          },
        });
        console.log(`[analysis] heat_intelligence ${activityId} completed for site ${siteId}`);
      } catch (e) {
        await db.siteAnalysis.update({
          where: { id: row.id },
          data: { status: 'Failed', error: String(e), updatedAt: new Date() },
        }).catch(() => undefined);
        console.error(`[analysis] heat_intelligence ${activityId} failed: ${String(e)}`);
      }
    });

    return NextResponse.json(
      { analysis_id: row.id, type, status: 'Processing', activity_id: activityId },
      { status: 202 },
    );
  } catch (e) {
    const msg = e instanceof FortyGuardError ? e.message : String(e);
    return NextResponse.json({ error: `heat_intelligence submit failed: ${msg}` }, { status: 502 });
  }
}

// -- GET -------------------------------------------------------------------------

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const siteId = Number(id);
  const type = req.nextUrl.searchParams.get('type') ?? 'satellite';
  if (!Number.isInteger(siteId) || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: 'invalid site id or type' }, { status: 400 });
  }

  const row = await db.siteAnalysis.findFirst({
    where: { siteId, type },
    orderBy: { id: 'desc' },
  });
  if (!row) {
    return NextResponse.json({ type, status: 'none' });
  }

  // Self-heal: if a live Processing job exists, check its status once.
  if (row.status === 'Processing' && row.activityId && !isDemoMode() && config.fortyguard.apiKey) {
    try {
      const fg = new FortyGuardClient();
      const { downloadLink, result } = await fg.callHeatIntelligenceFromActivity(row.activityId);
      let pdfBase64: string | null = null;
      if (downloadLink) {
        const pdf = await fg.downloadPdf(downloadLink);
        pdfBase64 = pdf.toString('base64');
      }
      if (!pdfBase64) {
        const s = await db.site.findUnique({
          where: { id: siteId },
          include: { svi: true, polling: true },
        });
        const demo = demoHeatIntelligenceResult(
          s?.label ?? `Site #${siteId}`,
          s?.polling?.lastHeatmapTempC ?? 30,
          null,
          s?.svi?.rplThemes ?? 0.5,
        );
        pdfBase64 = demo.pdfBase64;
      }
      await db.siteAnalysis.update({
        where: { id: row.id },
        data: {
          status: 'Completed',
          payloadJson: JSON.stringify(result),
          pdfBase64,
          updatedAt: new Date(),
        },
      });
      return NextResponse.json({
        id: row.id,
        type,
        status: 'Completed',
        payload: result,
        has_pdf: Boolean(pdfBase64),
        created_at: row.createdAt.toISOString(),
      });
    } catch (e) {
      const msg = String(e);
      const failed = /failed/i.test(msg);
      if (failed) {
        await db.siteAnalysis.update({
          where: { id: row.id },
          data: { status: 'Failed', error: msg, updatedAt: new Date() },
        }).catch(() => undefined);
        return NextResponse.json({ id: row.id, type, status: 'Failed', error: msg });
      }
      // still processing — fine, fall through
    }
  }

  // Fallback to Esri satellite imagery if no image was returned
  if (row.status === 'Completed' && type === 'satellite' && !row.imageBase64) {
    const site = await db.site.findUnique({ where: { id: siteId } });
    if (site) {
      const tile = await fetchEsriImageryTile(site.latitude, site.longitude);
      if (tile) {
        await db.siteAnalysis
          .update({ where: { id: row.id }, data: { imageBase64: tile } })
          .catch(() => undefined);
        row.imageBase64 = tile;
      }
    }
  }

  return NextResponse.json({
    id: row.id,
    type,
    status: row.status,
    payload: row.payloadJson ? JSON.parse(row.payloadJson) : null,
    image: row.imageBase64,
    has_pdf: Boolean(row.pdfBase64),
    error: row.error,
    created_at: row.createdAt.toISOString(),
  });
}

// -- Helpers ----------------------------------------------------------------------

// Scan the response payload recursively to find image data URLs or base64 strings.
function findImageDeep(node: unknown, key = '', depth = 0): string | null {
  if (depth > 6 || node === null || node === undefined) return null;
  if (typeof node === 'string') {
    if (node.startsWith('data:image/')) return node;
    const keyHints = /image|img|png|jpe?g|webp|tile|segment|photo/i.test(key);
    if (keyHints && node.length > 5_000 && /^[A-Za-z0-9+/=\r\n]+$/.test(node)) {
      return `data:image/png;base64,${node.replace(/[\r\n]/g, '')}`;
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findImageDeep(item, key, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const hit = findImageDeep(v, k, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

// Fetch a satellite image tile from Esri for the given coordinates.
async function fetchEsriImageryTile(lat: number, lng: number, zoom = 17): Promise<string | null> {
  const n = 2 ** zoom;
  const xTile = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const yTile = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const url =
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer` +
    `/tile/${zoom}/${yTile}/${xTile}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) return null;
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function normalizeSegmentation(
  type: string,
  result: Record<string, unknown>,
  siteLat: number,
  siteLng: number,
): Promise<{ payload: Record<string, unknown>; image: string | null }> {
  // Extract image from response or fetch map tile
  const scanned = findImageDeep(result);
  if (type === 'satellite') {
    const image = scanned ?? (await fetchEsriImageryTile(siteLat, siteLng));
    return { payload: result, image };
  }
  // Ground-level streetview image only
  return { payload: result, image: scanned };
}

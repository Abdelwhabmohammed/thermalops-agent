// stream the latest completed Heat Intelligence
// PDF report for a site. The PDF is downloaded once (from the temporary
// pre-signed link) and cached in SQLite, so repeated views cost no credits.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) {
    return NextResponse.json({ error: 'invalid site id' }, { status: 400 });
  }

  const row = await db.siteAnalysis.findFirst({
    where: { siteId, type: 'heat_intelligence', status: 'Completed', NOT: { pdfBase64: null } },
    orderBy: { id: 'desc' },
  });
  if (!row?.pdfBase64) {
    return NextResponse.json(
      { error: 'No completed report yet. Generate one from the site panel.' },
      { status: 404 },
    );
  }

  const buf = Buffer.from(row.pdfBase64, 'base64');
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="thermalops-heat-intelligence-site-${siteId}.pdf"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'private, max-age=60',
    },
  });
}

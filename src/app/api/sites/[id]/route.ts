// single site detail. DELETE — soft-deactivate.

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

  const site = await db.site.findUnique({
    where: { id: siteId },
    include: { svi: true, polling: true },
  });
  if (!site) return NextResponse.json({ error: 'site not found' }, { status: 404 });

  return NextResponse.json({
    site: {
      ...site,
      created_at: site.createdAt.toISOString(),
    },
    polling_state: site.polling
      ? {
          ...site.polling,
          last_heatmap_at: site.polling.lastHeatmapAt?.toISOString() ?? null,
          last_env_params_at: site.polling.lastEnvParamsAt?.toISOString() ?? null,
        }
      : {},
    svi: site.svi ?? {},
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const siteId = Number(id);
  if (!Number.isInteger(siteId)) {
    return NextResponse.json({ error: 'invalid site id' }, { status: 400 });
  }
  try {
    const site = await db.site.update({
      where: { id: siteId },
      data: { isActive: false },
    });
    return NextResponse.json({ site_id: site.id, is_active: false });
  } catch {
    return NextResponse.json({ error: 'site not found' }, { status: 404 });
  }
}

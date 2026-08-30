// POST /api/alerts/[id]/acknowledge — mark an alert as acknowledged.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const alertId = Number(id);
  if (!Number.isInteger(alertId)) {
    return NextResponse.json({ error: 'invalid alert id' }, { status: 400 });
  }

  try {
    await db.alert.update({
      where: { id: alertId },
      data: { isAcknowledged: true, acknowledgedAt: new Date() },
    });
    return NextResponse.json({ alert_id: alertId, is_acknowledged: true });
  } catch {
    return NextResponse.json({ error: 'alert not found' }, { status: 404 });
  }
}

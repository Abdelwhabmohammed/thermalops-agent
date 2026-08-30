// GET /api/health — service health + configuration state.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { config, isDemoMode } from '@/lib/server/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  let databaseOk = true;
  let databaseError: string | null = null;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (e) {
    databaseOk = false;
    databaseError = String(e);
  }

  return NextResponse.json({
    status: databaseOk ? 'ok' : 'degraded',
    mode: isDemoMode() ? 'demo' : 'live',
    env: config.app.env,
    fortyguard_plan: config.fortyguard.plan,
    fortyguard_api_key_set: config.fortyguard.apiKey.length > 0,
    gemini_api_key_set: config.gemini.apiKey.length > 0,
    scheduler_enabled: config.scheduler.enabled,
    database_ok: databaseOk,
    database_error: databaseError,
  });
}

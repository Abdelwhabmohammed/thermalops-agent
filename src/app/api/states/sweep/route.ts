// POST /api/states/sweep — run (or fetch cached) State Watch sweep.
//
//   body: { state: 'AZ', fresh?: false }
//
// Sweeps every sentinel of the state through the FREE instant chain
// (Open-Meteo → NWS + Stull wet-bulb + census SVI + the same risk engine as
// monitored sites) — zero FortyGuard credits. Results are cached 10 minutes
// server-side; `fresh: true` bypasses the cache. Sentinels within 1.5 km of
// an already-registered site come back with monitored_site_id set.
//
// GET /api/states/sweep?state=AZ returns the cached sweep (404 if none).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { findStateDef, sweepState } from '@/lib/server/state-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function activeSites() {
    return db.site.findMany({
        where: { isActive: true },
        select: { id: true, latitude: true, longitude: true },
    });
}

export async function POST(req: NextRequest) {
    let body: Record<string, unknown>;
    try {
        body = (await req.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const code = String(body.state ?? '');
    const fresh = body.fresh === true;
    const def = findStateDef(code);
    if (!def) {
        return NextResponse.json(
            { error: `unknown state code "${code}" — pick from the State Watch catalog` },
            { status: 400 },
        );
    }

    try {
        const sites = await activeSites();
        const result = await sweepState(def.code, sites, fresh);
        return NextResponse.json(result);
    } catch (e) {
        console.error(`[states/sweep] ${def.code} failed: ${String(e)}`);
        return NextResponse.json(
            { error: `sweep failed: ${String((e as Error).message || e).slice(0, 200)}` },
            { status: 502 },
        );
    }
}

export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get('state') ?? '';
    const def = findStateDef(code);
    if (!def) {
        return NextResponse.json({ error: 'missing/unknown ?state= code' }, { status: 400 });
    }
    try {
        // fresh=false → returns the 10-min cache when present; only sweeps when
        // there is no cache at all (first-ever GET).
        const sites = await activeSites();
        const result = await sweepState(def.code, sites, false);
        return NextResponse.json(result);
    } catch (e) {
        return NextResponse.json(
            { error: `sweep failed: ${String((e as Error).message || e).slice(0, 200)}` },
            { status: 502 },
        );
    }
}

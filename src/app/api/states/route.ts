// GET /api/states — State Watch catalog: each state's sentinel count plus how
// many of its sentinels are already covered by a registered monitored site

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { STATE_CATALOG } from '@/lib/server/state-watch';

export const dynamic = 'force-dynamic';

export async function GET() {
    const sites = await db.site.findMany({
        where: { isActive: true },
        select: { id: true, latitude: true, longitude: true, state: true },
    });

    const states = STATE_CATALOG.map((def) => {
        // Proximity match: any active site within ~0.05° of a sentinel.
        const near = sites.filter((site) =>
            def.sentinels.some(
                (s) =>
                    Math.abs(site.latitude - s.lat) <= 0.05 && Math.abs(site.longitude - s.lng) <= 0.05,
            ),
        ).length;
        // State-code match (catches monitored sites in the same state but outside
        // the sentinel metro areas, e.g. a rural AZ pin).
        const byCode = sites.filter((s) => (s.state ?? '').toUpperCase() === def.code).length;
        return {
            code: def.code,
            name: def.name,
            sentinel_count: def.sentinels.length,
            monitored_count: Math.max(near, byCode),
        };
    });

    return NextResponse.json({ states });
}

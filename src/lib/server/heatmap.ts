// Refresh heatmap temps. Shared by scheduler & manual poll.
// Lets "Poll now" heal a site with no cached temp yet.
//
// Tries these in order:
//   1. FortyGuard heatmap (satellite temps)
//   2. Open-Meteo (free weather stations)
//   3. NWS (US only)

import { db } from '@/lib/db';
import { FortyGuardClient, makeSmallAoi, extractTileTemperature } from './fortyguard';
import { fetchCurrentConditions } from './weather';

export async function refreshHeatmapForSite(
  site: { id: number; latitude: number; longitude: number },
): Promise<number | null> {
  const now = new Date();
  const aoi = makeSmallAoi(site.latitude, site.longitude, 100);
  const fg = new FortyGuardClient();

  let tempC: number | null = null;
  let source = 'fortyguard';

  try {
    const result = await fg.callHeatmapBlocking({
      polygonAoi: aoi,
      startDate: now.toISOString().slice(0, 10),
      startTime: now.toISOString().slice(11, 16),
      granularity: 100,
    });
    tempC = extractTileTemperature(result, site.latitude, site.longitude);
    if (tempC === null) {
      console.warn(`[heatmap] site ${site.id}: FortyGuard returned n_cells=0, trying Open-Meteo fallback...`);
    }
  } catch (e) {
    console.warn(`[heatmap] site ${site.id}: FortyGuard heatmap failed (${String(e).slice(0, 100)}), trying Open-Meteo fallback...`);
  }

  // Fallback: free weather station chain (Open-Meteo → NWS)
  if (tempC === null) {
    const wx = await fetchCurrentConditions(site.latitude, site.longitude);
    tempC = wx.tempC;
    source = wx.source;
    if (tempC !== null) {
      console.log(`[heatmap] site ${site.id}: ${source} fallback temp=${tempC.toFixed(1)}°C`);
    } else {
      console.error(`[heatmap] site ${site.id}: all temperature sources failed`);
      return null;
    }
  }

  await db.pollingState.upsert({
    where: { siteId: site.id },
    create: { siteId: site.id, lastHeatmapTempC: tempC, lastHeatmapAt: now },
    update: { lastHeatmapTempC: tempC, lastHeatmapAt: now },
  });
  console.log(`[heatmap] site ${site.id}: cached temp=${tempC.toFixed(1)}°C (${source})`);
  return tempC;
}

export async function refreshHeatmapsAll(): Promise<void> {
  const sites = await db.site.findMany({ where: { isActive: true } });
  if (!sites.length) return;
  // Sequential to be polite to the API rate limits.
  for (const site of sites) {
    await refreshHeatmapForSite(site);
  }
}

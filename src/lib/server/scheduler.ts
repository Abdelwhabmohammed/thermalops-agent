// Background scheduler (ported from the old Python poller).
// 
// Runs two main jobs:
//   1. env_params poll - checks each active site every 5 min (configurable)
//   2. heatmap refresh - updates heatmaps every 60 min (configurable)
//
// In demo mode, both jobs use fake data so you can test without spending credits.

import cron, { type ScheduledTask } from 'node-cron';
import { db } from '@/lib/db';
import { config } from './config';
import { refreshHeatmapsAll } from './heatmap';
import { runAgentForSite } from './agent';

const globalForScheduler = globalThis as unknown as {
  thermalopsScheduler?: { tasks: ScheduledTask[]; running: boolean };
};

// -- env_params poll -----------------------------------------------------------------

async function pollEnvParamsAll(): Promise<void> {
  const sites = await db.site.findMany({ where: { isActive: true } });
  if (!sites.length) return;
  for (const site of sites) {
    try {
      const result = await runAgentForSite(site.id);
      console.log(
        `[scheduler] poll site=${site.id} label="${site.label}" tier=${result.tier} ` +
        `action=${result.decision?.action ?? '—'} alert=${result.alertId ?? 'none'}`,
      );
    } catch (e) {
      console.error(`[scheduler] agent run failed for site ${site.id}: ${String(e)}`);
    }
  }
}

// -- Scheduler lifecycle ---------------------------------------------------------------

function cronEveryNMinutes(n: number): string {
  const m = Math.max(1, Math.min(59, Math.floor(n)));
  return m === 1 ? '* * * * *' : `*/${m} * * * *`;
}

export function startScheduler(): void {
  if (globalForScheduler.thermalopsScheduler?.running) return;

  if (!config.scheduler.enabled) {
    console.log('[scheduler] disabled via POLLER_ENABLED=false');
    return;
  }

  const tasks: ScheduledTask[] = [];

  tasks.push(
    cron.schedule(cronEveryNMinutes(config.scheduler.pollIntervalMinutes), () => {
      pollEnvParamsAll().catch((e) =>
        console.error(`[scheduler] env_params poll crashed: ${String(e)}`),
      );
    }),
  );

  tasks.push(
    cron.schedule(
      // Hours → minute-level cron. 60 min → 0 * * * *; other values every N minutes.
      config.scheduler.heatmapRefreshIntervalMinutes === 60
        ? '0 * * * *'
        : cronEveryNMinutes(config.scheduler.heatmapRefreshIntervalMinutes),
      () => {
        refreshHeatmapsAll().catch((e) =>
          console.error(`[scheduler] heatmap refresh crashed: ${String(e)}`),
        );
      },
    ),
  );

  globalForScheduler.thermalopsScheduler = { tasks, running: true };
  console.log(
    `[scheduler] started: env_params every ${config.scheduler.pollIntervalMinutes}min, ` +
    `heatmap every ${config.scheduler.heatmapRefreshIntervalMinutes}min`,
  );

  // Fire an initial cycle shortly after boot so a freshly deployed instance
  // populates the dashboard within ~30s instead of waiting a full interval.
  setTimeout(() => {
    console.log('[scheduler] boot cycle: refreshing heatmaps...');
    refreshHeatmapsAll()
      .then(() => pollEnvParamsAll())
      .catch((e) => console.error(`[scheduler] boot cycle failed: ${String(e)}`));
  }, 15_000);
}

export function stopScheduler(): void {
  const s = globalForScheduler.thermalopsScheduler;
  if (s?.running) {
    s.tasks.forEach((t) => t.stop());
    globalForScheduler.thermalopsScheduler = undefined;
    console.log('[scheduler] stopped');
  }
}

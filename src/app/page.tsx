'use client';

// ThermalOps Agent — main dashboard.
// 3-pane layout: risk map (left) | live alert feed (middle) | site detail (right).
// The header is a portfolio KPI band (crews protected, $ at risk, agent
// economics) — the "command center" numbers an EHS director sees first.

import { useState } from 'react';
import useSWR from 'swr';
import { fetchHealth, fetchSites, fetchSummary } from '@/lib/api';
import type { Health, Site, SummaryResponse } from '@/lib/types';
import SiteMap from '@/components/thermalops/SiteMap';
import AlertFeed from '@/components/thermalops/AlertFeed';
import SiteDetailPanel from '@/components/thermalops/SiteDetailPanel';
import { cn, formatUsd } from '@/lib/utils';
import {
  Activity,
  BrainCircuit,
  DollarSign,
  FlaskConical,
  HardHat,
  MapPin,
  ShieldAlert,
  Thermometer,
} from 'lucide-react';

export default function DashboardPage() {
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);

  const { data: sites, error: sitesErr, mutate: mutateSites } = useSWR<Site[]>(
    'sites',
    fetchSites,
    { refreshInterval: 15000, revalidateOnFocus: true },
  );
  const { data: health } = useSWR<Health>('health', fetchHealth, { refreshInterval: 30000 });
  const { data: summary, mutate: mutateSummary } = useSWR<SummaryResponse>('summary', fetchSummary, {
    refreshInterval: 30000,
  });

  // Derive the effective selection — auto-selects the first site until the
  // user picks one explicitly (no setState-in-effect needed).
  const effectiveSiteId =
    selectedSiteId !== null
      ? selectedSiteId
      : sites && sites.length > 0
        ? sites[0].id
        : null;

  return (
    <main className="h-screen flex flex-col bg-slate-950">
      {/* Top bar */}
      <header className="border-b border-slate-800/80 px-4 py-2.5 flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Thermometer className="w-5 h-5 text-orange-400" aria-hidden />
          <h1 className="text-sm font-semibold tracking-wide text-slate-100">
            ThermalOps Agent
          </h1>
          <span className="text-[10px] text-slate-500 ml-1 hidden sm:inline">
            autonomous heat-safety decisions
          </span>
        </div>

        {/* Portfolio KPI band */}
        <div className="flex items-center gap-2 ml-auto text-xs flex-wrap justify-end">
          <Stat
            label="Sites"
            value={summary?.sites ?? '—'}
            icon={<MapPin className="w-3.5 h-3.5" aria-hidden />}
          />
          <Stat
            label="Crews"
            value={summary?.crews_protected ?? '—'}
            icon={<HardHat className="w-3.5 h-3.5" aria-hidden />}
          />
          <Stat
            label="Avg WB"
            value={summary?.avg_wet_bulb_c !== null && summary?.avg_wet_bulb_c !== undefined
              ? `${summary.avg_wet_bulb_c.toFixed(1)}°C`
              : '—'}
            icon={<Thermometer className="w-3.5 h-3.5" aria-hidden />}
          />
          <Stat
            label="At risk"
            value={summary ? formatUsd(summary.productivity_loss_today_usd) : '—'}
            icon={<DollarSign className="w-3.5 h-3.5" aria-hidden />}
            tone="elevated"
            title="Estimated productivity value at risk from heat stress today, across all sites (ILO 2%/°C model above 25°C wet-bulb)"
          />
          <Stat
            label="Alerts"
            value={summary ? `${summary.active_alerts}` : '—'}
            icon={<ShieldAlert className="w-3.5 h-3.5" aria-hidden />}
            tone={summary && summary.critical_alerts > 0 ? 'critical' : 'default'}
          />
          <Stat
            label="Decisions 24h"
            value={summary?.decisions_24h ?? '—'}
            icon={<BrainCircuit className="w-3.5 h-3.5" aria-hidden />}
            title={
              summary
                ? `Tiered agent economics: ${summary.decisions_by_tier.rule} rule · ${summary.decisions_by_tier.flash} Gemini Flash · ${summary.decisions_by_tier.pro} Gemini Pro`
                : undefined
            }
          />
        </div>

        {/* Health / mode badge */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 ml-2">
          {health?.mode === 'demo' && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/40"
              title="No FORTYGUARD_API_KEY set — readings and LLM decisions are simulated. Add your key in .env to go live."
            >
              <FlaskConical className="w-3 h-3" aria-hidden />
              DEMO
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                health?.status === 'ok' ? 'bg-green-500' : 'bg-amber-500 animate-pulse',
              )}
              aria-hidden
            />
            {health ? health.fortyguard_plan : '...'}
          </div>
        </div>
      </header>

      {/* Main 3-pane layout: map | alert feed | site detail */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.4fr_0.8fr_0.9fr] gap-0 min-h-0 overflow-hidden">
        {/* Map */}
        <section className="relative min-h-[400px] lg:min-h-0 border-r border-slate-800/60">
          {sitesErr && (
            <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm z-[1100]">
              Failed to load sites: {String((sitesErr as Error).message || sitesErr)}
            </div>
          )}
          {sites && (
            <SiteMap
              sites={sites}
              selectedSiteId={effectiveSiteId}
              onSelectSite={setSelectedSiteId}
              onSiteRegistered={() => {
                // New site registered from a map probe — refresh map + KPIs
                // immediately (the first FortyGuard reading lands in the
                // background via after()).
                void mutateSites();
                void mutateSummary();
              }}
            />
          )}
          {/* Legend overlay */}
          <div className="absolute bottom-3 left-3 z-[1000] bg-slate-900/90 backdrop-blur border border-slate-700/60 rounded-md px-3 py-2 text-[10px] font-mono space-y-1 pointer-events-none">
            <div className="text-slate-400 uppercase tracking-wide mb-1">Risk Level</div>
            <Legend color="#16a34a" label="LOW — clear" />
            <Legend color="#f59e0b" label="ELEVATED — advisory" />
            <Legend color="#dc2626" label="CRITICAL — stop-work" />
            <Legend color="#64748b" label="unknown / pending" />
          </div>
        </section>

        {/* Alert feed */}
        <section className="border-r border-slate-800/60 min-h-0 flex flex-col overflow-hidden">
          <AlertFeed />
        </section>

        {/* Site detail */}
        <section className="min-h-0 flex flex-col overflow-hidden">
          <SiteDetailPanel siteId={effectiveSiteId} />
        </section>
      </div>
    </main>
  );
}

function Stat({
  label, value, icon, tone = 'default', title,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: 'default' | 'elevated' | 'critical';
  title?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900/60 border border-slate-700/40"
      title={title}
    >
      <span
        className={cn(
          tone === 'elevated' && 'text-amber-400',
          tone === 'critical' && 'text-red-400 animate-pulse',
          tone === 'default' && 'text-slate-400',
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="text-slate-400">{label}</span>
      <span
        className={cn(
          'font-mono',
          tone === 'elevated' && 'text-amber-300',
          tone === 'critical' && 'text-red-300',
          tone === 'default' && 'text-slate-200',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-300">
      <span
        className="w-2.5 h-2.5 rounded-full border border-white/50"
        style={{ background: color }}
        aria-hidden
      />
      {label}
    </div>
  );
}

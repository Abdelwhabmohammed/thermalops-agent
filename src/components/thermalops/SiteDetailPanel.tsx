'use client';

// Site detail panel — live readings grid, 24h shift plan, deep analyses,
// trend chart, CDC SVI module, decision audit trail, and the manual
// "Poll now" trigger.

import useSWR from 'swr';
import { useState } from 'react';
import { fetchSiteStatus, triggerManualPoll } from '@/lib/api';
import type { SiteStatus } from '@/lib/types';
import {
  actionLabel,
  cn,
  formatNumber,
  formatRelative,
  riskBadgeClass,
  tierClass,
  tierLabel,
} from '@/lib/utils';
import {
  Loader2,
  PlayCircle,
  Thermometer,
  Wind,
  Sun,
  Activity,
  Users,
  Droplets,
  Flame,
  ShieldCheck,
} from 'lucide-react';
import ShiftPlan from './ShiftPlan';
import SiteAnalysis from './SiteAnalysis';
import TrendSparkline from './TrendSparkline';

const POLL_MS = 15000;

interface Props {
  siteId: number | null;
}

export default function SiteDetailPanel({ siteId }: Props) {
  const { data, error, mutate, isValidating } = useSWR<SiteStatus>(
    siteId ? ['site', siteId] : null,
    () => fetchSiteStatus(siteId!),
    { refreshInterval: POLL_MS, revalidateOnFocus: false },
  );
  const [polling, setPolling] = useState(false);

  if (!siteId) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-sm text-slate-500">
        Select a site on the map to see its full status, shift plan, and
        agent decision audit trail.
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-300">
        Failed to load site: {String((error as Error).message || error)}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" aria-hidden />
      </div>
    );
  }

  const onManualPoll = async () => {
    setPolling(true);
    try {
      await triggerManualPoll(siteId);
      await mutate();
    } finally {
      setPolling(false);
    }
  };

  const busy = polling || isValidating;
  const latest = data.recent_events[0];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-100 truncate">
              {data.label}
            </h2>
            <div className="text-xs text-slate-500 mt-0.5">
              {data.city}, {data.state} · ({data.latitude.toFixed(4)}, {data.longitude.toFixed(4)})
              {data.fips_tract && ` · FIPS ${data.fips_tract}`}
            </div>
          </div>
          <button
            onClick={onManualPoll}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-600 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            title="Run one agent cycle now"
          >
            {busy
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              : <PlayCircle className="w-3.5 h-3.5" aria-hidden />}
            Poll now
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              'px-2 py-0.5 rounded text-xs font-mono border',
              riskBadgeClass(data.current_risk_level)
            )}
          >
            {data.current_risk_level ?? 'UNKNOWN'}
          </span>
          <span className="text-xs text-slate-400">
            Action: <strong className="text-slate-200">{actionLabel(data.current_action)}</strong>
          </span>
          {data.current_confidence !== null && (
            <span className="text-xs text-slate-500">
              conf {(data.current_confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
      {/* Live readings grid — 6 cards */}
      <div className="grid grid-cols-3 gap-2 p-3 border-b border-slate-700/60">
        <ReadingCard
          icon={<Thermometer className="w-4 h-4" aria-hidden />}
          label="Temperature"
          value={formatNumber(data.current_temp_c, '°C')}
          sub={formatRelative(data.current_temp_at)}
        />
        <ReadingCard
          icon={<Flame className="w-4 h-4" aria-hidden />}
          label="Feels Like"
          value={formatNumber(latest?.heat_index_c, '°C')}
          sub="heat index"
        />
        <ReadingCard
          icon={<Wind className="w-4 h-4" aria-hidden />}
          label="Wet-Bulb"
          value={formatNumber(latest?.wet_bulb_c, '°C')}
          sub={formatRelative(latest?.polled_at)}
        />
        <ReadingCard
          icon={<Activity className="w-4 h-4" aria-hidden />}
          label="AQI (US)"
          value={latest?.aqi !== null && latest?.aqi !== undefined ? latest.aqi.toFixed(0) : '—'}
          sub={aqiLabel(latest?.aqi)}
        />
        <ReadingCard
          icon={<Sun className="w-4 h-4" aria-hidden />}
          label="Solar GHI"
          value={formatNumber(latest?.solar_ghi, ' W/m²')}
          sub="clear-sky"
        />
        <ReadingCard
          icon={<Droplets className="w-4 h-4" aria-hidden />}
          label="Humidity"
          value={latest?.humidity_pct !== null && latest?.humidity_pct !== undefined
            ? `${latest.humidity_pct.toFixed(0)}%`
            : '—'}
          sub="relative"
        />
      </div>

      {/* 24h shift plan + ROI */}
      <ShiftPlan siteId={siteId} />

      {/* Deep analyses: satellite segmentation + heat intelligence report */}
      <SiteAnalysis siteId={siteId} hasTemperature={data.current_temp_c !== null} />

      {/* Trend */}
      <TrendSparkline events={data.recent_events} />

      {/* SVI block */}
      <div className="px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 mb-1.5">
          <Users className="w-3.5 h-3.5" aria-hidden /> CDC Social Vulnerability Index
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <SviRow label="Overall RPL_THEMES" value={data.svi_overall} highlight />
          <SviRow label="Housing/Transit (Theme 4)" value={data.svi_theme4_housing_transport} />
        </div>
        {data.svi_overall !== null && data.svi_overall >= 0.85 && (
          <div className="mt-2 text-xs text-amber-300/80">
            ⚠ This tract is in the top {(100 - data.svi_overall * 100).toFixed(0)}%
            nationally for overall vulnerability.
          </div>
        )}
        {data.svi_overall === null && (
          <div className="mt-2 text-xs text-slate-500">
            Not cached for this site yet (runs at registration; needs the SVI CSV —
            see scripts/download-svi.mjs).
          </div>
        )}
        <div className="mt-2 flex items-start gap-1 text-[10px] text-slate-600 leading-snug">
          <ShieldCheck className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden />
          Every decision is timestamped and stored — the audit trail below satisfies
          the recordkeeping expectations of OSHA&apos;s Heat National Emphasis Program
          and the proposed Heat Injury &amp; Illness Prevention Rule.
        </div>
      </div>

      {/* Event audit trail */}
      <div className="min-h-[120px]">
        <div className="px-4 py-2 text-xs uppercase tracking-wide text-slate-500 sticky top-0 bg-slate-900/95 backdrop-blur border-b border-slate-700/60">
          Decision Audit Trail
        </div>
        {data.recent_events.length === 0 && (
          <div className="px-4 py-6 text-xs text-slate-500 text-center">
            No decisions yet. Click <strong>Poll now</strong> to run one.
          </div>
        )}
        {data.recent_events.map(ev => (
          <div key={ev.id} className="px-4 py-3 border-b border-slate-800/60">
            <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1">
              <span>{formatRelative(ev.polled_at)}</span>
              <span>·</span>
              <span
                className={cn(
                  'px-1.5 py-0.5 rounded border font-mono',
                  tierClass(ev.agent_tier)
                )}
              >
                {tierLabel(ev.agent_tier)}
              </span>
              <span>·</span>
              <span
                className={cn(
                  'px-1.5 py-0.5 rounded border font-mono',
                  riskBadgeClass(ev.risk_level)
                )}
              >
                {ev.risk_level ?? '—'}
              </span>
              <span className="ml-auto">
                conf {ev.confidence !== null ? `${(ev.confidence * 100).toFixed(0)}%` : '—'}
              </span>
            </div>
            {ev.explanation && (
              <p className="text-xs leading-relaxed text-slate-300 mt-1">
                {ev.explanation}
              </p>
            )}
            <div className="mt-1.5 flex gap-2.5 text-[10px] text-slate-500 font-mono flex-wrap">
              <span>T:{formatNumber(ev.temp_c, '°C')}</span>
              <span>WB:{formatNumber(ev.wet_bulb_c, '°C')}</span>
              <span>AQI:{ev.aqi !== null && ev.aqi !== undefined ? ev.aqi.toFixed(0) : '—'}</span>
              <span>GHI:{formatNumber(ev.solar_ghi)}</span>
              {ev.humidity_pct !== null && ev.humidity_pct !== undefined && (
                <span>RH:{ev.humidity_pct.toFixed(0)}%</span>
              )}
              <span className="ml-auto">{actionLabel(ev.action)}</span>
            </div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

function ReadingCard({
  icon, label, value, sub,
}: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-700/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500">
        {icon}{label}
      </div>
      <div className="mt-1 text-lg font-mono text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function SviRow({
  label, value, highlight = false,
}: { label: string; value: number | null; highlight?: boolean }) {
  const pct = value !== null ? `${(value * 100).toFixed(1)}%` : '—';
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span
        className={cn(
          'font-mono',
          highlight && value !== null && value >= 0.85 ? 'text-amber-300' : 'text-slate-300'
        )}
      >
        {pct}
      </span>
    </div>
  );
}

function aqiLabel(aqi: number | null | undefined): string {
  if (aqi === null || aqi === undefined) return '—';
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'USG';
  if (aqi <= 200) return 'unhealthy';
  return 'very unhealthy';
}

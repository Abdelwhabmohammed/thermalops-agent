'use client';

// State Watch — the regional triage layer on top of the site map.
//
// Pick a state → the server sweeps that state's CURATED SENTINEL NETWORK with
// the free instant chain (Open-Meteo → NWS + Stull wet-bulb + census SVI +
// the same risk engine as monitored sites) — zero FortyGuard credits.
// Elevated sentinels get pulsing diamond pins on the map; the operator then
// promotes any of them to a full monitored site ("Monitor" ≈ 2 FG credits:
// heatmap + env_params) — credit-surgical, exactly like the tiered agent.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SentinelReading, StateInfo, StateSweepResponse } from '@/lib/types';
import { cn, riskColor } from '@/lib/utils';
import {
  Crosshair,
  Layers,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
  X,
} from 'lucide-react';

interface StateWatchProps {
  states: StateInfo[] | null;
  activeCode: string | null;
  sweep: StateSweepResponse | null;
  sweeping: boolean;
  error: string | null;
  focusSentinelId: string | null;
  registeringIds: Set<string>;
  onPickState: (code: string | null) => void;
  onRefresh: () => void;
  onRegisterSentinel: (s: SentinelReading) => void;
  onRegisterAllElevated: () => void;
  onOpenSentinel: (s: SentinelReading) => void;
  onSelectSite: (siteId: number) => void;
}

export default function StateWatch({
  states,
  activeCode,
  sweep,
  sweeping,
  error,
  focusSentinelId,
  registeringIds,
  onPickState,
  onRefresh,
  onRegisterSentinel,
  onRegisterAllElevated,
  onOpenSentinel,
  onSelectSite,
}: StateWatchProps) {
  const [open, setOpen] = useState(false);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // A map pin click focuses (highlights + scrolls to) the matching row.
  useEffect(() => {
    if (!focusSentinelId) return;
    const row = rowRefs.current.get(focusSentinelId);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusSentinelId]);

  // Risk-first ordering: CRITICAL → ELEVATED → LOW → unknown; within a tier,
  // unmonitored first, then composite score desc.
  const ordered = useMemo(() => {
    if (!sweep) return [];
    const rank = (s: SentinelReading): number => {
      if (s.risk_level === 'CRITICAL') return 0;
      if (s.risk_level === 'ELEVATED') return 1;
      if (s.risk_level === 'LOW') return 2;
      return 3;
    };
    return [...sweep.sentinels].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      const m = (a.monitored_site_id ? 1 : 0) - (b.monitored_site_id ? 1 : 0);
      if (m !== 0) return m;
      return (b.composite_score ?? -1) - (a.composite_score ?? -1);
    });
  }, [sweep]);

  const unmonitoredElevated = useMemo(
    () =>
      sweep?.sentinels.filter(
        (s) =>
          s.monitored_site_id === null &&
          (s.risk_level === 'ELEVATED' || s.risk_level === 'CRITICAL'),
      ) ?? [],
    [sweep],
  );

  const anyRegistering = registeringIds.size > 0;

  // Collapsed: a single pill button.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'absolute top-3 left-3 z-[1000] flex items-center gap-1.5 rounded-full border px-3 py-1.5',
          'bg-slate-900/90 backdrop-blur text-[10px] font-mono text-slate-200 transition-colors',
          activeCode
            ? 'border-orange-500/60 bg-orange-500/10 text-orange-200'
            : 'border-slate-700/60 hover:border-orange-500/50 hover:text-orange-200',
        )}
        title="Regional sentinel sweep — sweep a whole state for free, then monitor what's elevated"
      >
        <Radar className="w-3.5 h-3.5 text-orange-400" aria-hidden />
        State Watch
        {activeCode && (
          <span className="ml-0.5 px-1 rounded bg-orange-500/25 text-orange-100 font-bold">
            {activeCode}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="absolute top-3 left-3 z-[1000] w-[310px] max-w-[calc(100%-24px)] rounded-lg border border-slate-700/70 bg-slate-900/95 backdrop-blur shadow-xl overflow-hidden flex flex-col max-h-[calc(100%-24px)]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-700/60 flex-shrink-0">
        <Radar className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" aria-hidden />
        <span className="text-xs font-semibold text-slate-100">State Watch</span>
        <span className="text-[9px] font-mono text-slate-500">regional sentinel sweep</span>
        <div className="ml-auto flex items-center gap-1">
          {activeCode && (
            <button
              onClick={onRefresh}
              disabled={sweeping}
              className="text-slate-500 hover:text-slate-200 disabled:opacity-40 transition-colors"
              title="Re-sweep this state (bypasses the 10-min cache)"
              aria-label="Re-sweep state"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', sweeping && 'animate-spin')} aria-hidden />
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Collapse panel"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {/* State chips */}
      <div className="px-2.5 py-2 border-b border-slate-800/70 flex flex-wrap gap-1 flex-shrink-0">
        {(states ?? []).map((st) => (
          <button
            key={st.code}
            onClick={() => onPickState(st.code)}
            className={cn(
              'px-2 py-1 rounded text-[10px] font-mono border transition-colors',
              activeCode === st.code
                ? 'bg-orange-500/20 border-orange-500/60 text-orange-200 font-bold'
                : 'bg-slate-800/60 border-slate-700/50 text-slate-300 hover:border-orange-500/40 hover:text-orange-200',
            )}
            title={`${st.name} — ${st.sentinel_count} sentinels · ${st.monitored_count} monitored`}
          >
            {st.code}
          </button>
        ))}
        {!states && (
          <span className="text-[10px] text-slate-500 flex items-center gap-1.5 px-1 py-1">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden /> loading catalog…
          </span>
        )}
      </div>

      {/* Active-state results */}
      {activeCode && (
        <div className="overflow-y-auto flex-shrink-0">
          {sweeping && !sweep && (
            <div className="px-3 py-3 text-[10px] text-slate-400 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
              sweeping sentinels — free weather + census chain…
            </div>
          )}
          {error && (
            <div className="px-3 py-2 m-2 rounded text-[10px] text-red-300 bg-red-500/10 border border-red-500/30">
              {error}
            </div>
          )}

          {sweep && (
            <>
              {/* Summary strip */}
              <div className="px-3 py-2 border-b border-slate-800/70">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-100 tracking-wide">
                    {sweep.state_name.toUpperCase()}
                  </span>
                  {sweep.cached && (
                    <span className="text-[8px] font-mono text-slate-600">
                      cached{' '}
                      {new Date(sweep.swept_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                  <button
                    onClick={() => onPickState(null)}
                    className="ml-auto text-[9px] font-mono text-slate-500 hover:text-red-300 transition-colors flex items-center gap-0.5"
                    title="Clear this state's sweep pins"
                  >
                    <X className="w-3 h-3" aria-hidden /> clear
                  </button>
                </div>
                <div className="mt-1 text-[10px] font-mono text-slate-400 flex flex-wrap gap-x-2">
                  <span className={cn(sweep.summary.critical > 0 && 'text-red-400 font-bold')}>
                    {sweep.summary.critical} critical
                  </span>
                  <span className={cn(sweep.summary.elevated > 0 && 'text-amber-400')}>
                    {sweep.summary.elevated} elevated
                  </span>
                  <span>
                    · {sweep.summary.monitored}/{sweep.summary.total} monitored
                  </span>
                  {sweep.summary.crews_exposed > 0 && (
                    <span className="text-amber-300">
                      · {sweep.summary.crews_exposed} crews exposed
                    </span>
                  )}
                  {sweep.summary.avg_wet_bulb_c !== null && (
                    <span>· avg WB {sweep.summary.avg_wet_bulb_c.toFixed(1)}°C</span>
                  )}
                </div>
              </div>

              {/* Sentinel rows */}
              <div className="divide-y divide-slate-800/60">
                {ordered.map((s) => (
                  <div
                    key={s.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(s.id, el);
                      else rowRefs.current.delete(s.id);
                    }}
                    onClick={() => onOpenSentinel(s)}
                    className={cn(
                      'px-2.5 py-1.5 flex items-center gap-2 cursor-pointer transition-colors',
                      focusSentinelId === s.id
                        ? 'bg-orange-500/10 ring-1 ring-inset ring-orange-500/40'
                        : 'hover:bg-slate-800/40',
                    )}
                  >
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        (s.risk_level === 'ELEVATED' || s.risk_level === 'CRITICAL') &&
                        !s.error &&
                        'animate-pulse',
                      )}
                      style={{ background: s.error ? '#64748b' : riskColor(s.risk_level) }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-slate-100 truncate">
                          {s.label}
                        </span>
                        <span className="text-[7.5px] uppercase tracking-wide text-slate-500 border border-slate-700/60 rounded px-1 flex-shrink-0">
                          {s.site_type}
                        </span>
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 truncate">
                        {s.error ? (
                          <span className="text-amber-400/80">{s.error}</span>
                        ) : (
                          <>
                            {s.temp_c?.toFixed(1) ?? '—'}°C · WB{' '}
                            {s.wet_bulb_c?.toFixed(1) ?? '—'}°C · AQI {s.aqi?.toFixed(0) ?? '—'} ·
                            SVI {s.svi_pct ?? '—'} · {s.crew_size} crew
                          </>
                        )}
                      </div>
                    </div>
                    {s.monitored_site_id !== null ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectSite(s.monitored_site_id!);
                        }}
                        className="flex-shrink-0 text-[8px] font-bold px-1.5 py-1 rounded border bg-green-500/10 text-green-300 border-green-500/40 hover:bg-green-500/20 transition-colors flex items-center gap-1"
                        title="Already a monitored site — open its detail panel"
                      >
                        <Crosshair className="w-2.5 h-2.5" aria-hidden />
                        MONITORED
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRegisterSentinel(s);
                        }}
                        disabled={registeringIds.has(s.id)}
                        className={cn(
                          'flex-shrink-0 text-[9px] px-1.5 py-1 rounded border transition-colors flex items-center gap-1 font-semibold',
                          s.risk_level === 'CRITICAL'
                            ? 'bg-red-500/15 border-red-500/50 text-red-200 hover:bg-red-500/25'
                            : s.risk_level === 'ELEVATED'
                              ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 hover:bg-amber-500/25'
                              : 'bg-slate-800/60 border-slate-600/60 text-slate-300 hover:bg-slate-700/60',
                        )}
                        title="Register as a monitored site — starts the full FortyGuard pipeline (heatmap + env_params + tiered agent, ≈2 credits)"
                      >
                        {registeringIds.has(s.id) ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                        ) : (
                          <Plus className="w-3 h-3" aria-hidden />
                        )}
                        Monitor
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Bulk promote */}
              {unmonitoredElevated.length > 0 && (
                <div className="px-2.5 py-2 border-t border-slate-800/70">
                  <button
                    onClick={onRegisterAllElevated}
                    disabled={anyRegistering}
                    className="w-full text-[10px] px-2 py-1.5 rounded border border-orange-500/50 bg-orange-500/15 text-orange-200 hover:bg-orange-500/25 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 font-semibold"
                    title={`Registers all ${unmonitoredElevated.length} elevated sentinels — each starts the FortyGuard pipeline (≈2 credits/site)`}
                  >
                    {anyRegistering ? (
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                    ) : (
                      <Layers className="w-3 h-3" aria-hidden />
                    )}
                    Monitor all {unmonitoredElevated.length} elevated — start FortyGuard pipeline
                  </button>
                </div>
              )}

              {/* Honesty footer */}
              <div className="px-3 py-1.5 border-t border-slate-800/70 text-[8px] font-mono text-slate-600 leading-snug">
                free sweep — zero FortyGuard credits (Open-Meteo→NWS + census SVI).
                promoting to monitored spends ≈2 credits/site.
              </div>
            </>
          )}
        </div>
      )}

      {/* No state picked yet */}
      {!activeCode && (
        <div className="px-3 py-2.5 text-[9px] text-slate-500 leading-snug">
          Pick a state to sweep its sentinel network — every yard, depot and campus
          gets a free instant risk reading; elevated ones light up on the map.
        </div>
      )}
    </div>
  );
}

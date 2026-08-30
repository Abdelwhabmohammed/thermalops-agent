'use client';

// ShiftPlan — the planning layer built on the 24-hour heat curve that the
// FortyGuard env_params response already contains (captured by every agent
// poll at zero extra credit cost).
//
//   1. 24h classification strip (OSHA/NIOSH wet-bulb tiers + EPA AQI)
//   2. Work-window plan ("schedule heavy work 5AM–10AM")
//   3. Cost-of-inaction estimate in dollars

import useSWR from 'swr';
import { useState } from 'react';
import { fetchForecast } from '@/lib/api';
import type { ForecastResponse } from '@/lib/types';
import {
  cn,
  classificationColor,
  classificationLabel,
  formatUsd,
  hourLabel,
  type HourClassification,
} from '@/lib/utils';
import { CalendarClock, ChevronDown, DollarSign, Loader2, RefreshCw } from 'lucide-react';

interface Props {
  siteId: number;
}

const POLL_MS = 60_000;

export default function ShiftPlan({ siteId }: Props) {
  const { data, error, isValidating, mutate } = useSWR<ForecastResponse>(
    ['forecast', siteId],
    () => fetchForecast(siteId),
    { refreshInterval: POLL_MS, revalidateOnFocus: false },
  );
  const [showMethod, setShowMethod] = useState(false);

  const busy = !data && !error;

  return (
    <div className="px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 mb-2">
        <CalendarClock className="w-3.5 h-3.5" aria-hidden />
        Today&apos;s Shift Plan
        <span className="ml-auto normal-case tracking-normal text-[10px] text-slate-600">
          24h wet-bulb curve · captured free with every poll
        </span>
        <button
          onClick={() => mutate()}
          className="text-slate-500 hover:text-slate-300 transition-colors"
          title="Refresh"
        >
          {isValidating
            ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            : <RefreshCw className="w-3 h-3" aria-hidden />}
        </button>
      </div>

      {busy && (
        <div className="h-24 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-slate-600" aria-hidden />
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300/80">
          Forecast unavailable: {String((error as Error).message || error)}
        </div>
      )}

      {data && !data.series.length && (
        <div className="text-xs text-slate-500 py-2">
          {data.note ?? 'No forecast captured yet — click Poll now.'}
        </div>
      )}

      {data && data.series.length > 0 && (
        <>
          <HeatStrip series={data.series} />

          {/* Recommended heavy-work window */}
          {data.best_window && (
            <div className="mt-2.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
              <div className="text-xs font-semibold text-green-300">
                Heavy-work window: {hourLabel(data.best_window.startHour)} –{' '}
                {hourLabel(data.best_window.endHour)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {data.best_window.recommendation}
              </div>
            </div>
          )}

          {/* Windows list */}
          <div className="mt-2 space-y-1">
            {data.windows
              .filter((w) => w.classification !== 'SAFE')
              .map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span
                    className="mt-0.5 inline-block w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: classificationColor(w.classification) }}
                    aria-hidden
                  />
                  <span className="text-slate-400 font-mono w-32 flex-shrink-0">
                    {hourLabel(w.startHour)}–{hourLabel(w.endHour)}
                  </span>
                  <span className="text-slate-400">{w.recommendation}</span>
                </div>
              ))}
          </div>

          {/* ROI / cost of inaction */}
          {data.roi && (
            <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <DollarSign className="w-3.5 h-3.5" aria-hidden />
                Cost of inaction today
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
                <RoiStat
                  value={formatUsd(data.roi.dailyProductivityLossUsd)}
                  label="productivity at risk"
                />
                <RoiStat
                  value={`${data.roi.crewHoursAtRisk}h`}
                  label="crew-hours exposed"
                />
                <RoiStat
                  value={`${data.roi.avgProductivityLossPct}%`}
                  label="avg output loss"
                />
              </div>
              <div className="mt-1.5 text-[10px] text-slate-500">
                Hot-season projection {formatUsd(data.roi.hotSeasonLossUsd)} · one heat
                incident ≈ {formatUsd(data.roi.incidentExposureUsd)} (claim + lost day)
              </div>
              <button
                onClick={() => setShowMethod((v) => !v)}
                className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                Methodology
                <ChevronDown
                  className={cn('w-3 h-3 transition-transform', showMethod && 'rotate-180')}
                  aria-hidden
                />
              </button>
              {showMethod && (
                <ul className="mt-1 space-y-1 text-[10px] leading-relaxed text-slate-500 list-disc pl-4">
                  {data.roi.methodology.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// -- 24h classification strip ------------------------------------------------------

function HeatStrip({
  series,
}: {
  series: Array<{
    hour: number;
    wetBulbC: number | null;
    aqi: number | null;
    classification: HourClassification;
  }>;
}) {
  // Current local hour (client-side is fine — just highlights position).
  const nowHour = new Date().getHours();
  const sorted = [...series].sort((a, b) => a.hour - b.hour);
  const wbs = sorted.map((p) => p.wetBulbC).filter((v): v is number => v !== null);
  const minWb = Math.min(15, ...(wbs.length ? wbs : [20]));
  const maxWb = Math.max(33, ...(wbs.length ? wbs : [30]));

  return (
    <div>
      <div className="flex items-end gap-[2px] h-16" role="img" aria-label="24 hour heat classification">
        {sorted.map((p) => {
          const frac =
            p.wetBulbC !== null
              ? Math.max(0.08, Math.min(1, (p.wetBulbC - minWb) / (maxWb - minWb)))
              : 0.12;
          const isNow = p.hour === nowHour;
          return (
            <div
              key={p.hour}
              className="relative flex-1 group"
              title={`${hourLabel(p.hour)} · WB ${
                p.wetBulbC !== null ? `${p.wetBulbC.toFixed(1)}°C` : '—'
              } · AQI ${p.aqi !== null ? p.aqi.toFixed(0) : '—'} · ${classificationLabel(
                p.classification,
              )}`}
            >
              <div
                className={cn(
                  'w-full rounded-sm transition-opacity group-hover:opacity-100',
                  isNow && 'ring-2 ring-white/70',
                )}
                style={{
                  height: `${frac * 100}%`,
                  backgroundColor: classificationColor(p.classification),
                  opacity: 0.85,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* Hour axis: label every 3 hours */}
      <div className="flex gap-[2px] mt-1">
        {sorted.map((p) => (
          <div key={p.hour} className="flex-1 text-center">
            {p.hour % 3 === 0 ? (
              <span className="text-[8px] text-slate-600 font-mono">
                {hourLabel(p.hour).replace('AM', 'a').replace('PM', 'p')}
              </span>
            ) : (
              <span className="text-[8px]">&nbsp;</span>
            )}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        {(['SAFE', 'CAUTION', 'RESTRICTED', 'STOP'] as HourClassification[]).map((c) => (
          <span key={c} className="inline-flex items-center gap-1 text-[9px] text-slate-500">
            <span
              className="inline-block w-2 h-2 rounded-sm"
              style={{ backgroundColor: classificationColor(c) }}
              aria-hidden
            />
            {classificationLabel(c)}
          </span>
        ))}
        <span className="text-[9px] text-slate-600">
          bar height = wet-bulb · thresholds: 25 / 28 / 32°C (NIOSH)
        </span>
      </div>
    </div>
  );
}

function RoiStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-slate-900/60 rounded px-1.5 py-1.5 border border-slate-700/40">
      <div className="text-sm font-mono font-semibold text-amber-200">{value}</div>
      <div className="text-[9px] text-slate-500 leading-tight mt-0.5">{label}</div>
    </div>
  );
}

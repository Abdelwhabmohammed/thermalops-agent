'use client';

// TrendSparkline — hand-rolled dual-line SVG chart of temperature + wet-bulb
// over the site's recent decision history (each event stores the readings, so
// this costs zero extra API calls).

import type { SiteEvent } from '@/lib/types';
import { formatRelative } from '@/lib/utils';

interface Props {
  events: SiteEvent[];
  maxPoints?: number;
}

export default function TrendSparkline({ events, maxPoints = 40 }: Props) {
  // Oldest → newest, limited to the most recent N points.
  const pts = [...events].slice(0, maxPoints).reverse();

  if (pts.length < 2) {
    return (
      <div className="px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
          48h Trend
        </div>
        <div className="text-[11px] text-slate-600 py-2">
          Not enough history yet — trends appear after a few poll cycles.
        </div>
      </div>
    );
  }

  const W = 320;
  const H = 72;
  const PAD = 6;

  const temps = pts.map((p) => p.temp_c).filter((v): v is number => v !== null);
  const wbs = pts.map((p) => p.wet_bulb_c).filter((v): v is number => v !== null);
  const all = [...temps, ...wbs];
  if (!all.length) return null;

  const min = Math.min(...all) - 1;
  const max = Math.max(...all) + 1;
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - 2 * PAD);

  const line = (get: (p: SiteEvent) => number | null) => {
    let d = '';
    let started = false;
    pts.forEach((p, i) => {
      const v = get(p);
      if (v === null) {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const tempPath = line((p) => p.temp_c);
  const wbPath = line((p) => p.wet_bulb_c);
  const last = pts[pts.length - 1];

  return (
    <div className="px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 mb-1.5">
        48h Trend
        <span className="ml-auto normal-case tracking-normal text-[10px] text-slate-600">
          {pts.length} decisions · {formatRelative(pts[0].polled_at)} → now
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[72px]"
        role="img"
        aria-label="Temperature and wet-bulb trend"
      >
        {/* gridlines: min / mid / max */}
        {[min, (min + max) / 2, max].map((v, i) => (
          <g key={i}>
            <line
              x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)}
              stroke="#334155" strokeWidth="0.5" strokeDasharray="2 3"
            />
            <text x={PAD + 1} y={y(v) - 2} fontSize="7" fill="#64748b" fontFamily="monospace">
              {v.toFixed(0)}°
            </text>
          </g>
        ))}
        {/* NIOSH advisory threshold at 25°C if in range */}
        {25 > min && 25 < max && (
          <line
            x1={PAD} x2={W - PAD} y1={y(25)} y2={y(25)}
            stroke="#eab308" strokeWidth="0.75" strokeDasharray="4 3" opacity="0.7"
          />
        )}
        <path d={tempPath} fill="none" stroke="#fb923c" strokeWidth="1.5" strokeLinejoin="round" />
        <path d={wbPath} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeLinejoin="round" />
        {last.temp_c !== null && (
          <circle cx={x(pts.length - 1)} cy={y(last.temp_c)} r="2.2" fill="#fb923c" />
        )}
        {last.wet_bulb_c !== null && (
          <circle cx={x(pts.length - 1)} cy={y(last.wet_bulb_c)} r="2.2" fill="#38bdf8" />
        )}
      </svg>
      <div className="flex items-center gap-4 mt-0.5">
        <span className="inline-flex items-center gap-1 text-[9px] text-slate-500">
          <span className="inline-block w-3 h-0.5 bg-orange-400" aria-hidden /> air temp
        </span>
        <span className="inline-flex items-center gap-1 text-[9px] text-slate-500">
          <span className="inline-block w-3 h-0.5 bg-sky-400" aria-hidden /> wet-bulb
        </span>
        <span className="inline-flex items-center gap-1 text-[9px] text-slate-600">
          <span className="inline-block w-3 h-0.5 bg-yellow-500" aria-hidden /> NIOSH 25°C advisory
        </span>
      </div>
    </div>
  );
}

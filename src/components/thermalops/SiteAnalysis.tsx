'use client';

// Satellite land-cover and Heat Intelligence report cards for a site.

import useSWR from 'swr';
import { useState } from 'react';
import {
  fetchAnalysis,
  triggerAnalysis,
  reportUrl,
} from '@/lib/api';
import type { AnalysisResponse } from '@/lib/types';
import { formatRelative } from '@/lib/utils';
import {
  FileText,
  Loader2,
  Satellite,
  ExternalLink,
  TriangleAlert,
} from 'lucide-react';

interface Props {
  siteId: number;
  hasTemperature: boolean;
}

export default function SiteAnalysis({ siteId, hasTemperature }: Props) {
  return (
    <div className="px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
        Deep Analyses
      </div>
      <div className="grid grid-cols-1 gap-2.5">
        <SatelliteCard siteId={siteId} />
        <ReportCard siteId={siteId} hasTemperature={hasTemperature} />
      </div>
    </div>
  );
}

// -- Satellite / shade exposure ------------------------------------------------------

interface Segments {
  [key: string]: number;
}

function SatelliteCard({ siteId }: { siteId: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data, mutate } = useSWR<AnalysisResponse>(
    ['analysis-satellite', siteId],
    () => fetchAnalysis(siteId, 'satellite'),
    { revalidateOnFocus: false, refreshInterval: 0 },
  );

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await triggerAnalysis(siteId, 'satellite');
      await mutate();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const segments = extractSegments(data?.payload);
  const image = data?.image ?? null;
  const canopy = segments ? (segments.tree ?? 0) + (segments.plant ?? 0) : null;
  const isDone = data?.status === 'Completed';

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
      <div className="flex items-center gap-1.5">
        <Satellite className="w-3.5 h-3.5 text-sky-400" aria-hidden />
        <span className="text-xs font-semibold text-slate-200">Shade & Exposure</span>
        <span className="text-[9px] text-slate-600">FortyGuard satellite segmentation</span>
        <button
          onClick={run}
          disabled={busy}
          className="ml-auto text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin inline" aria-hidden /> : isDone ? 'Re-run' : 'Analyze'}
        </button>
      </div>

      {err && (
        <div className="mt-2 text-[10px] text-red-300/90 flex items-start gap-1">
          <TriangleAlert className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden />
          {err}
        </div>
      )}

      {busy && !isDone && (
        <div className="mt-2 text-[10px] text-slate-500">
          Submitting to FortyGuard… segmentation usually completes in under a minute.
        </div>
      )}

      {isDone && segments && (
        <div className="mt-2.5 flex gap-3">
          {image ? (

            <img
              src={image}
              alt="Satellite imagery and land-cover segmentation of the site"
              title="Site imagery — FortyGuard segmentation overlay when available, otherwise ESRI World Imagery of the exact coordinates"
              className="w-24 h-24 rounded border border-slate-700 object-cover flex-shrink-0"
            />
          ) : (
            <div
              className="w-24 h-24 rounded border border-slate-700 bg-slate-800/50 flex items-center justify-center flex-shrink-0"
              title="Imagery unavailable for this analysis"
            >
              <Satellite className="w-6 h-6 text-slate-600" aria-hidden />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="space-y-1">
              {Object.entries(segments)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-500 w-20 truncate capitalize">{k}</span>
                    <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.min(100, v)}%`,
                          backgroundColor:
                            k === 'tree' || k === 'plant'
                              ? '#22c55e'
                              : k === 'building'
                                ? '#f87171'
                                : '#94a3b8',
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-slate-400 w-8 text-right">
                      {v.toFixed(0)}%
                    </span>
                  </div>
                ))}
            </div>
            {canopy !== null && (
              <div className="mt-1.5 text-[10px] text-slate-400 leading-snug">
                {canopy < 8
                  ? `Only ${canopy.toFixed(1)}% vegetation canopy — radiant exposure stays high all day. Prioritize shade structures + cooling stations.`
                  : canopy < 20
                    ? `${canopy.toFixed(1)}% vegetation canopy — partial natural relief; plan rest breaks near the vegetated edge.`
                    : `${canopy.toFixed(1)}% vegetation canopy — good natural shade available; position rest areas under canopy.`}
              </div>
            )}
          </div>
        </div>
      )}

      {isDone && !segments && (
        <div className="mt-2 text-[10px] text-slate-500">
          Segmentation completed but no land-cover shares were returned — try
          re-running the analysis.
        </div>
      )}

      {data?.status === 'Failed' && (
        <div className="mt-2 text-[10px] text-red-300/80">{data.error ?? 'Analysis failed.'}</div>
      )}
    </div>
  );
}

function extractSegments(payload: Record<string, unknown> | null | undefined): Segments | null {
  if (!payload) return null;
  const seg = (payload.segmentation as { segments?: Segments } | undefined)?.segments;
  if (seg && typeof seg === 'object') {
    const out: Segments = {};
    for (const [k, v] of Object.entries(seg)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

// -- Heat Intelligence report ----------------------------------------------------------

function ReportCard({ siteId, hasTemperature }: { siteId: number; hasTemperature: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, mutate } = useSWR<AnalysisResponse>(
    ['analysis-report', siteId],
    () => fetchAnalysis(siteId, 'heat_intelligence'),
    {
      revalidateOnFocus: false,
      // While the PDF is generating server-side, poll for completion.
      refreshInterval: (latest?: AnalysisResponse) =>
        latest && latest.status === 'Processing' ? 5_000 : 0,
    },
  );

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await triggerAnalysis(siteId, 'heat_intelligence');
      await mutate();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const processing = data?.status === 'Processing' || (busy && data?.status !== 'Completed');
  const done = data?.status === 'Completed';

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
      <div className="flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5 text-orange-400" aria-hidden />
        <span className="text-xs font-semibold text-slate-200">Heat Intelligence Report</span>
        <span className="text-[9px] text-slate-600">multi-dim PDF · env + urban + anthropogenic</span>
        <button
          onClick={run}
          disabled={busy || processing || !hasTemperature}
          className="ml-auto text-[10px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
          title={
            !hasTemperature
              ? 'Needs a temperature reading first — poll the site, then generate.'
              : undefined
          }
        >
          {busy || processing ? (
            <Loader2 className="w-3 h-3 animate-spin inline" aria-hidden />
          ) : done ? (
            'Regenerate'
          ) : (
            'Generate'
          )}
        </button>
      </div>

      {err && (
        <div className="mt-2 text-[10px] text-red-300/90 flex items-start gap-1">
          <TriangleAlert className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden />
          {err}
        </div>
      )}

      {processing && (
        <div className="mt-2 text-[10px] text-slate-500">
          Report generating — FortyGuard compiles the multi-dimensional analysis; this
          can take a few minutes. The panel polls automatically.
        </div>
      )}

      {done && (
        <a
          href={reportUrl(siteId)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-orange-500/40 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 transition-colors"
        >
          Open PDF report
          <ExternalLink className="w-3 h-3" aria-hidden />
        </a>
      )}

      {data?.status === 'Failed' && (
        <div className="mt-2 text-[10px] text-red-300/80">{data.error ?? 'Report failed.'}</div>
      )}

      {data?.status === 'none' && !busy && (
        <div className="mt-2 text-[10px] text-slate-500">
          On-demand board-ready report: environmental, urban and anthropogenic heat
          analysis for this location.
        </div>
      )}
      {data?.created_at && data.status === 'Completed' && (
        <div className="mt-1 text-[9px] text-slate-600">
          generated {formatRelative(data.created_at)}
        </div>
      )}
    </div>
  );
}

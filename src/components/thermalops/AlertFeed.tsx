'use client';

// Live alert feed — SWR 10s poll, expandable cards, acknowledge button.

import useSWR from 'swr';
import { useState } from 'react';
import { fetchAlerts, acknowledgeAlert } from '@/lib/api';
import type { Alert } from '@/lib/types';
import { actionLabel, cn, formatRelative } from '@/lib/utils';
import { Bell, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

const POLL_MS = 10000; // poll every 10s

export default function AlertFeed() {
  // SWR with `since_id=0` always returns newest first up to limit. We poll.
  const { data, error, mutate } = useSWR<Alert[]>(
    'alerts',
    () => fetchAlerts(0, 50),
    { refreshInterval: POLL_MS, revalidateOnFocus: true },
  );
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [acking, setAking] = useState<number | null>(null);

  const toggle = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onAck = async (id: number) => {
    setAking(id);
    try {
      await acknowledgeAlert(id);
      await mutate();
    } finally {
      setAking(null);
    }
  };

  const alerts = data ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-amber-400" aria-hidden />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-slate-300">
            Alert Feed
          </h2>
          {alerts.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-700 text-slate-300">
              {alerts.length}
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          live · 10s poll
        </span>
      </div>

      <div className="flex-1 overflow-y-auto max-h-96 lg:max-h-none">
        {error && (
          <div className="px-4 py-3 text-xs text-red-300 border-b border-red-500/30 bg-red-500/5">
            Failed to load alerts: {String((error as Error).message || error)}
          </div>
        )}
        {!error && alerts.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-slate-500">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500/50" aria-hidden />
            No active alerts. All clear.
          </div>
        )}
        {alerts.map(a => {
          const isCritical = a.severity === 'CRITICAL';
          const isExpanded = expandedIds.has(a.id);
          return (
            <div
              key={a.id}
              className={cn(
                'border-b border-slate-800/60 transition-colors',
                isCritical ? 'bg-red-500/[0.04]' : 'bg-amber-500/[0.03]',
              )}
            >
              <button
                onClick={() => toggle(a.id)}
                className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-slate-800/40"
                aria-expanded={isExpanded}
              >
                <div
                  className={cn(
                    'mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0',
                    isCritical ? 'bg-red-500 animate-pulse' : 'bg-amber-500'
                  )}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-mono uppercase',
                        isCritical
                          ? 'bg-red-500/15 text-red-300'
                          : 'bg-amber-500/15 text-amber-300'
                      )}
                    >
                      {a.severity}
                    </span>
                    <span className="text-xs text-slate-400">{actionLabel(a.action)}</span>
                    <span className="text-[10px] text-slate-500 ml-auto">
                      {formatRelative(a.created_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-200 truncate">
                    {a.title}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400 truncate">
                    {a.message}
                  </div>
                </div>
                {isExpanded
                  ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0 mt-1" aria-hidden />
                  : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0 mt-1" aria-hidden />}
              </button>
              {isExpanded && (
                <div className="px-4 pb-3 pt-1 space-y-2">
                  <div className="bg-slate-900/60 rounded-md p-3 border border-slate-700/40">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                      Full Explanation
                    </div>
                    <p className="text-xs leading-relaxed text-slate-300">
                      {a.message}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>site #{a.site_id} · {a.site_label}</span>
                    <span>·</span>
                    <span>({a.latitude.toFixed(4)}, {a.longitude.toFixed(4)})</span>
                  </div>
                  {!a.is_acknowledged ? (
                    <button
                      onClick={() => onAck(a.id)}
                      disabled={acking === a.id}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                    >
                      {acking === a.id && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
                      Acknowledge
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-green-500/10 text-green-300">
                      <CheckCircle2 className="w-3 h-3" aria-hidden />
                      Acknowledged {formatRelative(a.acknowledged_at)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

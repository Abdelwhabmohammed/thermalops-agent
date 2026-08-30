// Frontend API client — same-origin calls to the Next.js API routes.

import type {
  Alert,
  AnalysisResponse,
  AnalysisType,
  ForecastResponse,
  Health,
  PollResult,
  ProbeResponse,
  SentinelReading,
  Site,
  SiteStatus,
  StateInfo,
  StateSweepResponse,
  SummaryResponse,
} from './types';

const API_BASE = '/api';

// Live data — disable Next.js fetch caching.
const fetchOpts: RequestInit = {
  cache: 'no-store' as RequestCache,
  headers: { Accept: 'application/json' },
};

export async function fetchHealth(): Promise<Health> {
  const r = await fetch(`${API_BASE}/health`, fetchOpts);
  if (!r.ok) throw new Error(`health ${r.status}`);
  return r.json();
}

export async function fetchSites(): Promise<Site[]> {
  const r = await fetch(`${API_BASE}/sites`, fetchOpts);
  if (!r.ok) throw new Error(`sites ${r.status}`);
  const body = await r.json();
  return body.sites as Site[];
}

export async function fetchSiteStatus(siteId: number): Promise<SiteStatus> {
  const r = await fetch(`${API_BASE}/sites/${siteId}/status`, fetchOpts);
  if (!r.ok) throw new Error(`site ${siteId} status ${r.status}`);
  return r.json();
}

export async function fetchAlerts(sinceId = 0, limit = 100): Promise<Alert[]> {
  const r = await fetch(
    `${API_BASE}/alerts/feed?since=${sinceId}&limit=${limit}`,
    fetchOpts,
  );
  if (!r.ok) throw new Error(`alerts ${r.status}`);
  const body = await r.json();
  return body.alerts as Alert[];
}

export async function registerSite(payload: {
  label: string;
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  site_type?: string;
  crew_size?: number;
  notes?: string;
}): Promise<{ site_id: number }> {
  const r = await fetch(`${API_BASE}/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store' as RequestCache,
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `register ${r.status}`);
  }
  return r.json();
}

export async function triggerManualPoll(siteId: number): Promise<PollResult> {
  const r = await fetch(`${API_BASE}/sites/${siteId}/poll`, {
    method: 'POST',
    cache: 'no-store' as RequestCache,
  });
  if (!r.ok) throw new Error(`poll ${r.status}`);
  return r.json();
}

export async function acknowledgeAlert(alertId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/alerts/${alertId}/acknowledge`, {
    method: 'POST',
    cache: 'no-store' as RequestCache,
  });
  if (!r.ok) throw new Error(`ack ${r.status}`);
}

// -- Forecast / shift planner -------------------------------------------------------

export async function fetchForecast(siteId: number): Promise<ForecastResponse> {
  const r = await fetch(`${API_BASE}/sites/${siteId}/forecast`, fetchOpts);
  if (!r.ok) throw new Error(`forecast ${siteId} ${r.status}`);
  return r.json();
}

// -- On-demand analyses ----------------------------------------------------------------

export async function triggerAnalysis(
  siteId: number,
  type: AnalysisType,
): Promise<AnalysisResponse> {
  const r = await fetch(`${API_BASE}/sites/${siteId}/analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
    cache: 'no-store' as RequestCache,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) {
    throw new Error((body as { error?: string }).error || `analysis ${r.status}`);
  }
  return body as AnalysisResponse;
}

export async function fetchAnalysis(
  siteId: number,
  type: AnalysisType,
): Promise<AnalysisResponse> {
  const r = await fetch(`${API_BASE}/sites/${siteId}/analysis?type=${type}`, fetchOpts);
  if (!r.ok) throw new Error(`analysis status ${r.status}`);
  return r.json();
}

export function reportUrl(siteId: number): string {
  return `${API_BASE}/sites/${siteId}/report`;
}

// -- Map probe ---------------------------------------------------------------------------

export async function probeLocation(
  latitude: number,
  longitude: number,
  deep = false,
): Promise<ProbeResponse> {
  const r = await fetch(`${API_BASE}/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude, deep }),
    cache: 'no-store' as RequestCache,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((body as { error?: string }).error || `probe ${r.status}`);
  }
  return body as ProbeResponse;
}

// -- State Watch (regional sentinel sweep) -------------------------------------------

export async function fetchStates(): Promise<StateInfo[]> {
  const r = await fetch(`${API_BASE}/states`, fetchOpts);
  if (!r.ok) throw new Error(`states ${r.status}`);
  const body = await r.json();
  return body.states as StateInfo[];
}

export async function sweepState(state: string, fresh = false): Promise<StateSweepResponse> {
  const r = await fetch(`${API_BASE}/states/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, fresh }),
    cache: 'no-store' as RequestCache,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((body as { error?: string }).error || `sweep ${r.status}`);
  }
  return body as StateSweepResponse;
}

// -- Portfolio summary -------------------------------------------------------------------

export async function fetchSummary(): Promise<SummaryResponse> {
  const r = await fetch(`${API_BASE}/summary`, fetchOpts);
  if (!r.ok) throw new Error(`summary ${r.status}`);
  return r.json();
}

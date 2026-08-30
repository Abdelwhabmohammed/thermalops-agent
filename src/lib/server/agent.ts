// Agent loop: check each site, score the risk, choose the right model tier, and
// decide whether to raise an alert. Clear-cut cases skip the LLM; complex ones
// get a Gemini review that can override the rule-based call.

import { db } from '@/lib/db';
import { FortyGuardClient, CORE_ENV_ANALYSES, EXTENDED_ENV_ANALYSES } from './fortyguard';
import { callGeminiTier, type AgentTier } from './gemini';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { assess, needsProModel, type RiskAssessment, type SiteSnapshot } from './risk-scorer';
import { AgentDecisionSchema, type AgentDecision } from './schemas';
import { isDemoMode, config } from './config';

// Parse FortyGuard env_params — extract current reading + full day series
// Shape: metadata.timestamps (24h site-local), locations[*].parameters (time series)
// Use nearest-to-now hour, not [0] (midnight). Store full series for shift planning.

export interface EnvSeriesPoint {
  hour: number;
  timestamp: string;
  tempC: number | null;
  wetBulbC: number | null;
  aqi: number | null;
  heatIndexC: number | null;
  humidityPct: number | null;
}

export interface ExtractedParams {
  tempC: number | null;
  wetBulbC: number | null;
  aqi: number | null;
  solarGhi: number | null;
  heatIndexC: number | null;
  humidityPct: number | null;
  series: EnvSeriesPoint[];
}

// Key aliases — primary name first (matches the official Python client),
// older/alternative spellings after.
const KEY_WET_BULB = ['wet_bulb_temperature_celsius', 'wet_bulb_temperature', 'wet_bulb'];
const KEY_AQI = ['air_quality:idx', 'air_quality_idx', 'aqi_us_co', 'us_aqi', 'aqi'];
const KEY_HEAT_INDEX = ['heat_index_celsius', 'heat_index', 'apparent_temperature_celsius'];
const KEY_HUMIDITY = ['relative_humidity_percent', 'relative_humidity'];

function pickParam(params: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (params[k] !== undefined && params[k] !== null) return params[k];
  }
  return undefined;
}

function valueAt(value: unknown, index: number): number | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    const i = Math.min(Math.max(index, 0), value.length - 1);
    const v = value[i];
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function extractEnvParams(
  result: Record<string, unknown>,
  now: Date = new Date(),
): ExtractedParams {
  const empty: ExtractedParams = {
    tempC: null, wetBulbC: null, aqi: null, solarGhi: null,
    heatIndexC: null, humidityPct: null, series: [],
  };

  const locations = (result.locations as Array<Record<string, unknown>>) ?? [];
  const loc = locations[0];
  if (!loc) {
    // Fallback: some shapes put parameters at the top level.
    const params = (result.parameters as Record<string, unknown>) ?? null;
    if (!params) return empty;
    const idx = nearestIndex(result, now);
    return finalize(params, loc, result, idx, now);
  }
  const params = (loc.parameters as Record<string, unknown>) ?? {};
  const idx = nearestIndex(result, now);
  return finalize(params, loc, result, idx, now);
}

function nearestIndex(result: Record<string, unknown>, now: Date): number {
  const meta = (result.metadata as Record<string, unknown>) ?? {};
  const timestamps = (meta.timestamps as string[] | undefined) ?? [];
  if (!timestamps.length) return 0;
  const nowMs = now.getTime();
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < timestamps.length; i++) {
    const t = Date.parse(timestamps[i]);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - nowMs);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function finalize(
  params: Record<string, unknown>,
  loc: Record<string, unknown> | undefined,
  result: Record<string, unknown>,
  idx: number,
  now: Date,
): ExtractedParams {
  const wb = pickParam(params, KEY_WET_BULB);
  const aqi = pickParam(params, KEY_AQI);
  const hi = pickParam(params, KEY_HEAT_INDEX);
  const rh = pickParam(params, KEY_HUMIDITY);

  const tempC = valueAt(loc?.temperature, idx); // echoes back the input temperature

  const solar = ((loc ?? result) as Record<string, unknown>).solar_irradiance as
    | Record<string, unknown>
    | undefined;
  const clearSky = (solar?.clear_sky as Record<string, unknown>) ?? {};
  const ghi = valueAt(clearSky.ghi, idx);

  // Build the full-day series for the shift planner (aligned with timestamps).
  const meta = (result.metadata as Record<string, unknown>) ?? {};
  const timestamps = (meta.timestamps as string[] | undefined) ?? [];
  const series: EnvSeriesPoint[] = [];
  const n = timestamps.length || Math.max(arrayLen(wb), arrayLen(aqi), arrayLen(hi), arrayLen(rh));
  for (let i = 0; i < n; i++) {
    const ts = timestamps[i] ?? null;
    let hour = i;
    if (ts) {
      const m = /T(\d{2}):/.exec(ts);
      if (m) hour = Number(m[1]);
    }
    series.push({
      hour,
      timestamp: ts ?? `${now.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00`,
      tempC: valueAt(loc?.temperature, i),
      wetBulbC: valueAt(wb, i),
      aqi: valueAt(aqi, i),
      heatIndexC: valueAt(hi, i),
      humidityPct: valueAt(rh, i),
    });
  }

  return {
    tempC,
    wetBulbC: valueAt(wb, idx),
    aqi: valueAt(aqi, idx),
    solarGhi: ghi,
    heatIndexC: valueAt(hi, idx),
    humidityPct: valueAt(rh, idx),
    series,
  };
}

function arrayLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function persistForecast(siteId: number, series: EnvSeriesPoint[]): Promise<void> {
  if (!series.length) return;
  const date = series[0].timestamp.slice(0, 10); // site-local date
  await db.forecast.upsert({
    where: { siteId_date: { siteId, date } },
    create: {
      siteId,
      date,
      seriesJson: JSON.stringify(series),
      source: isDemoMode() ? 'demo' : 'env_params',
    },
    update: {
      seriesJson: JSON.stringify(series),
      generatedAt: new Date(),
      source: isDemoMode() ? 'demo' : 'env_params',
    },
  });
}

// -- Rule-only decision constructor (no LLM call) ---------------------------------

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function ruleDecision(snapshot: SiteSnapshot, assessment: RiskAssessment): AgentDecision {
  const aqiNote =
    snapshot.aqi !== null && snapshot.aqi <= 100
      ? `AQI ${snapshot.aqi.toFixed(0)} — within safe outdoor exposure range.`
      : snapshot.aqi !== null
        ? `AQI ${snapshot.aqi.toFixed(0)} — elevated respiratory risk for prolonged exposure.`
        : 'AQI not available — assume conservative limits.';

  let sviNote = 'Community vulnerability not assessed for this site.';
  if (snapshot.sviOverall !== null) {
    const sviPct = snapshot.sviOverall * 100;
    const ord = ordinal(Math.round(sviPct));
    if (snapshot.sviOverall >= 0.85) {
      sviNote =
        `Census tract in top ${Math.max(1, 100 - sviPct).toFixed(0)}% nationally for overall ` +
        `vulnerability — workers in this zone are less likely to have cool ` +
        `shelter within walking distance.`;
    } else if (snapshot.sviOverall >= 0.5) {
      sviNote = `Census tract has moderate SVI ranking (${ord} percentile).`;
    } else {
      sviNote = `Census tract has low SVI ranking (${ord} percentile).`;
    }
  }

  const wb = snapshot.wetBulbC;
  let explanation: string;
  let mitigations: string[];

  switch (assessment.wetBulbTier) {
    case 'EXTREME':
      explanation =
        `Wet-bulb at ${wb?.toFixed(1)}°C exceeds the NIOSH extreme threshold (>32°C). ` +
        `Immediate stop-work required to prevent heat-fatality. ` +
        `${aqiNote} ${sviNote} Halt all outdoor work; relocate crew to cool shelter.`;
      mitigations = [
        'Issue stop-work order immediately',
        'Move crew to shaded or air-conditioned area',
        'Provide cool drinking water; monitor for confusion or loss of consciousness',
        'Notify site safety officer and (if symptoms appear) emergency services',
      ];
      break;
    case 'DANGER':
      explanation =
        `Wet-bulb at ${wb?.toFixed(1)}°C is in the NIOSH danger band (28-32°C). ` +
        `Mandatory rest breaks required. ${aqiNote} ${sviNote}`;
      mitigations = [
        'Schedule 15-min rest breaks every hour in shade',
        'Increase water availability; mandate hydration',
        'Reassign high-exertion tasks to cooler hours if possible',
      ];
      break;
    case 'MODERATE':
      explanation =
        `Wet-bulb at ${wb?.toFixed(1)}°C is in the NIOSH moderate band (25-28°C). ` +
        `Issue heat-safety advisory. ${aqiNote} ${sviNote}`;
      mitigations = [
        'Schedule optional 10-min rest breaks in shade every 2 hours',
        'Monitor crew for early heat-illness signs (headache, dizziness)',
        'Ensure water is accessible at all work positions',
      ];
      break;
    default:
      explanation =
        `Wet-bulb at ${wb?.toFixed(1)}°C is below the NIOSH caution threshold (<25°C). ` +
        `Conditions are within safe outdoor-exposure range. ${aqiNote} ${sviNote}`;
      mitigations = ['Continue normal operations', 'Maintain standard water availability'];
  }

  return AgentDecisionSchema.parse({
    risk_level: assessment.ruleRiskLevel,
    action: assessment.ruleAction,
    wet_bulb_tier: assessment.wetBulbTier,
    aqi_note: aqiNote,
    svi_note: sviNote,
    explanation,
    recommended_mitigations: mitigations,
    confidence: assessment.isClearCut ? 0.95 : 0.85,
    needs_human_review: false,
  });
}

// -- Alert dedup --------------------------------------------------------------------

const ALERT_DEDUP_MS = 30 * 60 * 1000; // 30 minutes

async function shouldEmitAlert(siteId: number, severity: string): Promise<boolean> {
  const last = await db.alert.findFirst({
    where: {
      siteId,
      severity,
      isAcknowledged: false,
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!last) return true;
  return Date.now() - last.createdAt.getTime() > ALERT_DEDUP_MS;
}

// -- The main agent loop --------------------------------------------------------------

export interface AgentRunResult {
  tier: AgentTier | 'skip' | 'deferred' | 'error';
  decision: AgentDecision | null;
  eventId: number | null;
  alertId: number | null;
  reason?: string;
}

export async function runAgentForSite(siteId: number): Promise<AgentRunResult> {
  const site = await db.site.findUnique({ where: { id: siteId } });
  if (!site) throw new Error(`Site ${siteId} not found`);
  if (!site.isActive) {
    return { tier: 'skip', decision: null, eventId: null, alertId: null };
  }

  const sviRow = await db.sviCache.findUnique({ where: { siteId } });
  const pollingState = await db.pollingState.findUnique({ where: { siteId } });

  const tempC = pollingState?.lastHeatmapTempC ?? null;

  // If we have no temperature yet, we can't call env_params. Defer this cycle.
  if (tempC === null) {
    console.warn(
      `[agent] site ${siteId} has no cached temperature; deferring until heatmap refresh`,
    );
    return {
      tier: 'deferred',
      decision: null,
      eventId: null,
      alertId: null,
      reason: 'no_cached_temperature',
    };
  }

  // Call /v1/env_params with cached temperature. Explicit `analysis` list
  // (exact API field names) keeps the request inside plan param limits and
  // guarantees wet-bulb + AQI are actually returned.
  const now = new Date();
  const fg = new FortyGuardClient();
  const analysis = config.fortyguard.isPremium ? EXTENDED_ENV_ANALYSES : CORE_ENV_ANALYSES;
  let envResult: Record<string, unknown>;
  try {
    envResult = await fg.callEnvParamsBlocking({
      latitude: site.latitude,
      longitude: site.longitude,
      temperature: tempC,
      startDate: now.toISOString().slice(0, 10),
      startTime: now.toISOString().slice(11, 16),
      analysis,
    });
  } catch (e) {
    console.error(`[agent] FortyGuard env_params failed for site ${siteId}: ${String(e)}`);
    const event = await db.event.create({
      data: {
        siteId,
        rawEnvParams: JSON.stringify({ error: String(e) }),
        tempC,
        explanation: `env_params call failed: ${String(e)}`,
        confidence: 0,
      },
    });
    return { tier: 'error', decision: null, eventId: event.id, alertId: null };
  }

  const extracted = extractEnvParams(envResult, now);

  // Persist the full-day heat curve (free with every poll — the API returns
  // the whole 24h series). Powers the shift planner + ROI model.
  await persistForecast(siteId, extracted.series);

  const snapshot: SiteSnapshot = {
    tempC: extracted.tempC ?? tempC, // prefer FG echo; fall back to cached
    wetBulbC: extracted.wetBulbC,
    aqi: extracted.aqi,
    solarGhi: extracted.solarGhi,
    sviOverall: sviRow?.rplThemes ?? null,
    sviHousingTransport: sviRow?.rplTheme4 ?? null,
    crewSize: site.crewSize,
  };

  // Debug surface: if wet-bulb/AQI still missing, log the raw param keys so
  // the response shape can be diagnosed from the server log.
  if (extracted.wetBulbC === null || extracted.aqi === null) {
    const loc0 = (envResult as { locations?: Array<{ parameters?: Record<string, unknown> }> }).locations?.[0];
    const params = loc0?.parameters ?? {};
    console.warn(
      `[agent] site ${siteId}: wetBulb=${extracted.wetBulbC} aqi=${extracted.aqi} — ` +
        `response parameter keys: [${Object.keys(params).join(', ')}] ` +
        `timestamps: ${(envResult as { metadata?: { timestamps?: unknown[] } }).metadata?.timestamps?.length ?? 0}`,
    );
    // Deep debug: show the actual value shape for wet-bulb and AQI keys
    for (const k of ['wet_bulb_temperature_celsius', 'air_quality:idx', 'aqi_us_co']) {
      if (params[k] !== undefined) {
        const v = params[k];
        console.warn(
          `[agent] site ${siteId}: param "${k}" type=${typeof v} isArray=${Array.isArray(v)} ` +
            `value=${JSON.stringify(v).slice(0, 200)}`,
        );
      }
    }
  }

  const assessment = assess(snapshot);

  // Decide tier and get the decision
  let tier: AgentTier;
  let decision: AgentDecision;
  let llmResponseJson: string | null = null;

  if (assessment.isClearCut) {
    tier = 'rule';
    decision = ruleDecision(snapshot, assessment);
  } else {
    const userPrompt = buildUserPrompt({
      siteLabel: site.label,
      city: site.city,
      state: site.state,
      crewSize: site.crewSize,
      tempC: snapshot.tempC,
      wetBulbC: snapshot.wetBulbC,
      aqi: snapshot.aqi,
      solarGhi: snapshot.solarGhi,
      sviOverall: sviRow?.rplThemes ?? undefined,
      sviTheme1: sviRow?.rplTheme1 ?? undefined,
      sviTheme2: sviRow?.rplTheme2 ?? undefined,
      sviTheme3: sviRow?.rplTheme3 ?? undefined,
      sviTheme4: sviRow?.rplTheme4 ?? undefined,
      sviCounty: sviRow?.countyName ?? undefined,
      sviTract: sviRow?.tractName ?? undefined,
      ruleAssessment: {
        wetBulbTier: assessment.wetBulbTier,
        compositeScore: assessment.compositeScore,
        ruleRiskLevel: assessment.ruleRiskLevel,
        ruleAction: assessment.ruleAction,
        isClearCut: assessment.isClearCut,
      },
      polledAtIso: now.toISOString(),
    });

    const wantedTier: 'pro' | 'flash' = needsProModel(snapshot, assessment) ? 'pro' : 'flash';
    tier = wantedTier;
    try {
      const llmResponse = await callGeminiTier(wantedTier, {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
      });
      if (llmResponse) {
        decision = AgentDecisionSchema.parse(llmResponse);
        llmResponseJson = JSON.stringify(llmResponse);
      } else {
        // Demo mode (no Gemini key) — rule fallback with explicit label,
        // but keep the tier the router selected so the audit trail still
        // shows which tier WOULD have reasoned over this case.
        decision = ruleDecision(snapshot, assessment);
        decision.explanation = `[LLM simulated — demo mode] ${decision.explanation}`;
        decision.needs_human_review = true;
        decision.confidence = Math.max(0, decision.confidence - 0.15);
        llmResponseJson = JSON.stringify({ simulated: true, tier: wantedTier });
      }
    } catch (e) {
      console.error(
        `[agent] Gemini call failed for site ${siteId} (tier=${wantedTier}); falling back to rules: ${String(e)}`,
      );
      tier = 'rule'; // graceful fallback
      decision = ruleDecision(snapshot, assessment);
      decision.explanation = `[LLM unavailable — rule-based fallback] ${decision.explanation}`;
      decision.needs_human_review = true;
      decision.confidence = Math.max(0, decision.confidence - 0.15);
      // Keep the failure reason in the audit trail (shown in the UI) so ops
      // can see WHY the LLM tier was skipped instead of guessing.
      llmResponseJson = JSON.stringify({ fallback: true, tier: wantedTier, error: String(e) });
    }
  }

  // Persist event
  const event = await db.event.create({
    data: {
      siteId,
      rawEnvParams: JSON.stringify(envResult),
      rawHeatmap: null, // heatmap result lives in polling_state
      rawSvi: sviRow ? JSON.stringify(sviRow) : null,
      tempC: snapshot.tempC,
      wetBulbC: snapshot.wetBulbC,
      aqi: snapshot.aqi,
      solarGhi: snapshot.solarGhi,
      heatIndexC: extracted.heatIndexC,
      humidityPct: extracted.humidityPct,
      riskLevel: decision.risk_level,
      action: decision.action,
      agentTier: tier,
      explanation: decision.explanation,
      confidence: decision.confidence,
      llmResponse: llmResponseJson, // null for pure-rule decisions
    },
  });

  // Update polling state
  await db.pollingState.upsert({
    where: { siteId },
    create: {
      siteId,
      lastEnvParamsAt: now,
      lastDecisionAction: decision.action,
      lastDecisionRisk: decision.risk_level,
      lastDecisionConfidence: decision.confidence,
    },
    update: {
      lastEnvParamsAt: now,
      lastDecisionAction: decision.action,
      lastDecisionRisk: decision.risk_level,
      lastDecisionConfidence: decision.confidence,
    },
  });

  // Emit alert if elevated or critical (deduplicated)
  let alertId: number | null = null;
  if (decision.risk_level === 'ELEVATED' || decision.risk_level === 'CRITICAL') {
    const severity: 'ELEVATED' | 'CRITICAL' =
      decision.risk_level === 'CRITICAL' ? 'CRITICAL' : 'ELEVATED';
    const actionLabel = decision.action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const title = `${severity}: ${actionLabel} — ${site.label}`;
    const demoPrefix = isDemoMode() ? '[DEMO] ' : '';
    if (await shouldEmitAlert(siteId, severity)) {
      const alert = await db.alert.create({
        data: {
          siteId,
          eventId: event.id,
          severity,
          action: decision.action,
          title: demoPrefix + title,
          message: decision.explanation,
        },
      });
      alertId = alert.id;
    }
  }

  return { tier, decision, eventId: event.id, alertId };
}

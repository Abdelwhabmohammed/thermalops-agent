// Wet-bulb tiers + composite risk.
// Mostly ported from backend/agent/risk_scorer.py.
//
// Composite score blends four pieces:
//   - wet-bulb temp (main OSHA signal) → 45 pts
//   - AQI → 25 pts
//   - solar GHI → 15 pts
//   - SVI → 15 pts
//
// Simple cases use rules; in-between cases use LLM.

import type { RiskLevel, AgentAction, WetBulbTier } from './schemas';

// OSHA/NIOSH wet-bulb thresholds (°C)
export const WB_CAUTION_MAX = 25.0;
export const WB_MODERATE_MAX = 28.0;
export const WB_DANGER_MAX = 32.0;

// AQI thresholds (US AQI) per EPA
const AQI_GOOD_MAX = 50;
const AQI_MODERATE_MAX = 100;
const AQI_USG_MAX = 150;
const AQI_UNHEALTHY_MAX = 200;

// Solar irradiance thresholds (W/m² GHI)
const SOLAR_LOW_MAX = 400;
const SOLAR_HIGH_MAX = 800;

export function classifyWetBulb(wbC: number | null | undefined): WetBulbTier {
  if (wbC === null || wbC === undefined) return 'CAUTION'; // unknown → conservative low (still hits LLM)
  if (wbC < WB_CAUTION_MAX) return 'CAUTION';
  if (wbC < WB_MODERATE_MAX) return 'MODERATE';
  if (wbC < WB_DANGER_MAX) return 'DANGER';
  return 'EXTREME';
}

export interface SiteSnapshot {
  tempC: number | null;
  wetBulbC: number | null;
  aqi: number | null;
  solarGhi: number | null;
  sviOverall: number | null;          // RPL_THEMES, 0-1
  sviHousingTransport: number | null; // RPL_THEME4
  crewSize: number;
}

export interface RiskAssessment {
  wetBulbTier: WetBulbTier;
  compositeScore: number; // 0-100, weighted
  ruleRiskLevel: RiskLevel; // what rules say (LLM may override)
  ruleAction: AgentAction;
  isClearCut: boolean; // true if rules alone give a confident decision
}

function aqiComponent(aqi: number | null | undefined): number {
  if (aqi === null || aqi === undefined) return 5.0; // unknown but assume low
  if (aqi <= AQI_GOOD_MAX) return 0.0;
  if (aqi <= AQI_MODERATE_MAX) return 5.0;
  if (aqi <= AQI_USG_MAX) return 12.0;
  if (aqi <= AQI_UNHEALTHY_MAX) return 20.0;
  return 25.0;
}

function solarComponent(ghi: number | null | undefined): number {
  if (ghi === null || ghi === undefined) return 3.0;
  if (ghi <= SOLAR_LOW_MAX) return 0.0;
  if (ghi <= SOLAR_HIGH_MAX) return 7.0;
  return 15.0;
}

function sviComponent(sviOverall: number | null | undefined): number {
  if (sviOverall === null || sviOverall === undefined) return 5.0;
  return Math.min(15.0, sviOverall * 15.0);
}

function wetBulbComponent(wb: number | null | undefined): number {
  if (wb === null || wb === undefined) return 10.0;
  if (wb < WB_CAUTION_MAX) return 0.0;
  if (wb < WB_MODERATE_MAX) {
    // 25-28: linear 5-15
    return 5.0 + (wb - WB_CAUTION_MAX) * (10.0 / (WB_MODERATE_MAX - WB_CAUTION_MAX));
  }
  if (wb < WB_DANGER_MAX) {
    // 28-32: linear 15-30
    return 15.0 + (wb - WB_MODERATE_MAX) * (15.0 / (WB_DANGER_MAX - WB_MODERATE_MAX));
  }
  // > 32: 30-45
  return Math.min(45.0, 30.0 + (wb - WB_DANGER_MAX) * 3.75);
}

export function assess(snapshot: SiteSnapshot): RiskAssessment {
  const wbTier = classifyWetBulb(snapshot.wetBulbC);
  const composite =
    wetBulbComponent(snapshot.wetBulbC) +
    aqiComponent(snapshot.aqi) +
    sviComponent(snapshot.sviOverall) +
    solarComponent(snapshot.solarGhi);

  // Rule-based risk + action mapping
  let ruleRisk: RiskLevel;
  let ruleAction: AgentAction;
  if (wbTier === 'EXTREME') {
    ruleRisk = 'CRITICAL';
    ruleAction = 'stop_work_order';
  } else if (wbTier === 'DANGER') {
    ruleRisk = 'ELEVATED';
    ruleAction = 'stop_work_order';
  } else if (wbTier === 'MODERATE') {
    ruleRisk = 'ELEVATED';
    ruleAction = 'advisory';
  } else {
    // CAUTION — also check composite for AQI-driven risk
    if (composite >= 60) {
      ruleRisk = 'CRITICAL';
      ruleAction = 'stop_work_order';
    } else if (composite >= 30) {
      ruleRisk = 'ELEVATED';
      ruleAction = 'advisory';
    } else {
      ruleRisk = 'LOW';
      ruleAction = 'clear';
    }
  }

  // Clear-cut (rule-only, no LLM needed)?
  //   - Clear: WB is CAUTION and composite < 25
  //   - Unambiguous CRITICAL: WB is EXTREME and composite >= 80
  const isClearCut =
    (wbTier === 'CAUTION' && composite < 25.0) ||
    (wbTier === 'EXTREME' && composite >= 80.0);

  return {
    wetBulbTier: wbTier,
    compositeScore: Math.round(composite * 10) / 10,
    ruleRiskLevel: ruleRisk,
    ruleAction,
    isClearCut,
  };
}

export function needsProModel(snapshot: SiteSnapshot, assessment: RiskAssessment): boolean {
  // Cases that need Pro reasoning:
  //  - WB is DANGER (28-32) — borderline band where action choice depends on AQI+SVI+solar
  //  - WB is CAUTION but composite is ELEVATED (30-60) — AQI-driven risk
  //  - SVI >= 0.85 — environmental-justice context needs prose
  if (assessment.wetBulbTier === 'DANGER') return true;
  if (assessment.wetBulbTier === 'CAUTION' && assessment.compositeScore >= 30 && assessment.compositeScore < 60) {
    return true;
  }
  if (snapshot.sviOverall !== null && snapshot.sviOverall >= 0.85) return true;
  return false;
}

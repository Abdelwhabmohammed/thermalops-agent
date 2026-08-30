// Shared API types — mirror the API route responses.

export type RiskLevel = 'LOW' | 'ELEVATED' | 'CRITICAL';
export type AgentAction = 'clear' | 'advisory' | 'stop_work_order' | 'emergency_escalate';
export type WetBulbTier = 'CAUTION' | 'MODERATE' | 'DANGER' | 'EXTREME';
export type AgentTier = 'rule' | 'flash' | 'pro';

export interface Site {
  id: number;
  label: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  site_type: string;
  crew_size: number;
  is_active: boolean;
  created_at: string;
  current_risk_level: RiskLevel | null;
  current_action: AgentAction | null;
  current_confidence: number | null;
  current_temp_c: number | null;
  current_temp_at: string | null;
  last_env_params_at: string | null;
  svi_overall: number | null;
  svi_housing_transport: number | null;
  fips_tract: string | null;
  last_event_id: number | null;
  last_event_at: string | null;
}

export interface Alert {
  id: number;
  site_id: number;
  event_id: number | null;
  severity: 'ELEVATED' | 'CRITICAL';
  action: AgentAction;
  title: string;
  message: string;
  created_at: string;
  is_acknowledged: boolean;
  acknowledged_at: string | null;
  site_label: string;
  latitude: number;
  longitude: number;
}

export interface SiteStatus {
  site_id: number;
  label: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  current_risk_level: RiskLevel | null;
  current_action: AgentAction | null;
  current_confidence: number | null;
  current_temp_c: number | null;
  current_temp_at: string | null;
  last_env_params_at: string | null;
  svi_overall: number | null;
  svi_theme4_housing_transport: number | null;
  fips_tract: string | null;
  recent_events: SiteEvent[];
}

export interface SiteEvent {
  id: number;
  site_id: number;
  polled_at: string;
  temp_c: number | null;
  wet_bulb_c: number | null;
  aqi: number | null;
  solar_ghi: number | null;
  heat_index_c: number | null;
  humidity_pct: number | null;
  risk_level: RiskLevel | null;
  action: AgentAction | null;
  agent_tier: AgentTier | null;
  explanation: string | null;
  confidence: number | null;
}

export interface Health {
  status: 'ok' | 'degraded';
  mode: 'demo' | 'live';
  env: string;
  fortyguard_plan: string;
  fortyguard_api_key_set: boolean;
  gemini_api_key_set: boolean;
  scheduler_enabled: boolean;
  database_ok: boolean;
  database_error: string | null;
}

export interface PollResult {
  site_id: number;
  tier: AgentTier | 'skip' | 'deferred' | 'error';
  decision: Record<string, unknown> | null;
  event_id: number | null;
  alert_id: number | null;
  reason: string | null;
}

// -- Shift planner / forecast ----------------------------------------------------

export type HourClassification = 'SAFE' | 'CAUTION' | 'RESTRICTED' | 'STOP';

export interface ForecastPoint {
  hour: number;
  timestamp: string;
  tempC: number | null;
  wetBulbC: number | null;
  aqi: number | null;
  heatIndexC: number | null;
  humidityPct: number | null;
  classification: HourClassification;
}

export interface WorkWindow {
  startHour: number;
  endHour: number;
  classification: HourClassification;
  avgWetBulbC: number | null;
  peakWetBulbC: number | null;
  recommendation: string;
}

export interface RoiEstimate {
  crewSize: number;
  hourlyWageUsd: number;
  exposedHours: number;
  crewHoursAtRisk: number;
  avgProductivityLossPct: number;
  dailyProductivityLossUsd: number;
  hotSeasonLossUsd: number;
  incidentExposureUsd: number;
  methodology: string[];
}

export interface ForecastResponse {
  site_id: number;
  date: string | null;
  series: ForecastPoint[];
  windows: WorkWindow[];
  best_window: WorkWindow | null;
  roi: RoiEstimate | null;
  generated_at: string | null;
  source?: string;
  note?: string;
}

// -- On-demand analyses -----------------------------------------------------------

export type AnalysisType = 'satellite' | 'streetview' | 'heat_intelligence';

export interface AnalysisResponse {
  id?: number;
  analysis_id?: number;
  type: AnalysisType;
  status: 'none' | 'Processing' | 'Completed' | 'Failed';
  payload: Record<string, unknown> | null;
  image?: string | null;
  has_pdf?: boolean;
  error?: string | null;
  created_at?: string;
}

// -- Map probe (scout before registering) -------------------------------------------

export interface ProbeInstant {
  temp_c: number;
  humidity_pct: number | null;
  aqi: number | null;
  wet_bulb_c: number | null;
  wet_bulb_estimated: boolean;
  tier: WetBulbTier;
  risk_level: RiskLevel;
  action: AgentAction;
  composite_score: number;
  source: string;
}

export interface ProbeDeep {
  temp_c: number | null;
  stats: Record<string, unknown> | null;
  source: string;
  error?: string;
}

export interface ProbeResponse {
  latitude: number;
  longitude: number;
  instant: ProbeInstant | null;
  deep: ProbeDeep | null;
  svi: {
    county: string | null;
    tract: string | null;
    rplThemes: number | null;
    stateCode: string | null;
  } | null;
  suggested: { label: string; city: string | null; state: string | null };
}

// -- State Watch (regional sentinel sweep) --------------------------------------------

export interface StateInfo {
  code: string;
  name: string;
  sentinel_count: number;
  monitored_count: number;
}

export interface SentinelReading {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  city: string;
  site_type: string;
  crew_size: number;
  temp_c: number | null;
  humidity_pct: number | null;
  wet_bulb_c: number | null;
  aqi: number | null;
  svi_pct: number | null;
  tier: WetBulbTier | null;
  risk_level: RiskLevel | null;
  action: AgentAction | null;
  composite_score: number | null;
  source: string | null;
  error: string | null;
  monitored_site_id: number | null;
}

export interface StateSweepResponse {
  state: string;
  state_name: string;
  swept_at: string;
  cached: boolean;
  sentinels: SentinelReading[];
  summary: {
    total: number;
    monitored: number;
    elevated: number;
    critical: number;
    crews_exposed: number;
    avg_wet_bulb_c: number | null;
  };
}

// -- Portfolio summary -------------------------------------------------------------

export interface SummaryResponse {
  sites: number;
  crews_protected: number;
  elevated_sites: number;
  critical_sites: number;
  active_alerts: number;
  critical_alerts: number;
  avg_wet_bulb_c: number | null;
  crew_hours_at_risk_today: number;
  productivity_loss_today_usd: number;
  hot_season_loss_usd: number;
  incident_exposure_usd: number;
  decisions_24h: number;
  decisions_by_tier: { rule: number; flash: number; pro: number };
  last_reading_at: string | null;
}

// Shift planner + cost-of-inaction model.
// Every 24-hour forecast becomes a work-plan tool: classify each hour (SAFE/CAUTION/RESTRICTED/STOP),
// find the best window for heavy work, and estimate daily $ loss from heat stress & incident risk.
// ROI model: 2% productivity loss per °C above 25°C (ILO 2019), + $55k claim cost (NSC), + OSHA fines.

export type HourClassification = 'SAFE' | 'CAUTION' | 'RESTRICTED' | 'STOP';

export interface SeriesPoint {
  hour: number; // 0-23 site-local
  timestamp: string;
  tempC: number | null;
  wetBulbC: number | null;
  aqi: number | null;
  heatIndexC: number | null;
  humidityPct: number | null;
  classification: HourClassification;
}

export interface WorkWindow {
  startHour: number; // inclusive
  endHour: number;   // exclusive
  classification: HourClassification;
  avgWetBulbC: number | null;
  peakWetBulbC: number | null;
  recommendation: string;
}

export interface RoiEstimate {
  crewSize: number;
  hourlyWageUsd: number;
  exposedHours: number;          // workday hours at MODERATE+ heat stress
  crewHoursAtRisk: number;       // crewSize × exposedHours
  avgProductivityLossPct: number;
  dailyProductivityLossUsd: number;
  hotSeasonLossUsd: number;      // daily × 90-day season
  incidentExposureUsd: number;   // one heat illness ≈ claim + lost day
  methodology: string[];
}

// -- Thresholds (shared with risk-scorer semantics) ----------------------------

const WB_CAUTION = 25.0;  // °C — NIOSH action limit
const WB_DANGER = 28.0;   // °C — mandatory rest cycles
const WB_EXTREME = 32.0;  // °C — stop-work
const AQI_CAUTION = 100;  // EPA: unhealthy for sensitive groups
const AQI_RESTRICTED = 150;
const AQI_STOP = 200;

const DEFAULT_WAGE_USD = Number(process.env.DEFAULT_HOURLY_WAGE_USD ?? 36);
const HOT_SEASON_DAYS = Number(process.env.HOT_SEASON_DAYS ?? 90);
const CLAIM_COST_USD = 55_000;
const WORK_START_HOUR = 6;
const WORK_END_HOUR = 18;

export function classifyHour(wetBulbC: number | null, aqi: number | null): HourClassification {
  const wb = wetBulbC;
  if (wb !== null && wb >= WB_EXTREME) return 'STOP';
  if (aqi !== null && aqi > AQI_STOP) return 'STOP';
  if (wb !== null && wb >= WB_DANGER) return 'RESTRICTED';
  if (aqi !== null && aqi > AQI_RESTRICTED) return 'RESTRICTED';
  if ((wb !== null && wb >= WB_CAUTION) || (aqi !== null && aqi > AQI_CAUTION)) return 'CAUTION';
  if (wb === null) return 'CAUTION'; // unknown → conservative
  return 'SAFE';
}

const RECOMMENDATIONS: Record<HourClassification, string> = {
  SAFE: 'Full work capacity — schedule heavy exertion (pouring, roofing, excavation) in this window.',
  CAUTION: 'Heat advisory — mandatory hydration + 10-min shade breaks every 2 hours.',
  RESTRICTED: 'Work/rest cycles only — ≥15 min rest per hour in shade; light duties; buddy checks.',
  STOP: 'Stop-work — no outdoor exertion. Relocate crew to cooled shelter.',
};

export function classifySeries(series: Omit<SeriesPoint, 'classification'>[]): SeriesPoint[] {
  return series.map((p) => ({ ...p, classification: classifyHour(p.wetBulbC, p.aqi) }));
}

/** Merge consecutive same-classification hours into windows. */
export function buildWorkWindows(series: SeriesPoint[]): WorkWindow[] {
  const windows: WorkWindow[] = [];
  let i = 0;
  while (i < series.length) {
    const cls = series[i].classification;
    let j = i;
    while (j < series.length && series[j].classification === cls) j++;
    const slice = series.slice(i, j);
    const wbs = slice.map((p) => p.wetBulbC).filter((v): v is number => v !== null);
    windows.push({
      startHour: slice[0].hour,
      endHour: slice[slice.length - 1].hour + 1,
      classification: cls,
      avgWetBulbC: wbs.length ? wbs.reduce((a, b) => a + b, 0) / wbs.length : null,
      peakWetBulbC: wbs.length ? Math.max(...wbs) : null,
      recommendation: RECOMMENDATIONS[cls],
    });
    i = j;
  }
  return windows;
}

/** The single most demo-worthy sentence: today's recommended heavy-work window. */
export function bestWorkWindow(windows: WorkWindow[]): WorkWindow | null {
  const safe = windows.filter((w) => w.classification === 'SAFE');
  if (!safe.length) return null;
  // Prefer SAFE hours inside a sensible workday (04:00–20:00 local) — crews
  // start at dawn, not 1 AM. Fall back to any SAFE window for true night ops.
  const DAY_START = 4;
  const DAY_END = 20;
  const clipped = safe
    .map((w) => ({
      ...w,
      startHour: Math.max(w.startHour, DAY_START),
      endHour: Math.min(w.endHour, DAY_END),
    }))
    .filter((w) => w.endHour - w.startHour > 0)
    .sort(
      (a, b) => (b.endHour - b.startHour) - (a.endHour - a.startHour) || a.startHour - b.startHour,
    );
  if (clipped.length) return clipped[0];
  return [...safe].sort(
    (a, b) => (b.endHour - b.startHour) - (a.endHour - a.startHour) || a.startHour - b.startHour,
  )[0];
}

/**
 * Cost-of-inaction estimate for one site, one day.
 * Productivity model: 2% loss per °C WBGT above 25 (ILO 2019), applied to
 * in-kind crew cost during the 06:00–18:00 workday.
 */
export function computeRoi(
  series: SeriesPoint[],
  crewSize: number,
  hourlyWageUsd: number = DEFAULT_WAGE_USD,
): RoiEstimate {
  const workday = series.filter((p) => p.hour >= WORK_START_HOUR && p.hour < WORK_END_HOUR);
  let exposedHours = 0;
  let lossSum = 0;
  let lossHours = 0;
  for (const p of workday) {
    if (p.wetBulbC !== null && p.wetBulbC > WB_CAUTION) {
      exposedHours += 1;
      const lossPct = Math.min(50, (p.wetBulbC - WB_CAUTION) * 2);
      lossSum += lossPct;
      lossHours += 1;
    }
  }
  const avgLossPct = lossHours > 0 ? lossSum / lossHours : 0;

  // Per-hour dollar loss: crew × wage × loss% (only for hours above threshold).
  const dailyLoss = workday.reduce((sum, p) => {
    if (p.wetBulbC === null || p.wetBulbC <= WB_CAUTION) return sum;
    const lossPct = Math.min(50, (p.wetBulbC - WB_CAUTION) * 2);
    return sum + crewSize * hourlyWageUsd * (lossPct / 100);
  }, 0);

  // One heat incident ≈ workers' comp claim + one lost crew-day.
  const incidentExposure = CLAIM_COST_USD + crewSize * hourlyWageUsd * 8;

  return {
    crewSize,
    hourlyWageUsd,
    exposedHours,
    crewHoursAtRisk: crewSize * exposedHours,
    avgProductivityLossPct: Math.round(avgLossPct * 10) / 10,
    dailyProductivityLossUsd: Math.round(dailyLoss),
    hotSeasonLossUsd: Math.round(dailyLoss * HOT_SEASON_DAYS),
    incidentExposureUsd: Math.round(incidentExposure),
    methodology: [
      `Productivity loss: 2% per °C wet-bulb above 25°C (ILO, "Working on a warmer planet", 2019), applied to ${crewSize}-person crew at $${hourlyWageUsd.toFixed(0)}/hr for the ${WORK_START_HOUR}:00–${WORK_END_HOUR}:00 workday.`,
      `Heat-illness claim exposure: ≈$55,000 average workers' compensation claim (National Safety Council) plus one lost crew-day.`,
      `Hot-season projection: daily loss × ${HOT_SEASON_DAYS} exposed days. OSHA's proposed Heat Injury & Illness Prevention Rule would make these controls mandatory — our decision trail is the audit record.`,
    ],
  };
}

export function hourLabel(h: number): string {
  const hh = h % 24;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const disp = hh % 12 === 0 ? 12 : hh % 12;
  return `${disp}${ampm}`;
}

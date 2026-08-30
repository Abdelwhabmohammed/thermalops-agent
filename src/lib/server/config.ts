// Environment-driven config

function envBool(key: string, def = false): boolean {
  const v = process.env[key];
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function envInt(key: string, def: number): number {
  const v = parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}

export const config = {
  fortyguard: {
    get apiKey(): string { return process.env.FORTYGUARD_API_KEY ?? ''; },
    get baseUrl(): string { return process.env.FORTYGUARD_BASE_URL ?? 'https://api.fortyguard.com/v1'; },
    get plan(): string { return (process.env.FORTYGUARD_PLAN ?? 'premium').toLowerCase(); },
    get isPremium(): boolean { return this.plan === 'premium'; },
    pollIntervalSeconds: envInt('FORTYGUARD_POLL_INTERVAL_SECONDS', 5),
    maxPollSeconds: envInt('FORTYGUARD_MAX_POLL_SECONDS', 600),
  },
  gemini: {
    // GEMINI_API_KEY or GOOGLE_API_KEY
    get apiKey(): string { return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? ''; },
    get proModel(): string { return process.env.GEMINI_PRO_MODEL ?? 'gemini-3.7-flash'; },
    get flashModel(): string { return process.env.GEMINI_FLASH_MODEL ?? 'gemini-3.6-flash'; },
    proRpm: envInt('GEMINI_PRO_RPM', 5),
    flashRpm: envInt('GEMINI_FLASH_RPM', 15),
  },
  svi: {
    // Relative to project root
    get csvPath(): string {
      return process.env.CDC_SVI_CSV_PATH ?? 'data/SVI_2022_US.csv';
    },
    get censusGeocoderUrl(): string {
      return (
        process.env.CENSUS_GEOCODER_URL ??
        'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'
      );
    },
  },
  scheduler: {
    enabled: envBool('POLLER_ENABLED', true),
    pollIntervalMinutes: envInt('POLLER_INTERVAL_MINUTES', 5),
    heatmapRefreshIntervalMinutes: envInt('HEATMAP_REFRESH_INTERVAL_MINUTES', 60),
  },
  app: {
    get env(): string { return process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development'; },
    get logLevel(): string { return process.env.LOG_LEVEL ?? 'INFO'; },
  },
} as const;

/**
 * Demo mode when no API key configured (or DEMO_MODE=true).
 * Fakes FortyGuard & Gemini calls, but exercises the full loop.
 */
export function isDemoMode(): boolean {
  if (envBool('DEMO_MODE', false)) return true;
  return config.fortyguard.apiKey.length === 0;
}

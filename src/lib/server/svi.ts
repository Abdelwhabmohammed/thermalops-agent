// CDC Social Vulnerability Index lookup.
// This is the lightweight version: geocode a point to a tract, then pull the
// matching SVI row from the CSV.
//
// The CSV uses -999 for missing values; we normalize that to null.

import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';

const SVI_NULL = -999.0;

export interface SviData {
  fipsTract: string;
  countyName: string | null;
  tractName: string | null;
  rplThemes: number | null;
  rplTheme1: number | null;
  rplTheme2: number | null;
  rplTheme3: number | null;
  rplTheme4: number | null;
}

// -- Minimal CSV parser (RFC-4180 quoted fields) --------------------------------

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function numOrNull(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return v === SVI_NULL ? null : v;
}

// -- In-memory CSV cache (module-level singleton) ---------------------------------

interface SviRow {
  rplThemes: number | null;
  rplTheme1: number | null;
  rplTheme2: number | null;
  rplTheme3: number | null;
  rplTheme4: number | null;
  countyName: string;
  tractName: string;
}

const globalForSvi = globalThis as unknown as {
  thermalopsSviCache?: Map<string, SviRow>;
  thermalopsSviLoadPromise?: Promise<Map<string, SviRow>>;
};

async function loadSviCsv(): Promise<Map<string, SviRow>> {
  if (globalForSvi.thermalopsSviCache) return globalForSvi.thermalopsSviCache;
  if (globalForSvi.thermalopsSviLoadPromise) return globalForSvi.thermalopsSviLoadPromise;

  globalForSvi.thermalopsSviLoadPromise = (async () => {
    // CSV path is env-configurable — the turbopackIgnore comment opts the
    // build tracer out of trying to statically resolve it.
    const csvPath = path.resolve(/* turbopackIgnore: true */ process.cwd(), config.svi.csvPath);
    const cache = new Map<string, SviRow>();
    let content: string;
    try {
      content = await fs.readFile(csvPath, 'utf-8');
    } catch {
      throw new Error(
        `SVI CSV not found at ${csvPath}. Run scripts/download-svi.mjs first.`,
      );
    }
    console.log('[svi] Loading SVI CSV from', csvPath);

    const lines = content.split('\n');
    const header = parseCsvLine(lines[0].replace(/^\uFEFF/, ''));
    const colIdx = (name: string) => header.findIndex((h) => h.trim() === name);

    const iFips = colIdx('FIPS');
    const iThemes = colIdx('RPL_THEMES');
    const iT1 = colIdx('RPL_THEME1');
    const iT2 = colIdx('RPL_THEME2');
    const iT3 = colIdx('RPL_THEME3');
    const iT4 = colIdx('RPL_THEME4');
    const iCounty = colIdx('COUNTY');
    const iLoc = colIdx('LOCATION');

    for (let li = 1; li < lines.length; li++) {
      const line = lines[li];
      if (!line.trim()) continue;
      const row = parseCsvLine(line);
      const fips = (row[iFips] ?? '').trim().padStart(11, '0');
      if (fips.length !== 11) continue;
      cache.set(fips, {
        rplThemes: numOrNull(row[iThemes]),
        rplTheme1: numOrNull(row[iT1]),
        rplTheme2: numOrNull(row[iT2]),
        rplTheme3: numOrNull(row[iT3]),
        rplTheme4: numOrNull(row[iT4]),
        countyName: (row[iCounty] ?? '').trim(),
        tractName: (row[iLoc] ?? '').trim(),
      });
    }
    console.log(`[svi] Loaded ${cache.size} tracts from SVI CSV`);
    globalForSvi.thermalopsSviCache = cache;
    return cache;
  })();

  return globalForSvi.thermalopsSviLoadPromise;
}

// -- Census Geocoder ---------------------------------------------------------------

interface CensusTract {
  STATE?: string | number;
  COUNTY?: string | number;
  TRACT?: string | number;
  BASENAME?: string;
  NAME?: string;
}

async function censusGeocode(
  lat: number,
  lng: number,
  retries = 2,
): Promise<CensusTract[] | null> {
  const params = new URLSearchParams({
    x: String(lng), // Census Geocoder uses x=lon, y=lat
    y: String(lat),
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    format: 'json',
    layers: 'Census Tracts',
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${config.svi.censusGeocoderUrl}?${params.toString()}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.status === 200) {
        const body = (await resp.json()) as {
          result?: { geographies?: Record<string, CensusTract[]> };
        };
        return body?.result?.geographies?.['Census Tracts'] ?? [];
      }
      if (resp.status === 429) {
        console.warn('[svi] Census Geocoder 429 — sleeping 2s');
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.warn(`[svi] Census Geocoder returned ${resp.status} for (${lat}, ${lng})`);
      return null;
    } catch (e) {
      console.warn(`[svi] Census Geocoder error (attempt ${attempt + 1}): ${String(e)}`);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000));
      else return null;
    }
  }
  return null;
}

// -- Public API --------------------------------------------------------------------

export async function sviLookup(lat: number, lng: number): Promise<SviData | null> {
  const tracts = await censusGeocode(lat, lng);
  if (!tracts || tracts.length === 0) return null;

  const t = tracts[0];
  const stateFips = String(t.STATE ?? '').padStart(2, '0');
  const countyFips = String(t.COUNTY ?? '').padStart(3, '0');
  const tract = String(t.TRACT ?? '').padStart(6, '0');
  const fips = stateFips + countyFips + tract;
  if (fips.length !== 11) return null;

  let csv: Map<string, SviRow>;
  try {
    csv = await loadSviCsv();
  } catch (e) {
    // Missing CSV shouldn't kill site registration — rethrow as-is so caller
    // can record a soft failure and continue.
    throw e;
  }
  const row = csv.get(fips);
  if (!row) {
    console.warn(`[svi] FIPS ${fips} not in SVI CSV`);
    return null;
  }
  return {
    fipsTract: fips,
    countyName: row.countyName || (t.BASENAME ?? null),
    tractName: row.tractName || (t.NAME ?? null),
    rplThemes: row.rplThemes,
    rplTheme1: row.rplTheme1,
    rplTheme2: row.rplTheme2,
    rplTheme3: row.rplTheme3,
    rplTheme4: row.rplTheme4,
  };
}

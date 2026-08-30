// Seed 5 demo sites across Phoenix, Houston, Chicago.
// Ported from scripts/seed_sites.py.
//
// Usage:  node scripts/seed-sites.mjs
//
// Requires: `npm run db:push` first (creates the SQLite schema) and
// `node scripts/download-svi.mjs` for real CDC SVI scores (soft-fails
// gracefully without it — SVI rows are simply left unset).

import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

// 5 demo sites — picked to span risk levels (Phoenix = extreme, Houston =
// elevated, Chicago = low). Crew sizes are fictional.
const DEMO_SITES = [
  {
    label: 'Phoenix Downtown Construction Site',
    latitude: 33.4484,
    longitude: -112.074,
    city: 'Phoenix',
    state: 'AZ',
    site_type: 'construction',
    crew_size: 28,
    notes: 'Foundation pour for 12-story mixed-use',
  },
  {
    label: 'Phoenix South Mountain Crew',
    latitude: 33.3822,
    longitude: -112.0797,
    city: 'Phoenix',
    state: 'AZ',
    site_type: 'construction',
    crew_size: 15,
    notes: 'Road resurfacing, full sun exposure',
  },
  {
    label: 'Houston East End Logistics Hub',
    latitude: 29.7432,
    longitude: -95.314,
    city: 'Houston',
    state: 'TX',
    site_type: 'logistics',
    crew_size: 42,
    notes: 'Loading dock, mixed shade',
  },
  {
    label: 'Houston Sunnyside Warehouse',
    latitude: 29.6859,
    longitude: -95.3095,
    city: 'Houston',
    state: 'TX',
    site_type: 'logistics',
    crew_size: 18,
    notes: 'High-SVI tract; mostly outdoor work',
  },
  {
    label: 'Chicago West Loop Tower',
    latitude: 41.881,
    longitude: -87.649,
    city: 'Chicago',
    state: 'IL',
    site_type: 'construction',
    crew_size: 35,
    notes: 'Steel erection, mid-rise',
  },
];

// -- Compact SVI lookup (Census Geocoder REST + local CSV) ------------------------

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}

let sviCache = null;

function loadSviCsv() {
  if (sviCache) return sviCache;
  const csvPath = path.resolve(process.cwd(), process.env.CDC_SVI_CSV_PATH ?? 'data/SVI_2022_US.csv');
  if (!existsSync(csvPath)) return null;
  const lines = readFileSync(csvPath, 'utf-8').split('\n');
  const header = parseCsvLine(lines[0].replace(/^\uFEFF/, ''));
  const idx = (name) => header.findIndex((h) => h.trim() === name);
  const iFips = idx('FIPS'), iT = idx('RPL_THEMES'),
    i1 = idx('RPL_THEME1'), i2 = idx('RPL_THEME2'), i3 = idx('RPL_THEME3'), i4 = idx('RPL_THEME4'),
    iCounty = idx('COUNTY'), iLoc = idx('LOCATION');
  const num = (raw) => {
    const s = (raw ?? '').trim();
    if (!s) return null;
    const v = Number(s);
    if (!Number.isFinite(v)) return null;
    return v === -999 ? null : v;
  };
  sviCache = new Map();
  for (let li = 1; li < lines.length; li++) {
    if (!lines[li].trim()) continue;
    const row = parseCsvLine(lines[li]);
    const fips = (row[iFips] ?? '').trim().padStart(11, '0');
    if (fips.length !== 11) continue;
    sviCache.set(fips, {
      rplThemes: num(row[iT]), rplTheme1: num(row[i1]), rplTheme2: num(row[i2]),
      rplTheme3: num(row[i3]), rplTheme4: num(row[i4]),
      countyName: (row[iCounty] ?? '').trim(), tractName: (row[iLoc] ?? '').trim(),
    });
  }
  console.log(`Loaded ${sviCache.size} tracts from SVI CSV`);
  return sviCache;
}

async function censusGeocode(lat, lng) {
  const params = new URLSearchParams({
    x: String(lng), y: String(lat),
    benchmark: 'Public_AR_Current', vintage: 'Current_Current',
    format: 'json', layers: 'Census Tracts',
  });
  const resp = await fetch(
    `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?${params}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!resp.ok) throw new Error(`census geocoder HTTP ${resp.status}`);
  const body = await resp.json();
  return body?.result?.geographies?.['Census Tracts'] ?? [];
}

async function sviLookup(lat, lng) {
  const tracts = await censusGeocode(lat, lng);
  if (!tracts.length) return null;
  const t = tracts[0];
  const fips =
    String(t.STATE ?? '').padStart(2, '0') +
    String(t.COUNTY ?? '').padStart(3, '0') +
    String(t.TRACT ?? '').padStart(6, '0');
  if (fips.length !== 11) return null;
  const csv = loadSviCsv();
  if (!csv) return null;
  const row = csv.get(fips);
  if (!row) return null;
  return { fipsTract: fips, ...row };
}

// -- Seed ----------------------------------------------------------------------------

async function main() {
  const existing = await prisma.site.findMany({ select: { label: true } });
  const existingLabels = new Set(existing.map((s) => s.label));
  let added = 0;

  for (const siteDef of DEMO_SITES) {
    if (existingLabels.has(siteDef.label)) {
      console.log(`Skipping existing site: ${siteDef.label}`);
      continue;
    }
    const site = await prisma.site.create({
      data: {
        label: siteDef.label,
        latitude: siteDef.latitude,
        longitude: siteDef.longitude,
        city: siteDef.city,
        state: siteDef.state,
        siteType: siteDef.site_type,
        crewSize: siteDef.crew_size,
        notes: siteDef.notes,
      },
    });
    added++;
    console.log(`Registered site ${site.id}: ${site.label}`);

    // Eager SVI lookup for demo reproducibility.
    try {
      const svi = await sviLookup(siteDef.latitude, siteDef.longitude);
      if (svi) {
        await prisma.sviCache.upsert({
          where: { siteId: site.id },
          create: { siteId: site.id, ...svi },
          update: { ...svi },
        });
        console.log(`  SVI cached: FIPS=${svi.fipsTract} rpl_themes=${svi.rplThemes}`);
      } else {
        console.warn(`  SVI lookup returned no data for ${siteDef.label}`);
      }
    } catch (e) {
      console.warn(`  SVI lookup failed for ${siteDef.label}: ${e}`);
    }
  }

  const total = await prisma.site.count();
  console.log(`Seeded ${added} new sites (total: ${total})`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

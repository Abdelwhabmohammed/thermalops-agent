#!/usr/bin/env node
// Download the CDC SVI 2022 nationwide tract-level CSV (~60MB, 84k tracts).
// Ported from scripts/download_svi.py.
//
// Usage:  node scripts/download-svi.mjs
//
// The SVI portal serves files through svi2.cdc.gov/webapi (linked from
// https://www.atsdr.cdc.gov/placeandhealth/svi/data_documentation_download.html).
// It requires browser-like headers — we send them explicitly.

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { unlink, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const SVI_CSV_URL =
  'https://svi2.cdc.gov/webapi/Documents/download?year=2022&type=csv&category=states&name=SVI_2022_US';
const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.atsdr.cdc.gov/place-health/php/svi/svi-data-documentation-download.html',
  Origin: 'https://www.atsdr.cdc.gov',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-site',
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const OUT_PATH = path.resolve(process.cwd(), process.env.CDC_SVI_CSV_PATH ?? 'data/SVI_2022_US.csv');

async function main() {
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  if (existsSync(OUT_PATH) && statSync(OUT_PATH).size > 10_000_000) {
    console.log(`SVI CSV already exists at ${OUT_PATH} (${statSync(OUT_PATH).size} bytes)`);
    return 0;
  }

  console.log(`Downloading SVI 2022 CSV (~60MB) from svi2.cdc.gov ...`);
  let resp;
  try {
    resp = await fetch(SVI_CSV_URL, { headers: BROWSER_HEADERS, redirect: 'follow' });
  } catch (e) {
    console.error(`Download failed: ${e}`);
    console.error('Download manually from https://www.atsdr.cdc.gov/placeandhealth/svi/data_documentation_download.html');
    return 1;
  }
  if (!resp.ok) {
    console.error(`Download failed: HTTP ${resp.status}`);
    console.error('Download manually from https://www.atsdr.cdc.gov/placeandhealth/svi/data_documentation_download.html');
    return 1;
  }

  const tmpPath = OUT_PATH + '.tmp';
  try {
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(tmpPath));
  } catch (e) {
    await unlink(tmpPath).catch(() => {});
    console.error(`Download failed mid-stream: ${e}`);
    return 1;
  }

  // Verify it looks like the right CSV.
  const head = (await readFile(tmpPath, 'utf-8')).slice(0, 4000);
  const headerLine = head.split('\n')[0] ?? '';
  const needed = ['FIPS', 'COUNTY', 'LOCATION', 'RPL_THEMES'];
  const missing = needed.filter((c) => !headerLine.includes(c));
  if (missing.length > 0) {
    await unlink(tmpPath).catch(() => {});
    console.error(`Verification failed — missing columns: ${missing.join(', ')}`);
    console.error(`Got header: ${headerLine.slice(0, 200)}`);
    return 1;
  }

  await rename(tmpPath, OUT_PATH);
  const size = statSync(OUT_PATH).size;
  console.log(`Saved SVI 2022 CSV to ${OUT_PATH} (${(size / 1e6).toFixed(1)} MB)`);
  return 0;
}

process.exit(await main());

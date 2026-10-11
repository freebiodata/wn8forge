#!/usr/bin/env node
/**
 * Fetches the raw data the site is built from into data-raw/.
 *
 * Sources (all public, no API key required):
 *  - wn8exp.json          XVM's official WN8 expected tank values (v31+ format, keyed by tank_id)
 *  - tank_map.json        game-file vehicle metadata (tag → tank_id, name, tier, nation, class)
 *                         from Tomato-gg/wot-decompiled-stats (decompiled World of Tanks client files)
 *  - tank_stats.json      per-tank stats (view range, HP, class) keyed by tank_id
 *  - tank_id_to_code.json tank_id → game-file tag cross-check table
 *
 * Run `npm run data:fetch`, then `npm run data:generate` to re-emit src/data/etv.ts.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data-raw');

const SOURCES = [
  {
    file: 'wn8exp.json',
    url: 'https://static.modxvm.com/wn8-data-exp/json/wn8exp.json',
    // The canonical XVM expected-values endpoint. Mirrors exist, but the XVM
    // server is the source referenced by wn8.info and most WN8 tools.
  },
  {
    file: 'tank_map.json',
    url: 'https://raw.githubusercontent.com/Tomato-gg/wot-decompiled-stats/master/tank_map.json',
  },
  {
    file: 'tank_stats.json',
    url: 'https://raw.githubusercontent.com/Tomato-gg/wot-decompiled-stats/master/tank_stats.json',
  },
  {
    file: 'tank_id_to_code.json',
    url: 'https://raw.githubusercontent.com/Tomato-gg/wot-decompiled-stats/master/sitedata/tank_id_to_code.json',
  },
];

await mkdir(RAW, { recursive: true });

for (const { file, url } of SOURCES) {
  process.stdout.write(`fetching ${file} … `);
  const res = await fetch(url, { headers: { 'user-agent': 'wn8forge data pipeline' } });
  if (!res.ok) {
    console.error(`FAILED (${res.status} ${res.statusText}) — keeping the cached copy in data-raw/`);
    continue;
  }
  const body = await res.text();
  JSON.parse(body); // fail fast on truncated/HTML responses
  await writeFile(path.join(RAW, file), body);
  console.log(`ok (${(body.length / 1024).toFixed(0)} kB)`);
}

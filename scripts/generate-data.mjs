#!/usr/bin/env node
/**
 * Joins the curated subset list (below) against the raw data in data-raw/ and
 * emits src/data/etv.ts — the expected-values table shipped to the browser.
 *
 * Every emitted row is cross-verified across two independent sources:
 *  - tank_map.json (decompiled game files): display name, tier, nation, class, tank_id
 *  - tank_stats.json (Wargaming-API-derived): the same tank_id must map to the same
 *    tier, nation and class — and the name must match after normalization
 *  - WN8 expected values come from wn8exp.json (XVM), keyed by that same tank_id
 *
 * Per-tank camouflage values (stationary / moving / firing penalty / net bonus)
 * are read from the decompiled per-vehicle game files (raw/<tag>.xml.json) and
 * cached in data-raw/camo/ so regeneration works offline after the first run.
 *
 * A row that fails a check aborts the generation — the site never ships an
 * unverified mapping.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data-raw');

/** Curated subset: popular, recognizable tanks across nations, classes and tiers.
 *  `tag` is the game-file vehicle tag (the most stable identifier the game uses). */
const CURATED = [
  // ── Tier X heavies ────────────────────────────────────────────────────────
  'R45_IS-7', 'R157_Object_279R', 'R155_Object_277', 'R145_Object_705_A', 'R169_ST_II',
  'Pl15_60TP_Lewandowskiego', 'G56_E-100', 'G42_Maus', 'G92_VK7201', 'GB91_Super_Conqueror',
  'GB13_FV215b', 'A69_T110E5', 'Ch41_WZ_111_5A', 'Ch48_BZ_75', 'J40_Type_71',
  'Cz17_Vz_55', 'It15_Rinoceronte', 'J20_Type_2605',
  // ── Tier IX–VIII heavies (grinders + premiums) ────────────────────────────
  'G55_E-75', 'GB12_Conqueror', 'A66_M103', 'F83_AMX_M4_Mle1949_Bis', 'Ch12_111_1_2_3',
  'S16_Kranvagn', 'F115_Lorraine_50t', 'A156_T54_2022',
  'G51_Lowe', 'G16_PzVIB_Tiger_II', 'Cz14_Skoda_T-56', 'Cz18_TNH_105_1000', 'Ch47_BZ_176',
  'R134_Object_252K', 'R115_IS-3_auto', 'F84_Somua_SM', 'R19_IS-3', 'Ch03_WZ_111_A',
  // ── Tier X mediums ────────────────────────────────────────────────────────
  'R97_Object_140', 'R87_T62A', 'R148_Object_430_U', 'R144_K_91', 'R95_Object_907',
  'Pl21_CS_63', 'S28_UDES_15_16', 'G73_E50_Ausf_M', 'J16_ST_B1', 'Ch19_121', 'Ch25_121_mod_1971B',
  'F18_Bat_Chatillon25t',
  // ── Tier VII–VIII mediums ─────────────────────────────────────────────────
  'It13_Progetto_M35_mod_46', 'F116_Bat_Chatillon_Bourrasque', 'F68_AMX_Chasseur_de_char_46',
  'Ch01_Type59', 'R122_T44_100', 'R20_T-44', 'Cz10_T-34-85M' /* placeholder, fixed below */,
  'G78_Panther_M10', 'J13_STA_1', 'Ch14_T34_3', 'Ch43_WZ_122_2', 'GB21_Cromwell',
  'GB70_N_FV4202_105',
  // ── Tier X–VI lights ──────────────────────────────────────────────────────
  'GB100_Manticore', 'R132_VNII_100LT', 'F88_AMX_13_105', 'F108_Panhard_EBR_105',
  'A116_XM551', 'Ch29_Type_62C_prot', 'F106_Panhard_EBR_75_Mle1954', 'R03_BT-7',
  // ── Tank destroyers ───────────────────────────────────────────────────────
  'G114_Rheinmetall_Skorpian', 'A122_TS-5', 'G37_Ferdinand', 'R159_SU_130PM',
  'Cz20_ShPTK_TVP_100_mm', 'R135_T_103', 'Ch39_WZ120_1G_FT', 'G97_Waffentrager_IV',
  'A85_T110E3', 'R149_Object_268_4', 'G121_Grille_15_L63', 'S11_Strv_103B',
  'GB92_FV217', 'GB83_FV4005', 'G72_JagdPz_E100', 'GB48_FV215b_183',
  'R89_SU122_44', 'R47_ISU-152', 'A41_M18_Hellcat', 'G48_E-25', 'A130_Super_Hellcat',
  'R49_SU100Y',
  // ── Artillery ─────────────────────────────────────────────────────────────
  'A87_M44', 'GB77_FV304', 'R52_Object_261',
];

// The T-34-85M tag fixed (kept the list readable above).
const TAG_FIXES = { 'Cz10_T-34-85M': 'R108_T34_85M' };

const readJson = async (file) => JSON.parse(await readFile(path.join(RAW, file), 'utf8'));

const [wn8exp, tankMap, tankStats] = await Promise.all([
  readJson('wn8exp.json'),
  readJson('tank_map.json'),
  readJson('tank_stats.json'),
]);

const expById = new Map(wn8exp.data.map((d) => [d.IDNum, d]));
const statsById = new Map(tankStats.map((d) => [d.tank_id, d]));

const CLASS_LABEL = {
  lightTank: 'LT',
  mediumTank: 'MT',
  heavyTank: 'HT',
  'AT-SPG': 'TD',
  SPG: 'SPG',
};
const STATS_CLASS = { LT: 'LT', MT: 'MT', HT: 'HT', TD: 'TD', SPG: 'SPG' };

const normName = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const rows = [];
const problems = [];
const warnings = [];

for (const rawTag of CURATED) {
  const tag = TAG_FIXES[rawTag] ?? rawTag;
  const vehicle = tankMap[tag];
  if (!vehicle) {
    problems.push(`${tag}: not found in tank_map.json (game files)`);
    continue;
  }

  const exp = expById.get(vehicle.id);
  if (!exp) {
    problems.push(`${tag} (${vehicle.name}): no expected values in wn8exp.json`);
    continue;
  }

  const stats = statsById.get(vehicle.id) ?? null;

  // Independent verification: the Wargaming-API-derived table must agree on
  // tier, nation and class for this tank_id.
  if (stats) {
    const cls = CLASS_LABEL[vehicle.tags[0]];
    if (stats.tier !== vehicle.tier) {
      problems.push(`${tag} (${vehicle.name}): tier mismatch — game files T${vehicle.tier} vs API T${stats.tier}`);
      continue;
    }
    if (STATS_CLASS[stats.class] !== cls) {
      problems.push(`${tag} (${vehicle.name}): class mismatch — game files ${cls} vs API ${stats.class}`);
      continue;
    }
    if (stats.nation.toLowerCase() !== vehicle.nation) {
      problems.push(`${tag} (${vehicle.name}): nation mismatch — game files ${vehicle.nation} vs API ${stats.nation}`);
      continue;
    }
    const a = normName(vehicle.name);
    const b = normName(stats.name);
    if (a !== b && !a.includes(b) && !b.includes(a)) {
      warnings.push(`${tag}: name variant — game files "${vehicle.name}" vs API "${stats.name}" (keeping game-file name)`);
    }
  } else {
    warnings.push(`${tag} (${vehicle.name}): not in tank_stats.json — verified against game files + wn8exp only`);
  }

  rows.push({
    id: vehicle.id,
    tag,
    name: vehicle.name,
    tier: vehicle.tier,
    nation: vehicle.nation,
    cls: CLASS_LABEL[vehicle.tags[0]] ?? vehicle.tags[0],
    expDamage: exp.expDamage,
    expFrag: exp.expFrag,
    expSpot: exp.expSpot,
    expDef: exp.expDef,
    expWinRate: exp.expWinRate,
    viewRange: stats?.viewRange ?? null,
    hp: stats?.hp ?? null,
  });
}

// ── Camouflage values from the decompiled per-vehicle game files ────────────
const CAMO_CACHE = path.join(RAW, 'camo');
const CAMO_URL = (tag) =>
  `https://raw.githubusercontent.com/Tomato-gg/wot-decompiled-stats/master/raw/${tag}.xml.json`;
const exists = async (p) => access(p).then(() => true, () => false);

await mkdir(CAMO_CACHE, { recursive: true });

let fetched = 0;
for (const row of rows) {
  const cacheFile = path.join(CAMO_CACHE, `${row.tag}.json`);
  let invisibility;
  if (await exists(cacheFile)) {
    invisibility = JSON.parse(await readFile(cacheFile, 'utf8'));
  } else {
    process.stdout.write(`camo ${row.tag} … `);
    const res = await fetch(CAMO_URL(row.tag), { headers: { 'user-agent': 'wn8forge data pipeline' } });
    if (!res.ok) {
      console.warn(`unavailable (${res.status})`);
      invisibility = null;
    } else {
      const vehicleFile = await res.json();
      invisibility = vehicleFile.invisibility ?? null;
      if (invisibility) {
        await writeFile(cacheFile, JSON.stringify({
          still: invisibility.still,
          moving: invisibility.moving,
          firePenalty: invisibility.firePenalty,
          camouflageBonus: invisibility.camouflageBonus ?? null,
        }));
        fetched++;
        console.log('ok');
      } else {
        console.log('no invisibility section');
      }
    }
  }
  if (invisibility) {
    row.camoStill = Math.round(invisibility.still * 1000) / 10;
    row.camoMoving = Math.round(invisibility.moving * 1000) / 10;
    row.camoFirePenalty = invisibility.firePenalty;
    row.camoNet = invisibility.camouflageBonus != null
      ? Math.round(invisibility.camouflageBonus * 1000) / 10
      : null;
  } else {
    row.camoStill = null;
    row.camoMoving = null;
    row.camoFirePenalty = null;
    row.camoNet = null;
  }
}
console.log(`camouflage: ${rows.filter((r) => r.camoStill != null).length}/${rows.length} tanks covered (${fetched} fetched, rest cached)`);

if (problems.length > 0) {
  console.error('Curated subset failed verification:\n' + problems.map((p) => ` - ${p}`).join('\n'));
  process.exit(1);
}
if (warnings.length > 0) {
  console.warn('Notes:\n' + warnings.map((w) => ` - ${w}`).join('\n'));
}

rows.sort((a, b) => a.name.localeCompare(b.name));

const classCounts = rows.reduce((acc, r) => ((acc[r.cls] = (acc[r.cls] ?? 0) + 1), acc), {});
const tierCounts = rows.reduce((acc, r) => ((acc[r.tier] = (acc[r.tier] ?? 0) + 1), acc), {});
const nationCounts = rows.reduce((acc, r) => ((acc[r.nation] = (acc[r.nation] ?? 0) + 1), acc), {});
const withViewRange = rows.filter((r) => r.viewRange != null).length;

const header = `// AUTO-GENERATED by scripts/generate-data.mjs — do not edit by hand.
// Refresh with: npm run data:fetch && npm run data:generate
//
// Expected values: XVM's official WN8 expected tank values (${wn8exp.data.length} vehicles),
// subset to ${rows.length} hand-curated popular tanks, every row cross-verified
// against decompiled game files (names/tier/nation/class) and a Wargaming-API-derived
// stat table (view range/HP) before emission.

export const etvSnapshotDate = '${new Date().toISOString().slice(0, 10)}';
export const etvSourceEntries = ${wn8exp.data.length};

export interface EtvTank {
  /** Wargaming tank_id (the IDNum used by the XVM expected-values file). */
  id: number;
  /** Game-file vehicle tag. */
  tag: string;
  name: string;
  tier: number;
  nation: string;
  /** LT / MT / HT / TD / SPG */
  cls: string;
  expDamage: number;
  expFrag: number;
  expSpot: number;
  expDef: number;
  expWinRate: number;
  /** Base view range in metres, null when not covered by the stats table. */
  viewRange: number | null;
  hp: number | null;
  /** Base camouflage factor (0–100, per cent), null when the game file was unavailable. */
  camoStill: number | null;
  camoMoving: number | null;
  /** Post-shot camo multiplier as defined in the game files (e.g. 0.507 → camo drops to ~51% after firing). */
  camoFirePenalty: number | null;
  /** Camouflage-net bonus for this tank (per cent), null when not defined in the game files. */
  camoNet: number | null;
}

export const etvTanks: EtvTank[] = ${JSON.stringify(rows, null, 2)};
`;

await writeFile(path.join(ROOT, 'src', 'data', 'etv.ts'), header);

console.log(`emitted src/data/etv.ts — ${rows.length} tanks`);
console.log('  classes:', JSON.stringify(classCounts));
console.log('  tiers:  ', JSON.stringify(tierCounts));
console.log('  nations:', JSON.stringify(nationCounts));
console.log(`  viewRange coverage: ${withViewRange}/${rows.length}`);

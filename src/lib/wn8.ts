/**
 * WN8 - the official formula as documented by wn8.info / XVM.
 *
 *  rDAMAGE = damage / expDAMAGE      rWIN = wins / expWIN   (expWIN = Σ 0.01·expWinRate·battles)
 *  rSPOT   = spotted / expSPOT
 *  rFRAG   = frags / expFRAGS
 *  rDEF    = defPoints / expDEF
 *
 *  rWINc    = max(0, (rWIN − 0.71) / (1 − 0.71))
 *  rDAMAGEc = max(0, (rDAMAGE − 0.22) / (1 − 0.22))
 *  rFRAGc   = max(0, min(rDAMAGEc + 0.2, (rFRAG − 0.12) / (1 − 0.12)))
 *  rSPOTc   = max(0, min(rDAMAGEc + 0.1, (rSPOT − 0.38) / (1 − 0.38)))
 *  rDEFc    = max(0, min(rDAMAGEc + 0.1, (rDEF − 0.10) / (1 − 0.10)))
 *
 *  WN8 = 980·rDAMAGEc + 210·rDAMAGEc·rFRAGc + 155·rFRAGc·rSPOTc + 75·rDEFc·rFRAGc + 145·min(1.8, rWINc)
 */

export interface AggregateStats {
  battles: number;
  damageDealt: number;
  frags: number;
  spotted: number;
  /** Dropped capture points ("defense" stat). */
  defensePoints: number;
  wins: number;
}

export interface ExpectedValues {
  /** Per battle: expected damage. */
  expDamage: number;
  /** Per battle: expected kills. */
  expFrag: number;
  /** Per battle: expected spots. */
  expSpot: number;
  /** Per battle: expected defense points. */
  expDef: number;
  /** Per battle: expected win rate in per cent (51.5 → 51.5 %). */
  expWinRate: number;
}

export interface Wn8Breakdown {
  wn8: number;
  rDamage: number;
  rSpot: number;
  rFrag: number;
  rDef: number;
  rWin: number;
  rDamageC: number;
  rSpotC: number;
  rFragC: number;
  rDefC: number;
  rWinC: number;
  /** Contribution of each term to the final WN8. */
  termDamage: number;
  termDamageFrag: number;
  termFragSpot: number;
  termDefFrag: number;
  termWin: number;
}

const ZERO: ExpectedValues = { expDamage: 0, expFrag: 0, expSpot: 0, expDef: 0, expWinRate: 0 };

/** The five ratios (actual ÷ expected), guarding against zero expected totals. */
export function ratioBreakdown(stats: AggregateStats, expected: ExpectedValues): {
  rDamage: number; rSpot: number; rFrag: number; rDef: number; rWin: number;
} {
  const expWin = 0.01 * expected.expWinRate * stats.battles;
  const r = (actual: number, expTotal: number) => (expTotal > 0 ? actual / expTotal : 0);
  return {
    rDamage: r(stats.damageDealt, expected.expDamage * stats.battles),
    rSpot: r(stats.spotted, expected.expSpot * stats.battles),
    rFrag: r(stats.frags, expected.expFrag * stats.battles),
    rDef: r(stats.defensePoints, expected.expDef * stats.battles),
    rWin: r(stats.wins, expWin),
  };
}

/** The core WN8 formula from the five ratios, with every normalization step exposed. */
export function wn8FromRatios(r: {
  rDamage: number; rSpot: number; rFrag: number; rDef: number; rWin: number;
}): Wn8Breakdown {
  const rWinC = Math.max(0, (r.rWin - 0.71) / (1 - 0.71));
  const rDamageC = Math.max(0, (r.rDamage - 0.22) / (1 - 0.22));
  const rFragC = Math.max(0, Math.min(rDamageC + 0.2, (r.rFrag - 0.12) / (1 - 0.12)));
  const rSpotC = Math.max(0, Math.min(rDamageC + 0.1, (r.rSpot - 0.38) / (1 - 0.38)));
  const rDefC = Math.max(0, Math.min(rDamageC + 0.1, (r.rDef - 0.10) / (1 - 0.10)));

  const termDamage = 980 * rDamageC;
  const termDamageFrag = 210 * rDamageC * rFragC;
  const termFragSpot = 155 * rFragC * rSpotC;
  const termDefFrag = 75 * rDefC * rFragC;
  const termWin = 145 * Math.min(1.8, rWinC);

  return {
    wn8: termDamage + termDamageFrag + termFragSpot + termDefFrag + termWin,
    rDamage: r.rDamage, rSpot: r.rSpot, rFrag: r.rFrag, rDef: r.rDef, rWin: r.rWin,
    rDamageC, rSpotC, rFragC, rDefC, rWinC,
    termDamage, termDamageFrag, termFragSpot, termDefFrag, termWin,
  };
}

/**
 * Full pipeline: aggregate recent stats + the battle-weighted expected values of
 * the tank mix → WN8 (rounded to an integer, as WN8 is conventionally displayed).
 */
export function wn8(stats: AggregateStats, expected: ExpectedValues): Wn8Breakdown {
  if (stats.battles <= 0) {
    return { ...wn8FromRatios({ rDamage: 0, rSpot: 0, rFrag: 0, rDef: 0, rWin: 0 }), wn8: 0 };
  }
  return wn8FromRatios(ratioBreakdown(stats, expected ?? ZERO));
}

/** Battle-weighted expected values for a tank mix (tanks × battles). */
export function weightedExpected(
  mix: Array<{ expected: ExpectedValues; battles: number }>,
): ExpectedValues {
  let battles = 0;
  const sum: ExpectedValues = { ...ZERO };
  for (const { expected, battles: b } of mix) {
    if (b <= 0) continue;
    battles += b;
    sum.expDamage += expected.expDamage * b;
    sum.expFrag += expected.expFrag * b;
    sum.expSpot += expected.expSpot * b;
    sum.expDef += expected.expDef * b;
    sum.expWinRate += expected.expWinRate * b;
  }
  if (battles === 0) return { ...ZERO };
  return {
    expDamage: sum.expDamage / battles,
    expFrag: sum.expFrag / battles,
    expSpot: sum.expSpot / battles,
    expDef: sum.expDef / battles,
    expWinRate: sum.expWinRate / battles,
  };
}

export interface Wn8Band {
  min: number;
  label: string;
  /** Display color for the band (the widely used WN8 palette). */
  color: string;
}

/**
 * WN8 rating bands. Thresholds and colors follow the widely used scale
 * (0/450/650/850/1050/1250/1400/1600/2000/2450/2850 - e.g. the `wn8-color`
 * npm package ships exactly these cut-offs and hex values). Band *names* vary
 * between statistics sites; these labels are the common ones.
 */
export const WN8_BANDS: readonly Wn8Band[] = [
  { min: 0, label: 'Bad', color: '#8f8f8f' },
  { min: 450, label: 'Below Average', color: '#e50000' },
  { min: 650, label: 'Average', color: '#cd3333' },
  { min: 850, label: 'Above Average', color: '#d77900' },
  { min: 1050, label: 'Good', color: '#d7b600' },
  { min: 1250, label: 'Very Good', color: '#6d9251' },
  { min: 1400, label: 'Great', color: '#4c762e' },
  { min: 1600, label: 'Unicum', color: '#46a892' },
  { min: 2000, label: 'Super Unicum', color: '#4a92b7' },
  { min: 2450, label: 'High Unicum', color: '#83579d' },
  { min: 2850, label: 'Elite', color: '#5a3175' },
];

export function wn8Band(wn8Value: number): Wn8Band {
  let band: Wn8Band = WN8_BANDS[0];
  for (const b of WN8_BANDS) {
    if (wn8Value >= b.min) band = b;
  }
  return band;
}

/**
 * Marks of Excellence (MoE) projection.
 *
 * Official mechanics (Wargaming, "Awards and achievements"):
 * - The MoE rating compares your average combined damage on a Tier V–XI vehicle
 *    (damage dealt + assist damage from spots and tracks) with the recent 14-day
 *    performance of all players on that vehicle.
 * - 1 mark: higher than 65 % of players · 2 marks: 85 % · 3 marks: 95 %.
 * - Once earned, a mark is never lost.
 *
 * Wargaming does not publish the per-tank score distribution, so no threshold
 * score can be computed here. What this module does - exactly and honestly - is
 * the rolling-average arithmetic that decides how fast your 14-day average
 * moves: given your current average, the number of battles it is built on and a
 * planned per-battle score, it derives the battles needed until the average
 * reaches a target score (e.g. a mark threshold you read off a tracker).
 */

export interface MoEStanding {
  /** Current mark thresholds in per cent of players. */
  static readonly?: never;
}

export const MARK_THRESHOLDS = [65, 85, 95] as const;

/** Your current mark based on the standing (0–100 per cent). */
export function currentMark(standingPct: number): 0 | 1 | 2 | 3 {
  if (standingPct >= 95) return 3;
  if (standingPct >= 85) return 2;
  if (standingPct >= 65) return 1;
  return 0;
}

/**
 * Battles at a constant per-battle score `plannedScore` needed to lift the
 * 14-day average from `currentAverage` (over `currentBattles`) to `target`.
 *
 *   n = B · (A − T) / (T − X)
 *
 * Returns 0 when the target is already met, and null when the plan can never
 * reach it (planned score below target, or a degenerate window).
 */
export function battlesToTarget(
  currentBattles: number,
  currentAverage: number,
  plannedScore: number,
  target: number,
): number | null {
  if (currentBattles <= 0 || currentAverage <= 0) return null;
  if (currentAverage >= target) return 0;
  if (plannedScore <= target) return null;
  const n = (currentBattles * (currentAverage - target)) / (target - plannedScore);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.ceil(n);
}

/** Average after `extraBattles` battles at `plannedScore`. */
export function averageAfter(
  currentBattles: number,
  currentAverage: number,
  plannedScore: number,
  extraBattles: number,
): number {
  const total = currentBattles + extraBattles;
  if (total <= 0) return 0;
  return (currentBattles * currentAverage + extraBattles * plannedScore) / total;
}

/** Combined damage score per the official definition. */
export function combinedDamage(damage: number, assistDamage: number): number {
  return damage + assistDamage;
}

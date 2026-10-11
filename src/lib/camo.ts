/**
 * Camouflage & spotting math, following the official Wargaming wiki
 * "Camo and Spotting" mechanics page (archived 2016, mechanics unchanged):
 *
 *  camoFactor   = baseCamo × (0.00375 × camoSkill + 0.5) × shotMult + pattern + net + environment
 *                 (capped at 1)
 *  spottingRange = effectiveViewRange − effectiveViewRange × camoFactor
 *                 (targets within 50 m are always spotted; spotting is capped at 445 m)
 *
 * baseCamo is the vehicle's base camouflage factor for its current state - 
 * the game files define separate values for stationary ("still") and moving.
 * shotMult is the game files' post-shot penalty ("firePenalty"), applied while
 * the gun is firing / reloading after a shot.
 */

export type CamoState = 'stationary' | 'moving' | 'firing';

export interface CamoInput {
  /** Base stationary camo factor in per cent (e.g. 33.8 for Bourrasque). */
  baseStill: number;
  /** Base moving camo factor in per cent. */
  baseMoving: number;
  /** Post-shot multiplier from the game files (e.g. 0.507). */
  firePenalty: number;
  /** Effective Camouflage skill of the crew, 0–100. */
  camoSkill: number;
  /** Camouflage net bonus in per cent (only active when stationary ≥ 3 s). */
  net?: number;
  netActive?: boolean;
  /** Permanent camouflage pattern bonus in per cent. */
  pattern?: number;
  /** Environment (bush/tree) bonus in per cent. */
  environment?: number;
}

/** The vehicle's base camo for the chosen state, in per cent. */
export function baseCamoFor(input: CamoInput, state: CamoState): number {
  if (state === 'moving') return input.baseMoving;
  if (state === 'firing') return input.baseStill * input.firePenalty;
  return input.baseStill;
}

/**
 * The total camouflage factor as a fraction 0–1 (1 = invisible).
 * Per the wiki formula the crew-skill multiplier applies to the base camo only;
 * pattern/net/environment bonuses are added flat.
 */
export function camoFactor(input: CamoInput, state: CamoState): number {
  const base = baseCamoFor(input, state) / 100;
  const skillMultiplier = 0.00375 * clamp(input.camoSkill, 0, 100) + 0.5;
  const net = state === 'moving' || !input.netActive ? 0 : (input.net ?? 0) / 100;
  const factor =
    base * skillMultiplier +
    net +
    (input.pattern ?? 0) / 100 +
    (input.environment ?? 0) / 100;
  return clamp(factor, 0, 1);
}

export interface ViewRangeInput {
  /** Base view range in metres (game files / tankopedia). */
  baseViewRange: number;
  /** Extra view range in per cent (optics +10 %, binoculars +25 % stationary, food, BIA…). */
  viewRangeBonusPct?: number;
}

/** Effective view range in metres after percentage bonuses. */
export function effectiveViewRange({ baseViewRange, viewRangeBonusPct = 0 }: ViewRangeInput): number {
  return baseViewRange * (1 + viewRangeBonusPct / 100);
}

export const MIN_SPOTTING_RANGE = 50;
export const MAX_SPOTTING_RANGE = 445;

/**
 * Spotting range against a target with the given camo factor:
 * spottingRange = effectiveViewRange × (1 − camoFactor), capped at 445 m.
 * Targets inside 50 m are always spotted regardless of camouflage.
 */
export function spottingRange(viewRange: number, camo: number): number {
  return clamp(viewRange * (1 - camo), 0, MAX_SPOTTING_RANGE);
}

/** Distance at which you are detected by a target with the given camo factor. */
export function detectionRange(input: ViewRangeInput & { camo: CamoInput; state: CamoState }) {
  const vr = effectiveViewRange(input);
  const camo = camoFactor(input.camo, input.state);
  return spottingRange(vr, camo);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Per-cent display helper (0.3371 → "33.7 %"). */
export function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)} %`;
}

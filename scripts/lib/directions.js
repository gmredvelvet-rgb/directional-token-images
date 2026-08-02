/**
 * @file Direction vocabulary, image-slot modes and the pure geometry that maps a movement vector
 * onto a direction slot. Everything here is a pure function of its inputs: no Foundry globals are
 * touched, which keeps the quantisation logic trivially unit-testable and reusable by third parties.
 * @module directional-token-images/lib/directions
 */

import { I18N } from "../constants.js";

/**
 * A direction slot key. `"default"` is the fallback slot used by single-image mode and as the last
 * resort for every other mode.
 * @typedef {"n"|"ne"|"e"|"se"|"s"|"sw"|"w"|"nw"|"default"} DirectionKey
 */

/**
 * @typedef {object} Vector2
 * @property {number} dx Horizontal displacement in pixels. Positive is East (screen right).
 * @property {number} dy Vertical displacement in pixels. Positive is South (screen down).
 */

/** The fallback slot key. @type {DirectionKey} */
export const DEFAULT_SLOT = "default";

/**
 * The eight compass directions in clockwise screen order starting at East.
 * The order matters: {@link quantiseEightWay} walks it to build angular sectors.
 * @type {ReadonlyArray<DirectionKey>}
 */
export const COMPASS_ORDER = Object.freeze(["e", "se", "s", "sw", "w", "nw", "n", "ne"]);

/**
 * Every storable slot, including the fallback. Used when reading/writing/clearing flag data so the
 * shape of stored data never depends on the currently selected mode.
 * @type {ReadonlyArray<DirectionKey>}
 */
export const ALL_SLOTS = Object.freeze([DEFAULT_SLOT, "n", "ne", "e", "se", "s", "sw", "w", "nw"]);

/** The four cardinal slots. @type {ReadonlyArray<DirectionKey>} */
export const CARDINAL_SLOTS = Object.freeze(["n", "e", "s", "w"]);

/** The four intercardinal (diagonal) slots. @type {ReadonlyArray<DirectionKey>} */
export const DIAGONAL_SLOTS = Object.freeze(["ne", "se", "sw", "nw"]);

/**
 * Screen-space angle, in degrees, of the centre of each direction sector.
 * Screen coordinates: 0° is East and angles increase clockwise because `y` grows downwards.
 * @type {Readonly<Record<string, number>>}
 */
export const DIRECTION_ANGLES = Object.freeze({
  e: 0,
  se: 45,
  s: 90,
  sw: 135,
  w: 180,
  nw: 225,
  n: 270,
  ne: 315
});

/**
 * @typedef {object} DirectionMode
 * @property {number} id             The numeric mode identifier (1, 2, 4 or 8).
 * @property {DirectionKey[]} slots  The slots a token actually uses in this mode, in display order.
 * @property {DirectionKey} resting  The slot to show when a token is not moving. South — facing the
 *   camera — is the natural idle pose for every multi-image mode.
 * @property {string} labelKey       Localisation key for the mode name.
 * @property {string} hintKey        Localisation key for the mode hint.
 */

/**
 * The supported image-set modes.
 *
 * Every mode reuses the same nine storage slots, so switching modes never destroys artwork the user
 * already configured. Two-image mode deliberately maps onto `s` (facing the camera / "front") and
 * `n` (facing away / "back") rather than introducing new keys.
 *
 * @type {Readonly<Record<number, DirectionMode>>}
 */
export const MODES = Object.freeze({
  1: Object.freeze({
    id: 1,
    slots: Object.freeze([DEFAULT_SLOT]),
    resting: DEFAULT_SLOT,
    labelKey: `${I18N}.MODES.1.label`,
    hintKey: `${I18N}.MODES.1.hint`
  }),
  2: Object.freeze({
    id: 2,
    slots: Object.freeze(["s", "n"]),
    resting: "s",
    labelKey: `${I18N}.MODES.2.label`,
    hintKey: `${I18N}.MODES.2.hint`
  }),
  4: Object.freeze({
    id: 4,
    slots: Object.freeze(["n", "s", "w", "e"]),
    resting: "s",
    labelKey: `${I18N}.MODES.4.label`,
    hintKey: `${I18N}.MODES.4.hint`
  }),
  8: Object.freeze({
    id: 8,
    slots: Object.freeze(["n", "ne", "e", "se", "s", "sw", "w", "nw"]),
    resting: "s",
    labelKey: `${I18N}.MODES.8.label`,
    hintKey: `${I18N}.MODES.8.hint`
  })
});

/** Valid mode identifiers. @type {ReadonlyArray<number>} */
export const MODE_IDS = Object.freeze([1, 2, 4, 8]);

/** Sentinel stored on a token that should follow the world default mode. @type {string} */
export const MODE_INHERIT = "inherit";

/**
 * Clamp a number into an inclusive range without relying on Foundry's `Math.clamp` extension.
 * @param {number} value The value to clamp.
 * @param {number} min   Lower bound.
 * @param {number} max   Upper bound.
 * @returns {number} The clamped value.
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Normalise an angle into the `[0, 360)` range.
 * @param {number} degrees An angle in degrees.
 * @returns {number} The equivalent angle in `[0, 360)`.
 */
export function normaliseDegrees(degrees) {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Convert a movement vector into a screen-space angle in degrees.
 * @param {Vector2} vector The movement vector.
 * @returns {number} The angle in `[0, 360)`, where 0 is East and angles increase clockwise.
 */
export function vectorToAngle({ dx, dy }) {
  return normaliseDegrees((Math.atan2(dy, dx) * 180) / Math.PI);
}

/**
 * Rotate a movement vector. Used by projection-aware direction providers (isometric, rotated hex
 * layouts, custom camera rigs) to convert world-space movement into facing space.
 * @param {Vector2} vector  The vector to rotate.
 * @param {number} degrees  The rotation to apply, in degrees, clockwise on screen.
 * @returns {Vector2} The rotated vector.
 */
export function rotateVector({ dx, dy }, degrees) {
  if (!degrees) return { dx, dy };
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}

/**
 * Is the given slot one of the four cardinal directions?
 * @param {DirectionKey} slot The slot to test.
 * @returns {boolean} True for `n`, `e`, `s` or `w`.
 */
export function isCardinal(slot) {
  return CARDINAL_SLOTS.includes(slot);
}

/* -------------------------------------------- */
/*  Quantisation                                */
/* -------------------------------------------- */

/**
 * Two-image mode: the token only distinguishes "towards the camera" from "away from the camera".
 * Purely horizontal movement returns `null` so the caller keeps the current artwork.
 * @param {Vector2} vector The facing-space movement vector.
 * @returns {DirectionKey|null} `"s"` (front), `"n"` (back) or `null`.
 */
function quantiseTwoWay({ dy }) {
  if (dy > 0) return "s";
  if (dy < 0) return "n";
  return null;
}

/**
 * Four-image mode. Implements the classic dominant-axis rule:
 * `|dx| > |dy|` means horizontal movement, otherwise vertical.
 *
 * `sensitivity` biases the comparison: values above 1 require horizontal movement to be more
 * pronounced before it wins (making the token prefer North/South artwork), values below 1 make
 * horizontal movement win more easily.
 *
 * @param {Vector2} vector      The facing-space movement vector.
 * @param {number} sensitivity  The axis dominance bias.
 * @returns {DirectionKey|null} The selected slot, or `null` when there is no movement at all.
 */
function quantiseFourWay({ dx, dy }, sensitivity) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return null;
  if (ax > ay * sensitivity) return dx > 0 ? "e" : "w";
  if (ay > 0) return dy > 0 ? "s" : "n";
  return dx > 0 ? "e" : "w";
}

/**
 * Eight-image mode. The circle is divided into eight sectors whose widths are driven by
 * `sensitivity`: the four cardinal sectors are `45 * sensitivity` degrees wide and the four
 * diagonal sectors absorb the remainder, so a sensitivity above 1 favours cardinal artwork and a
 * sensitivity below 1 favours diagonals. The total always sums to exactly 360 degrees.
 *
 * @param {Vector2} vector      The facing-space movement vector.
 * @param {number} sensitivity  The cardinal sector bias.
 * @returns {DirectionKey|null} The selected slot, or `null` when there is no movement at all.
 */
function quantiseEightWay({ dx, dy }, sensitivity) {
  if (dx === 0 && dy === 0) return null;
  const cardinalWidth = clamp(45 * sensitivity, 10, 80);
  const diagonalWidth = 90 - cardinalWidth;

  // Shift by half a cardinal sector so the East sector starts exactly at 0 and sectors can be
  // consumed with a single forward walk.
  let remaining = normaliseDegrees(vectorToAngle({ dx, dy }) + cardinalWidth / 2);
  for (const slot of COMPASS_ORDER) {
    const width = isCardinal(slot) ? cardinalWidth : diagonalWidth;
    if (remaining < width) return slot;
    remaining -= width;
  }
  return COMPASS_ORDER[0];
}

/**
 * Map a facing-space movement vector onto a direction slot for the given mode.
 * @param {Vector2} vector             The facing-space movement vector.
 * @param {number} mode                One of {@link MODE_IDS}.
 * @param {object} [options]           Tuning options.
 * @param {number} [options.sensitivity=1] The direction sensitivity, see the per-mode notes above.
 * @returns {DirectionKey|null} The direction slot, or `null` when the vector carries no usable
 *   direction for this mode (the caller must then keep the current artwork).
 */
export function quantise(vector, mode, { sensitivity = 1 } = {}) {
  switch (mode) {
    case 1:
      return DEFAULT_SLOT;
    case 2:
      return quantiseTwoWay(vector);
    case 4:
      return quantiseFourWay(vector, sensitivity);
    case 8:
      return quantiseEightWay(vector, sensitivity);
    default:
      return quantiseFourWay(vector, sensitivity);
  }
}

/* -------------------------------------------- */
/*  Fallbacks                                   */
/* -------------------------------------------- */

/**
 * Static component axes for the diagonal slots, used to derive graceful fallbacks when a diagonal
 * image has not been configured.
 * @type {Readonly<Record<string, [DirectionKey, DirectionKey]>>}
 */
const DIAGONAL_COMPONENTS = Object.freeze({
  ne: ["n", "e"],
  se: ["s", "e"],
  sw: ["s", "w"],
  nw: ["n", "w"]
});

/**
 * Horizontally opposite slots.
 *
 * When horizontal mirroring is enabled these pairs let one drawing serve both sides: the artwork for
 * West is the East drawing flipped, and so on for the diagonals. North and South have no entry
 * because flipping a front-facing or back-facing drawing produces the same view, not the opposite
 * one.
 *
 * @type {Readonly<Record<string, DirectionKey>>}
 */
export const MIRROR_PAIRS = Object.freeze({
  e: "w",
  w: "e",
  ne: "nw",
  nw: "ne",
  se: "sw",
  sw: "se"
});

/**
 * One step of a fallback chain.
 * @typedef {object} FallbackStep
 * @property {DirectionKey} slot The slot to read an image from.
 * @property {boolean} mirrored  Whether that image must be flipped horizontally to serve as the
 *   artwork for the direction originally requested.
 */

/**
 * Build the ordered list of candidates to try when resolving artwork for a direction.
 *
 * The order is deliberate:
 *  1. the direction's own image;
 *  2. when mirroring is enabled, the horizontally opposite image, flipped — visually far closer
 *     than any cardinal substitute;
 *  3. for diagonals, their component cardinals, ordered by whichever axis actually dominated the
 *     movement, so a token drifting mostly East while heading North-East falls back to East;
 *  4. the shared {@link DEFAULT_SLOT}.
 *
 * @param {DirectionKey} slot          The preferred slot.
 * @param {Vector2} [vector]           The movement vector that produced the slot, used to order
 *   diagonal fallbacks. Optional; a stable order is used when omitted.
 * @param {object} [options]
 * @param {boolean} [options.mirror=false] Allow horizontally mirrored substitutes.
 * @returns {FallbackStep[]} The ordered fallback chain, starting with `slot` itself.
 */
export function getFallbackChain(slot, vector, { mirror = false } = {}) {
  if (slot === DEFAULT_SLOT) return [{ slot: DEFAULT_SLOT, mirrored: false }];

  const chain = [{ slot, mirrored: false }];
  const opposite = mirror ? MIRROR_PAIRS[slot] : undefined;
  if (opposite) chain.push({ slot: opposite, mirrored: true });

  const components = DIAGONAL_COMPONENTS[slot];
  if (components) {
    const [vertical, horizontal] = components;
    const horizontalDominates = vector ? Math.abs(vector.dx) >= Math.abs(vector.dy) : false;
    const ordered = horizontalDominates ? [horizontal, vertical] : [vertical, horizontal];
    for (const candidate of ordered) chain.push({ slot: candidate, mirrored: false });
  }

  chain.push({ slot: DEFAULT_SLOT, mirrored: false });
  return chain;
}

/**
 * Coerce an arbitrary stored value into a valid mode id.
 * @param {*} value             The stored value (may be a string, number, `null` or `undefined`).
 * @param {number} [fallback=4] The mode to use when `value` is not a valid mode.
 * @returns {number} A valid mode id.
 */
export function coerceMode(value, fallback = 4) {
  const numeric = Number(value);
  return MODE_IDS.includes(numeric) ? numeric : fallback;
}

/**
 * @file Shared render-context builder for every surface that edits directional data.
 *
 * The standalone configurator, the Token Configuration tab and the prototype-token sheet all render
 * the *same* Handlebars partials from the *same* context, so a field only ever has to be defined
 * once and the three surfaces can never drift apart.
 *
 * @module directional-token-images/apps/field-builder
 */

import { I18N, MODULE_ID, VIDEO_EXTENSIONS, VISION_FACING } from "../constants.js";
import { ALL_SLOTS, DEFAULT_SLOT, MODES, MODE_IDS, MODE_INHERIT } from "../lib/directions.js";
import { DirectionalTokenData } from "../lib/token-images.js";
import { getModeChoices } from "../settings/settings.js";

/**
 * @typedef {import("../lib/directions.js").DirectionKey} DirectionKey
 * @typedef {import("../lib/token-images.js").DirectionalData} DirectionalData
 */

/**
 * The input-name prefix shared by every surface. Using the flag path directly means the Token
 * Configuration sheet submits our fields through core's own form handling with no extra code.
 * @type {string}
 */
export const FIELD_PREFIX = `flags.${MODULE_ID}.`;

/**
 * Presentation metadata for each direction slot: which modes show it, the arrow glyph and the CSS
 * accent class that colours it.
 * @type {Readonly<Record<DirectionKey, {icon: string, modes: number[], order: number}>>}
 */
export const SLOT_META = Object.freeze({
  [DEFAULT_SLOT]: { icon: "fa-solid fa-image", modes: [1, 2, 4, 8], order: 0 },
  n: { icon: "fa-solid fa-arrow-up", modes: [2, 4, 8], order: 1 },
  ne: { icon: "fa-solid fa-arrow-up-right", modes: [8], order: 2 },
  e: { icon: "fa-solid fa-arrow-right", modes: [4, 8], order: 3 },
  se: { icon: "fa-solid fa-arrow-down-right", modes: [8], order: 4 },
  s: { icon: "fa-solid fa-arrow-down", modes: [2, 4, 8], order: 5 },
  sw: { icon: "fa-solid fa-arrow-down-left", modes: [8], order: 6 },
  w: { icon: "fa-solid fa-arrow-left", modes: [4, 8], order: 7 },
  nw: { icon: "fa-solid fa-arrow-up-left", modes: [8], order: 8 }
});

/**
 * Slots ordered the way the UI lists them: the fallback first, then North, South, West, East (the
 * order a user reading the mock-up expects), then the diagonals.
 * @type {ReadonlyArray<DirectionKey>}
 */
export const DISPLAY_ORDER = Object.freeze([DEFAULT_SLOT, "n", "s", "w", "e", "nw", "ne", "sw", "se"]);

/**
 * Does this path point at a video file?
 * @param {string} src The image path.
 * @returns {boolean} True for webm/mp4/m4v/ogv.
 */
export function isVideo(src) {
  if (!src) return false;
  const extension = src.split("?")[0].split(".").pop()?.toLowerCase();
  return VIDEO_EXTENSIONS.has(extension);
}

/**
 * Build the per-slot rows for the image column.
 *
 * The same rows drive the preview compass, which is why each row carries both its own raw `value`
 * and the `resolved` path that the fallback chain would actually display.
 *
 * @param {DirectionalData} data     The normalised data.
 * @param {DirectionKey} previewSlot The slot the preview stage is currently showing.
 * @returns {object[]} One row descriptor per slot.
 */
export function buildImageRows(data, previewSlot) {
  const mode = DirectionalTokenData.resolveMode(data);
  return DISPLAY_ORDER.map(slot => {
    const meta = SLOT_META[slot];
    const src = data.images[slot] ?? "";
    const artwork = DirectionalTokenData.resolveArtwork(data, slot);
    return {
      slot,
      name: `${FIELD_PREFIX}images.${slot}`,
      value: src,
      icon: meta.icon,
      // Consumed by the mode filter: a space separated list is trivial to match with a selector.
      modes: meta.modes.join(" "),
      hidden: !meta.modes.includes(mode),
      label: `${I18N}.DIRECTIONS.${slot}.label`,
      hint: `${I18N}.DIRECTIONS.${slot}.hint`,
      hasValue: !!src,
      resolved: artwork?.src ?? "",
      // True when this direction is being served by the opposite side's drawing, flipped.
      isMirrored: artwork?.mirrored === true,
      isPreviewSlot: slot === previewSlot,
      isVideo: isVideo(src)
    };
  });
}

/**
 * Build the numeric transform rows for the position/scale column.
 * @param {DirectionalData} data The normalised data.
 * @returns {object[]} One row descriptor per numeric field.
 */
export function buildTransformRows(data) {
  return [
    {
      name: `${FIELD_PREFIX}art.offsetX`,
      value: data.art.offsetX,
      label: `${I18N}.TRANSFORM.offsetX`,
      min: -500,
      max: 500,
      step: 1
    },
    {
      name: `${FIELD_PREFIX}art.offsetY`,
      value: data.art.offsetY,
      label: `${I18N}.TRANSFORM.offsetY`,
      min: -500,
      max: 500,
      step: 1
    },
    {
      name: `${FIELD_PREFIX}art.offsetZ`,
      value: data.art.offsetZ,
      label: `${I18N}.TRANSFORM.offsetZ`,
      min: -100,
      max: 100,
      step: 1
    },
    {
      name: `${FIELD_PREFIX}art.scale`,
      value: data.art.scale,
      label: `${I18N}.TRANSFORM.artScale`,
      min: 0.1,
      max: 5,
      step: 0.05
    },
    {
      name: `${FIELD_PREFIX}base.scale`,
      value: data.base.scale,
      label: `${I18N}.TRANSFORM.baseScale`,
      min: 0.1,
      max: 5,
      step: 0.05,
      requiresBase: true
    },
    {
      name: `${FIELD_PREFIX}base.rotation`,
      value: data.base.rotation,
      label: `${I18N}.TRANSFORM.baseRotation`,
      min: -180,
      max: 180,
      step: 1,
      suffix: "°",
      requiresBase: true
    }
  ];
}

/**
 * Build the complete shared render context.
 * @param {DirectionalData} data  The normalised data.
 * @param {object} [options]
 * @param {boolean} [options.compact=false] Render the single-column tab layout instead of the
 *   two-column standalone layout.
 * @param {DirectionKey} [options.previewSlot] The slot the preview stage should show. Defaults to
 *   the first slot of the active mode.
 * @returns {object} The Handlebars context consumed by the shared partials.
 */
export function buildFieldContext(data, { compact = false, previewSlot } = {}) {
  const mode = DirectionalTokenData.resolveMode(data);
  const modeChoices = { [MODE_INHERIT]: `${I18N}.MODES.inherit`, ...getModeChoices() };
  const activeSlot = previewSlot ?? MODES[mode].slots[0] ?? DEFAULT_SLOT;
  const previewArtwork = DirectionalTokenData.resolveArtwork(data, activeSlot);

  return {
    dti: {
      prefix: FIELD_PREFIX,
      compact,
      data,
      mode,
      modeValue: data.mode ?? MODE_INHERIT,
      modeChoices,
      modeIds: MODE_IDS,
      loadMethod: data.loadMethod,
      isUrlMode: data.loadMethod === "url",
      pickerType: "imagevideo",
      images: buildImageRows(data, activeSlot),
      transforms: buildTransformRows(data),
      base: {
        name: `${FIELD_PREFIX}base.src`,
        value: data.base.src,
        hasValue: !!data.base.src,
        isVideo: isVideo(data.base.src)
      },
      enabled: {
        name: `${FIELD_PREFIX}enabled`,
        value: data.enabled
      },
      mirror: {
        name: `${FIELD_PREFIX}mirrorHorizontal`,
        value: data.mirrorHorizontal,
        // Only meaningful where left and right are distinct directions.
        modes: "4 8",
        hidden: ![4, 8].includes(mode)
      },
      vision: {
        name: `${FIELD_PREFIX}visionFacing`,
        value: data.visionFacing ?? VISION_FACING.INHERIT,
        choices: {
          [VISION_FACING.INHERIT]: `${I18N}.FIELDS.visionFacing.inherit`,
          [VISION_FACING.ON]: `${I18N}.FIELDS.visionFacing.on`,
          [VISION_FACING.OFF]: `${I18N}.FIELDS.visionFacing.off`
        }
      },
      previewSlot: activeSlot,
      previewSrc: previewArtwork?.src ?? "",
      previewMirrored: previewArtwork?.mirrored === true,
      allSlots: ALL_SLOTS
    }
  };
}

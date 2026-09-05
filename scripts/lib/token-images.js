/**
 * @file The per-document data model: reading, normalising, resolving and writing the directional
 * image flags stored under `flags["directional-token-images"]`.
 * @module directional-token-images/lib/token-images
 */

import { FLAGS, MODULE_ID, VISION_FACING } from "../constants.js";
import {
  ALL_SLOTS,
  DEFAULT_SLOT,
  MIRROR_PAIRS,
  MODE_INHERIT,
  MODES,
  coerceMode,
  getFallbackChain
} from "./directions.js";
import { Settings } from "../settings/settings.js";

/**
 * @typedef {import("./directions.js").DirectionKey} DirectionKey
 * @typedef {import("./directions.js").Vector2} Vector2
 */

/**
 * Artwork offset and scale applied on top of the token's own texture settings.
 * @typedef {object} ArtTransform
 * @property {number} offsetX Horizontal art offset in pixels.
 * @property {number} offsetY Vertical art offset in pixels.
 * @property {number} offsetZ Depth nudge applied to the primary-canvas sort value.
 * @property {number} scale   Multiplier applied to the token artwork.
 */

/**
 * Optional decorative base drawn underneath the token artwork.
 * @typedef {object} BaseConfig
 * @property {string} src     Image path. Empty disables the base entirely.
 * @property {number} scale   Multiplier relative to the token's grid footprint.
 * @property {number} rotation Rotation in degrees.
 */

/**
 * The normalised flag payload for one document.
 * @typedef {object} DirectionalData
 * @property {boolean} enabled                    Master switch for this token.
 * @property {string} mode                        `"inherit"` or a stringified mode id.
 * @property {boolean} mirrorHorizontal           Reuse one side's artwork for the other, flipped.
 * @property {"picker"|"url"} loadMethod          Which input widget the config UI shows.
 * @property {Record<DirectionKey, string>} images Image path per slot; empty string means unset.
 * @property {BaseConfig} base                    Optional base image configuration.
 * @property {ArtTransform} art                   Artwork offset and scale.
 * @property {"inherit"|"on"|"off"} visionFacing  Whether this token's vision/light cone follows the
 *   artwork, or defers to the world setting.
 */

/**
 * A resolved piece of artwork.
 * @typedef {object} ResolvedArtwork
 * @property {string} src               The image path to display.
 * @property {DirectionKey} sourceSlot  The slot the path was actually read from.
 * @property {boolean|null} mirrored    `true`/`false` when this token manages horizontal mirroring,
 *   `null` when mirroring is disabled and the token's own `texture.scaleX` must be left alone.
 */

/**
 * Immutable defaults for a document that has never been configured.
 * @type {Readonly<DirectionalData>}
 */
export const DEFAULT_DATA = Object.freeze({
  enabled: false,
  mode: MODE_INHERIT,
  mirrorHorizontal: false,
  loadMethod: "picker",
  images: Object.freeze(ALL_SLOTS.reduce((images, slot) => ({ ...images, [slot]: "" }), {})),
  base: Object.freeze({ src: "", scale: 1, rotation: 0 }),
  art: Object.freeze({ offsetX: 0, offsetY: 0, offsetZ: 0, scale: 1 }),
  visionFacing: VISION_FACING.INHERIT
});

/**
 * Coerce a stored value into one of the three vision-facing states, defaulting to `"inherit"` so a
 * token configured before the feature existed keeps following the world setting.
 * @param {*} value The raw value.
 * @returns {"inherit"|"on"|"off"} A valid state.
 */
function toVisionFacing(value) {
  return Object.values(VISION_FACING).includes(value) ? value : VISION_FACING.INHERIT;
}

/**
 * Coerce a value to a finite number, falling back when it is not usable.
 * @param {*} value        The raw value.
 * @param {number} fallback The fallback.
 * @returns {number} A finite number.
 */
function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Coerce a value to a trimmed string.
 * @param {*} value The raw value.
 * @returns {string} A trimmed string, empty when the value is nullish.
 */
function toPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read and normalise the directional data for a token document.
 *
 * Accepts a `Token` placeable, a `TokenDocument`, a `PrototypeToken` or an `Actor` so that callers
 * never have to unwrap the object themselves.
 */
export class DirectionalTokenData {
  /**
   * Resolve whatever the caller passed into a document that carries the flags.
   * @param {Token|TokenDocument|PrototypeToken|Actor|null} target The object to unwrap.
   * @returns {TokenDocument|PrototypeToken|null} The flag-bearing document, or `null`.
   */
  static resolveDocument(target) {
    if (!target) return null;
    // Token placeable
    if (target.document?.documentName === "Token") return target.document;
    // Actor: fall back to its prototype token
    if (target.documentName === "Actor") return target.prototypeToken ?? null;
    // TokenDocument or PrototypeToken already
    if (typeof target.getFlag === "function") return target;
    return null;
  }

  /**
   * Read the normalised directional data for a document.
   * @param {Token|TokenDocument|PrototypeToken|Actor|null} target The document (or wrapper).
   * @returns {DirectionalData} A fully populated, safe-to-read data object.
   */
  static read(target) {
    const document = DirectionalTokenData.resolveDocument(target);
    const raw = document?.flags?.[MODULE_ID] ?? {};

    const images = {};
    for (const slot of ALL_SLOTS) images[slot] = toPath(raw[FLAGS.IMAGES]?.[slot]);

    return {
      enabled: raw[FLAGS.ENABLED] === true,
      mode: raw[FLAGS.MODE] ?? MODE_INHERIT,
      mirrorHorizontal: raw[FLAGS.MIRROR] === true,
      loadMethod: raw[FLAGS.LOAD_METHOD] === "url" ? "url" : "picker",
      images,
      base: {
        src: toPath(raw[FLAGS.BASE]?.src),
        scale: toNumber(raw[FLAGS.BASE]?.scale, 1),
        rotation: toNumber(raw[FLAGS.BASE]?.rotation, 0)
      },
      art: {
        offsetX: toNumber(raw[FLAGS.ART]?.offsetX, 0),
        offsetY: toNumber(raw[FLAGS.ART]?.offsetY, 0),
        offsetZ: toNumber(raw[FLAGS.ART]?.offsetZ, 0),
        scale: toNumber(raw[FLAGS.ART]?.scale, 1)
      },
      visionFacing: toVisionFacing(raw[FLAGS.VISION])
    };
  }

  /**
   * Resolve the effective image-set mode for a document, honouring the `"inherit"` sentinel.
   * @param {DirectionalData} data The normalised data.
   * @returns {number} A valid mode id (1, 2, 4 or 8).
   */
  static resolveMode(data) {
    if (data.mode === MODE_INHERIT || data.mode === undefined || data.mode === null) {
      return coerceMode(Settings.current.defaultMode);
    }
    return coerceMode(data.mode, coerceMode(Settings.current.defaultMode));
  }

  /**
   * The slots that are meaningful for the document's current mode, in display order.
   * @param {DirectionalData} data The normalised data.
   * @returns {DirectionKey[]} The active slots.
   */
  static activeSlots(data) {
    return [...MODES[DirectionalTokenData.resolveMode(data)].slots];
  }

  /**
   * The slot a token should display while it is standing still — the idle pose used when artwork is
   * applied for the first time, before the token has ever moved.
   * @param {DirectionalData} data The normalised data.
   * @returns {DirectionKey} The resting slot.
   */
  static restingSlot(data) {
    return MODES[DirectionalTokenData.resolveMode(data)].resting;
  }

  /**
   * Resolve the artwork to display for a direction.
   *
   * Walks the slot's fallback chain — the slot's own image, then (when the token opts into
   * horizontal mirroring) the opposite side's image flipped, then the dominant cardinal, then the
   * `default` slot. Returning `null` is the documented signal that the caller must keep the token's
   * current artwork.
   *
   * @param {DirectionalData} data The normalised data.
   * @param {DirectionKey} slot    The preferred slot.
   * @param {Vector2} [vector]     The movement vector, used to order diagonal fallbacks.
   * @returns {ResolvedArtwork|null} The artwork, or `null` when nothing is configured.
   */
  static resolveArtwork(data, slot, vector) {
    if (!slot) return null;
    const mirror = data.mirrorHorizontal === true;

    for (const step of getFallbackChain(slot, vector, { mirror })) {
      const src = data.images[step.slot];
      if (!src) continue;
      return {
        src,
        sourceSlot: step.slot,
        // `null` tells the caller to leave `texture.scaleX` untouched entirely.
        mirrored: mirror ? step.mirrored : null
      };
    }
    return null;
  }

  /**
   * Resolve just the image path for a direction.
   * @param {DirectionalData} data The normalised data.
   * @param {DirectionKey} slot    The preferred slot.
   * @param {Vector2} [vector]     The movement vector, used to order diagonal fallbacks.
   * @returns {string|null} An image path, or `null` when nothing is configured.
   */
  static getImage(data, slot, vector) {
    return DirectionalTokenData.resolveArtwork(data, slot, vector)?.src ?? null;
  }

  /**
   * Find which slot a given image path is currently filling. Used to recover the "current
   * direction" after a reload without persisting any extra state.
   *
   * When the token manages mirroring and is currently flipped, a match resolves to the *opposite*
   * slot: a westward token legitimately displays the East drawing.
   *
   * @param {DirectionalData} data      The normalised data.
   * @param {string} src                The image path to look up.
   * @param {boolean} [mirrored=false]  Whether the token is currently flipped horizontally.
   * @returns {DirectionKey|null} The matching slot, or `null` when the path is not one of ours.
   */
  static findSlotForImage(data, src, mirrored = false) {
    if (!src) return null;

    const flip = slot => (mirrored && data.mirrorHorizontal ? MIRROR_PAIRS[slot] ?? slot : slot);
    for (const slot of DirectionalTokenData.activeSlots(data)) {
      if (data.images[slot] === src) return flip(slot);
    }
    return data.images[DEFAULT_SLOT] === src ? DEFAULT_SLOT : null;
  }

  /**
   * Whether the document has at least one usable image configured.
   * @param {DirectionalData} data The normalised data.
   * @returns {boolean} True when any slot holds a path.
   */
  static hasAnyImage(data) {
    return ALL_SLOTS.some(slot => !!data.images[slot]);
  }

  /**
   * Whether directional swapping should run for this document right now.
   * @param {DirectionalData} data The normalised data.
   * @returns {boolean} True when enabled and at least one image is configured.
   */
  static isActive(data) {
    return data.enabled && DirectionalTokenData.hasAnyImage(data);
  }

  /**
   * Every unique image path referenced by the document, for texture preloading.
   * @param {DirectionalData} data The normalised data.
   * @returns {string[]} Unique, non-empty paths, including the base image.
   */
  static collectPaths(data) {
    const paths = new Set();
    for (const slot of ALL_SLOTS) if (data.images[slot]) paths.add(data.images[slot]);
    if (data.base.src) paths.add(data.base.src);
    return [...paths];
  }

  /**
   * Build a flat, dot-notated update payload for `Document#update`.
   *
   * Using explicit flat keys (rather than a nested object) keeps the update diff minimal and avoids
   * clobbering flags written by other modules.
   *
   * @param {Partial<DirectionalData>} partial The subset of data to write.
   * @returns {Record<string, *>} A flat update object.
   */
  static buildUpdate(partial) {
    const prefix = `flags.${MODULE_ID}`;
    const update = {};

    /**
     * Write one key, skipping values the caller did not supply.
     * @param {string} path        The flag path relative to the module's flag scope.
     * @param {*} value            The raw value.
     * @param {(v: *) => *} coerce The coercion to apply.
     * @returns {void}
     */
    const set = (path, value, coerce) => {
      if (value === undefined) return;
      update[`${prefix}.${path}`] = coerce(value);
    };

    const asBoolean = value => value === true;
    const asNumber = fallback => value => toNumber(value, fallback);

    set(FLAGS.ENABLED, partial.enabled, asBoolean);
    set(FLAGS.MODE, partial.mode, String);
    set(FLAGS.MIRROR, partial.mirrorHorizontal, asBoolean);
    set(FLAGS.LOAD_METHOD, partial.loadMethod, String);

    for (const [slot, src] of Object.entries(partial.images ?? {})) {
      if (ALL_SLOTS.includes(slot)) set(`${FLAGS.IMAGES}.${slot}`, src, toPath);
    }

    set(`${FLAGS.BASE}.src`, partial.base?.src, toPath);
    set(`${FLAGS.BASE}.scale`, partial.base?.scale, asNumber(1));
    set(`${FLAGS.BASE}.rotation`, partial.base?.rotation, asNumber(0));

    set(`${FLAGS.ART}.offsetX`, partial.art?.offsetX, asNumber(0));
    set(`${FLAGS.ART}.offsetY`, partial.art?.offsetY, asNumber(0));
    set(`${FLAGS.ART}.offsetZ`, partial.art?.offsetZ, asNumber(0));
    set(`${FLAGS.ART}.scale`, partial.art?.scale, asNumber(1));

    set(FLAGS.VISION, partial.visionFacing, toVisionFacing);

    return update;
  }

  /**
   * Is this a `PrototypeToken` rather than a real `TokenDocument`?
   *
   * A prototype is a plain DataModel hanging off an Actor, not a Document, which is the cleanest
   * way to tell the two apart without depending on class names.
   *
   * @param {TokenDocument|PrototypeToken} document The document to test.
   * @returns {boolean} True for a prototype token.
   */
  static isPrototype(document) {
    return !!document && !(document instanceof foundry.abstract.Document);
  }

  /**
   * Persist a partial data payload onto a document.
   *
   * Writes to a prototype token are routed through the owning Actor with `prototypeToken.`-prefixed
   * keys. `PrototypeToken#update` forwards its payload verbatim into an Actor update, where only
   * *top level* dotted keys are expanded — so prefixing here is what keeps the flag path from being
   * stored as one long literal key.
   *
   * @param {Token|TokenDocument|PrototypeToken|Actor} target The document (or wrapper).
   * @param {Partial<DirectionalData>} partial                The subset of data to write.
   * @returns {Promise<TokenDocument|PrototypeToken|null>} The updated document, or `null` when the
   *   target could not be resolved.
   */
  static async write(target, partial) {
    const document = DirectionalTokenData.resolveDocument(target);
    if (!document) return null;

    const update = DirectionalTokenData.buildUpdate(partial);
    if (foundry.utils.isEmpty(update)) return document;

    if (DirectionalTokenData.isPrototype(document)) {
      const actor = document.actor;
      if (!actor) return null;
      const prefixed = {};
      for (const [key, value] of Object.entries(update)) prefixed[`prototypeToken.${key}`] = value;
      await actor.update(prefixed);
      return document;
    }

    await document.update(update);
    return document;
  }

  /**
   * Remove every flag written by this module from a document.
   * @param {Token|TokenDocument|PrototypeToken|Actor} target The document (or wrapper).
   * @returns {Promise<TokenDocument|PrototypeToken|null>} The updated document, or `null`.
   */
  static async clear(target) {
    const document = DirectionalTokenData.resolveDocument(target);
    if (!document) return null;

    if (DirectionalTokenData.isPrototype(document)) {
      await document.actor?.update({ [`prototypeToken.flags.-=${MODULE_ID}`]: null });
      return document;
    }

    await document.update({ [`flags.-=${MODULE_ID}`]: null });
    return document;
  }
}

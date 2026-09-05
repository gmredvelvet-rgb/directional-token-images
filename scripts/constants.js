/**
 * @file Immutable module-wide constants.
 * Nothing in this file may import from other module files: it is the root of the dependency graph.
 * @module directional-token-images/constants
 */

/** The module id. Must match the containing folder name and `module.json#id`. @type {string} */
export const MODULE_ID = "directional-token-images";

/** Human readable module title, used in log prefixes and window titles. @type {string} */
export const MODULE_TITLE = "Directional Token Images";

/**
 * Localize a key, substituting `data` into its `{placeholders}` when given.
 *
 * v14 merged the old `format()` into `localize(key, data)` and dropped `format` from Localization
 * entirely, while v13's `localize` ignores a second argument and only `format` interpolates. Neither
 * call works on both generations, so the version decides — with a capability check behind it in case
 * `game.release` is not readable yet.
 *
 * @param {string} key    The localisation key.
 * @param {object} [data] Interpolation data.
 * @returns {string} The localised string.
 */
export function localize(key, data) {
  if (!data) return game.i18n.localize(key);
  if ((game.release?.generation ?? 13) >= 14) return game.i18n.localize(key, data);
  return typeof game.i18n.format === "function" ? game.i18n.format(key, data) : game.i18n.localize(key, data);
}

/**
 * Keys of the per-document flag object stored under `flags[MODULE_ID]`.
 * @enum {string}
 */
export const FLAGS = Object.freeze({
  ENABLED: "enabled",
  MODE: "mode",
  MIRROR: "mirrorHorizontal",
  LOAD_METHOD: "loadMethod",
  IMAGES: "images",
  BASE: "base",
  ART: "art",
  PROVIDER: "provider",
  VISION: "visionFacing"
});

/**
 * Per-token override values for "the vision cone follows the artwork".
 *
 * A three state flag rather than a boolean: `INHERIT` follows the world setting, while the two
 * explicit values let a single token opt in or out whichever way the world is configured.
 *
 * @enum {string}
 */
export const VISION_FACING = Object.freeze({
  INHERIT: "inherit",
  ON: "on",
  OFF: "off"
});

/**
 * Values of the "self-visibility circle" setting.
 *
 * A dropdown rather than a slider because the useful answer is almost always one of the `AUTO`
 * sizes — the module can measure the drawn artwork itself — and the fixed sizes only exist for a GM
 * who wants to pin it.
 *
 * @enum {string}
 */
export const SELF_RADIUS = Object.freeze({
  OFF: "off",
  AUTO: "auto",
  FIXED: "fixed"
});

/**
 * Margin factors offered on top of the measured artwork, as `"auto" + factor` values.
 *
 * A bare fit is rarely quite enough on an isometric map. The vision circle is a circle in *scene*
 * space, but the projection compresses scene space vertically on the way to the screen, so a circle
 * that exactly encloses the sprite's scene-space box still lands slightly inside the top of the
 * drawing. Rather than trying to invert an arbitrary projection matrix, the fit is simply offered
 * with room to spare.
 *
 * @type {ReadonlyArray<string>}
 */
export const SELF_RADIUS_AUTO_STEPS = Object.freeze(["1.5", "2", "3"]);

/**
 * The fixed self-visibility sizes offered alongside `off` and the `auto` family, in grid squares.
 *
 * Stored as `"fixed" + size` rather than as bare numbers so the dropdown keeps the order it is
 * written in: JavaScript hoists integer-like keys to the front of an object, which put "1 grid
 * square" above "Off" in the settings menu.
 *
 * @type {ReadonlyArray<string>}
 */
export const SELF_RADIUS_STEPS = Object.freeze(["1", "2", "3", "4", "6", "8"]);

/**
 * World/client setting keys.
 * @enum {string}
 */
export const SETTINGS = Object.freeze({
  DEFAULT_MODE: "defaultMode",
  PROVIDER: "directionProvider",
  ANGLE_OFFSET: "angleOffset",
  SENSITIVITY: "sensitivity",
  THRESHOLD: "movementThreshold",
  UPDATE_DURING_DRAG: "updateDuringDrag",
  APPLY_AFTER_MOVEMENT: "applyAfterMovement",
  SMOOTH_TRANSITION: "smoothTransition",
  TRANSITION_TYPE: "transitionType",
  TRANSITION_SPEED: "transitionSpeed",
  PRELOAD: "preloadTextures",
  SHOW_HUD_BUTTON: "showHudButton",
  VISION_FACING: "visionFollowsFacing",
  VISION_SELF_RADIUS: "visionSelfRadius",
  DEBUG: "debug"
});

/**
 * Paths to Handlebars templates shipped with the module.
 * @enum {string}
 */
export const TEMPLATES = Object.freeze({
  CONFIG_APP: `modules/${MODULE_ID}/templates/config-app.hbs`,
  TOKEN_CONFIG_TAB: `modules/${MODULE_ID}/templates/token-config-tab.hbs`,
  IMAGE_FIELDS: `modules/${MODULE_ID}/templates/partials/image-fields.hbs`,
  TRANSFORM_FIELDS: `modules/${MODULE_ID}/templates/partials/transform-fields.hbs`,
  PREVIEW: `modules/${MODULE_ID}/templates/partials/preview.hbs`,
  HUD_PALETTE: `modules/${MODULE_ID}/templates/hud-palette.hbs`
});

/**
 * Handlebars partial names registered at init.
 * Dot-free so they can be referenced as `{{> dti-image-fields}}` without quoting.
 * @enum {string}
 */
export const PARTIALS = Object.freeze({
  IMAGE_FIELDS: "dti-image-fields",
  TRANSFORM_FIELDS: "dti-transform-fields",
  PREVIEW: "dti-preview"
});

/** The id of the tab injected into the Token Configuration sheet. @type {string} */
export const TAB_ID = "directional";

/** The tab group the injected tab belongs to (matches core's TokenConfig tab group). @type {string} */
export const TAB_GROUP = "sheet";

/**
 * Hook names broadcast by this module for third party integrations.
 * @enum {string}
 */
export const HOOK_EVENTS = Object.freeze({
  READY: `${MODULE_ID}.ready`,
  DIRECTION_CHANGED: `${MODULE_ID}.directionChanged`,
  PRE_DIRECTION_CHANGE: `${MODULE_ID}.preDirectionChange`
});

/** Localization key prefix. @type {string} */
export const I18N = `DTI`;

/** File extensions treated as video sources when building preview thumbnails. @type {ReadonlySet<string>} */
export const VIDEO_EXTENSIONS = Object.freeze(new Set(["webm", "mp4", "m4v", "ogv"]));

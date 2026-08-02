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
  PROVIDER: "provider"
});

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

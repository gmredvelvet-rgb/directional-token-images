/**
 * @file World setting registration and a cached read facade.
 *
 * Movement hooks can fire dozens of times per second across hundreds of tokens, so settings are
 * read once into a plain cached object and refreshed from each setting's `onChange` handler rather
 * than calling `game.settings.get` on every hook.
 *
 * @module directional-token-images/settings/settings
 */

import {
  I18N,
  MODULE_ID,
  SELF_RADIUS,
  SELF_RADIUS_AUTO_STEPS,
  SELF_RADIUS_STEPS,
  SETTINGS,
  localize
} from "../constants.js";
import { MODE_IDS, MODES } from "../lib/directions.js";
import { DirectionProviderRegistry } from "../lib/direction-provider.js";
import { Logger } from "../lib/logger.js";
import { VisionFacing } from "../lib/vision-facing.js";

/**
 * The resolved module configuration.
 * @typedef {object} DirectionalSettings
 * @property {number} defaultMode          Fallback image-set mode for tokens set to "inherit".
 * @property {string} directionProvider    Id of the active {@link DirectionProvider}.
 * @property {number} angleOffset          Facing rotation applied before quantisation, in degrees.
 * @property {number} sensitivity          Direction sensitivity.
 * @property {number} movementThreshold    Minimum movement, in pixels, before a swap is considered.
 * @property {boolean} updateDuringDrag    Swap the artwork live while a token is being dragged.
 * @property {boolean} applyAfterMovement  Swap only once the movement animation has finished.
 * @property {boolean} smoothTransition    Cross-fade between artwork instead of cutting.
 * @property {string} transitionType       The texture transition filter type to use.
 * @property {number} transitionSpeed      Transition duration, in milliseconds.
 * @property {boolean} preloadTextures     Warm the texture cache when a scene is drawn.
 * @property {boolean} showHudButton       Show the direction button on the Token HUD.
 * @property {boolean} debug               Verbose logging.
 */

/**
 * Build the `{value: i18nKey}` choice map for the image-set mode dropdowns.
 * @returns {Record<number, string>} Localisable choices.
 */
export function getModeChoices() {
  return MODE_IDS.reduce((choices, id) => {
    choices[id] = MODES[id].labelKey;
    return choices;
  }, {});
}

/**
 * Build the `{value: label}` choices for the self-visibility dropdown.
 *
 * The fixed sizes are labelled through a single parameterised key rather than one key per step, so
 * adding a step never needs a translation.
 *
 * @returns {Record<string, string>} Localisable choices.
 */
export function getSelfRadiusChoices() {
  const choices = {
    [SELF_RADIUS.OFF]: `${I18N}.SELF_RADIUS.off`,
    [SELF_RADIUS.AUTO]: `${I18N}.SELF_RADIUS.auto`
  };
  for (const factor of SELF_RADIUS_AUTO_STEPS) {
    choices[`${SELF_RADIUS.AUTO}${factor}`] = localize(`${I18N}.SELF_RADIUS.autoScaled`, { factor });
  }
  for (const step of SELF_RADIUS_STEPS) {
    choices[`${SELF_RADIUS.FIXED}${step}`] = localize(`${I18N}.SELF_RADIUS.squares`, { squares: step });
  }
  return choices;
}

/**
 * The available texture transition types, read from core when possible so the list stays correct if
 * Foundry adds more, with a hard-coded fallback for safety.
 * @returns {Record<string, string>} `{value: label}` choices.
 */
export function getTransitionChoices() {
  const types = foundry.canvas?.rendering?.filters?.TextureTransitionFilter?.TYPES ?? {
    FADE: "fade",
    MORPH: "morph",
    CROSSHATCH: "crosshatch",
    DOTS: "dots",
    GLITCH: "glitch",
    HOLE: "hole",
    HOLE_SWIRL: "holeSwirl",
    HOLOGRAM: "hologram",
    SWIRL: "swirl",
    WATER_DROP: "waterDrop",
    WAVES: "waves",
    WHITE_NOISE: "whiteNoise",
    WIND: "wind"
  };
  return Object.values(types).reduce((choices, value) => {
    choices[value] = `${I18N}.TRANSITIONS.${value}`;
    return choices;
  }, {});
}

/**
 * Cached, hook-safe access to the module's settings.
 */
export class Settings {
  /**
   * The cached settings snapshot. Populated by {@link Settings.refresh}.
   * @type {DirectionalSettings}
   */
  static #cache = {
    defaultMode: 4,
    directionProvider: "topDown",
    angleOffset: 0,
    sensitivity: 1,
    movementThreshold: 1,
    updateDuringDrag: true,
    applyAfterMovement: false,
    smoothTransition: true,
    transitionType: "fade",
    transitionSpeed: 250,
    preloadTextures: true,
    showHudButton: true,
    visionFollowsFacing: false,
    visionSelfRadius: "off",
    debug: false
  };

  /** @returns {DirectionalSettings} The cached settings snapshot. */
  static get current() {
    return Settings.#cache;
  }

  /**
   * Read a single setting straight from the store, bypassing the cache.
   * @param {string} key One of {@link SETTINGS}.
   * @returns {*} The stored value.
   */
  static read(key) {
    return game.settings.get(MODULE_ID, key);
  }

  /**
   * Write a single setting.
   * @param {string} key One of {@link SETTINGS}.
   * @param {*} value    The value to store.
   * @returns {Promise<*>} Resolves once the setting is saved.
   */
  static async write(key, value) {
    return game.settings.set(MODULE_ID, key, value);
  }

  /**
   * Refresh the whole cache from the settings store and propagate the derived state (debug flag,
   * active direction provider).
   * @returns {DirectionalSettings} The refreshed snapshot.
   */
  static refresh() {
    for (const key of Object.values(SETTINGS)) {
      try {
        Settings.#cache[key] = game.settings.get(MODULE_ID, key);
      } catch (error) {
        // A setting that is not registered yet simply keeps its default; this happens when the
        // cache is warmed before `init` completes.
        Logger.trace(`Setting "${key}" is not registered yet.`, error);
      }
    }
    Logger.debug = Settings.#cache.debug;
    DirectionProviderRegistry.setActive(Settings.#cache.directionProvider);
    return Settings.#cache;
  }

  /**
   * Update a single cached value without a full refresh. Used by `onChange` handlers.
   * @param {string} key The setting key.
   * @param {*} value    The new value.
   * @returns {void}
   */
  static patch(key, value) {
    Settings.#cache[key] = value;
    if (key === SETTINGS.DEBUG) Logger.debug = value;
    if (key === SETTINGS.PROVIDER) DirectionProviderRegistry.setActive(value);
    if (key === SETTINGS.VISION_SELF_RADIUS) VisionFacing.syncSelfRadius();
    // Bring the scene into line straight away: a toggle nobody can see act is a toggle that looks
    // broken. Only the GM's client writes, and only when the feature was just switched on.
    if (key === SETTINGS.VISION_FACING && value === true) void VisionFacing.realignScene();
  }
}

/**
 * Shared `onChange` factory that keeps the cache in sync.
 * @param {string} key The setting key.
 * @returns {(value: *) => void} The change handler.
 */
function onChange(key) {
  return value => Settings.patch(key, value);
}

/**
 * Register every world setting. Call once during `init`.
 * @returns {void}
 */
export function registerSettings() {
  const register = (key, data) =>
    game.settings.register(MODULE_ID, key, {
      name: `${I18N}.SETTINGS.${key}.name`,
      hint: `${I18N}.SETTINGS.${key}.hint`,
      scope: "world",
      config: true,
      onChange: onChange(key),
      ...data
    });

  register(SETTINGS.DEFAULT_MODE, {
    type: Number,
    choices: getModeChoices(),
    default: 4
  });

  register(SETTINGS.PROVIDER, {
    type: String,
    // A live reference: providers registered later by other modules appear without a reload.
    choices: DirectionProviderRegistry.choices,
    default: "topDown"
  });

  register(SETTINGS.ANGLE_OFFSET, {
    type: Number,
    range: { min: -180, max: 180, step: 5 },
    default: 0
  });

  register(SETTINGS.SENSITIVITY, {
    type: Number,
    range: { min: 0.25, max: 2, step: 0.05 },
    default: 1
  });

  register(SETTINGS.THRESHOLD, {
    type: Number,
    range: { min: 0, max: 500, step: 1 },
    default: 1
  });

  register(SETTINGS.UPDATE_DURING_DRAG, { type: Boolean, default: true });
  register(SETTINGS.APPLY_AFTER_MOVEMENT, { type: Boolean, default: false });
  register(SETTINGS.SMOOTH_TRANSITION, { type: Boolean, default: true });

  register(SETTINGS.TRANSITION_TYPE, {
    type: String,
    choices: getTransitionChoices(),
    default: "fade"
  });

  register(SETTINGS.TRANSITION_SPEED, {
    type: Number,
    range: { min: 0, max: 3000, step: 50 },
    default: 250
  });

  register(SETTINGS.PRELOAD, { type: Boolean, default: true });
  register(SETTINGS.SHOW_HUD_BUTTON, { type: Boolean, default: true });

  register(SETTINGS.VISION_FACING, { type: Boolean, default: false });

  register(SETTINGS.VISION_SELF_RADIUS, {
    type: String,
    choices: getSelfRadiusChoices(),
    default: SELF_RADIUS.OFF
  });
  register(SETTINGS.DEBUG, { type: Boolean, default: false });

  Settings.refresh();
  Logger.trace("Settings registered.");
}

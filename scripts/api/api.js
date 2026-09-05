/**
 * @file The public API surfaced at `game.modules.get("directional-token-images").api`.
 *
 * Everything here is a thin, well-documented facade over the internal services so that macros and
 * other modules never have to reach into module internals.
 *
 * @module directional-token-images/api/api
 */

import { HOOK_EVENTS, MODULE_ID, SETTINGS, VISION_FACING } from "../constants.js";
import {
  ALL_SLOTS,
  CARDINAL_SLOTS,
  DEFAULT_SLOT,
  DIAGONAL_SLOTS,
  DIRECTION_ANGLES,
  MODES,
  MODE_IDS,
  MODE_INHERIT
} from "../lib/directions.js";
import { DirectionProvider, DirectionProviderRegistry } from "../lib/direction-provider.js";
import { DirectionResolver } from "../lib/direction-resolver.js";
import { DirectionalConfigApp } from "../apps/directional-config.js";
import { PrototypeSync } from "../lib/prototype-sync.js";
import { DirectionalTokenData } from "../lib/token-images.js";
import { ImageCache } from "../lib/image-cache.js";
import { Logger } from "../lib/logger.js";
import { Settings } from "../settings/settings.js";
import { TextureSwapper } from "../lib/texture-swapper.js";
import { VisionFacing } from "../lib/vision-facing.js";

/**
 * @typedef {import("../lib/directions.js").DirectionKey} DirectionKey
 * @typedef {import("../lib/token-images.js").DirectionalData} DirectionalData
 */

/**
 * Normalise a "token-ish" argument into a list of token documents.
 *
 * Accepts a `Token`, a `TokenDocument`, an `Actor`, a token id, an array of any of those, or
 * nothing at all — in which case the currently controlled tokens are used.
 *
 * @param {*} target The caller's argument.
 * @returns {(TokenDocument|PrototypeToken)[]} The resolved documents.
 */
function resolveTargets(target) {
  if (target === undefined || target === null) {
    return (canvas?.tokens?.controlled ?? []).map(token => token.document);
  }
  const list = Array.isArray(target) ? target : [target];
  return list
    .map(entry => {
      if (typeof entry === "string") {
        return canvas?.tokens?.get(entry)?.document ?? fromUuidSync(entry) ?? null;
      }
      return DirectionalTokenData.resolveDocument(entry);
    })
    .filter(document => !!document);
}

/**
 * The public module API.
 */
export class DirectionalTokenImagesAPI {
  /* -------------------------------------------- */
  /*  Vocabulary                                  */
  /* -------------------------------------------- */

  /** Every storable direction slot, including the fallback. @type {ReadonlyArray<DirectionKey>} */
  static DIRECTIONS = ALL_SLOTS;

  /** The four cardinal slots. @type {ReadonlyArray<DirectionKey>} */
  static CARDINALS = CARDINAL_SLOTS;

  /** The four diagonal slots. @type {ReadonlyArray<DirectionKey>} */
  static DIAGONALS = DIAGONAL_SLOTS;

  /** The fallback slot key. @type {DirectionKey} */
  static DEFAULT_SLOT = DEFAULT_SLOT;

  /** Screen angle of each direction sector centre. @type {Readonly<Record<string, number>>} */
  static DIRECTION_ANGLES = DIRECTION_ANGLES;

  /** The supported image-set modes. @type {Readonly<Record<number, object>>} */
  static MODES = MODES;

  /** Valid mode ids. @type {ReadonlyArray<number>} */
  static MODE_IDS = MODE_IDS;

  /** The "follow the world default" mode sentinel. @type {string} */
  static MODE_INHERIT = MODE_INHERIT;

  /** Hook names broadcast by this module. @type {Readonly<Record<string, string>>} */
  static HOOKS = HOOK_EVENTS;

  /** The base class third parties extend to supply a custom projection. @type {typeof DirectionProvider} */
  static DirectionProvider = DirectionProvider;

  /** The standalone configurator application class. @type {typeof DirectionalConfigApp} */
  static DirectionalConfigApp = DirectionalConfigApp;

  /** The per-token override values for vision-cone steering. @type {Readonly<Record<string, string>>} */
  static VISION_FACING = VISION_FACING;

  /** Vision/light cone steering. @type {typeof VisionFacing} */
  static VisionFacing = VisionFacing;

  /** @returns {string} The installed module version. */
  static get version() {
    return game.modules.get(MODULE_ID)?.version ?? "0.0.0";
  }

  /* -------------------------------------------- */
  /*  Configuration                               */
  /* -------------------------------------------- */

  /**
   * Assign directional images to one or more tokens.
   *
   * @example Give the selected tokens a four-way image set
   * ```js
   * const api = game.modules.get("directional-token-images").api;
   * await api.setDirectionalImages(null, {
   *   n: "tokens/hero_north.png",
   *   s: "tokens/hero_south.png",
   *   e: "tokens/hero_east.png",
   *   w: "tokens/hero_west.png"
   * }, { mode: 4 });
   * ```
   *
   * @param {*} target                          The token(s); omit to use the current selection.
   * @param {Record<DirectionKey, string>} images Image paths keyed by slot. Unknown keys are ignored
   *   and an empty string clears that slot (which makes the token keep its current artwork for
   *   that direction).
   * @param {object} [options]
   * @param {number|string} [options.mode]      The image-set mode (1, 2, 4, 8 or `"inherit"`).
   * @param {boolean} [options.enabled=true]    Whether directional swapping is enabled.
   * @param {boolean} [options.mirrorHorizontal] Let one side's drawing serve the other, flipped.
   * @param {object} [options.base]             Optional base image configuration.
   * @param {object} [options.art]              Optional artwork offset/scale configuration.
   * @param {"inherit"|"on"|"off"} [options.visionFacing] Whether this token's vision/light cone
   *   follows the artwork, or defers to the world setting.
   * @returns {Promise<(TokenDocument|PrototypeToken)[]>} The updated documents.
   */
  static async setDirectionalImages(
    target,
    images = {},
    { mode, enabled = true, mirrorHorizontal, base, art, visionFacing } = {}
  ) {
    const documents = resolveTargets(target);
    if (!documents.length) {
      Logger.warn("setDirectionalImages: no token resolved from the given target.");
      return [];
    }
    const payload = { images, enabled };
    if (mode !== undefined) payload.mode = mode;
    if (mirrorHorizontal !== undefined) payload.mirrorHorizontal = mirrorHorizontal;
    if (base) payload.base = base;
    if (art) payload.art = art;
    if (visionFacing !== undefined) payload.visionFacing = visionFacing;

    for (const document of documents) {
      await DirectionalTokenData.write(document, payload);
      ImageCache.invalidate(document);
      void ImageCache.preload(document);
    }
    return documents;
  }

  /**
   * Remove every directional flag from one or more tokens. The token keeps whatever artwork it is
   * currently displaying.
   * @param {*} target The token(s); omit to use the current selection.
   * @returns {Promise<(TokenDocument|PrototypeToken)[]>} The updated documents.
   */
  static async clearDirectionalImages(target) {
    const documents = resolveTargets(target);
    for (const document of documents) {
      await DirectionalTokenData.clear(document);
      ImageCache.invalidate(document);
      ImageCache.setForced(document, null);
    }
    return documents;
  }

  /**
   * Push an actor's prototype-token configuration onto tokens already placed on scenes.
   *
   * New tokens inherit the prototype automatically; this brings existing ones up to date so a
   * change made once on the actor reaches every scene.
   *
   * @example
   * ```js
   * await api.syncFromPrototype(actor);                    // every scene
   * await api.syncFromPrototype(actor, {scope: "current"}); // just the active scene
   * ```
   *
   * @param {Actor|string} actor  The actor, or its id.
   * @param {object} [options]
   * @param {"all"|"current"} [options.scope="all"] Which scenes to update.
   * @returns {Promise<import("../lib/prototype-sync.js").SyncReport>} What was changed.
   */
  static async syncFromPrototype(actor, { scope = "all" } = {}) {
    const resolved = typeof actor === "string" ? game.actors.get(actor) : actor;
    return PrototypeSync.fromActor(resolved, { scope });
  }

  /**
   * Open the standalone configurator for one or more tokens.
   * @param {*} [documents] The tokens; omit to use the current selection.
   * @returns {object|null} The rendered application, or `null` when nothing was selected.
   */
  static openConfig(documents) {
    return DirectionalConfigApp.open(documents ? resolveTargets(documents) : undefined);
  }

  /**
   * Open the configurator bound to an actor's prototype token.
   * @param {Actor|string} actor The actor, or its id.
   * @returns {object|null} The rendered application, or `null`.
   */
  static openActorConfig(actor) {
    const resolved = typeof actor === "string" ? game.actors.get(actor) : actor;
    if (!resolved?.prototypeToken) return null;
    return DirectionalConfigApp.open([resolved.prototypeToken]);
  }

  /**
   * Read the normalised directional configuration of a token.
   * @param {*} target The token; omit to use the first controlled token.
   * @returns {DirectionalData|null} The configuration, or `null` when no token resolved.
   */
  static getDirectionalImages(target) {
    const [document] = resolveTargets(target);
    return document ? DirectionalTokenData.read(document) : null;
  }

  /* -------------------------------------------- */
  /*  Runtime                                     */
  /* -------------------------------------------- */

  /**
   * Compute the direction slot for a movement vector.
   *
   * @example
   * ```js
   * api.getDirection(120, -10);          // "e" in four-way mode
   * api.getDirection({dx: 1, dy: 1}, {mode: 8}); // "se"
   * ```
   *
   * @param {number|{dx: number, dy: number}} dx Horizontal displacement, or a whole vector.
   * @param {number|object} [dy]                 Vertical displacement, or the options object when
   *   the first argument was a vector.
   * @param {object} [options]
   * @param {number} [options.mode]              Override the image-set mode.
   * @param {*} [options.token]                  A token whose mode/flags should be used.
   * @returns {DirectionKey|null} The slot, or `null` when the vector carries no usable direction.
   */
  static getDirection(dx, dy, options = {}) {
    let vector;
    let config = options;
    if (typeof dx === "object" && dx !== null) {
      vector = { dx: dx.dx ?? 0, dy: dx.dy ?? 0 };
      config = typeof dy === "object" && dy !== null ? dy : options;
    } else {
      vector = { dx: Number(dx) || 0, dy: Number(dy) || 0 };
    }
    const [document] = config.token ? resolveTargets(config.token) : [];
    return DirectionResolver.resolveSlot(vector, { document: document ?? null, mode: config.mode });
  }

  /**
   * Re-apply the correct artwork to one or more tokens.
   *
   * Useful after changing the configured images, or to snap a token onto a specific direction.
   *
   * @param {*} target                       The token(s); omit to use the current selection.
   * @param {object} [options]
   * @param {DirectionKey} [options.direction] Apply this slot instead of the current one.
   * @param {boolean} [options.animate=true]   Use the configured transition.
   * @returns {Promise<number>} How many tokens actually changed artwork.
   */
  static async refreshToken(target, { direction, animate = true } = {}) {
    const documents = resolveTargets(target);
    let changed = 0;

    for (const document of documents) {
      ImageCache.invalidate(document);
      const data = ImageCache.getData(document);
      if (!DirectionalTokenData.isActive(data)) continue;

      const slot =
        direction ??
        ImageCache.getForced(document) ??
        ImageCache.getCurrentSlot(document) ??
        DirectionalTokenData.restingSlot(data) ??
        DEFAULT_SLOT;

      const artwork = DirectionalTokenData.resolveArtwork(data, slot);
      if (!artwork) continue;
      const resolution = { slot, ...artwork, data };
      if (await TextureSwapper.applyToDocument(document, resolution, { animate })) changed += 1;
    }
    return changed;
  }

  /**
   * Pin one or more tokens to a direction, overriding automatic detection until cleared.
   * @param {*} target          The token(s); omit to use the current selection.
   * @param {DirectionKey} slot The slot to force.
   * @returns {Promise<number>} How many tokens changed artwork.
   */
  static async forceDirection(target, slot) {
    const documents = resolveTargets(target);
    for (const document of documents) ImageCache.setForced(document, slot);
    return DirectionalTokenImagesAPI.refreshToken(documents, { direction: slot });
  }

  /**
   * Release a forced direction so automatic detection resumes.
   * @param {*} target The token(s); omit to use the current selection.
   * @returns {void}
   */
  static clearForcedDirection(target) {
    for (const document of resolveTargets(target)) ImageCache.setForced(document, null);
  }

  /**
   * The direction a token is currently displaying.
   * @param {*} target The token; omit to use the first controlled token.
   * @returns {DirectionKey|null} The current slot, or `null` when unknown.
   */
  static getCurrentDirection(target) {
    const [document] = resolveTargets(target);
    if (!document) return null;
    return ImageCache.getForced(document) ?? ImageCache.getCurrentSlot(document);
  }

  /* -------------------------------------------- */
  /*  Extensibility                               */
  /* -------------------------------------------- */

  /**
   * Register a custom {@link DirectionProvider}. The provider appears in the world settings
   * dropdown immediately, without a reload.
   * @param {DirectionProvider} provider The provider instance.
   * @returns {DirectionProvider} The registered provider.
   */
  static registerDirectionProvider(provider) {
    return DirectionProviderRegistry.register(provider);
  }

  /**
   * Activate a registered direction provider and persist the choice.
   * @param {string} id The provider id.
   * @returns {Promise<boolean>} Whether the id was known and therefore applied.
   */
  static async setDirectionProvider(id) {
    if (!DirectionProviderRegistry.get(id)) return false;
    await Settings.write(SETTINGS.PROVIDER, id);
    return true;
  }

  /** @returns {DirectionProvider[]} Every registered provider. */
  static listDirectionProviders() {
    return DirectionProviderRegistry.all();
  }

  /** @returns {DirectionProvider} The currently active provider. */
  static get activeDirectionProvider() {
    return DirectionProviderRegistry.active;
  }

  /* -------------------------------------------- */
  /*  Diagnostics                                 */
  /* -------------------------------------------- */

  /** Drop every cache. Rarely needed; exposed for troubleshooting. @returns {void} */
  static clearCache() {
    ImageCache.clear();
  }

  /** @returns {import("../settings/settings.js").DirectionalSettings} The cached settings. */
  static get settings() {
    return Settings.current;
  }
}

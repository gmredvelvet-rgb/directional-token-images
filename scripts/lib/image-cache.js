/**
 * @file Per-document caches.
 *
 * Three things are cached, all keyed by document uuid:
 *  - the normalised flag payload, so movement hooks never re-parse flags;
 *  - the slot each token is currently displaying, so an image is never re-applied;
 *  - a GM-forced direction used by the HUD testing palette.
 *
 * The caches are deliberately plain `Map`s rather than `WeakMap`s so they can be cleared wholesale
 * when a scene changes, and every entry is dropped as soon as the document is updated or deleted.
 *
 * @module directional-token-images/lib/image-cache
 */

import { MODULE_ID } from "../constants.js";
import { DirectionalTokenData } from "./token-images.js";
import { Logger } from "./logger.js";

/**
 * @typedef {import("./directions.js").DirectionKey} DirectionKey
 * @typedef {import("./token-images.js").DirectionalData} DirectionalData
 */

/**
 * Build a stable cache key for a flag-bearing document.
 * @param {TokenDocument|PrototypeToken} document The document.
 * @returns {string|null} A cache key, or `null` when no stable key can be derived.
 */
function cacheKey(document) {
  if (!document) return null;
  if (document.uuid) return document.uuid;
  const parent = document.parent ?? document.actor;
  return parent?.uuid ? `${parent.uuid}.PrototypeToken` : null;
}

/**
 * Memoisation layer in front of {@link DirectionalTokenData}.
 */
export class ImageCache {
  /** @type {Map<string, DirectionalData>} */
  static #data = new Map();

  /** @type {Map<string, DirectionKey>} */
  static #currentSlot = new Map();

  /** @type {Map<string, DirectionKey>} */
  static #forced = new Map();

  /** @type {Set<string>} */
  static #preloaded = new Set();

  /**
   * Read the normalised data for a document, populating the cache on a miss.
   * @param {Token|TokenDocument|PrototypeToken} target The document (or wrapper).
   * @returns {DirectionalData} The normalised data.
   */
  static getData(target) {
    const document = DirectionalTokenData.resolveDocument(target);
    const key = cacheKey(document);
    if (!key) return DirectionalTokenData.read(document);
    let data = ImageCache.#data.get(key);
    if (!data) {
      data = DirectionalTokenData.read(document);
      ImageCache.#data.set(key, data);
    }
    return data;
  }

  /**
   * The slot a document is currently displaying.
   *
   * Falls back to reverse-looking-up the token's live `texture.src` among the configured images, so
   * the module recovers the correct state after a reload without persisting anything extra.
   *
   * @param {Token|TokenDocument|PrototypeToken} target The document (or wrapper).
   * @returns {DirectionKey|null} The current slot, or `null` when unknown.
   */
  static getCurrentSlot(target) {
    const document = DirectionalTokenData.resolveDocument(target);
    const key = cacheKey(document);
    if (!key) return null;
    if (ImageCache.#currentSlot.has(key)) return ImageCache.#currentSlot.get(key);
    const slot = DirectionalTokenData.findSlotForImage(
      ImageCache.getData(document),
      document?.texture?.src,
      (document?.texture?.scaleX ?? 1) < 0
    );
    if (slot) ImageCache.#currentSlot.set(key, slot);
    return slot;
  }

  /**
   * Record the slot a document is now displaying.
   * @param {Token|TokenDocument|PrototypeToken} target The document (or wrapper).
   * @param {DirectionKey|null} slot                    The new slot.
   * @returns {void}
   */
  static setCurrentSlot(target, slot) {
    const key = cacheKey(DirectionalTokenData.resolveDocument(target));
    if (!key) return;
    if (slot) ImageCache.#currentSlot.set(key, slot);
    else ImageCache.#currentSlot.delete(key);
  }

  /**
   * The GM-forced direction for a document, if any. A forced direction short-circuits automatic
   * detection until it is cleared.
   * @param {Token|TokenDocument|PrototypeToken} target The document (or wrapper).
   * @returns {DirectionKey|null} The forced slot, or `null`.
   */
  static getForced(target) {
    const key = cacheKey(DirectionalTokenData.resolveDocument(target));
    return key ? ImageCache.#forced.get(key) ?? null : null;
  }

  /**
   * Force (or clear) a direction for a document.
   * @param {Token|TokenDocument|PrototypeToken} target The document (or wrapper).
   * @param {DirectionKey|null} slot                    The slot to force, or `null` to clear.
   * @returns {void}
   */
  static setForced(target, slot) {
    const key = cacheKey(DirectionalTokenData.resolveDocument(target));
    if (!key) return;
    if (slot) ImageCache.#forced.set(key, slot);
    else ImageCache.#forced.delete(key);
  }

  /**
   * Drop every cached entry for a document. Called whenever the document is updated or deleted.
   * @param {Token|TokenDocument|PrototypeToken|string} target The document, wrapper or uuid.
   * @returns {void}
   */
  static invalidate(target) {
    const key =
      typeof target === "string" ? target : cacheKey(DirectionalTokenData.resolveDocument(target));
    if (!key) return;
    ImageCache.#data.delete(key);
    ImageCache.#currentSlot.delete(key);
    ImageCache.#preloaded.delete(key);
    Logger.trace("Cache invalidated for", key);
  }

  /**
   * Clear every cache. Called on scene teardown.
   * @param {object} [options]
   * @param {boolean} [options.keepForced=false] Preserve GM-forced directions across the clear.
   * @returns {void}
   */
  static clear({ keepForced = false } = {}) {
    ImageCache.#data.clear();
    ImageCache.#currentSlot.clear();
    ImageCache.#preloaded.clear();
    if (!keepForced) ImageCache.#forced.clear();
  }

  /**
   * Warm the texture cache for a document's configured artwork so the first swap does not stutter.
   * Each document is only preloaded once per scene.
   * @param {Token|TokenDocument|PrototypeToken} target The document (or wrapper).
   * @returns {Promise<void>} Resolves once the textures are queued.
   */
  static async preload(target) {
    const document = DirectionalTokenData.resolveDocument(target);
    const key = cacheKey(document);
    if (!key || ImageCache.#preloaded.has(key)) return;
    const data = ImageCache.getData(document);
    if (!DirectionalTokenData.isActive(data)) return;
    ImageCache.#preloaded.add(key);

    const paths = DirectionalTokenData.collectPaths(data);
    if (!paths.length) return;
    try {
      await foundry.canvas.TextureLoader.loader.load(paths, { message: MODULE_ID });
      Logger.trace(`Preloaded ${paths.length} texture(s) for`, key);
    } catch (error) {
      Logger.warn("Failed to preload directional textures.", error);
    }
  }
}

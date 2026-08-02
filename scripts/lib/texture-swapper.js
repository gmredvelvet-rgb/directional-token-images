/**
 * @file Applies a resolved image path to a token.
 *
 * Three delivery routes exist, deliberately kept apart:
 *  - {@link TextureSwapper.stageChanges} folds the new artwork into an in-flight document update so
 *    a move produces exactly one database write;
 *  - {@link TextureSwapper.applyToDocument} performs a standalone update (used by the HUD, the API
 *    and the "apply after movement" mode);
 *  - {@link TextureSwapper.applyToPreview} mutates only the dragged preview clone, touching no data.
 *
 * ## Horizontal mirroring
 * A token that opts into mirroring lets one drawing serve both sides, and this module then owns the
 * *sign* of `texture.scaleX` (never its magnitude, so the token's configured scale is preserved).
 * A token that has not opted in never has `texture.scaleX` touched at all, which keeps the module's
 * original promise — no rotation, no flipping — intact by default.
 *
 * @module directional-token-images/lib/texture-swapper
 */

import { HOOK_EVENTS } from "../constants.js";
import { Settings } from "../settings/settings.js";
import { ImageCache } from "./image-cache.js";
import { Logger } from "./logger.js";

/**
 * @typedef {import("./directions.js").DirectionKey} DirectionKey
 * @typedef {import("./direction-resolver.js").DirectionResolution} DirectionResolution
 */

/**
 * Applies directional artwork to tokens.
 */
export class TextureSwapper {
  /**
   * Build the `animation` update option that drives core's texture transition filter.
   *
   * Note that `duration` here only affects non-movement properties: Foundry animates movement from
   * `movementSpeed`, so setting a transition duration never slows a token down.
   *
   * @param {object} [options]
   * @param {boolean} [options.linkToMovement=false] Stretch the cross-fade to match the movement
   *   animation instead of using the configured fixed duration.
   * @returns {object|null} The animation options, or `null` when smooth transitions are disabled.
   */
  static getAnimationOptions({ linkToMovement = false } = {}) {
    const { smoothTransition, transitionType, transitionSpeed } = Settings.current;
    if (!smoothTransition) return null;
    const animation = { transition: transitionType };
    if (linkToMovement) animation.linkToMovement = true;
    else animation.duration = transitionSpeed;
    return animation;
  }

  /**
   * The `texture.scaleX` a document should end up with.
   *
   * Only the sign is decided here: the magnitude always comes from whatever the token is already
   * configured with, so a token scaled to 1.4 stays at 1.4 whichever way it faces.
   *
   * @param {TokenDocument|PrototypeToken} document The document.
   * @param {boolean|null} mirrored                 The desired mirror state, or `null` to opt out.
   * @returns {number|null} The target `scaleX`, or `null` when it must be left alone.
   */
  static #targetScaleX(document, mirrored) {
    if (mirrored === null || mirrored === undefined) return null;
    const magnitude = Math.abs(document?.texture?.scaleX ?? 1) || 1;
    return mirrored ? -magnitude : magnitude;
  }

  /**
   * Is the document already displaying exactly this artwork, facing this way?
   * @param {TokenDocument|PrototypeToken} document The document.
   * @param {string} src                            The candidate image path.
   * @param {boolean|null} [mirrored]               The candidate mirror state.
   * @returns {boolean} True when no work is needed.
   */
  static isCurrent(document, src, mirrored) {
    if (!src) return true;
    if (document?.texture?.src !== src) return false;
    const target = TextureSwapper.#targetScaleX(document, mirrored);
    return target === null || document.texture.scaleX === target;
  }

  /**
   * Build the `texture` sub-document for an update.
   * @param {TokenDocument|PrototypeToken} document The document.
   * @param {string} src                            The image path.
   * @param {boolean|null} mirrored                 The desired mirror state.
   * @returns {object} A `texture` payload containing `src` and, when relevant, `scaleX`.
   */
  static #buildTexturePayload(document, src, mirrored) {
    const texture = { src };
    const target = TextureSwapper.#targetScaleX(document, mirrored);
    if (target !== null && document?.texture?.scaleX !== target) texture.scaleX = target;
    return texture;
  }

  /**
   * Announce an imminent direction change and let listeners veto it.
   * @param {TokenDocument|PrototypeToken} document The document.
   * @param {DirectionKey} slot                     The resolved slot.
   * @param {string} src                            The resolved image path.
   * @param {boolean|null} mirrored                 The resolved mirror state.
   * @returns {boolean} False when a listener vetoed the change.
   */
  static #announcePre(document, slot, src, mirrored) {
    return Hooks.call(HOOK_EVENTS.PRE_DIRECTION_CHANGE, document, slot, src, mirrored) !== false;
  }

  /**
   * Announce a completed direction change.
   * @param {TokenDocument|PrototypeToken} document The document.
   * @param {DirectionKey} slot                     The applied slot.
   * @param {string} src                            The applied image path.
   * @param {boolean|null} mirrored                 The applied mirror state.
   * @returns {void}
   */
  static #announcePost(document, slot, src, mirrored) {
    ImageCache.setCurrentSlot(document, slot);
    Hooks.callAll(HOOK_EVENTS.DIRECTION_CHANGED, document, slot, src, mirrored);
  }

  /**
   * Fold the artwork change into an in-flight document update.
   *
   * Called from `preUpdateToken`, so the texture swap and the movement travel together in a single
   * update — one write, one animation, no flicker.
   *
   * @param {TokenDocument} document                The document being updated.
   * @param {DirectionResolution} resolution        The resolved artwork.
   * @param {object} changes                        The mutable update payload.
   * @param {object} options                        The mutable update options.
   * @returns {boolean} Whether the change was staged.
   */
  static stageChanges(document, resolution, changes, options) {
    const { slot, src, mirrored } = resolution;
    if (TextureSwapper.isCurrent(document, src, mirrored)) return false;
    if (!TextureSwapper.#announcePre(document, slot, src, mirrored)) return false;

    foundry.utils.mergeObject(changes, {
      texture: TextureSwapper.#buildTexturePayload(document, src, mirrored)
    });
    const animation = TextureSwapper.getAnimationOptions({ linkToMovement: false });
    if (animation) options.animation = foundry.utils.mergeObject(options.animation ?? {}, animation);

    Logger.trace(`Staged "${slot}" artwork for ${document.name ?? document.id}:`, src, { mirrored });
    TextureSwapper.#announcePost(document, slot, src, mirrored);
    return true;
  }

  /**
   * Apply the artwork with a standalone document update.
   * @param {TokenDocument|PrototypeToken} document The document to update.
   * @param {DirectionResolution} resolution        The resolved artwork.
   * @param {object} [options]
   * @param {boolean} [options.animate=true]        Whether to use the configured transition.
   * @returns {Promise<boolean>} Whether an update was actually performed.
   */
  static async applyToDocument(document, resolution, { animate = true } = {}) {
    const { slot, src, mirrored } = resolution;
    if (TextureSwapper.isCurrent(document, src, mirrored)) return false;
    if (!TextureSwapper.#announcePre(document, slot, src, mirrored)) return false;

    const updateOptions = {};
    if (animate) {
      const animation = TextureSwapper.getAnimationOptions();
      if (animation) updateOptions.animation = animation;
    }

    try {
      await document.update(
        { texture: TextureSwapper.#buildTexturePayload(document, src, mirrored) },
        updateOptions
      );
    } catch (error) {
      Logger.error(`Failed to apply "${slot}" artwork to ${document.name ?? document.id}.`, error);
      return false;
    }

    Logger.trace(`Applied "${slot}" artwork to ${document.name ?? document.id}:`, src, { mirrored });
    TextureSwapper.#announcePost(document, slot, src, mirrored);
    return true;
  }

  /**
   * Apply the artwork to a drag preview clone only.
   *
   * The preview is a throwaway clone, so this writes nothing to the database and never fires
   * document hooks. Because the drag workflow rebuilds the final update from its own destination
   * data, the preview's texture never leaks into the committed movement either.
   *
   * @param {Token} preview                  The preview placeable.
   * @param {DirectionResolution} resolution The resolved artwork.
   * @returns {boolean} Whether the preview was changed.
   */
  static applyToPreview(preview, resolution) {
    if (!preview?.document || preview.destroyed) return false;
    const { slot, src, mirrored } = resolution;
    if (TextureSwapper.isCurrent(preview.document, src, mirrored)) return false;

    try {
      preview.document.updateSource({
        texture: TextureSwapper.#buildTexturePayload(preview.document, src, mirrored)
      });
      preview.renderFlags.set({ redraw: true });
    } catch (error) {
      Logger.warn("Failed to update the drag preview artwork.", error);
      return false;
    }
    Logger.trace(`Preview switched to "${slot}":`, src, { mirrored });
    return true;
  }
}

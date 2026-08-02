/**
 * @file Document-level hooks: the actual movement detection and artwork swap.
 *
 * There is no polling and no interval anywhere in this module. Every swap is driven by the token
 * update workflow, and in the default configuration the artwork change rides along inside the very
 * same update that moves the token — one database write, one animation.
 *
 * @module directional-token-images/hooks/movement-hooks
 */

import { MODULE_ID } from "../constants.js";
import { DirectionResolver } from "../lib/direction-resolver.js";
import { DirectionalTokenData } from "../lib/token-images.js";
import { ImageCache } from "../lib/image-cache.js";
import { Logger } from "../lib/logger.js";
import { Settings } from "../settings/settings.js";
import { TextureSwapper } from "../lib/texture-swapper.js";

/**
 * Swaps queued for after the movement animation completes, keyed by document uuid.
 * @type {Map<string, import("../lib/direction-resolver.js").DirectionResolution>}
 */
const deferred = new Map();

/**
 * Apply the artwork a token should be showing while standing still.
 *
 * Without this a freshly configured token would keep whatever image it already had — the actor's
 * default portrait, or Foundry's placeholder — until somebody moved it, which reads as "the module
 * did nothing". Called whenever a token's directional flags change and when a configured token is
 * placed on the canvas.
 *
 * @param {TokenDocument} document The document to bring up to date.
 * @returns {Promise<boolean>} Whether the artwork was changed.
 */
export async function applyRestingArtwork(document) {
  const data = ImageCache.getData(document);
  if (!DirectionalTokenData.isActive(data)) return false;

  // Respect a forced direction, then whatever the token is already displaying, and only fall back
  // to the idle pose when neither tells us anything.
  const slot =
    ImageCache.getForced(document) ??
    ImageCache.getCurrentSlot(document) ??
    DirectionalTokenData.restingSlot(data);

  const artwork = DirectionalTokenData.resolveArtwork(data, slot);
  if (!artwork) {
    Logger.trace(`No artwork configured for the resting slot "${slot}" of ${document.name}.`);
    return false;
  }

  return TextureSwapper.applyToDocument(document, { slot, ...artwork, data });
}

/**
 * Wait for a token's movement animation to finish, if it has one.
 * @param {TokenDocument} document The document that moved.
 * @returns {Promise<void>} Resolves when the token has settled.
 */
async function awaitMovement(document) {
  const promise = document?.object?.movementAnimationPromise;
  if (!promise) return;
  try {
    await promise;
  } catch (error) {
    Logger.trace("Movement animation did not settle cleanly.", error);
  }
}

/**
 * `preUpdateToken`: detect movement and fold the artwork change into the outgoing update.
 *
 * This hook only runs on the client that initiated the update, so the work is never duplicated
 * across connected users.
 *
 * @param {TokenDocument} document The document about to be updated.
 * @param {object} changes         The mutable update payload.
 * @param {object} options         The mutable update options.
 * @param {string} userId          The id of the initiating user.
 * @returns {void}
 */
export function onPreUpdateToken(document, changes, options, userId) {
  // Never fight an explicit artwork change made by the user, a system or another module.
  if (changes.texture?.src !== undefined) return;
  if (options?.[MODULE_ID]?.skip === true) return;

  const sample = DirectionResolver.sampleUpdate(document, changes, options);
  if (!sample) return;

  const resolution = DirectionResolver.resolve(document, sample);
  if (!resolution) return;

  if (Settings.current.applyAfterMovement) {
    deferred.set(document.uuid, resolution);
    Logger.trace(`Deferred "${resolution.slot}" artwork until the movement of ${document.name} ends.`);
    return;
  }

  TextureSwapper.stageChanges(document, resolution, changes, options);
}

/**
 * `updateToken`: keep the caches honest and flush deferred swaps.
 * @param {TokenDocument} document The updated document.
 * @param {object} changes         The applied changes.
 * @param {object} options         The update options.
 * @param {string} userId          The id of the initiating user.
 * @returns {Promise<void>} Resolves once any deferred swap has been applied.
 */
export async function onUpdateToken(document, changes, options, userId) {
  if (MODULE_ID in (changes.flags ?? {})) {
    ImageCache.invalidate(document);
    if (Settings.current.preloadTextures) void ImageCache.preload(document);

    // Saving the configuration must show a result straight away. Only the user who made the change
    // performs the follow-up update, and it carries no flag changes, so this cannot recurse. An
    // explicit artwork change in the same update is honoured instead of being overwritten.
    if (userId === game.user.id && changes.texture?.src === undefined) {
      await applyRestingArtwork(document);
    }
  }

  // Keep the "currently displayed slot" cache in sync with externally driven texture changes.
  if (changes.texture?.src !== undefined) {
    const data = ImageCache.getData(document);
    const mirrored = (document.texture?.scaleX ?? 1) < 0;
    ImageCache.setCurrentSlot(
      document,
      DirectionalTokenData.findSlotForImage(data, changes.texture.src, mirrored)
    );
  }

  const pending = deferred.get(document.uuid);
  if (!pending) return;
  deferred.delete(document.uuid);

  // Only the initiating client performs the follow-up update.
  if (userId !== game.user.id) return;

  await awaitMovement(document);
  await TextureSwapper.applyToDocument(document, pending);
}

/**
 * `createToken`: warm the texture cache and give a freshly placed token its idle artwork.
 *
 * A token dragged out of an Actor whose prototype carries directional flags should land wearing the
 * right image, not the prototype's static portrait.
 *
 * @param {TokenDocument} document The created document.
 * @param {object} options         The creation options.
 * @param {string} userId          The id of the creating user.
 * @returns {Promise<void>} Resolves once the artwork has been applied.
 */
export async function onCreateToken(document, options, userId) {
  if (Settings.current.preloadTextures) void ImageCache.preload(document);
  if (userId !== game.user.id) return;
  await applyRestingArtwork(document);
}

/**
 * `deleteToken`: drop every cached entry for the removed document.
 * @param {TokenDocument} document The deleted document.
 * @returns {void}
 */
export function onDeleteToken(document) {
  deferred.delete(document.uuid);
  ImageCache.invalidate(document);
}

/**
 * `updateActor`: a prototype token's flags may have changed, so drop its cached data.
 * @param {Actor} actor    The updated actor.
 * @param {object} changes The applied changes.
 * @returns {void}
 */
export function onUpdateActor(actor, changes) {
  if (!changes.prototypeToken) return;
  ImageCache.invalidate(actor.prototypeToken);
}

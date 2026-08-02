/**
 * @file Canvas-level hooks: live drag previews, the optional artwork transform and base sprite,
 * and cache lifecycle around scene changes.
 * @module directional-token-images/hooks/canvas-hooks
 */

import { ArtRenderer } from "../lib/art-renderer.js";
import { DirectionResolver } from "../lib/direction-resolver.js";
import { ImageCache } from "../lib/image-cache.js";
import { Logger } from "../lib/logger.js";
import { Settings } from "../settings/settings.js";
import { TextureSwapper } from "../lib/texture-swapper.js";

/**
 * The slot each drag preview is currently showing.
 *
 * Keyed by the preview placeable itself so entries disappear with the preview and never collide
 * with the real token's cached state (a preview shares its original's uuid).
 *
 * @type {WeakMap<Token, string>}
 */
const previewSlots = new WeakMap();

/**
 * Update a drag preview's artwork to match the direction it is being dragged in.
 * @param {Token} preview The preview placeable.
 * @returns {void}
 */
function refreshDragPreview(preview) {
  const original = preview._original;
  if (!original?.document) return;

  const source = original.document._source;
  const dx = preview.document.x - source.x;
  const dy = preview.document.y - source.y;
  // A sheet preview sits exactly on top of its original; only a real drag produces a delta.
  if (dx === 0 && dy === 0) return;

  const sample = {
    dx,
    dy,
    origin: { x: source.x, y: source.y },
    destination: { x: preview.document.x, y: preview.document.y }
  };

  const resolution = DirectionResolver.resolve(original.document, sample);
  if (!resolution) return;

  // "Only update the texture when the direction changes" — the cheapest possible drag path.
  if (previewSlots.get(preview) === resolution.slot) return;
  previewSlots.set(preview, resolution.slot);
  TextureSwapper.applyToPreview(preview, resolution);
}

/**
 * `refreshToken`: the single canvas entry point.
 *
 * Both features gate themselves on the specific render flags they care about, so an unrelated
 * refresh (selection, targeting, bars) costs nothing more than two property reads.
 *
 * @param {Token} token  The refreshed placeable.
 * @param {object} flags The render flags that were applied.
 * @returns {void}
 */
export function onRefreshToken(token, flags) {
  try {
    if (token.isPreview && flags?.refreshPosition && Settings.current.updateDuringDrag) {
      refreshDragPreview(token);
    }
    ArtRenderer.refresh(token, flags);
  } catch (error) {
    Logger.error("Failed to refresh a token's directional visuals.", error);
  }
}

/**
 * `drawToken`: attach the base sprite as soon as the placeable exists.
 *
 * Empty render flags are passed on purpose: core has not positioned the mesh yet at draw time, so
 * only the absolute adjustments (base sprite, depth) run here. The `refreshToken` that immediately
 * follows a draw applies the additive offsets.
 *
 * @param {Token} token The drawn placeable.
 * @returns {void}
 */
export function onDrawToken(token) {
  try {
    ArtRenderer.refresh(token, {});
  } catch (error) {
    Logger.error("Failed to draw a token's directional visuals.", error);
  }
}

/**
 * `destroyToken`: release the base sprite bound to the placeable.
 * @param {Token} token The destroyed placeable.
 * @returns {void}
 */
export function onDestroyToken(token) {
  ArtRenderer.destroy(token);
}

/**
 * `canvasReady`: warm the texture cache for every configured token on the scene.
 * @returns {void}
 */
export function onCanvasReady() {
  if (!Settings.current.preloadTextures) return;
  const tokens = canvas?.tokens?.placeables ?? [];
  Promise.all(tokens.map(token => ImageCache.preload(token.document))).then(() =>
    Logger.trace(`Preload pass complete for ${tokens.length} token(s).`)
  );
}

/**
 * `canvasTearDown`: release every canvas-bound resource and cached entry.
 * @returns {void}
 */
export function onCanvasTearDown() {
  ArtRenderer.destroyAll();
  ImageCache.clear({ keepForced: true });
}

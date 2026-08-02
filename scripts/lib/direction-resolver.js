/**
 * @file The single decision point: given a movement, which artwork should a token show?
 *
 * Hook handlers stay deliberately thin by delegating everything here, which means drag previews,
 * committed movement, the API and the HUD all take exactly the same code path and therefore always
 * agree with each other.
 *
 * @module directional-token-images/lib/direction-resolver
 */

import { DirectionProviderRegistry } from "./direction-provider.js";
import { DirectionalTokenData } from "./token-images.js";
import { ImageCache } from "./image-cache.js";
import { Logger } from "./logger.js";
import { Settings } from "../settings/settings.js";

/**
 * @typedef {import("./directions.js").DirectionKey} DirectionKey
 * @typedef {import("./token-images.js").DirectionalData} DirectionalData
 */

/**
 * The outcome of a resolution attempt.
 * @typedef {object} DirectionResolution
 * @property {DirectionKey} slot       The slot that was selected.
 * @property {string} src              The image path to display.
 * @property {DirectionKey} sourceSlot The slot the path was actually read from, which differs from
 *   `slot` whenever a fallback or a horizontal mirror was used.
 * @property {boolean|null} mirrored   Whether the artwork must be flipped horizontally, or `null`
 *   when this token does not manage mirroring at all.
 * @property {DirectionalData} data    The normalised data the decision was made from.
 */

/**
 * A movement, expressed in whatever detail the caller could obtain.
 * @typedef {object} MovementSample
 * @property {number} dx            Net horizontal displacement in pixels.
 * @property {number} dy            Net vertical displacement in pixels.
 * @property {object} [origin]      The movement origin, when known.
 * @property {object} [destination] The movement destination, when known.
 * @property {object[]} [waypoints] The passed waypoints, when known.
 */

/**
 * Resolves movement into artwork.
 */
export class DirectionResolver {
  /**
   * Derive a movement sample from an in-flight token update.
   *
   * Foundry v13 exposes the resolved movement operation on the update options while the
   * `preUpdateToken` hook runs, which gives an exact origin, destination and waypoint path. That is
   * preferred when present; otherwise the net displacement between the document's current position
   * and the incoming change is used, which covers API-driven and legacy updates.
   *
   * @param {TokenDocument} document The document being updated.
   * @param {object} changes         The incoming update payload.
   * @param {object} options         The update options.
   * @returns {MovementSample|null} The sample, or `null` when the update carries no movement.
   */
  static sampleUpdate(document, changes, options) {
    const hasPositionChange = "x" in changes || "y" in changes;
    if (!hasPositionChange) return null;

    let origin = { x: document.x, y: document.y };
    let waypoints;

    try {
      const movement = options?._movement?.[document.id];
      if (movement?.origin) {
        origin = movement.origin;
        waypoints = movement.passed?.waypoints;
      }
    } catch (error) {
      Logger.trace("Could not read the movement operation; falling back to net displacement.", error);
    }

    const destination = { x: changes.x ?? document.x, y: changes.y ?? document.y };
    return {
      dx: destination.x - origin.x,
      dy: destination.y - origin.y,
      origin,
      destination,
      waypoints
    };
  }

  /**
   * Ask the active direction provider which slot a movement corresponds to.
   * @param {MovementSample} sample                           The movement.
   * @param {object} [context]                                Additional context.
   * @param {TokenDocument|PrototypeToken} [context.document] The moving document.
   * @param {Scene} [context.scene]                           The scene the movement happens in.
   * @param {number} [context.mode]                           Override the image-set mode.
   * @returns {DirectionKey|null} The slot, or `null` when no direction could be derived.
   */
  static resolveSlot(sample, { document = null, scene = null, mode } = {}) {
    const settings = Settings.current;
    const data = document ? ImageCache.getData(document) : null;
    const effectiveMode = mode ?? (data ? DirectionalTokenData.resolveMode(data) : settings.defaultMode);

    const provider = DirectionProviderRegistry.active;
    if (!provider) {
      Logger.warn("No direction provider is active.");
      return null;
    }

    return provider.resolve({
      dx: sample.dx,
      dy: sample.dy,
      mode: effectiveMode,
      sensitivity: settings.sensitivity,
      angleOffset: settings.angleOffset,
      document,
      scene: scene ?? document?.parent ?? null,
      origin: sample.origin ?? null,
      destination: sample.destination ?? null,
      waypoints: sample.waypoints ?? []
    });
  }

  /**
   * Full resolution: is this document eligible, did it move far enough, which slot applies and
   * which image path should be shown?
   *
   * @param {TokenDocument|PrototypeToken} document   The moving document.
   * @param {MovementSample} sample                   The movement.
   * @param {object} [options]
   * @param {boolean} [options.ignoreThreshold=false] Skip the minimum-distance check.
   * @param {boolean} [options.ignoreForced=false]    Ignore a GM-forced direction.
   * @param {DirectionKey} [options.slot]             Force a specific slot instead of computing one.
   * @returns {DirectionResolution|null} The resolution, or `null` when nothing should change. A
   *   `null` result is the documented signal to keep the token's current artwork.
   */
  static resolve(document, sample, { ignoreThreshold = false, ignoreForced = false, slot } = {}) {
    const data = ImageCache.getData(document);
    if (!DirectionalTokenData.isActive(data)) return null;

    const forced = ignoreForced ? null : ImageCache.getForced(document);
    let selected = slot ?? forced;

    if (!selected) {
      if (!ignoreThreshold) {
        const distance = Math.hypot(sample.dx, sample.dy);
        if (distance < Settings.current.movementThreshold) {
          Logger.trace(`Movement of ${distance.toFixed(2)}px is below the threshold; ignoring.`);
          return null;
        }
      }
      selected = DirectionResolver.resolveSlot(sample, { document });
    }

    // No usable direction for this mode (for example purely horizontal movement in two-image mode).
    if (!selected) return null;

    const artwork = DirectionalTokenData.resolveArtwork(data, selected, sample);
    // An unconfigured slot means "keep the current image" rather than "clear the image".
    if (!artwork) {
      Logger.trace(`Slot "${selected}" has no image configured; keeping the current artwork.`);
      return null;
    }

    return { slot: selected, src: artwork.src, sourceSlot: artwork.sourceSlot, mirrored: artwork.mirrored, data };
  }
}

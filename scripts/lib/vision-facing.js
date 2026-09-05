/**
 * @file Steers a token's vision (and light) cone so it always points where the directional artwork
 * is looking.
 *
 * ## Why this is a separate concern
 * Foundry aims a limited vision cone with `TokenDocument#rotation`: the cone is centred on
 * `rotation + 90` degrees in screen space, so `rotation = 0` looks South — straight at the camera.
 * Nothing in core ever changes that value on its own, which is why a token with a 190° vision angle
 * keeps staring South however its artwork turns: the unseen wedge ends up drawn *in front of* the
 * character instead of behind it.
 *
 * This module already knows exactly which way a token is facing — it is the slot whose drawing the
 * token is wearing. Turning that slot back into a rotation is the whole feature.
 *
 * ## Projection awareness
 * Direction slots are authored in *facing* space (the space the drawings were made in), while
 * `rotation` is read in *scene* space. On an isometric map the two differ by the projection's
 * rotation, so the slot is mapped back through
 * {@link module:directional-token-images/lib/direction-provider.DirectionProvider#untransformAngle}
 * — the exact inverse of the transform that produced the slot in the first place. A token that
 * shows its "South" drawing on a 2:1 isometric map is really walking South-East in scene
 * coordinates, and its cone is aimed accordingly.
 *
 * ## The artwork never rotates
 * The module's original promise is that it never rotates, mirrors or flips a token. Writing
 * `rotation` would break that on a top-down map, so every write is paired with `lockRotation: true`,
 * which tells Foundry to keep the *drawing* upright while the *facing* turns underneath it.
 *
 * @module directional-token-images/lib/vision-facing
 */

import { SELF_RADIUS, VISION_FACING } from "../constants.js";
import { DirectionProviderRegistry } from "./direction-provider.js";
import { DirectionalTokenData } from "./token-images.js";
import { ImageCache } from "./image-cache.js";
import { Logger } from "./logger.js";
import { Settings } from "../settings/settings.js";
import { angularDistance, normaliseDegrees } from "./directions.js";

/**
 * @typedef {import("./directions.js").DirectionKey} DirectionKey
 * @typedef {import("./token-images.js").DirectionalData} DirectionalData
 */

export { SELF_RADIUS, VISION_FACING };

/**
 * Rotations closer together than this are treated as identical, so floating point noise never
 * produces a pointless database write.
 * @type {number}
 */
const ROTATION_EPSILON = 0.5;

/**
 * The offset between a scene-space angle and Foundry's `rotation` field: a cone is emitted around
 * `rotation + 90`, so `rotation = 0` points South.
 * @type {number}
 */
const ROTATION_TO_SCREEN = 90;

/**
 * Turns direction slots into token facings.
 */
export class VisionFacing {
  /**
   * Is an angle a genuinely limited cone rather than full, all-round coverage?
   * @param {number} angle The configured angle in degrees.
   * @returns {boolean} True for a cone narrower than a full circle.
   */
  static #isLimited(angle) {
    const numeric = Number(angle);
    return Number.isFinite(numeric) && numeric > 0 && numeric < 360;
  }

  /**
   * Does this document have anything whose aim is worth steering?
   *
   * A token with 360° vision and no directional light sees the same in every direction, so turning
   * it would write to the database for no visible result. This is the check that honours the
   * "only when the vision range is not 360°" part of the feature.
   *
   * @param {TokenDocument|PrototypeToken} document The document to inspect.
   * @returns {boolean} True when a limited vision or light cone is configured.
   */
  static hasLimitedCone(document) {
    if (!document) return false;
    const sight = document.sight;
    if (sight?.enabled && VisionFacing.#isLimited(sight.angle)) return true;
    return VisionFacing.#isLimited(document.light?.angle);
  }

  /**
   * Should the feature run for this document?
   *
   * The per-token override wins in both directions, so a single scout can be steered in a world
   * that leaves the feature off, and a single turret can be pinned in a world that has it on.
   *
   * @param {DirectionalData} [data] The token's normalised directional data.
   * @returns {boolean} True when the cone should follow the artwork.
   */
  static isEnabled(data) {
    switch (data?.visionFacing) {
      case VISION_FACING.ON:
        return true;
      case VISION_FACING.OFF:
        return false;
      default:
        return Settings.current.visionFollowsFacing === true;
    }
  }

  /**
   * The `rotation` value that aims a token's cone along a direction slot.
   *
   * @param {DirectionKey} slot                     The slot the token is wearing.
   * @param {TokenDocument|PrototypeToken} [document] The document, passed on to the provider.
   * @returns {number|null} A rotation in `[0, 360)`, or `null` when the slot carries no direction
   *   (single-image mode) or no provider is active.
   */
  static rotationForSlot(slot, document = null) {
    const provider = DirectionProviderRegistry.active;
    if (!provider) return null;

    const sceneAngle = provider.sceneAngleForSlot(slot, {
      angleOffset: Settings.current.angleOffset,
      document,
      scene: document?.parent ?? null
    });
    if (sceneAngle === null) return null;

    return normaliseDegrees(sceneAngle - ROTATION_TO_SCREEN);
  }

  /**
   * Build the document changes that aim a token along a slot.
   *
   * `lockRotation` is written alongside the rotation on purpose: it is what keeps the artwork
   * upright while the facing turns, which is the only reason this module is allowed to touch
   * `rotation` at all.
   *
   * @param {TokenDocument|PrototypeToken} document The document being updated.
   * @param {DirectionKey} slot                     The slot the token is being given.
   * @param {DirectionalData} [data]                The token's normalised directional data.
   * @returns {object|null} A partial update, or `null` when nothing needs to change.
   */
  static buildPayload(document, slot, data) {
    if (!document || !slot) return null;
    if (!VisionFacing.isEnabled(data)) return null;
    if (!VisionFacing.hasLimitedCone(document)) return null;

    const rotation = VisionFacing.rotationForSlot(slot, document);
    if (rotation === null) return null;

    const payload = {};
    const current = Number(document.rotation) || 0;
    if (angularDistance(current, rotation) > ROTATION_EPSILON) payload.rotation = rotation;
    // Never leave a token free to rotate its drawing once we own its rotation value.
    if (document.lockRotation !== true) payload.lockRotation = true;

    return foundry.utils.isEmpty(payload) ? null : payload;
  }

  /**
   * Is the document already aimed correctly for this slot?
   * @param {TokenDocument|PrototypeToken} document The document.
   * @param {DirectionKey} slot                     The slot.
   * @param {DirectionalData} [data]                The token's normalised directional data.
   * @returns {boolean} True when no facing change is needed.
   */
  static isCurrent(document, slot, data) {
    return VisionFacing.buildPayload(document, slot, data) === null;
  }

  /**
   * Re-aim every already-placed token on the current scene.
   *
   * Turning the world setting on should be visible immediately rather than only after each token
   * has been nudged once, so this brings the whole scene into line in a single batched update. Only
   * the GM runs it, so the write happens exactly once however many clients are connected.
   *
   * Turning the setting *off* deliberately leaves the rotations where they are: a token keeps
   * looking wherever it was last walking, which is far less startling than every cone on the map
   * snapping back to South at once.
   *
   * @returns {Promise<number>} How many tokens were re-aimed.
   */
  static async realignScene() {
    if (!game.user?.isGM || !canvas?.scene) return 0;

    const updates = [];
    for (const placeable of canvas.tokens?.placeables ?? []) {
      const document = placeable.document;
      const data = ImageCache.getData(document);
      if (!DirectionalTokenData.isActive(data)) continue;

      const slot =
        ImageCache.getForced(document) ??
        ImageCache.getCurrentSlot(document) ??
        DirectionalTokenData.restingSlot(data);

      const payload = VisionFacing.buildPayload(document, slot, data);
      if (payload) updates.push({ _id: document.id, ...payload });
    }

    if (!updates.length) return 0;
    try {
      await canvas.scene.updateEmbeddedDocuments("Token", updates);
    } catch (error) {
      Logger.error("Failed to re-aim the scene's tokens.", error);
      return 0;
    }
    Logger.trace(`Re-aimed ${updates.length} token(s) after a facing setting change.`);
    return updates.length;
  }

  /* -------------------------------------------- */
  /*  Self visibility                             */
  /* -------------------------------------------- */

  /**
   * Whether {@link VisionFacing.installSelfRadiusPatch} has already run.
   * @type {boolean}
   */
  static #selfRadiusInstalled = false;

  /**
   * The circle a token always sees around itself, whatever its cone is doing.
   *
   * `LimitedAnglePolygon` unions an `externalRadius` circle into the cone - core's own mechanism for
   * "a token is never blind to the space it occupies" - and `Token#externalRadius` sizes that circle
   * from the token's **grid footprint**: `Math.min(width, height) / 2`, so half a square for a
   * Medium creature. That is right for top-down art drawn inside its square.
   *
   * Isometric art is not drawn inside its square. The projection modules stretch the sprite to well
   * over a grid unit tall and centre it on the token's cell, so a character walking towards the
   * camera has their own head and shoulders outside the cone, where the unseen overlay paints
   * straight over them. Widening the circle to cover the drawing puts the token back inside its own
   * vision without altering the cone by a single degree.
   *
   * @param {Token} token The placeable.
   * @returns {number} The radius in scene pixels, or `0` to leave core's value alone.
   */
  static selfRadiusFor(token) {
    const mode = Settings.current.visionSelfRadius;
    if (typeof mode !== "string" || mode === SELF_RADIUS.OFF) return 0;
    if (!VisionFacing.wantsSelfRadius(token?.document)) return 0;

    // "auto", "auto1.5", "auto2", ... — the measured artwork, optionally with room to spare.
    if (mode.startsWith(SELF_RADIUS.AUTO)) {
      const factor = Number(mode.slice(SELF_RADIUS.AUTO.length)) || 1;
      return VisionFacing.artworkRadius(token) * factor;
    }

    // "fixed2" — a size in grid squares. A bare number is accepted too, so a value stored before
    // the prefix existed keeps working.
    const raw = mode.startsWith(SELF_RADIUS.FIXED) ? mode.slice(SELF_RADIUS.FIXED.length) : mode;
    const squares = Number(raw);
    if (!Number.isFinite(squares) || squares <= 0) return 0;
    return squares * VisionFacing.#gridSize(token);
  }

  /**
   * The scene-space grid size that applies to a placeable.
   * @param {Token} token The placeable.
   * @returns {number} The grid size in pixels.
   */
  static #gridSize(token) {
    return token?.document?.parent?.grid?.size ?? canvas?.grid?.size ?? 0;
  }

  /**
   * The radius of a circle that covers the token's drawn artwork.
   *
   * Measured from the mesh rather than from the document, because the drawn size is exactly what a
   * projection module has been rewriting - reading it back is what makes this work on any
   * projection without knowing anything about the module that produced it. The mesh lives in the
   * primary group, whose coordinates *are* scene coordinates, so no conversion is needed.
   *
   * The circumscribed circle (`hypot / 2`) is used rather than the inscribed one so the corners of a
   * rotated or skewed sprite are covered too.
   *
   * @param {Token} token The placeable.
   * @returns {number} The radius in scene pixels, or `0` when the mesh cannot be measured.
   */
  static artworkRadius(token) {
    const mesh = token?.mesh;
    if (!mesh) return 0;
    const width = Math.abs(Number(mesh.width));
    const height = Math.abs(Number(mesh.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
    return Math.hypot(width, height) / 2;
  }

  /**
   * Does this document opt into the widened self-visibility circle?
   *
   * Deliberately narrow: only tokens this module actually steers are affected, so a world that turns
   * the setting on never changes how anything else on the map sees.
   *
   * @param {TokenDocument|PrototypeToken} document The document to test.
   * @returns {boolean} True when the widening applies.
   */
  static wantsSelfRadius(document) {
    if (!document) return false;
    if (!VisionFacing.hasLimitedCone(document)) return false;
    // Read through the cache: this runs on every vision-source rebuild.
    const data = ImageCache.getData(document);
    if (!DirectionalTokenData.isActive(data)) return false;
    return VisionFacing.isEnabled(data);
  }

  /**
   * Widen the self-visibility circle used by a token's vision and light sources.
   *
   * Only the `externalRadius` *reported to the sources* is touched, never `Token#externalRadius`
   * itself. That distinction matters: core measures a token's light radius from its outer edge with
   * `getLightRadius()`, which adds `externalRadius` to the configured distance, so widening the
   * getter would quietly hand every torch-bearing token a bigger torch. Patching the two
   * source-data builders instead leaves light *radius*, occlusion and everything else reading the
   * real value, and changes only the supplementary circle that `LimitedAnglePolygon` unions into a
   * cone.
   *
   * Both wrappers delegate to whatever was there before - core's method, or another module's - and
   * return core's own value untouched while the setting is off, so installing this is inert until a
   * GM asks for it.
   *
   * @returns {boolean} Whether the patch is in place.
   */
  static installSelfRadiusPatch() {
    if (VisionFacing.#selfRadiusInstalled) return true;

    const prototype = (foundry.canvas?.placeables?.Token ?? globalThis.Token)?.prototype;
    if (!prototype) {
      Logger.warn("Could not find the Token class; the self-visibility circle is unavailable.");
      return false;
    }

    const patched = ["_getVisionSourceData", "_getLightSourceData"].filter(method =>
      VisionFacing.#wrapSourceData(prototype, method)
    );
    if (!patched.length) {
      Logger.warn("Token source-data methods are missing on this Foundry version; skipping the patch.");
      return false;
    }

    VisionFacing.#selfRadiusInstalled = true;
    Logger.trace("Self-visibility patch installed on", patched.join(", "));
    return true;
  }

  /**
   * Wrap one source-data builder so the reported `externalRadius` is never smaller than the token's
   * own artwork needs.
   * @param {object} prototype The Token prototype.
   * @param {string} method    The method name to wrap.
   * @returns {boolean} Whether the method existed and was wrapped.
   */
  static #wrapSourceData(prototype, method) {
    const original = prototype[method];
    if (typeof original !== "function") return false;

    Object.defineProperty(prototype, method, {
      configurable: true,
      writable: true,
      /**
       * @this {Token}
       * @param {...*} args The original arguments.
       * @returns {object} The source data, with a widened `externalRadius` where it applies.
       */
      value: function (...args) {
        const data = original.apply(this, args);
        try {
          const radius = VisionFacing.selfRadiusFor(this);
          if (radius > (Number(data?.externalRadius) || 0)) data.externalRadius = radius;
        } catch (error) {
          Logger.trace("Failed to widen the self-visibility circle; using core's value.", error);
        }
        return data;
      }
    });
    return true;
  }

  /**
   * Install the self-visibility patch when the setting asks for it, then repaint.
   * @returns {void}
   */
  static syncSelfRadius() {
    const mode = Settings.current.visionSelfRadius;
    if (mode && mode !== SELF_RADIUS.OFF) VisionFacing.installSelfRadiusPatch();
    if (!VisionFacing.#selfRadiusInstalled) return;
    try {
      canvas?.perception?.update({ initializeVisionSources: true, initializeLightSources: true });
    } catch (error) {
      Logger.trace("Could not refresh perception after a self-visibility change.", error);
    }
  }
}

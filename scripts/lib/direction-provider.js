/**
 * @file The pluggable direction-calculation strategy.
 *
 * A {@link DirectionProvider} converts a world-space movement vector into a direction slot. The base
 * implementation only needs subclasses to override {@link DirectionProvider#transformDelta} in order
 * to support a different projection (isometric, rotated hex, a camera rig, …) — the quantisation,
 * sensitivity handling and fallback logic are inherited unchanged.
 *
 * @module directional-token-images/lib/direction-provider
 */

import { I18N } from "../constants.js";
import { normaliseDegrees, quantise, rotateVector, slotToAngle } from "./directions.js";
import { Logger } from "./logger.js";

/**
 * @typedef {import("./directions.js").DirectionKey} DirectionKey
 * @typedef {import("./directions.js").Vector2} Vector2
 */

/**
 * Everything a provider is given in order to decide on a direction.
 * @typedef {object} DirectionContext
 * @property {number} dx                    Net world-space horizontal displacement, in pixels.
 * @property {number} dy                    Net world-space vertical displacement, in pixels.
 * @property {number} mode                  The active image-set mode (1, 2, 4 or 8).
 * @property {number} sensitivity           The configured direction sensitivity.
 * @property {number} angleOffset           A user-configured facing rotation, in degrees.
 * @property {TokenDocument|PrototypeToken|null} document The document being moved, when available.
 * @property {Scene|null} scene             The scene the movement happens in, when available.
 * @property {object|null} [origin]         The movement origin `{x, y, elevation}`, when available.
 * @property {object|null} [destination]    The movement destination, when available.
 * @property {object[]} [waypoints]         The full passed waypoint path, when available. Providers
 *   may inspect this to react to multi-leg movement instead of the net displacement.
 */

/**
 * Base direction provider: a straight top-down projection where screen axes equal world axes.
 *
 * @example Registering a custom provider from another module
 * ```js
 * Hooks.once("directional-token-images.ready", api => {
 *   class MyProvider extends api.DirectionProvider {
 *     static id = "my-projection";
 *     static labelKey = "MYMODULE.ProviderLabel";
 *     transformDelta(vector) { return { dx: vector.dy, dy: -vector.dx }; }
 *   }
 *   api.registerDirectionProvider(new MyProvider());
 * });
 * ```
 */
export class DirectionProvider {
  /** Unique provider id, used as the settings value. @type {string} */
  static id = "base";

  /** Localisation key for the provider's display name. @type {string} */
  static labelKey = `${I18N}.PROVIDERS.base`;

  /** @returns {string} This provider's id. */
  get id() {
    return this.constructor.id;
  }

  /** @returns {string} This provider's localised label. */
  get label() {
    return game.i18n.localize(this.constructor.labelKey);
  }

  /**
   * Convert a world-space movement vector into facing space.
   *
   * The base implementation is the identity transform plus the user-configured angle offset, which
   * lets a GM dial in a projection without writing any code. Subclasses that model a specific
   * projection should call `super.transformDelta()` so the user offset is still honoured.
   *
   * @param {Vector2} vector             The world-space movement vector.
   * @param {DirectionContext} context   The full direction context.
   * @returns {Vector2} The facing-space movement vector.
   */
  transformDelta(vector, context) {
    return context.angleOffset ? rotateVector(vector, context.angleOffset) : vector;
  }

  /**
   * Resolve a direction slot from a movement context.
   *
   * Subclasses rarely need to override this: overriding {@link DirectionProvider#transformDelta} is
   * usually enough and keeps sensitivity/mode handling consistent across providers.
   *
   * @param {DirectionContext} context The direction context.
   * @returns {DirectionKey|null} The resolved slot, or `null` to keep the current artwork.
   */
  resolve(context) {
    const vector = this.transformDelta({ dx: context.dx, dy: context.dy }, context);
    if (!vector || (!vector.dx && !vector.dy)) return null;
    return quantise(vector, context.mode, { sensitivity: context.sensitivity });
  }

  /**
   * Convert a facing-space angle back into scene space: the exact inverse of
   * {@link DirectionProvider#transformDelta}.
   *
   * Artwork slots are authored in facing space, but everything Foundry itself steers — a vision
   * cone, a light cone — lives in scene space. Any subclass that overrides `transformDelta` must
   * override this too, or a token's cone will not agree with the drawing it is wearing.
   *
   * @param {number} degrees           A facing-space angle, where 0 is East and angles increase
   *   clockwise.
   * @param {DirectionContext} context The full direction context.
   * @returns {number} The equivalent scene-space angle in `[0, 360)`.
   */
  untransformAngle(degrees, context) {
    return normaliseDegrees(degrees - (context?.angleOffset ?? 0));
  }

  /**
   * The scene-space angle a token wearing a given direction slot is facing.
   * @param {import("./directions.js").DirectionKey} slot The direction slot.
   * @param {DirectionContext} context                    The full direction context.
   * @returns {number|null} The angle in `[0, 360)`, or `null` when the slot carries no direction.
   */
  sceneAngleForSlot(slot, context) {
    const angle = slotToAngle(slot);
    return angle === null ? null : this.untransformAngle(angle, context);
  }
}

/**
 * Standard top-down projection: North is up on screen.
 */
export class TopDownDirectionProvider extends DirectionProvider {
  /** @override */
  static id = "topDown";

  /** @override */
  static labelKey = `${I18N}.PROVIDERS.topDown`;
}

/**
 * Isometric projection.
 *
 * On a 2:1 isometric map the world axes are drawn rotated 45° on screen, so a token whose sprite
 * should show its "North" artwork is actually travelling up-and-left in screen pixels. Rotating the
 * incoming vector by +45° maps those screen diagonals back onto the compass slots the artwork is
 * authored against.
 */
export class IsometricDirectionProvider extends DirectionProvider {
  /** @override */
  static id = "isometric";

  /** @override */
  static labelKey = `${I18N}.PROVIDERS.isometric`;

  /** The screen rotation of the isometric projection, in degrees. @type {number} */
  static ROTATION = 45;

  /** @inheritdoc */
  transformDelta(vector, context) {
    return rotateVector(super.transformDelta(vector, context), this.constructor.ROTATION);
  }

  /** @inheritdoc */
  untransformAngle(degrees, context) {
    return super.untransformAngle(normaliseDegrees(degrees - this.constructor.ROTATION), context);
  }
}

/**
 * Isometric projection mirrored on the opposite diagonal, used by maps whose "north" runs
 * up-and-right instead of up-and-left.
 */
export class IsometricMirroredDirectionProvider extends IsometricDirectionProvider {
  /** @override */
  static id = "isometricMirrored";

  /** @override */
  static labelKey = `${I18N}.PROVIDERS.isometricMirrored`;

  /** @override */
  static ROTATION = -45;
}

/**
 * Registry of the available direction providers.
 *
 * The `choices` object is intentionally a stable, mutable reference: it is handed to
 * `game.settings.register` so that providers registered by other modules after our own `init` still
 * appear in the settings dropdown without a reload.
 */
export class DirectionProviderRegistry {
  /** @type {Map<string, DirectionProvider>} */
  static #providers = new Map();

  /**
   * Live `{id: label}` map consumed by the settings dropdown.
   * @type {Record<string, string>}
   */
  static choices = {};

  /** @type {string} */
  static #activeId = TopDownDirectionProvider.id;

  /**
   * Register a provider instance. Registering an existing id replaces the previous provider.
   * @param {DirectionProvider} provider The provider instance to register.
   * @returns {DirectionProvider} The registered provider, for chaining.
   */
  static register(provider) {
    if (!(provider instanceof DirectionProvider)) {
      throw new Error("A direction provider must be an instance of DirectionProvider.");
    }
    DirectionProviderRegistry.#providers.set(provider.id, provider);
    DirectionProviderRegistry.choices[provider.id] = provider.constructor.labelKey;
    Logger.trace("Registered direction provider", provider.id);
    return provider;
  }

  /**
   * Retrieve a provider by id.
   * @param {string} id The provider id.
   * @returns {DirectionProvider|undefined} The provider, if registered.
   */
  static get(id) {
    return DirectionProviderRegistry.#providers.get(id);
  }

  /** @returns {DirectionProvider[]} Every registered provider. */
  static all() {
    return [...DirectionProviderRegistry.#providers.values()];
  }

  /**
   * The currently active provider, falling back to the top-down provider when the configured id is
   * unknown (for example after uninstalling the module that supplied it).
   * @returns {DirectionProvider} The active provider.
   */
  static get active() {
    return (
      DirectionProviderRegistry.#providers.get(DirectionProviderRegistry.#activeId) ??
      DirectionProviderRegistry.#providers.get(TopDownDirectionProvider.id)
    );
  }

  /**
   * Select the active provider.
   * @param {string} id The provider id to activate.
   * @returns {boolean} Whether the id was known and therefore applied.
   */
  static setActive(id) {
    if (!DirectionProviderRegistry.#providers.has(id)) {
      Logger.warn(`Unknown direction provider "${id}"; keeping "${DirectionProviderRegistry.#activeId}".`);
      return false;
    }
    DirectionProviderRegistry.#activeId = id;
    Logger.trace("Active direction provider set to", id);
    return true;
  }

  /**
   * Register the providers that ship with the module. Safe to call more than once.
   * @returns {void}
   */
  static registerDefaults() {
    DirectionProviderRegistry.register(new TopDownDirectionProvider());
    DirectionProviderRegistry.register(new IsometricDirectionProvider());
    DirectionProviderRegistry.register(new IsometricMirroredDirectionProvider());
  }
}

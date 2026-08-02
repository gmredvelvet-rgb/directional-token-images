/**
 * @file Optional visual extras: the artwork offset/scale nudge and the decorative base sprite.
 *
 * Both features are strictly opt-in — a token with a zero offset, a scale of 1 and no base image
 * costs a single early `return` per refresh, so scenes that do not use them pay nothing.
 *
 * ## Why the render flags are checked
 * Core recomputes the mesh transform *absolutely* immediately before emitting `refreshToken`, so an
 * additive offset applied under the matching flag can never compound. Applying it on unrelated
 * refreshes (selection, visibility, bars) would compound, which is why each adjustment is gated on
 * the specific flag whose core handler had just rewritten the value it modifies.
 *
 * @module directional-token-images/lib/art-renderer
 */

import { ImageCache } from "./image-cache.js";
import { Logger } from "./logger.js";

/**
 * @typedef {import("./token-images.js").DirectionalData} DirectionalData
 */

/**
 * Renders the per-token artwork transform and base sprite.
 */
export class ArtRenderer {
  /**
   * Base sprites currently attached to the canvas.
   *
   * Keyed by the placeable itself rather than by document id, because drag previews and sheet
   * previews share their original's id and would otherwise fight over the same sprite.
   *
   * @type {WeakMap<Token, PIXI.DisplayObject>}
   */
  static #bases = new WeakMap();

  /**
   * Every live base sprite, so a scene teardown can dispose of them all.
   * @type {Set<PIXI.DisplayObject>}
   */
  static #live = new Set();

  /**
   * Sort layer for base sprites: above drawings, below every token so a base never covers artwork.
   * @returns {number} The sort layer value.
   */
  static get #baseSortLayer() {
    const layers = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS;
    return (layers.DRAWINGS + layers.TOKENS) / 2;
  }

  /**
   * Does this token need any of the optional visuals?
   * @param {DirectionalData} data The normalised data.
   * @returns {boolean} True when at least one visual extra is configured.
   */
  static #needsWork(data) {
    const { art, base } = data;
    return !!base.src || art.offsetX !== 0 || art.offsetY !== 0 || art.offsetZ !== 0 || art.scale !== 1;
  }

  /**
   * Apply the artwork transform and synchronise the base sprite for a token.
   *
   * @param {Token} token   The token placeable.
   * @param {object} [flags] The render flags emitted alongside `refreshToken`. When omitted every
   *   adjustment is applied, which is what a fresh draw wants.
   * @returns {void}
   */
  static refresh(token, flags = null) {
    if (!token?.mesh || token.destroyed) return;

    const data = ImageCache.getData(token.document);
    if (!data.enabled || !ArtRenderer.#needsWork(data)) {
      ArtRenderer.destroy(token);
      return;
    }

    const { art } = data;
    const all = flags === null;

    // Position: core assigned `mesh.position = token.center` under `refreshPosition`.
    if ((all || flags.refreshPosition) && (art.offsetX || art.offsetY)) {
      token.mesh.position.set(token.mesh.position.x + art.offsetX, token.mesh.position.y + art.offsetY);
    }

    // Scale: core called `mesh.resize()` under `refreshMesh` / `refreshSize` / `refreshShape`.
    if ((all || flags.refreshMesh || flags.refreshSize || flags.refreshShape) && art.scale !== 1) {
      token.mesh.scale.set(token.mesh.scale.x * art.scale, token.mesh.scale.y * art.scale);
    }

    // Depth: recomputed absolutely, so it is safe to apply on any refresh.
    if (art.offsetZ) token.mesh.sort = (token.document.sort ?? 0) + art.offsetZ;

    ArtRenderer.#syncBase(token, data);
  }

  /**
   * Create, update or tear down the base sprite for a token.
   * @param {Token} token          The token placeable.
   * @param {DirectionalData} data The normalised data.
   * @returns {void}
   */
  static #syncBase(token, data) {
    const { src, scale, rotation } = data.base;
    if (!src) {
      ArtRenderer.destroy(token);
      return;
    }

    let mesh = ArtRenderer.#bases.get(token);
    if (!mesh || mesh.destroyed) {
      mesh = ArtRenderer.#createBase(token);
      if (!mesh) return;
    }

    // Load lazily; the sprite simply stays invisible until its texture is ready.
    if (mesh.__dtiSrc !== src) {
      mesh.__dtiSrc = src;
      mesh.visible = false;
      foundry.canvas
        .loadTexture(src, { fallback: null })
        .then(texture => {
          if (!texture || mesh.destroyed || mesh.__dtiSrc !== src) return;
          mesh.texture = texture;
          mesh.visible = true;
        })
        .catch(error => Logger.warn(`Could not load the base image "${src}".`, error));
    }

    const { width, height } = token.document.getSize();
    const center = token.center;
    mesh.anchor?.set?.(0.5, 0.5);
    mesh.position.set(center.x, center.y);
    mesh.width = width * scale;
    mesh.height = height * scale;
    mesh.angle = rotation;
    mesh.elevation = token.document.elevation;
    mesh.alpha = token.mesh.alpha;
    mesh.renderable = token.renderable && token.visible;
  }

  /**
   * Instantiate a base sprite and attach it to the primary canvas group.
   * @param {Token} token The placeable the sprite belongs to.
   * @returns {PIXI.DisplayObject|null} The created sprite, or `null` when the canvas is not ready.
   */
  static #createBase(token) {
    if (!canvas?.primary) return null;
    try {
      const mesh = new foundry.canvas.primary.PrimarySpriteMesh({ name: `dti-base-${token.id}` });
      mesh.sortLayer = ArtRenderer.#baseSortLayer;
      mesh.visible = false;
      canvas.primary.addChild(mesh);
      ArtRenderer.#bases.set(token, mesh);
      ArtRenderer.#live.add(mesh);
      return mesh;
    } catch (error) {
      Logger.error("Failed to create the token base sprite.", error);
      return null;
    }
  }

  /**
   * Dispose of a base sprite.
   * @param {PIXI.DisplayObject} mesh The sprite to dispose of.
   * @returns {void}
   */
  static #disposeBase(mesh) {
    ArtRenderer.#live.delete(mesh);
    if (mesh.destroyed) return;
    mesh.removeFromParent?.();
    mesh.destroy();
  }

  /**
   * Remove every visual extra owned by a token.
   * @param {Token} token The token placeable.
   * @returns {void}
   */
  static destroy(token) {
    if (!token) return;
    const mesh = ArtRenderer.#bases.get(token);
    if (!mesh) return;
    ArtRenderer.#bases.delete(token);
    ArtRenderer.#disposeBase(mesh);
  }

  /**
   * Remove every base sprite. Called on scene teardown.
   * @returns {void}
   */
  static destroyAll() {
    for (const mesh of [...ArtRenderer.#live]) ArtRenderer.#disposeBase(mesh);
    ArtRenderer.#live.clear();
  }
}

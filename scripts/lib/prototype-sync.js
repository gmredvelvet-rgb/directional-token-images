/**
 * @file Pushes an actor's prototype configuration onto tokens that already exist.
 *
 * Foundry copies the prototype token into every *new* token, but tokens already placed on a scene
 * keep the configuration they were created with. This service closes that gap so a change made once
 * on the actor can reach every scene without the user opening each token.
 *
 * @module directional-token-images/lib/prototype-sync
 */

import { DirectionalTokenData } from "./token-images.js";
import { ImageCache } from "./image-cache.js";
import { Logger } from "./logger.js";

/**
 * @typedef {import("./token-images.js").DirectionalData} DirectionalData
 */

/**
 * Result of a synchronisation pass.
 * @typedef {object} SyncReport
 * @property {number} tokens  How many token documents were updated.
 * @property {number} scenes  How many scenes contained at least one of them.
 * @property {string[]} failed Names of scenes that could not be updated.
 */

/**
 * Propagates prototype configuration to placed tokens.
 */
export class PrototypeSync {
  /**
   * Collect the scenes to consider.
   * @param {"all"|"current"} scope Which scenes to touch.
   * @returns {Scene[]} The scenes.
   */
  static #scenesFor(scope) {
    if (scope === "current") return canvas?.scene ? [canvas.scene] : [];
    return [...(game.scenes ?? [])];
  }

  /**
   * Push an actor's prototype directional configuration onto its existing tokens.
   *
   * Matching is by `actorId`, which covers linked and unlinked tokens alike. Tokens are updated one
   * scene at a time so a permission failure on a single scene cannot abort the whole pass.
   *
   * @param {Actor} actor              The actor whose prototype is the source of truth.
   * @param {object} [options]
   * @param {"all"|"current"} [options.scope="all"] Which scenes to update.
   * @returns {Promise<SyncReport>} What was changed.
   */
  static async fromActor(actor, { scope = "all" } = {}) {
    const report = { tokens: 0, scenes: 0, failed: [] };
    if (!actor?.prototypeToken) return report;

    const data = DirectionalTokenData.read(actor.prototypeToken);
    const payload = DirectionalTokenData.buildUpdate(data);
    if (foundry.utils.isEmpty(payload)) return report;

    for (const scene of PrototypeSync.#scenesFor(scope)) {
      const updates = scene.tokens
        .filter(token => token.actorId === actor.id)
        .map(token => ({ _id: token.id, ...payload }));
      if (!updates.length) continue;

      try {
        await scene.updateEmbeddedDocuments("Token", updates);
        for (const update of updates) ImageCache.invalidate(scene.tokens.get(update._id));
        report.tokens += updates.length;
        report.scenes += 1;
      } catch (error) {
        report.failed.push(scene.name);
        Logger.warn(`Could not sync directional images on scene "${scene.name}".`, error);
      }
    }

    Logger.trace(`Prototype sync for ${actor.name}:`, report);
    return report;
  }
}

/**
 * @file Central hook registration.
 *
 * Keeping every `Hooks.on` call in one place makes the module's canvas and document footprint easy
 * to audit: there is no polling, no `setInterval`, and no listener registered outside this file.
 *
 * @module directional-token-images/hooks/index
 */

import {
  onCanvasReady,
  onCanvasTearDown,
  onDestroyToken,
  onDrawToken,
  onRefreshToken
} from "./canvas-hooks.js";
import {
  onCreateToken,
  onDeleteToken,
  onPreUpdateToken,
  onUpdateActor,
  onUpdateToken
} from "./movement-hooks.js";
import { DirectionHud } from "../apps/direction-hud.js";
import { Logger } from "../lib/logger.js";

/**
 * Register every runtime hook. Call once during `init`.
 * @returns {void}
 */
export function registerHooks() {
  // Document lifecycle and movement.
  Hooks.on("preUpdateToken", onPreUpdateToken);
  Hooks.on("updateToken", onUpdateToken);
  Hooks.on("createToken", onCreateToken);
  Hooks.on("deleteToken", onDeleteToken);
  Hooks.on("updateActor", onUpdateActor);

  // Canvas lifecycle, drag previews and the optional visual extras.
  Hooks.on("drawToken", onDrawToken);
  Hooks.on("refreshToken", onRefreshToken);
  Hooks.on("destroyToken", onDestroyToken);
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("canvasTearDown", onCanvasTearDown);

  // User interface.
  Hooks.on("renderTokenHUD", DirectionHud.onRenderTokenHUD);

  Logger.trace("Hooks registered.");
}

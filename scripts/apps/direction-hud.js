/**
 * @file The Token HUD direction palette.
 *
 * Adds one control to the Token HUD that reports the direction the module currently believes the
 * token is facing and lets a GM pin it to any direction for testing. Pinning is a purely in-memory
 * override: nothing extra is written to the document.
 *
 * @module directional-token-images/apps/direction-hud
 */

import { I18N, TEMPLATES } from "../constants.js";
import { DirectionalTokenImagesAPI } from "../api/api.js";
import { DirectionalConfigApp } from "./directional-config.js";
import { DirectionalTokenData } from "../lib/token-images.js";
import { ImageCache } from "../lib/image-cache.js";
import { Logger } from "../lib/logger.js";
import { MODES } from "../lib/directions.js";
import { SLOT_META } from "./field-builder.js";
import { Settings } from "../settings/settings.js";

/**
 * Build the palette render context for a token.
 * @param {TokenDocument} document The token document.
 * @returns {object} The Handlebars context.
 */
function buildPaletteContext(document) {
  const data = ImageCache.getData(document);
  const mode = DirectionalTokenData.resolveMode(data);
  const forced = ImageCache.getForced(document);
  const current = forced ?? ImageCache.getCurrentSlot(document);

  return {
    mode,
    forced,
    currentLabel: current
      ? game.i18n.localize(`${I18N}.DIRECTIONS.${current}.label`)
      : game.i18n.localize(`${I18N}.HUD.unknown`),
    slots: MODES[mode].slots.map(slot => ({
      slot,
      icon: SLOT_META[slot].icon,
      label: `${I18N}.DIRECTIONS.${slot}.label`,
      active: slot === forced
    }))
  };
}

/**
 * Handle a click inside the palette.
 * @param {PointerEvent} event     The click event.
 * @param {HTMLElement} palette    The palette root.
 * @param {TokenDocument} document The token document.
 * @returns {Promise<void>} Resolves once the action has been applied.
 */
async function onPaletteClick(event, palette, document) {
  const target = event.target.closest("[data-dti-action]");
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();

  switch (target.dataset.dtiAction) {
    case "force": {
      await DirectionalTokenImagesAPI.forceDirection(document, target.dataset.slot);
      break;
    }
    case "auto": {
      DirectionalTokenImagesAPI.clearForcedDirection(document);
      break;
    }
    case "configure": {
      DirectionalConfigApp.open([document]);
      return;
    }
    default:
      return;
  }

  // Reflect the new state without re-rendering the whole HUD.
  const forced = ImageCache.getForced(document);
  for (const control of palette.querySelectorAll("[data-dti-action='force']")) {
    control.classList.toggle("active", control.dataset.slot === forced);
  }
  palette.querySelector("[data-dti-action='auto']")?.classList.toggle("active", !forced);
  const value = palette.querySelector("[data-dti-current]");
  if (value) {
    const current = forced ?? ImageCache.getCurrentSlot(document);
    value.textContent = current
      ? game.i18n.localize(`${I18N}.DIRECTIONS.${current}.label`)
      : game.i18n.localize(`${I18N}.HUD.unknown`);
  }
}

/**
 * The Token HUD integration.
 */
export class DirectionHud {
  /**
   * `renderTokenHUD`: append the direction control and its palette.
   * @param {object} hud          The Token HUD application.
   * @param {HTMLElement} element The rendered HUD element.
   * @returns {Promise<void>} Resolves once the control has been inserted.
   */
  static async onRenderTokenHUD(hud, element) {
    if (!Settings.current.showHudButton) return;

    const document = hud.object?.document;
    if (!document) return;
    if (!document.isOwner && !game.user.isGM) return;

    const column = element.querySelector(".col.right");
    if (!column || column.querySelector("[data-palette='directional']")) return;

    try {
      const button = window.document.createElement("button");
      button.type = "button";
      button.className = "control-icon";
      button.dataset.action = "togglePalette";
      button.dataset.palette = "directional";
      button.dataset.tooltip = `${I18N}.HUD.tooltip`;
      button.setAttribute("aria-label", game.i18n.localize(`${I18N}.HUD.tooltip`));
      button.innerHTML = '<i class="fa-solid fa-compass" inert></i>';

      const html = await foundry.applications.handlebars.renderTemplate(
        TEMPLATES.HUD_PALETTE,
        buildPaletteContext(document)
      );
      const wrapper = window.document.createElement("div");
      wrapper.innerHTML = html;
      const palette = wrapper.firstElementChild;

      column.append(button, palette);
      palette.addEventListener("click", event => void onPaletteClick(event, palette, document));
    } catch (error) {
      Logger.error("Failed to render the Token HUD direction palette.", error);
    }
  }
}

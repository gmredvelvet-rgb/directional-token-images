/**
 * @file Adds a "Directional Images" entry to the Actor sheet header.
 *
 * Configuring the *prototype* token rather than a placed one is what makes the setup persistent:
 * Foundry copies the prototype into every token created from the actor, so the artwork only has to
 * be chosen once instead of scene by scene.
 *
 * Both application generations are supported, because systems migrate at their own pace — PF2e's
 * character sheet is still an ApplicationV1 in Foundry 13 while core's own sheets are V2.
 *
 * @module directional-token-images/apps/actor-sheet-button
 */

import { I18N } from "../constants.js";
import { DirectionalConfigApp } from "./directional-config.js";
import { Logger } from "../lib/logger.js";

/**
 * Should this sheet offer the control?
 * @param {object} sheet The actor sheet application.
 * @returns {Actor|null} The actor to configure, or `null` when the control does not apply.
 */
function getEligibleActor(sheet) {
  const actor = sheet?.actor ?? sheet?.document;
  if (!actor || actor.documentName !== "Actor") return null;
  if (!actor.isOwner) return null;
  // A synthetic actor belongs to an unlinked token; that token is configured directly instead.
  if (actor.isToken) return null;
  return actor;
}

/**
 * Open the configurator bound to an actor's prototype token.
 * @param {Actor} actor The actor whose prototype should be edited.
 * @returns {void}
 */
function openForActor(actor) {
  if (!actor?.prototypeToken) return;
  DirectionalConfigApp.open([actor.prototypeToken]);
}

/**
 * `getActorSheetHeaderButtons` — ApplicationV1 sheets.
 *
 * Core dispatches this hook for every class in the sheet's inheritance chain, so listening on the
 * base `ActorSheet` name also covers system subclasses such as PF2e's `CharacterSheetPF2e`.
 *
 * @param {object} sheet    The actor sheet application.
 * @param {object[]} buttons The mutable header button array.
 * @returns {void}
 */
export function onActorSheetHeaderButtons(sheet, buttons) {
  const actor = getEligibleActor(sheet);
  if (!actor) return;
  if (buttons.some(button => button.class === "directional-token-images")) return;

  // Insert before Close so the control sits alongside the sheet's own buttons.
  const closeIndex = buttons.findIndex(button => button.class === "close");
  const control = {
    label: game.i18n.localize(`${I18N}.TAB.label`),
    class: "directional-token-images",
    icon: "fa-solid fa-compass",
    onclick: () => openForActor(actor)
  };
  if (closeIndex === -1) buttons.push(control);
  else buttons.splice(closeIndex, 0, control);
}

/**
 * `getHeaderControlsActorSheetV2` — ApplicationV2 sheets.
 * @param {object} sheet      The actor sheet application.
 * @param {object[]} controls The mutable header control array.
 * @returns {void}
 */
export function onActorSheetHeaderControls(sheet, controls) {
  const actor = getEligibleActor(sheet);
  if (!actor) return;
  if (controls.some(control => control.action === "dtiConfigureDirectional")) return;

  controls.push({
    action: "dtiConfigureDirectional",
    icon: "fa-solid fa-compass",
    label: `${I18N}.TAB.label`,
    onClick: () => openForActor(actor)
  });
}

/**
 * Registration entry point for the Actor sheet integration.
 */
export class ActorSheetButton {
  /**
   * Register the header hooks for both application generations.
   * @returns {void}
   */
  static register() {
    Hooks.on("getActorSheetHeaderButtons", onActorSheetHeaderButtons);
    Hooks.on("getHeaderControlsActorSheetV2", onActorSheetHeaderControls);
    Logger.trace("Actor sheet header control registered.");
  }
}

/**
 * @file Injects the "Directional Images" tab into the Token Configuration sheet.
 *
 * The tab is added the way core adds its own tabs — as an entry in `TABS.sheet.tabs`, a template
 * part in `PARTS`, and a `_prepare<Part>Tab()` context method. Nothing about tab switching, form
 * submission or the live token preview has to be re-implemented, and system subclasses such as
 * PF2e's `TokenConfigPF2e` are patched alongside core's class.
 *
 * @module directional-token-images/apps/token-config-tab
 */

import { I18N, TAB_GROUP, TAB_ID, TEMPLATES } from "../constants.js";
import { DirectionalFormController } from "./form-controller.js";
import { DirectionalTokenData } from "../lib/token-images.js";
import { ImageCache } from "../lib/image-cache.js";
import { Logger } from "../lib/logger.js";
import { buildFieldContext } from "./field-builder.js";

/**
 * Controllers bound to open sheets, so listeners are wired exactly once per render.
 * @type {WeakMap<object, DirectionalFormController>}
 */
const controllers = new WeakMap();

/**
 * Collect every application class that renders a token sheet: core's two classes plus whatever the
 * active system registered.
 *
 * Systems commonly subclass both sheets — PF2e, for instance, registers `TokenConfigPF2e` through
 * `DocumentSheetConfig` and assigns `PrototypeTokenConfigPF2e` to `CONFIG.Token.prototypeSheetClass`
 * — and those subclasses often snapshot `PARTS` at class-definition time, so patching core alone is
 * not enough.
 *
 * @returns {Set<Function>} The classes to patch.
 */
function collectTokenSheetClasses() {
  const classes = new Set();
  const { TokenConfig, PrototypeTokenConfig } = foundry.applications.sheets;
  if (TokenConfig) classes.add(TokenConfig);
  if (PrototypeTokenConfig) classes.add(PrototypeTokenConfig);
  if (CONFIG.Token?.prototypeSheetClass) classes.add(CONFIG.Token.prototypeSheetClass);

  for (const entry of Object.values(CONFIG.Token?.sheetClasses?.base ?? {})) {
    if (entry?.cls) classes.add(entry.cls);
  }

  // Only keep classes that actually expose the tab/part statics we need.
  for (const cls of classes) {
    if (!Array.isArray(cls?.TABS?.[TAB_GROUP]?.tabs) || !cls?.PARTS) classes.delete(cls);
  }
  return classes;
}

/**
 * Add the tab, the template part and the context method to a single sheet class.
 *
 * Each of the three pieces is guarded independently. That matters because a subclass may inherit
 * `TABS` (already patched via its parent) while owning a private copy of `PARTS` that still needs
 * the template part added.
 *
 * @param {Function} cls The application class to patch.
 * @returns {void}
 */
function patchSheetClass(cls) {
  const tabs = cls.TABS[TAB_GROUP].tabs;
  if (!tabs.some(tab => tab.id === TAB_ID)) {
    tabs.push({
      id: TAB_ID,
      group: TAB_GROUP,
      icon: "fa-solid fa-compass",
      label: `${I18N}.TAB.label`
    });
  }

  const parts = cls.PARTS;
  if (!(TAB_ID in parts)) {
    // Insert before the footer so the save button stays at the bottom of the sheet.
    const footer = parts.footer;
    if (footer) delete parts.footer;
    parts[TAB_ID] = { template: TEMPLATES.TOKEN_CONFIG_TAB, scrollable: [""] };
    if (footer) parts.footer = footer;
  }

  // Core calls `_prepare${partId.titleCase()}Tab()` for any part that maps to a tab.
  if (!cls.prototype._prepareDirectionalTab) {
    cls.prototype._prepareDirectionalTab = function () {
      return buildFieldContext(DirectionalTokenData.read(this.token), { compact: true });
    };
  }

  Logger.trace(`Patched ${cls.name} with the directional images tab.`);
}

/**
 * Bind the shared interaction controller to a freshly rendered token sheet.
 * @param {object} app          The token configuration application.
 * @param {HTMLElement} element The rendered root element.
 * @returns {void}
 */
function onRenderTokenSheet(app, element) {
  const root = element.querySelector(`[data-application-part="${TAB_ID}"]`);
  if (!root) return;
  if (controllers.get(app)?.root === root) return;

  const document = app.token ?? app.document;
  const controller = new DirectionalFormController(root, {
    baseline: DirectionalTokenData.read(document),
    onChange: () => {
      // The sheet mirrors form changes onto its preview clone, so dropping the cache lets the
      // canvas preview reflect unsaved offsets, scale and base changes immediately.
      ImageCache.invalidate(document);
      document?.object?.renderFlags?.set({ refreshMesh: true, refreshPosition: true });
    }
  }).activate();

  controllers.set(app, controller);
}

/**
 * Drop cached data derived from a sheet's preview clone once the sheet closes.
 * @param {object} app The closing application.
 * @returns {void}
 */
function onCloseTokenSheet(app) {
  controllers.delete(app);
  const document = app.document ?? app.token;
  if (document) ImageCache.invalidate(document);
}

/**
 * Registration entry point for the Token Configuration integration.
 */
export class TokenConfigTab {
  /**
   * Patch the sheet classes and register the render/close listeners.
   *
   * Must run during `setup` rather than `init`: systems register their token sheet subclasses in
   * their own `init` handler, and only by `setup` is `CONFIG.Token` guaranteed to be final.
   *
   * @returns {void}
   */
  static register() {
    for (const cls of collectTokenSheetClasses()) {
      try {
        patchSheetClass(cls);
      } catch (error) {
        Logger.error(`Failed to patch ${cls?.name ?? "an unknown token sheet"}.`, error);
      }
    }

    // Core dispatches render hooks for every class in the inheritance chain, so listening to the
    // two base class names also covers system subclasses.
    Hooks.on("renderTokenConfig", onRenderTokenSheet);
    Hooks.on("renderPrototypeTokenConfig", onRenderTokenSheet);
    Hooks.on("closeTokenConfig", onCloseTokenSheet);
    Hooks.on("closePrototypeTokenConfig", onCloseTokenSheet);
  }
}

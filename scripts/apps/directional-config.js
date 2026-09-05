/**
 * @file The standalone Directional Token Images configurator.
 *
 * A full ApplicationV2 form that can be opened from the Token HUD, the token context menu or the
 * API, and applied to one or many selected tokens at once.
 *
 * @module directional-token-images/apps/directional-config
 */

import { I18N, MODULE_ID, TEMPLATES } from "../constants.js";
import { DirectionalFormController } from "./form-controller.js";
import { buildFieldContext } from "./field-builder.js";
import { DirectionalTokenData } from "../lib/token-images.js";
import { ImageCache } from "../lib/image-cache.js";
import { Logger } from "../lib/logger.js";
import { PrototypeSync } from "../lib/prototype-sync.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * @typedef {import("../lib/token-images.js").DirectionalData} DirectionalData
 */

/**
 * Standalone editor for a token's directional artwork.
 *
 * @example
 * ```js
 * new DirectionalConfigApp({ documents: canvas.tokens.controlled.map(t => t.document) }).render(true);
 * ```
 */
export class DirectionalConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-config`,
    classes: ["directional-token-images", "dti-config-app", "standard-form"],
    tag: "form",
    window: {
      title: `${I18N}.APP.title`,
      icon: "fa-solid fa-compass",
      resizable: true,
      contentClasses: ["standard-form"]
    },
    position: { width: 880, height: "auto" },
    form: {
      handler: DirectionalConfigApp.#onSubmitForm,
      closeOnSubmit: true,
      submitOnChange: false
    },
    actions: {
      dtiCancel: DirectionalConfigApp.#onCancel
    }
  };

  /** @override */
  static PARTS = {
    body: { template: TEMPLATES.CONFIG_APP, scrollable: [".dti-column"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /**
   * The documents this dialog will write to.
   * @type {(TokenDocument|PrototypeToken)[]}
   */
  #documents;

  /**
   * The interaction controller bound to the rendered form.
   * @type {DirectionalFormController|null}
   */
  #controller = null;

  /** @returns {DirectionalFormController|null} The bound interaction controller. */
  get controller() {
    return this.#controller;
  }

  /**
   * @param {object} [options]
   * @param {(Token|TokenDocument|PrototypeToken)[]} [options.documents] The tokens to configure.
   *   Defaults to the currently controlled tokens.
   */
  constructor(options = {}) {
    super(options);
    const supplied = options.documents ?? canvas?.tokens?.controlled ?? [];
    this.#documents = supplied.map(entry => DirectionalTokenData.resolveDocument(entry)).filter(Boolean);
  }

  /** @returns {(TokenDocument|PrototypeToken)[]} The documents this dialog writes to. */
  get documents() {
    return this.#documents;
  }

  /** @returns {TokenDocument|PrototypeToken|null} The document whose values seed the form. */
  get primary() {
    return this.#documents[0] ?? null;
  }

  /** @returns {boolean} Whether this dialog is editing an actor's prototype token. */
  get isPrototype() {
    return DirectionalTokenData.isPrototype(this.primary);
  }

  /** @returns {Actor|null} The actor behind a prototype target, if any. */
  get actor() {
    return this.isPrototype ? this.primary?.actor ?? null : null;
  }

  /** @inheritdoc */
  get title() {
    const name = this.actor?.name ?? this.primary?.name;
    const base = game.i18n.localize(`${I18N}.APP.title`);
    if (!name) return base;
    const suffix = this.isPrototype ? ` (${game.i18n.localize(`${I18N}.APP.prototype`)})` : "";
    return `${base} — ${name}${suffix}`;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritdoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const data = DirectionalTokenData.read(this.primary);

    return Object.assign(context, buildFieldContext(data), {
      tokenName: this.actor?.name ?? this.primary?.name ?? "",
      count: this.#documents.length,
      multiple: this.#documents.length > 1,
      isPrototype: this.isPrototype,
      // Only offer propagation when there is somewhere to propagate to.
      canPropagate: this.isPrototype && !!this.actor,
      placedCount: this.isPrototype ? this.#countPlacedTokens() : 0,
      buttons: [
        {
          type: "submit",
          icon: "fa-solid fa-check",
          label: this.isPrototype ? `${I18N}.BUTTONS.applyPrototype` : `${I18N}.BUTTONS.apply`,
          cssClass: "dti-primary",
          disabled: !this.#documents.length
        },
        { type: "button", action: "dtiCancel", icon: "fa-solid fa-xmark", label: `${I18N}.BUTTONS.cancel` }
      ]
    });
  }

  /**
   * How many tokens across every scene already come from this actor.
   * @returns {number} The token count.
   */
  #countPlacedTokens() {
    const actorId = this.actor?.id;
    if (!actorId) return 0;
    let count = 0;
    for (const scene of game.scenes ?? []) {
      count += scene.tokens.filter(token => token.actorId === actorId).length;
    }
    return count;
  }

  /** @inheritdoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const data = this.primary ? DirectionalTokenData.read(this.primary) : undefined;
    this.#controller = new DirectionalFormController(this.element, { baseline: data }).activate();
  }

  /* -------------------------------------------- */
  /*  Event handlers                              */
  /* -------------------------------------------- */

  /**
   * Persist the form to every targeted document.
   * @this {DirectionalConfigApp}
   * @param {SubmitEvent} event      The submit event.
   * @param {HTMLFormElement} form   The form element.
   * @param {FormDataExtended} formData The parsed form data.
   * @returns {Promise<void>} Resolves once every document is updated.
   */
  static async #onSubmitForm(event, form, formData) {
    const payload = foundry.utils.expandObject(formData.object)?.flags?.[MODULE_ID];
    if (!payload) return;

    const data = {
      enabled: payload.enabled === true,
      mode: String(payload.mode ?? "inherit"),
      mirrorHorizontal: payload.mirrorHorizontal === true,
      loadMethod: payload.loadMethod === "url" ? "url" : "picker",
      images: payload.images ?? {},
      base: payload.base ?? {},
      art: payload.art ?? {},
      visionFacing: payload.visionFacing
    };

    for (const document of this.documents) {
      try {
        await DirectionalTokenData.write(document, data);
        ImageCache.invalidate(document);
        void ImageCache.preload(document);
      } catch (error) {
        const name = document.actor?.name ?? document.name;
        Logger.error(`Failed to apply directional images to "${name}".`, error);
        ui.notifications.error(game.i18n.format(`${I18N}.NOTIFICATIONS.applyFailed`, { name }));
      }
    }

    // Saving artwork with the master switch off is the one way to configure everything correctly
    // and still see nothing happen, so say so rather than reporting a silent success.
    const hasImages = Object.values(data.images).some(src => !!String(src ?? "").trim());
    if (hasImages && !data.enabled) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.NOTIFICATIONS.notEnabled`));
      return;
    }

    if (this.isPrototype) {
      await this.#reportPrototypeSave(formData.object.dtiPropagate === true);
      return;
    }

    ui.notifications.info(
      game.i18n.format(`${I18N}.NOTIFICATIONS.applied`, { count: this.documents.length })
    );
  }

  /**
   * Optionally push the freshly saved prototype onto existing tokens, then report the outcome.
   * @param {boolean} propagate Whether the user asked for existing tokens to be updated.
   * @returns {Promise<void>} Resolves once the report has been shown.
   */
  async #reportPrototypeSave(propagate) {
    if (!propagate) {
      ui.notifications.info(game.i18n.localize(`${I18N}.NOTIFICATIONS.prototypeSaved`));
      return;
    }

    const report = await PrototypeSync.fromActor(this.actor, { scope: "all" });
    if (report.failed.length) {
      ui.notifications.warn(
        game.i18n.format(`${I18N}.NOTIFICATIONS.syncedPartial`, {
          tokens: report.tokens,
          scenes: report.failed.join(", ")
        })
      );
      return;
    }
    ui.notifications.info(
      game.i18n.format(`${I18N}.NOTIFICATIONS.synced`, { tokens: report.tokens, scenes: report.scenes })
    );
  }

  /**
   * Close without saving.
   * @this {DirectionalConfigApp}
   * @returns {void}
   */
  static #onCancel() {
    this.close();
  }

  /* -------------------------------------------- */
  /*  Convenience                                 */
  /* -------------------------------------------- */

  /**
   * Open the configurator for a set of tokens, reusing the existing window when possible.
   * @param {(Token|TokenDocument|PrototypeToken)[]} [documents] The tokens to configure.
   * @returns {DirectionalConfigApp|null} The rendered application, or `null` when nothing was
   *   selected.
   */
  static open(documents) {
    const targets = documents ?? canvas?.tokens?.controlled ?? [];
    if (!targets.length) {
      ui.notifications.warn(game.i18n.localize(`${I18N}.NOTIFICATIONS.noSelection`));
      return null;
    }
    const existing = foundry.applications.instances.get(`${MODULE_ID}-config`);
    existing?.close({ force: true });
    const app = new DirectionalConfigApp({ documents: targets });
    app.render(true);
    return app;
  }
}

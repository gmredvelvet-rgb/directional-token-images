/**
 * @file The interaction layer shared by every surface that edits directional data.
 *
 * Binding this controller to a root element gives that element the whole feature set — mode
 * filtering, thumbnails, the File Picker / URL toggle, slider-and-number pairs, the live preview
 * compass and the Preview / Reset / Clear All actions — regardless of whether the markup lives in
 * the standalone configurator or inside the Token Configuration sheet.
 *
 * All interactive elements are marked with `data-dti-action` rather than `data-action` so that they
 * can never collide with the host application's own action dispatcher.
 *
 * @module directional-token-images/apps/form-controller
 */

import { DEFAULT_SLOT, MODES, MODE_INHERIT, coerceMode, getFallbackChain } from "../lib/directions.js";
import { DEFAULT_DATA } from "../lib/token-images.js";
import { FIELD_PREFIX, SLOT_META, isVideo } from "./field-builder.js";
import { Logger } from "../lib/logger.js";
import { Settings } from "../settings/settings.js";
import { VISION_FACING } from "../constants.js";

/**
 * @typedef {import("../lib/directions.js").DirectionKey} DirectionKey
 * @typedef {import("../lib/token-images.js").DirectionalData} DirectionalData
 */

/**
 * Wires up the directional form markup inside a root element.
 */
export class DirectionalFormController {
  /** @type {HTMLElement} */
  #root;

  /** @type {DirectionalData} The values the form was rendered with, used by "Reset". */
  #baseline;

  /** @type {DirectionKey} The slot the preview stage is showing. */
  #previewSlot = DEFAULT_SLOT;

  /** @type {(() => void)|null} Invoked after any value changes, for host-side live previews. */
  #onChange;

  /**
   * @param {HTMLElement} root                 The element containing the directional markup.
   * @param {object} [options]
   * @param {DirectionalData} [options.baseline] The stored values, used by the Reset action.
   * @param {() => void} [options.onChange]      Called after any field changes.
   */
  constructor(root, { baseline, onChange } = {}) {
    this.#root = root;
    this.#baseline = foundry.utils.deepClone(baseline ?? DEFAULT_DATA);
    this.#onChange = onChange ?? null;
  }

  /** @returns {HTMLElement} The bound root element. */
  get root() {
    return this.#root;
  }

  /* -------------------------------------------- */
  /*  Wiring                                      */
  /* -------------------------------------------- */

  /**
   * Attach every listener and bring the DOM into sync with its current values.
   * @returns {this} This controller, for chaining.
   */
  activate() {
    this.#root.addEventListener("click", this.#onClick.bind(this));
    this.#root.addEventListener("change", this.#onFieldChange.bind(this));
    this.#root.addEventListener("input", this.#onFieldInput.bind(this));

    this.#previewSlot = this.#root.querySelector(".dti-compass")?.dataset.activeSlot ?? DEFAULT_SLOT;
    this.syncModeVisibility();
    this.refreshPreview();
    return this;
  }

  /**
   * Handle every `data-dti-action` click inside the root.
   * @param {PointerEvent} event The click event.
   * @returns {void}
   */
  #onClick(event) {
    const target = event.target.closest("[data-dti-action]");
    if (!target || !this.#root.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();

    switch (target.dataset.dtiAction) {
      case "setLoadMethod":
        this.setLoadMethod(target.dataset.method);
        break;
      case "clearField":
        this.clearField(target.dataset.field);
        break;
      case "resetTransform":
        this.resetTransform();
        break;
      case "previewDirection":
        this.setPreviewSlot(target.dataset.slot);
        break;
      case "reset":
        this.resetToBaseline();
        break;
      case "clearAll":
        this.clearAllImages();
        break;
      case "preview":
        this.cyclePreview();
        break;
      default:
        Logger.trace("Unhandled directional form action:", target.dataset.dtiAction);
    }
  }

  /**
   * Handle `change` events from any bound field.
   * @param {Event} event The change event.
   * @returns {void}
   */
  #onFieldChange(event) {
    const field = event.target;
    if (!field?.name?.startsWith(FIELD_PREFIX)) return;

    if (field.classList.contains("dti-mode-select")) this.syncModeVisibility();
    this.#syncNumberToRange(field);
    this.#refreshThumbFor(field.name);
    this.refreshPreview();
    this.#onChange?.();
  }

  /**
   * Handle live `input` events, principally the range sliders driving their numeric partner.
   * @param {Event} event The input event.
   * @returns {void}
   */
  #onFieldInput(event) {
    const field = event.target;
    if (field.classList?.contains("dti-range")) {
      const partner = this.#field(field.dataset.for);
      if (partner) {
        partner.value = field.value;
        partner.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (field?.name?.startsWith(FIELD_PREFIX)) this.#syncNumberToRange(field);
  }

  /* -------------------------------------------- */
  /*  Field access                                */
  /* -------------------------------------------- */

  /**
   * Find a bound field by its form name.
   * @param {string} name The field name.
   * @returns {HTMLElement|null} The element, if present.
   */
  #field(name) {
    if (!name) return null;
    return this.#root.querySelector(`[name="${CSS.escape(name)}"]`);
  }

  /**
   * Mirror a numeric field's value onto its range slider.
   * @param {HTMLElement} field The numeric field.
   * @returns {void}
   */
  #syncNumberToRange(field) {
    const range = this.#root.querySelector(`.dti-range[data-for="${CSS.escape(field.name ?? "")}"]`);
    if (range && range.value !== String(field.value)) range.value = field.value;
  }

  /**
   * Read the entire form back as a normalised data object.
   * @returns {DirectionalData} The current form values.
   */
  readData() {
    const read = (suffix, fallback) => {
      const element = this.#field(`${FIELD_PREFIX}${suffix}`);
      if (!element) return fallback;
      if (element.type === "checkbox") return element.checked;
      const value = element.value;
      if (typeof fallback === "number") {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
      }
      return value ?? fallback;
    };

    const images = {};
    for (const slot of Object.keys(SLOT_META)) images[slot] = String(read(`images.${slot}`, "") ?? "").trim();

    return {
      enabled: read("enabled", false) === true,
      mode: String(read("mode", MODE_INHERIT)),
      mirrorHorizontal: read("mirrorHorizontal", false) === true,
      loadMethod: read("loadMethod", "picker") === "url" ? "url" : "picker",
      images,
      base: {
        src: String(read("base.src", "") ?? "").trim(),
        scale: read("base.scale", 1),
        rotation: read("base.rotation", 0)
      },
      art: {
        offsetX: read("art.offsetX", 0),
        offsetY: read("art.offsetY", 0),
        offsetZ: read("art.offsetZ", 0),
        scale: read("art.scale", 1)
      },
      visionFacing: String(read("visionFacing", VISION_FACING.INHERIT))
    };
  }

  /**
   * The effective image-set mode currently selected in the form.
   * @returns {number} A valid mode id.
   */
  get mode() {
    const raw = this.#field(`${FIELD_PREFIX}mode`)?.value ?? MODE_INHERIT;
    if (raw === MODE_INHERIT) return coerceMode(Settings.current.defaultMode);
    return coerceMode(raw, coerceMode(Settings.current.defaultMode));
  }

  /* -------------------------------------------- */
  /*  Behaviour                                   */
  /* -------------------------------------------- */

  /**
   * Show only the rows and compass buttons that belong to the selected mode.
   *
   * Hidden rows stay in the DOM (and therefore in the submitted form data) so that switching modes
   * never destroys artwork the user configured under another mode.
   *
   * @returns {void}
   */
  syncModeVisibility() {
    const mode = this.mode;
    for (const element of this.#root.querySelectorAll("[data-modes]")) {
      element.hidden = !element.dataset.modes.split(" ").includes(String(mode));
    }
    for (const section of this.#root.querySelectorAll("[data-mode]")) section.dataset.mode = String(mode);

    // Keep the preview pointed at a slot that still exists in this mode.
    const slots = MODES[mode].slots;
    if (!slots.includes(this.#previewSlot)) this.setPreviewSlot(slots[0] ?? DEFAULT_SLOT);
  }

  /**
   * Switch between the File Picker and plain URL input styles.
   * @param {"picker"|"url"} method The requested method.
   * @returns {void}
   */
  setLoadMethod(method) {
    const normalised = method === "url" ? "url" : "picker";
    for (const section of this.#root.querySelectorAll(".dti-images")) {
      section.dataset.loadMethod = normalised;
    }
    const input = this.#root.querySelector(".dti-load-method-input");
    if (input) input.value = normalised;
    for (const segment of this.#root.querySelectorAll("[data-dti-action='setLoadMethod']")) {
      segment.classList.toggle("active", segment.dataset.method === normalised);
    }
    this.#onChange?.();
  }

  /**
   * Empty a single field and refresh everything that depends on it.
   * @param {string} name The field name to clear.
   * @returns {void}
   */
  clearField(name) {
    const field = this.#field(name);
    if (!field) return;
    field.value = "";
    this.#refreshThumbFor(name);
    this.refreshPreview();
    this.#onChange?.();
  }

  /**
   * Empty every image field, including the base image.
   * @returns {void}
   */
  clearAllImages() {
    for (const slot of Object.keys(SLOT_META)) {
      const field = this.#field(`${FIELD_PREFIX}images.${slot}`);
      if (field) field.value = "";
    }
    const base = this.#field(`${FIELD_PREFIX}base.src`);
    if (base) base.value = "";
    this.#refreshAllThumbs();
    this.refreshPreview();
    this.#onChange?.();
  }

  /**
   * Restore the position, scale and rotation controls to their neutral defaults.
   * @returns {void}
   */
  resetTransform() {
    const defaults = {
      "art.offsetX": 0,
      "art.offsetY": 0,
      "art.offsetZ": 0,
      "art.scale": 1,
      "base.scale": 1,
      "base.rotation": 0
    };
    for (const [suffix, value] of Object.entries(defaults)) {
      const field = this.#field(`${FIELD_PREFIX}${suffix}`);
      if (!field) continue;
      field.value = value;
      this.#syncNumberToRange(field);
    }
    this.refreshPreview();
    this.#onChange?.();
  }

  /**
   * Restore every field to the values the form was rendered with, discarding unsaved edits.
   * @returns {void}
   */
  resetToBaseline() {
    const data = this.#baseline;
    const set = (suffix, value) => {
      const field = this.#field(`${FIELD_PREFIX}${suffix}`);
      if (!field) return;
      if (field.type === "checkbox") field.checked = value === true;
      else field.value = value;
      this.#syncNumberToRange(field);
    };

    set("enabled", data.enabled);
    set("mode", data.mode);
    set("mirrorHorizontal", data.mirrorHorizontal);
    for (const slot of Object.keys(SLOT_META)) set(`images.${slot}`, data.images[slot] ?? "");
    set("base.src", data.base.src);
    set("base.scale", data.base.scale);
    set("base.rotation", data.base.rotation);
    set("art.offsetX", data.art.offsetX);
    set("art.offsetY", data.art.offsetY);
    set("art.offsetZ", data.art.offsetZ);
    set("art.scale", data.art.scale);
    set("visionFacing", data.visionFacing ?? VISION_FACING.INHERIT);
    this.setLoadMethod(data.loadMethod);

    this.syncModeVisibility();
    this.#refreshAllThumbs();
    this.refreshPreview();
    this.#onChange?.();
  }

  /**
   * Record a new baseline, for example after a successful save.
   * @param {DirectionalData} data The values to treat as stored.
   * @returns {void}
   */
  setBaseline(data) {
    this.#baseline = foundry.utils.deepClone(data);
  }

  /**
   * Point the preview stage at a specific direction.
   * @param {DirectionKey} slot The slot to show.
   * @returns {void}
   */
  setPreviewSlot(slot) {
    this.#previewSlot = slot ?? DEFAULT_SLOT;
    const compass = this.#root.querySelector(".dti-compass");
    if (compass) compass.dataset.activeSlot = this.#previewSlot;
    for (const button of this.#root.querySelectorAll(".dti-compass-button")) {
      button.classList.toggle("active", button.dataset.slot === this.#previewSlot);
    }
    this.refreshPreview();
  }

  /**
   * Step the preview through the directions available in the current mode. This is what the
   * "Preview" button does: a quick visual sanity check of the whole set.
   * @returns {void}
   */
  cyclePreview() {
    const slots = MODES[this.mode].slots;
    const index = slots.indexOf(this.#previewSlot);
    this.setPreviewSlot(slots[(index + 1) % slots.length]);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @returns {boolean} Whether horizontal mirroring is currently ticked. */
  get mirrorEnabled() {
    return this.#field(`${FIELD_PREFIX}mirrorHorizontal`)?.checked === true;
  }

  /**
   * Resolve the artwork a slot would actually display, honouring the fallback chain and the
   * horizontal mirror option. Mirrors the runtime logic in `DirectionalTokenData.resolveArtwork`
   * but reads live form values rather than saved flags.
   * @param {DirectionKey} slot The slot to resolve.
   * @returns {{src: string, mirrored: boolean}} The artwork; `src` is empty when nothing is set.
   */
  resolveImage(slot) {
    const mirror = this.mirrorEnabled;
    for (const step of getFallbackChain(slot, undefined, { mirror })) {
      const value = this.#field(`${FIELD_PREFIX}images.${step.slot}`)?.value?.trim();
      if (value) return { src: value, mirrored: mirror && step.mirrored };
    }
    return { src: "", mirrored: false };
  }

  /**
   * Update the small thumbnail attached to whichever row owns a field.
   * @param {string} name The field name that changed.
   * @returns {void}
   */
  #refreshThumbFor(name) {
    if (!name?.startsWith(FIELD_PREFIX)) return;
    const suffix = name.slice(FIELD_PREFIX.length);

    let key = null;
    if (suffix === "base.src") key = "base";
    else if (suffix.startsWith("images.")) key = suffix.slice("images.".length);
    if (!key) return;

    this.#renderThumb(key, this.#field(name)?.value?.trim() ?? "");
  }

  /**
   * Rebuild every thumbnail from the current field values.
   * @returns {void}
   */
  #refreshAllThumbs() {
    for (const slot of Object.keys(SLOT_META)) {
      this.#renderThumb(slot, this.#field(`${FIELD_PREFIX}images.${slot}`)?.value?.trim() ?? "");
    }
    this.#renderThumb("base", this.#field(`${FIELD_PREFIX}base.src`)?.value?.trim() ?? "");
  }

  /**
   * Render a single thumbnail, using a looping muted video element for animated sources.
   * @param {string} key The thumbnail key (`"base"` or a slot).
   * @param {string} src The image path, or an empty string.
   * @returns {void}
   */
  #renderThumb(key, src) {
    const holder = this.#root.querySelector(`[data-thumb-for="${CSS.escape(key)}"]`);
    if (!holder) return;
    if (!src) {
      holder.innerHTML = '<i class="fa-regular fa-image" inert></i>';
      return;
    }
    if (isVideo(src)) {
      holder.innerHTML = `<video src="${src}" autoplay loop muted playsinline disablepictureinpicture></video>`;
    } else {
      const image = document.createElement("img");
      image.src = src;
      image.alt = "";
      holder.replaceChildren(image);
    }
  }

  /**
   * Refresh everything that reacts to a value change: the preview stage, the mirror markers and the
   * "configured but not enabled" warning.
   * @returns {void}
   */
  refreshPreview() {
    const stage = this.#root.querySelector(".dti-compass-stage");
    if (!stage) return;

    const artwork = this.resolveImage(this.#previewSlot);
    this.#renderStage(stage, artwork);
    this.#renderMarkers();
    this.#renderStatus(artwork);
  }

  /**
   * Draw the preview stage: artwork, base, offsets, scale and the horizontal flip.
   * @param {HTMLElement} stage                          The stage element.
   * @param {{src: string, mirrored: boolean}} artwork   The artwork to display.
   * @returns {void}
   */
  #renderStage(stage, { src, mirrored }) {
    stage.toggleAttribute("data-mirrored", mirrored);

    const art = stage.querySelector(".dti-preview-art");
    if (art) {
      art.hidden = !src;
      if (src && art.getAttribute("src") !== src) art.setAttribute("src", src);
      const { offsetX, offsetY, scale } = this.readData().art;
      // The horizontal flip is folded into the same transform so it composes with the art scale.
      const scaleX = scale * (mirrored ? -1 : 1);
      art.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scale})`;
    }

    const base = stage.querySelector(".dti-preview-base");
    if (base) {
      const baseSrc = this.#field(`${FIELD_PREFIX}base.src`)?.value?.trim() ?? "";
      base.hidden = !baseSrc;
      if (baseSrc && base.getAttribute("src") !== baseSrc) base.setAttribute("src", baseSrc);
      const scale = Number(this.#field(`${FIELD_PREFIX}base.scale`)?.value ?? 1) || 1;
      const rotation = Number(this.#field(`${FIELD_PREFIX}base.rotation`)?.value ?? 0) || 0;
      base.style.transform = `scale(${scale}) rotate(${rotation}deg)`;
    }

    const empty = stage.querySelector(".dti-preview-empty");
    if (empty) empty.hidden = !!src;
  }

  /**
   * Flag the compass buttons and image rows that are empty or served by a mirrored counterpart.
   * @returns {void}
   */
  #renderMarkers() {
    for (const button of this.#root.querySelectorAll(".dti-compass-button")) {
      const resolved = this.resolveImage(button.dataset.slot);
      button.toggleAttribute("data-empty", !resolved.src);
      button.toggleAttribute("data-mirrored", resolved.mirrored);
    }
    for (const row of this.#root.querySelectorAll(".dti-row[data-slot]")) {
      if (row.dataset.slot === "base") continue;
      row.toggleAttribute("data-mirrored", this.resolveImage(row.dataset.slot).mirrored);
    }
  }

  /**
   * Update the caption, the base-controls dimming and the "not enabled" warning.
   * @param {{src: string, mirrored: boolean}} artwork The artwork currently previewed.
   * @returns {void}
   */
  #renderStatus({ mirrored }) {
    // Dim the base-only transform controls while no base image is configured.
    this.#root.dataset.hasBase = String(!!this.#field(`${FIELD_PREFIX}base.src`)?.value?.trim());

    // Surface the single most common mistake: images filled in, master switch left off.
    const warning = this.#root.querySelector("[data-disabled-warning]");
    if (warning) {
      const hasImages = Object.keys(SLOT_META).some(
        slot => !!this.#field(`${FIELD_PREFIX}images.${slot}`)?.value?.trim()
      );
      warning.hidden = !hasImages || this.#field(`${FIELD_PREFIX}enabled`)?.checked === true;
    }

    const label = this.#root.querySelector("[data-preview-label]");
    if (!label) return;
    const direction = game.i18n.localize(`DTI.DIRECTIONS.${this.#previewSlot}.label`);
    label.textContent = mirrored
      ? game.i18n.format("DTI.PREVIEW.showingMirrored", { direction })
      : game.i18n.format("DTI.PREVIEW.showing", { direction });
  }
}

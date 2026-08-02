/**
 * @file Module entry point.
 *
 * Wiring order matters and is deliberate:
 *  1. `init` — direction providers register first, so the settings dropdown can reference them;
 *     settings register next, so every other service can read its configuration; then the runtime
 *     hooks and the public API.
 *  2. `setup` — the Token Configuration sheet classes are patched. This has to wait until systems
 *     have registered their own token sheet subclasses, which they do during their `init`.
 *  3. `ready` — the settings cache is re-read and the module announces itself.
 *
 * @module directional-token-images
 */

import { HOOK_EVENTS, I18N, MODULE_ID, MODULE_TITLE, PARTIALS, TEMPLATES } from "./constants.js";
import LicenseUI, { isWorldLicensed, licenseMenuClass } from "./license/license-ui.js";
import { ActorSheetButton } from "./apps/actor-sheet-button.js";
import { DirectionProviderRegistry } from "./lib/direction-provider.js";
import { DirectionalTokenImagesAPI } from "./api/api.js";
import LicenseClient from "./license/license.js";
import { Logger } from "./lib/logger.js";
import { Settings, registerSettings } from "./settings/settings.js";
import { TokenConfigTab } from "./apps/token-config-tab.js";
import { registerHooks } from "./hooks/index.js";

/**
 * Register the Handlebars partials shared by the configurator and the Token Configuration tab.
 * @returns {Promise<Function[]>} Resolves once every partial is compiled and registered.
 */
function registerPartials() {
  return foundry.applications.handlebars.loadTemplates({
    [PARTIALS.IMAGE_FIELDS]: TEMPLATES.IMAGE_FIELDS,
    [PARTIALS.TRANSFORM_FIELDS]: TEMPLATES.TRANSFORM_FIELDS,
    [PARTIALS.PREVIEW]: TEMPLATES.PREVIEW
  });
}

/**
 * Register the licence flag and its settings-menu entry.
 *
 * `worldLicensed` is written by the GM's client once Patreon verifies the subscription, and read by
 * every other client so players never contact the licence server.
 * @returns {void}
 */
function registerLicenseSettings() {
  game.settings.register(MODULE_ID, "worldLicensed", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.registerMenu(MODULE_ID, "licenseMenu", {
    name: `${I18N}.Settings.License.Name`,
    label: `${I18N}.Settings.License.Label`,
    hint: `${I18N}.Settings.License.Hint`,
    icon: "fa-brands fa-patreon",
    type: licenseMenuClass(),
    restricted: true
  });
}

Hooks.once("init", () => {
  Logger.info(`Initialising ${MODULE_TITLE}.`);

  DirectionProviderRegistry.registerDefaults();
  registerSettings();
  registerLicenseSettings();
  registerHooks();

  // Partial compilation is asynchronous but nothing can render before `ready`, so this is safe to
  // fire and forget; failures are surfaced rather than swallowed.
  registerPartials().catch(error => Logger.error("Failed to register Handlebars partials.", error));

  game.modules.get(MODULE_ID).api = DirectionalTokenImagesAPI;
});

Hooks.once("setup", () => {
  // Deferred to `setup` so that systems have finished registering their own token sheet subclasses.
  TokenConfigTab.register();
  ActorSheetButton.register();
});

Hooks.once("ready", async () => {
  Settings.refresh();
  Logger.info(`Ready. API available at game.modules.get("${MODULE_ID}").api`);
  Hooks.callAll(HOOK_EVENTS.READY, DirectionalTokenImagesAPI);
  await startLicenceCheck();
});

/**
 * Run the soft licence check.
 *
 * Deliberately a soft gate: every feature works either way, and an unlicensed world only receives a
 * periodic free-trial reminder. Only the GM's client contacts the licence server — it verifies the
 * Patreon subscription and writes the world flag that every other client reads.
 *
 * @returns {Promise<void>} Resolves once the check has settled.
 */
async function startLicenceCheck() {
  // Foundry loads modules on the join, setup and stream pages too, where there is no world to
  // licence and nobody to prompt.
  if (game.view !== "game") return;
  try {
    if (game.user?.isGM) {
      const client = LicenseClient.instance;
      // True when verified right now, or still inside the 30-day window a past verification bought,
      // so an authorised GM is never asked twice.
      const licensed = await client.initialize();
      if (licensed) await game.settings.set(MODULE_ID, "worldLicensed", true);
      // Never open with the card when the world is already licensed: that is a second browser or a
      // server outage, not somebody who has to be asked.
      else if (!client.hasStoredCredentials && !isWorldLicensed()) LicenseUI.show();
    }
    LicenseUI.startReminder();
  } catch (error) {
    // The licence layer must never take the module down with it.
    Logger.error("Licence check failed.", error);
  }
}

// The GM activating mid-session silences the reminder on every connected client without anyone
// reloading; the flag arrives as a world-setting update.
Hooks.on("updateSetting", setting => {
  if (setting.key !== `${MODULE_ID}.worldLicensed`) return;
  if (isWorldLicensed()) LicenseUI.stopReminder();
  else LicenseUI.startReminder();
});

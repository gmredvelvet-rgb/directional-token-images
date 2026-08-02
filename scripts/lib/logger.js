/**
 * @file Tiny leveled logger with a module prefix and a cached debug flag.
 * @module directional-token-images/lib/logger
 */

import { MODULE_TITLE } from "../constants.js";

/**
 * Centralised console logger.
 *
 * The debug flag is cached rather than read from `game.settings` on every call so that hot paths
 * (movement / refresh hooks) never pay for a settings lookup.
 */
export class Logger {
  /**
   * Whether verbose debug logging is currently enabled.
   * @type {boolean}
   */
  static #debug = false;

  /** @returns {boolean} Whether debug logging is enabled. */
  static get debug() {
    return Logger.#debug;
  }

  /** @param {boolean} value Enable or disable debug logging. */
  static set debug(value) {
    Logger.#debug = value === true;
  }

  /** @type {string} The console prefix applied to every message. */
  static get #prefix() {
    return `${MODULE_TITLE} |`;
  }

  /**
   * Log an informational message.
   * @param {...*} args Console arguments.
   * @returns {void}
   */
  static info(...args) {
    console.log(Logger.#prefix, ...args);
  }

  /**
   * Log a warning.
   * @param {...*} args Console arguments.
   * @returns {void}
   */
  static warn(...args) {
    console.warn(Logger.#prefix, ...args);
  }

  /**
   * Log an error.
   * @param {...*} args Console arguments.
   * @returns {void}
   */
  static error(...args) {
    console.error(Logger.#prefix, ...args);
  }

  /**
   * Log a message only when debug mode is enabled.
   * @param {...*} args Console arguments.
   * @returns {void}
   */
  static trace(...args) {
    if (!Logger.#debug) return;
    console.debug(Logger.#prefix, ...args);
  }

  /**
   * Run a callback only when debug mode is enabled. Useful when building the log payload is itself
   * expensive and should not run in production.
   * @param {() => void} fn The callback to run.
   * @returns {void}
   */
  static when(fn) {
    if (Logger.#debug) fn();
  }
}

/**
 * mhc-utils.js — MultiHog Companion
 *
 * Shared pure HTML and text utility helpers used across parser, UI, and integrity modules.
 */

/**
 * Escapes HTML special characters for safe DOM / attribute insertion.
 * Safely coerces numbers/booleans to string and returns '' for null/undefined.
 *
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

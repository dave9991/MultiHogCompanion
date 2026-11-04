/**
 * concierge-system-registry.js — MultiHog Companion
 *
 * Central registry for Game System Adapters. Allows game systems (PbtA, FAE,
 * future engines) to register dynamically and be resolved by ruleset identifier.
 */

import { ConciergeSystemAdapter } from './concierge-system-base.js';

class ConciergeSystemRegistry {
    /** @type {Map<string, ConciergeSystemAdapter>} */
    #systems = new Map();

    /** @type {string} */
    #defaultSystemId = 'pbta';

    /**
     * Registers a game system adapter.
     * @param {ConciergeSystemAdapter} adapter
     */
    register(adapter) {
        if (!adapter || !(adapter instanceof ConciergeSystemAdapter)) {
            throw new TypeError('System adapter must be an instance of ConciergeSystemAdapter');
        }
        if (!adapter.id || typeof adapter.id !== 'string') {
            throw new Error('System adapter must have a non-empty string id');
        }
        this.#systems.set(adapter.id.toLowerCase().trim(), adapter);
    }

    /**
     * Retrieves a system adapter by id.
     * Falls back to default system if the id is unrecognized.
     * @param {string} [rulesetId]
     * @returns {ConciergeSystemAdapter}
     */
    get(rulesetId) {
        if (rulesetId && typeof rulesetId === 'string') {
            const clean = rulesetId.toLowerCase().trim();
            const found = this.#systems.get(clean);
            if (found) return found;
        }
        return this.#systems.get(this.#defaultSystemId) || this.#systems.values().next().value;
    }

    /**
     * Checks if a ruleset ID is explicitly registered.
     * @param {string} rulesetId
     * @returns {boolean}
     */
    has(rulesetId) {
        if (!rulesetId || typeof rulesetId !== 'string') return false;
        return this.#systems.has(rulesetId.toLowerCase().trim());
    }

    /**
     * Returns an array of all registered system adapters.
     * @returns {ConciergeSystemAdapter[]}
     */
    list() {
        return Array.from(this.#systems.values());
    }

    /**
     * Inspects a campaign dossier object and detects its active ruleset ID.
     * @param {object} [dossier]
     * @returns {string} Detected ruleset ID (e.g. 'fae' or 'pbta')
     */
    detectRuleset(dossier) {
        if (!dossier || typeof dossier !== 'object') return this.#defaultSystemId;

        // 1. Explicit meta.ruleset takes top priority
        const explicit = dossier.meta?.ruleset;
        if (explicit && this.has(explicit)) {
            return explicit.toLowerCase().trim();
        }

        // 2. FAE structural markers
        const p = dossier.protagonist || {};
        if (
            (Array.isArray(p.positiveTags) && p.positiveTags.length > 0) ||
            (Array.isArray(p.positive_tags) && p.positive_tags.length > 0) ||
            p.heroicDomain ||
            p.heroic_domain ||
            (dossier.pools && Object.keys(dossier.pools).length > 0) ||
            (p.pools && Object.keys(p.pools).length > 0) ||
            (dossier.config?.faeGenre)
        ) {
            return 'fae';
        }

        // 3. Check systemKey if meta.ruleset was unset
        const sysKey = (dossier.meta?.systemKey || '').toLowerCase();
        if (sysKey) {
            for (const adapter of this.#systems.values()) {
                if (adapter.id === this.#defaultSystemId) continue;
                const genres = adapter.getGenres();
                if (genres && genres[sysKey]) {
                    return adapter.id;
                }
            }
            const defaultAdapter = this.get(this.#defaultSystemId);
            if (defaultAdapter?.getGenres()?.[sysKey]) {
                return defaultAdapter.id;
            }
        }

        // 4. PbtA structural markers
        if (
            (p.stats && Object.keys(p.stats).length > 0) ||
            (Array.isArray(p.startingMoves) && p.startingMoves.length > 0) ||
            (Array.isArray(p.moves) && p.moves.length > 0) ||
            dossier.config?.harmMax
        ) {
            return 'pbta';
        }

        return this.#defaultSystemId;
    }

    /**
     * Sets the default fallback ruleset id.
     * @param {string} id
     */
    setDefaultSystemId(id) {
        if (typeof id === 'string' && id.trim()) {
            this.#defaultSystemId = id.toLowerCase().trim();
        }
    }

    /**
     * Returns the current default ruleset id.
     * @returns {string}
     */
    getDefaultSystemId() {
        return this.#defaultSystemId;
    }
}

/** Global singleton registry instance. */
export const systemRegistry = new ConciergeSystemRegistry();

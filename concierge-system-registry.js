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
     * Detects ruleset ID from raw State Memo text markers.
     * @param {string} memoText
     * @param {string|null} [fallback=null]
     * @returns {string|null}
     */
    detectRulesetFromMemo(memoText, fallback = null) {
        if (!memoText || typeof memoText !== 'string') return fallback;
        if (/FAE Knobs:|Positive Tags:|\(\(PILLS\)\)\s*Scars & Debuffs:|Leverage Barriers/i.test(memoText)) {
            return 'fae';
        }
        if (/Harm\s*:\s*\d+\/\d+|\(Harm:\s*\d+\/\d+\)|\bMoves\s*:|\[PBTA_|Hack & Slash/i.test(memoText)) {
            return 'pbta';
        }
        if (/\b(?:Attr|Saves|Proficiencies)\s*:|\bHD\s*:\s*\d*d\d+|\bTotal\s*:\s*\d+\s*\/\s*\d+\s*XP\s*\(Level|\bLevel\s*:\s*\d+\s*\|\s*XP\s*:/i.test(memoText)) {
            return 'dnd5e';
        }
        return fallback;
    }

    /**
     * Inspects a campaign dossier object (or memo text) and detects its active ruleset ID.
     * @param {object|string|null|undefined} [dossier]
     * @param {object} [options={}]
     * @param {string} [options.memo='']
     * @param {string|null} [options.fallback=null]
     * @returns {string} Detected ruleset ID (e.g. 'fae', 'pbta', or 'dnd5e')
     */
    detectRuleset(dossier, options = {}) {
        const { memo = '', fallback = null } = options || {};
        if (typeof dossier === 'string') {
            return this.detectRulesetFromMemo(dossier, fallback || this.#defaultSystemId);
        }
        if (!dossier || typeof dossier !== 'object') {
            const fromMemo = memo ? this.detectRulesetFromMemo(memo, null) : null;
            return fromMemo || fallback || this.#defaultSystemId;
        }

        // 1. Explicit meta.ruleset takes top priority
        const explicit = dossier.meta?.ruleset;
        if (explicit && this.has(explicit)) {
            return explicit.toLowerCase().trim();
        }

        const p = dossier.protagonist || {};
        const sysKey = (dossier.meta?.systemKey || '').toLowerCase();

        // 2. FAE structural markers
        if (
            (Array.isArray(p.positiveTags) && p.positiveTags.length > 0) ||
            (Array.isArray(p.positive_tags) && p.positive_tags.length > 0) ||
            p.heroicDomain ||
            p.heroic_domain ||
            (dossier.pools && Object.keys(dossier.pools).length > 0) ||
            (p.pools && Object.keys(p.pools).length > 0) ||
            (dossier.config?.faeGenre) ||
            sysKey === 'fae'
        ) {
            return 'fae';
        }

        // 3. D&D 5e (D&D Lite) structural markers
        if (
            dossier.progressionBlueprint ||
            p.hitDie ||
            sysKey === 'dnd5e' ||
            (p.stats && (p.stats.STR !== undefined || p.stats.DEX !== undefined || p.stats.CON !== undefined) && !Array.isArray(p.startingMoves) && !dossier.config?.harmMax && !p.isPbta && !p.playbook && !p.harm)
        ) {
            return 'dnd5e';
        }

        // 4. Explicit PbtA structural markers
        if (
            p.isPbta ||
            p.playbook ||
            p.harm ||
            (Array.isArray(p.startingMoves) && p.startingMoves.length > 0) ||
            (Array.isArray(p.moves) && p.moves.length > 0) ||
            dossier.config?.harmMax ||
            sysKey === 'pbta'
        ) {
            return 'pbta';
        }

        // 5. System label pattern check
        const sysLabel = String(dossier.meta?.systemLabel || '');
        if (sysLabel) {
            if (/\b(?:FAE|Freeform Attrition)\b/i.test(sysLabel)) return 'fae';
            if (/\b(?:PbtA|Dungeon World|Fellowship|Apocalypse|Monster of the Week|Sprawl|Masks|Blades in the Dark|Wanderhome)\b/i.test(sysLabel)) return 'pbta';
            if (/\b(?:D&D|Dungeons\s*&\s*Dragons|5e)\b/i.test(sysLabel)) return 'dnd5e';
        }

        // 6. Check systemKey if meta.ruleset was unset
        if (sysKey) {
            for (const adapter of this.#systems.values()) {
                if (adapter.id === this.#defaultSystemId || adapter.id === 'dnd5e') continue;
                const genres = adapter.getGenres();
                if (genres && genres[sysKey]) {
                    return adapter.id;
                }
            }
            const defaultAdapter = this.get(this.#defaultSystemId);
            if (defaultAdapter?.getGenres()?.[sysKey]) {
                return defaultAdapter.id;
            }
            const dndAdapter = this.has('dnd5e') ? this.get('dnd5e') : null;
            if (dndAdapter?.getGenres()?.[sysKey]) {
                return 'dnd5e';
            }
        }

        // 7. Remaining PbtA stat check
        if (p.stats && Object.keys(p.stats).length > 0) {
            return 'pbta';
        }

        // 8. Memo fallback
        if (memo) {
            const fromMemo = this.detectRulesetFromMemo(memo, null);
            if (fromMemo) return fromMemo;
        }

        return fallback || this.#defaultSystemId;
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

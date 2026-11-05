/**
 * concierge-system-base.js — MultiHog Companion
 *
 * Abstract base class defining the contract for modular Game System Adapters.
 * Every supported tabletop RPG engine (PbtA, FAE, future systems) implements
 * this interface to provide ruleset-specific schemas, prompts, formatting,
 * cartridge installation, and live state memo management.
 */

export class ConciergeSystemAdapter {
    /**
     * Unique ruleset identifier (e.g. 'pbta', 'fae').
     * @type {string}
     */
    id = 'base';

    /**
     * Human-readable name for the system.
     * @type {string}
     */
    label = 'Base System';

    /**
     * Primary dice engine description (e.g. '2d6 Moves & Harm', '4dF Pools & Leverage').
     * @type {string}
     */
    diceEngine = 'Dice';

    /**
     * UI icon badge (e.g. '🎲', '⚡').
     * @type {string}
     */
    badgeIcon = '🎲';

    /**
     * Brief summary of the system philosophy.
     * @type {string}
     */
    description = '';

    // ── Genre & Skeletons ──────────────────────────────────────────────────

    /**
     * Returns dictionary of available genres for this system.
     * @returns {Record<string, object>}
     */
    getGenres() {
        return {};
    }

    /**
     * Returns default genre key for new dossiers.
     * @returns {string}
     */
    getDefaultGenre() {
        return '';
    }

    /**
     * Resolves a genre object by key, falling back to default genre if not found.
     * @param {string} genreKey
     * @returns {object}
     */
    getGenre(genreKey) {
        const genres = this.getGenres();
        return genres[genreKey] || genres[this.getDefaultGenre()] || {};
    }

    // ── Schema & Normalization ─────────────────────────────────────────────

    /**
     * Creates clean default protagonist object for this system.
     * @param {string} [genreKey]
     * @returns {object}
     */
    createEmptyProtagonist(genreKey) {
        return {
            name: '',
            gender: '',
            playbook: '',
            species: '',
            appearance: '',
            equipment: '',
            personality: '',
            background: '',
            habits: '',
        };
    }

    /**
     * Creates clean default config dials for this system.
     * @param {string} [genreKey]
     * @returns {object}
     */
    createEmptyConfig(genreKey) {
        return {
            playstyle: 'cyoa_5',
            relationships: true,
            partyMode: 'solo',
            simulationDepth: 'active_fronts',
        };
    }

    /**
     * Heals and normalizes protagonist properties (stats, pools, tags, gear).
     * @param {object} protagonist
     * @param {string} genreKey
     * @param {object} dossier Full dossier context
     */
    normalizeProtagonist(protagonist, genreKey, dossier) {
        // Implemented by subclasses
    }

    /**
     * Heals and normalizes adversary/monster properties.
     * @param {Array<object>} monsters
     * @param {string} genreKey
     * @param {object} dossier Full dossier context
     */
    normalizeMonsters(monsters, genreKey, dossier) {
        // Implemented by subclasses
    }

    /**
     * Returns default gear items when none are provided.
     * @returns {string[]}
     */
    getDefaultGear() {
        return ['Essential kit', 'Signature tool or weapon'];
    }

    // ── AI Prompts & Rubrics ───────────────────────────────────────────────

    /**
     * Assistant name used in LLM conversation bubbles.
     * @returns {string}
     */
    getAssistantName() {
        return `${this.id.toUpperCase()}_Concierge`;
    }

    /**
     * User prompt instruction emitted during critique pass.
     * @returns {string}
     */
    getCritiqueUserInstruction() {
        return `Audit the current Campaign Blueprint against the 5-point ${this.label} design rubric and emit your [DOSSIER_CRITIQUE] block.`;
    }

    /**
     * Returns true if the calibration dial is supported by this system.
     * @param {string} dialName
     * @returns {boolean}
     */
    hasDial(dialName) {
        return ['playstyle', 'partyMode', 'simulationDepth', 'relationships', 'cyoaEmojis'].includes(dialName);
    }

    /**
     * Builds the interactive facilitator / talker system prompt.
     * @param {object} options
     * @returns {string}
     */
    getSystemPrompt(options = {}) {
        return '';
    }

    /**
     * Builds the state machine / blueprint builder prompt.
     * @param {object} options
     * @returns {string}
     */
    getBuilderPrompt(options = {}) {
        return '';
    }

    /**
     * Builds the story editor / critique judge prompt.
     * @param {object} options
     * @returns {string}
     */
    getJudgePrompt(options = {}) {
        return '';
    }

    /**
     * Builds the conversational talker system prompt.
     * @param {object} options
     * @returns {string}
     */
    getTalkerPrompt(options = {}) {
        return '';
    }

    /**
     * Returns guidance on creating starting crisis / incident for this system.
     * @returns {string}
     */
    getIncitingCrisisGuidance() {
        return '';
    }

    // ── MultiHog [CORE] Card Formatting ────────────────────────────────────

    /**
     * Builds a structured Player Character bio string matching MultiHog's DEFAULT_PC_SECTIONS.
     * @param {object} protagonist
     * @param {Record<string, string>} [sectionNames]
     * @param {object} [options]
     * @returns {string}
     */
    formatPcBio(protagonist, sectionNames, options = {}) {
        return '';
    }

    /**
     * Builds lorebook / library [CORE] content for an adversary / monster.
     * @param {object} monster
     * @param {Record<string, string>} [sectionNames]
     * @param {object} [options]
     * @returns {{ core: string, full: string }}
     */
    formatAdversaryContent(monster, sectionNames, options = {}) {
        return { core: '', full: '' };
    }

    // ── Campaign Launch & Live Sync ────────────────────────────────────────

    /**
     * Compiles and installs the ruleset cartridge for an adventure.
     * @param {string} systemKey
     * @param {object} overrides
     * @param {object} [options]
     * @returns {Promise<boolean>}
     */
    async installCartridge(systemKey, overrides, options = {}) {
        return false;
    }

    /**
     * Formats an initial game state memo for Day 0 of an adventure.
     * @param {object} dossier
     * @param {object} [options]
     * @returns {string}
     */
    formatInitialMemo(dossier, options = {}) {
        return '';
    }

    /**
     * Non-destructively merges updated dossier data into an in-flight live memo.
     * @param {string} liveMemo
     * @param {object} dossier
     * @param {string} [charName]
     * @returns {string}
     */
    mergeLiveMemo(liveMemo, dossier, charName = null) {
        return liveMemo;
    }

    /**
     * Synchronizes live character vitality bars with MultiHog settings.
     * @param {object} rpgSettings
     * @param {string} chatId
     * @returns {boolean} Whether settings were updated
     */
    syncVitality(rpgSettings, chatId) {
        return false;
    }

    // ── UI Deck Presentation ───────────────────────────────────────────────

    /**
     * Renders character stat pills and vitals in the Blueprint Deck UI.
     * @param {object} elements jQuery element map { vitalsEl, statsEl, movesEl, heroicEl }
     * @param {object} protagonist
     * @param {object} dossier
     * @param {object} [helpers]
     */
    renderDeckStats(elements, protagonist, dossier, helpers = {}) {
        // Base fallback: clear or show generic info
    }

    /**
     * Returns localStorage key for session zero drafts.
     * @returns {string}
     */
    getDraftStorageKey() {
        return `mhc_concierge_draft_${this.id}`;
    }
}

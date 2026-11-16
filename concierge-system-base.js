/// <reference path="./types.d.ts" />
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

    // ── UI Deck Presentation & Context Serialization ───────────────────────

    /**
     * Returns true if the protagonist object contains meaningful authored state.
     * @param {object} protagonist
     * @returns {boolean}
     */
    isProtagonistConfigured(protagonist) {
        if (!protagonist || typeof protagonist !== 'object') return false;
        return Boolean(protagonist.name || protagonist.playbook || protagonist.class);
    }

    /**
     * Formats the protagonist block lines for LLM [CURRENT_CAMPAIGN_DOSSIER] context.
     * @param {object} protagonist
     * @param {object} dossier
     * @returns {string[]}
     */
    formatProtagonistForContext(protagonist, dossier) {
        const p = protagonist || {};
        const lines = [
            '[PROTAGONIST]',
            `name: ${p.name || 'Unnamed Adventurer'}`,
        ];
        if (p.gender) lines.push(`gender: ${p.gender}`);
        if (p.playbook || p.class || p.archetype) {
            lines.push(`playbook: ${p.playbook || p.class || p.archetype}`);
        }
        if (p.species) lines.push(`species: ${p.species}`);
        if (p.appearance) lines.push(`appearance: ${p.appearance}`);
        if (p.equipment) lines.push(`equipment: ${p.equipment}`);
        if (p.personality) lines.push(`personality: ${p.personality}`);
        if (p.background) lines.push(`background: ${p.background}`);
        if (p.habits) lines.push(`habits: ${p.habits}`);
        if (p.stats && Object.keys(p.stats).length) {
            lines.push(`stats: ${Object.entries(p.stats).map(([k, v]) => `${k} ${v}`).join(', ')}`);
        }
        if (p.status) lines.push(`status: ${p.status}`);
        if (Array.isArray(p.gear) && p.gear.length) lines.push(`gear: ${p.gear.join(', ')}`);
        if (p.bio) lines.push(`bio: ${p.bio}`);
        lines.push(`portrait: ${p.portraitSrc ? 'set' : 'none'}`);
        lines.push('[/PROTAGONIST]');
        return lines;
    }

    /**
     * Formats a single adversary/monster block for LLM [CURRENT_CAMPAIGN_DOSSIER] context.
     * @param {object} monster
     * @param {object} dossier
     * @returns {string[]}
     */
    formatMonsterForContext(monster, dossier) {
        const m = monster || {};
        const lines = [
            '[MONSTER]',
            `name: ${m.name || 'Threat'}`,
        ];
        if (m.status) lines.push(`status: ${m.status}`);
        if (m.attacks && m.attacks.length) lines.push(`attacks: ${[].concat(m.attacks).join(', ')}`);
        if (m.weakness) lines.push(`weakness: ${m.weakness}`);
        if (m.notes) lines.push(`notes: ${m.notes}`);
        lines.push('[/MONSTER]');
        return lines;
    }

    /**
     * Renders an adversary/monster card HTML string for the Blueprint Deck UI.
     * @param {object} monster
     * @param {object} [helpers={}]
     * @returns {string}
     */
    renderDeckMonsterHtml(monster, helpers = {}) {
        const escapeHtml = helpers.escapeHtml || ((s) => String(s ?? ''));
        const formatName = helpers.formatBlueprintNameWithBadge || ((name) => ({ cleanName: name || 'Unnamed', badgeHtml: '' }));
        const m = monster || {};
        const { cleanName, badgeHtml } = formatName(m.name, {
            badgeBg: 'rgba(239, 68, 68, 0.15)',
            badgeBorder: 'rgba(239, 68, 68, 0.4)',
            badgeColor: '#fca5a5',
        });
        const attacks = Array.isArray(m.attacks) && m.attacks.length ? m.attacks.join(', ') : (m.attacks || 'Natural attacks');
        return `
            <div class="mhc-deck-item collapsible">
                <div class="mhc-deck-item-header">
                    <div class="mhc-deck-item-title" style="color: var(--mhc-danger, #ef4444);">
                        👹 ${escapeHtml(cleanName)} ${badgeHtml}
                    </div>
                    <span class="mhc-deck-item-toggle">▼</span>
                </div>
                <div class="mhc-deck-item-detail">
                    <div style="font-size: 0.85em; opacity: 0.85;"><b>Attacks:</b> ${escapeHtml(attacks)}</div>
                    ${m.notes ? `<div style="font-size: 0.8em; opacity: 0.75;"><b>Notes:</b> ${escapeHtml(m.notes)}</div>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Updates ruleset-specific calibration dial buttons in the Blueprint Deck UI.
     * @param {Function} $ jQuery / DOM selector helper
     * @param {object} dossier
     */
    renderDeckDials($, dossier) {
        if (typeof $ !== 'function') return;
        const cfg = dossier?.config || {};
        const partyMode = cfg.partyMode || 'squad';
        const partyLabel = partyMode.charAt(0).toUpperCase() + partyMode.slice(1);
        const relsOn = cfg.relationships !== false;
        $('#mhc_dial_heroic_btn').hide();
        $('#mhc_dial_tempo_btn').hide();
        $('#mhc_dial_party_btn').text(`👥 Party: ${partyLabel}`).show();
        $('#mhc_dial_relationships_btn').text(`🤝 Relations: ${relsOn ? 'On' : 'Off'}`).css('opacity', relsOn ? '1' : '0.65').show();
    }

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

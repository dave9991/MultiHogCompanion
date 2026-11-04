/**
 * concierge-system-pbta.js — MultiHog Companion
 *
 * Powered by the Apocalypse (PbtA) Game System Adapter.
 * Encapsulates 2d6 moves, standard stat arrays (+2, +1, +1, 0, -1),
 * harm tracks, impending doom countdowns, and PbtA cartridge compilation.
 */

import { ConciergeSystemAdapter } from './concierge-system-base.js';
import { PBTA_GENRES, formatInitialPbtaMemo } from './pbta-ruleset.js';
import { mergeDossierIntoLiveMemo, normalizePbtaMemo, syncLivePbtaMemoVitality } from './pbta-vitality-sync.js';
import { buildMonsterEntryContent } from './concierge-npc-format.js';
import { buildPlayerCardBio } from './concierge-pc-format.js';
import {
    buildConciergeSystemPrompt,
    buildConciergeBuilderPrompt,
    buildConciergeCriticPrompt,
    buildConciergeTalkerPrompt,
} from './concierge-prompt.js';
import { systemRegistry } from './concierge-system-registry.js';

export class PbtaSystemAdapter extends ConciergeSystemAdapter {
    id = 'pbta';
    label = 'Powered by the Apocalypse';
    diceEngine = '2d6 Moves & Harm';
    badgeIcon = '🎲';
    description = 'Fiction-first narrative engine driven by 2d6 action rolls, situational moves, and impending doom fronts.';

    getGenres() {
        return PBTA_GENRES;
    }

    getDefaultGenre() {
        return 'fantasy';
    }

    createEmptyProtagonist(genreKey = 'fantasy') {
        const genre = this.getGenre(genreKey);
        const stats = {};
        if (Array.isArray(genre.stats)) {
            const stdMods = [+2, +1, +1, 0, -1];
            genre.stats.forEach((s, idx) => {
                stats[s] = stdMods[idx] ?? 0;
            });
        }
        return {
            name: '',
            playbook: '',
            species: '',
            appearance: '',
            equipment: '',
            personality: '',
            background: '',
            habits: '',
            heroicDomain: '',
            stats,
            startingMoves: [],
            harm: { max: 5, current: 0, armor: 0 },
            conditions: [],
            status: '',
            gear: [],
            bio: '',
            portraitSrc: null,
        };
    }

    createEmptyConfig(genreKey = 'fantasy') {
        return {
            playstyle: 'cyoa_5',
            cyoaEmojis: true,
            harmMax: 5,
            partyMode: 'squad',
            artStyle: '',
            pacingXp: 5,
            simulationDepth: 'active_fronts',
            relationships: true,
            maxHarmFate: {
                rule: 'Mortal Peril (Last Breath / Dying)',
                statusToken: '(-) Incapacitated',
                cyoaStyle: 'crisis',
            },
            actionTempo: 'gritty_default',
            heroicTier: false,
        };
    }

    normalizeProtagonist(protagonist, genreKey, dossier) {
        const genre = this.getGenre(genreKey);

        if (!protagonist.stats || typeof protagonist.stats !== 'object' || Object.keys(protagonist.stats).length === 0) {
            const stdMods = [+2, +1, +1, 0, -1];
            const healedStats = {};
            if (Array.isArray(genre.stats)) {
                genre.stats.forEach((s, idx) => {
                    healedStats[s] = stdMods[idx] ?? 0;
                });
            }
            protagonist.stats = healedStats;
        } else {
            for (const [k, v] of Object.entries(protagonist.stats)) {
                protagonist.stats[k] = parseInt(v, 10) || 0;
            }
        }

        if (!Array.isArray(protagonist.startingMoves) || protagonist.startingMoves.length === 0) {
            protagonist.startingMoves = Array.isArray(genre.moves) ? genre.moves.slice(0, 2) : [];
        }

        protagonist.harm = protagonist.harm || {};
        protagonist.harm.max = parseInt(protagonist.harm.max ?? dossier?.config?.harmMax, 10) || 5;
        protagonist.harm.current = parseInt(protagonist.harm.current, 10) || 0;
    }

    normalizeMonsters(monsters, genreKey, dossier) {
        if (!Array.isArray(monsters)) return;
        monsters.forEach(m => {
            m.name = (m.name || 'Threat').trim();
            m.harm = parseInt(m.harm, 10) || 3;
            m.currentHarm = parseInt(m.currentHarm, 10) || 0;
            m.armor = parseInt(m.armor, 10) || 0;
            m.attacks = Array.isArray(m.attacks) && m.attacks.length > 0
                ? m.attacks
                : (m.attacks && typeof m.attacks === 'string' ? m.attacks.split(',').map(s => s.trim()) : ['Claw/Strike (2 Harm)']);
            m.impendingDoom = Array.isArray(m.impendingDoom) ? m.impendingDoom : [];
        });
    }

    getDefaultGear() {
        return ['Essential adventurer kit', 'Signature weapon (close, 2 Harm)'];
    }

    getSystemPrompt(options = {}) {
        return buildConciergeSystemPrompt({ ...options, ruleset: 'pbta' });
    }

    getBuilderPrompt(options = {}) {
        return buildConciergeBuilderPrompt({ ...options, ruleset: 'pbta' });
    }

    getJudgePrompt(options = {}) {
        return buildConciergeCriticPrompt('pbta');
    }

    getTalkerPrompt(options = {}) {
        return buildConciergeTalkerPrompt('pbta');
    }

    formatPcBio(protagonist, sectionNames, options = {}) {
        return buildPlayerCardBio(protagonist, sectionNames, { ...options, ruleset: 'pbta' });
    }

    formatAdversaryContent(monster, sectionNames, options = {}) {
        return buildMonsterEntryContent(monster, sectionNames, { ...options, ruleset: 'pbta' });
    }

    async installCartridge(systemKey, overrides, options = {}) {
        if (typeof options.applyPbtACartridge === 'function') {
            return await options.applyPbtACartridge(systemKey, overrides);
        }
        const { applyPbtACartridge } = await import('./index.js');
        return await applyPbtACartridge(systemKey, overrides);
    }

    formatInitialMemo(dossier, options = {}) {
        return formatInitialPbtaMemo(dossier, options);
    }

    mergeLiveMemo(liveMemo, dossier, charName = null) {
        const merged = mergeDossierIntoLiveMemo(liveMemo, dossier, charName);
        return normalizePbtaMemo(merged);
    }

    syncVitality(rpgSettings, chatId) {
        return syncLivePbtaMemoVitality(rpgSettings, chatId);
    }

    getAssistantName() {
        return 'PbtA_Concierge';
    }

    getCritiqueUserInstruction() {
        return 'Audit the current Campaign Blueprint against the 5-point PbtA design rubric and emit your [DOSSIER_CRITIQUE] block.';
    }

    hasDial(dialName) {
        return ['playstyle', 'harmMax', 'downed', 'partyMode', 'relationships', 'cyoaEmojis', 'simulationDepth'].includes(dialName);
    }

    renderDeckStats(elements, protagonist, dossier, { isUntouchedAndUnestablished = false, escapeHtml = (s) => s } = {}) {
        const { vitalsEl, statsEl, movesEl, heroicEl } = elements || {};
        if (heroicEl && typeof heroicEl.hide === 'function') heroicEl.hide();

        if (isUntouchedAndUnestablished) {
            if (vitalsEl && typeof vitalsEl.empty === 'function') vitalsEl.empty().hide();
            if (statsEl && typeof statsEl.html === 'function') statsEl.html('<span class="mhc-empty-hint">5 Genre Stats (+2, +1, +1, 0, -1) will be tailored to your setting.</span>');
            if (movesEl && typeof movesEl.text === 'function') movesEl.text('• Bespoke playbook moves will be established in Session Zero.');
            return;
        }

        const curHarm = parseInt(protagonist?.harm?.current, 10) || 0;
        const maxHarm = parseInt(protagonist?.harm?.max ?? dossier?.config?.harmMax, 10) || 5;
        const curHp = Math.max(0, maxHarm - curHarm);
        if (curHarm > 0 || (protagonist?.conditions && protagonist.conditions.length) || protagonist?.status) {
            const condList = Array.isArray(protagonist.conditions) ? protagonist.conditions : (protagonist.conditions ? [protagonist.conditions] : []);
            const condText = condList.length ? ` · ${condList.join(', ')}` : '';
            const statusLabel = protagonist.status || (curHarm > 0 ? 'Wounded' : 'Healthy');
            if (vitalsEl && typeof vitalsEl.html === 'function') {
                vitalsEl.html(`
                    <span class="mhc-pill" style="border-color: rgba(239, 68, 68, 0.5); color: #f87171; background: rgba(239, 68, 68, 0.1);" title="Vitals & Injuries">
                        🩸 ${curHp}/${maxHarm} HP (Harm: ${curHarm}/${maxHarm}) · ${escapeHtml(statusLabel)}${escapeHtml(condText)}
                    </span>
                `).show();
            }
        } else if (vitalsEl && typeof vitalsEl.empty === 'function') {
            vitalsEl.empty().hide();
        }

        if (statsEl && typeof statsEl.empty === 'function') {
            statsEl.empty();
            const statsObj = protagonist?.stats && Object.keys(protagonist.stats).length
                ? protagonist.stats
                : { Might: 0, Agility: 0, Wits: 0, Heart: 0, Arcana: 0 };
            for (const [sName, sVal] of Object.entries(statsObj)) {
                const sign = sVal >= 0 ? '+' : '';
                statsEl.append(`<span class="mhc-stat-pill">${escapeHtml(sName)} ${sign}${sVal}</span>`);
            }
        }

        const moves = protagonist?.startingMoves || [];
        if (movesEl) {
            if (moves.length) {
                movesEl.html(moves.map(m => `<div>• <b>${escapeHtml(m.split(' — ')[0])}:</b> ${escapeHtml(m.split(' — ')[1] || '')}</div>`).join(''));
            } else {
                movesEl.text('• No custom moves registered yet.');
            }
        }
    }
}

export const pbtaSystemAdapter = new PbtaSystemAdapter();
systemRegistry.register(pbtaSystemAdapter);

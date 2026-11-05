/**
 * concierge-system-fae.js — MultiHog Companion
 *
 * Freeform Attrition Engine (FAE) Game System Adapter.
 * Encapsulates single-pass 4dF attrition rolls, resource pools (Health, Sanity,
 * Supplies, Grit), positive/negative tags, heroic domains, and FAE cartridge compilation.
 */

import { ConciergeSystemAdapter } from './concierge-system-base.js';
import { FAE_GENRES, buildFaeCartridge, sanitizeFaePositiveTags } from './fae-ruleset.js';
import { sanitizeHeroicDomain } from './concierge-parser.js';
import { formatInitialFaeMemo, mergeDossierIntoLiveFaeMemo } from './fae-state-sync.js';
import { buildMonsterEntryContent } from './concierge-npc-format.js';
import { buildPlayerCardBio } from './concierge-pc-format.js';
import {
    buildFaeConciergeSystemPrompt,
    buildFaeConciergeBuilderPrompt,
    buildFaeConciergeCriticPrompt,
    buildFaeConciergeTalkerPrompt,
} from './concierge-prompt.js';
import { systemRegistry } from './concierge-system-registry.js';

export class FaeSystemAdapter extends ConciergeSystemAdapter {
    id = 'fae';
    label = 'Freeform Attrition Engine';
    diceEngine = '4dF Pools & Leverage';
    badgeIcon = '⚡';
    description = 'Single-pass 4dF narrative engine with resource pools, positive/negative tags, and proportional leverage.';

    getGenres() {
        return FAE_GENRES;
    }

    getDefaultGenre() {
        return 'cosmic_horror';
    }

    createEmptyProtagonist(genreKey = 'cosmic_horror') {
        const genre = this.getGenre(genreKey);
        const clonedPools = {};
        for (const [k, p] of Object.entries(genre.pools || {})) {
            clonedPools[k] = {
                key: p.key || k,
                label: p.label,
                barColor: p.barColor || 'green',
                current: p.current,
                max: p.max,
                recovery: p.recovery,
                passive_drain: p.passive_drain ? { ...p.passive_drain } : null,
                strain_flavor: p.strain_flavor,
                zero_debuff: p.zero_debuff,
                on_overflow: p.on_overflow,
            };
        }

        const isHeroicDefault = Boolean(genre.knobs?.heroic_tier ?? (genreKey === 'osr_dungeon'));
        const defaultHeroicDomain = isHeroicDefault ? (genre.defaultHeroicDomain || '') : '';

        return {
            name: '',
            playbook: '',
            species: '',
            appearance: '',
            equipment: '',
            personality: '',
            background: '',
            habits: '',
            heroicDomain: defaultHeroicDomain,
            stats: {},
            startingMoves: [],
            positiveTags: [],
            negativeTags: [],
            pools: clonedPools,
            harm: { max: 5, current: 0, armor: 0 },
            conditions: [],
            status: '',
            gear: [],
            bio: '',
            portraitSrc: null,
        };
    }

    createEmptyConfig(genreKey = 'cosmic_horror') {
        const genre = this.getGenre(genreKey);
        const isHeroicDefault = Boolean(genre.knobs?.heroic_tier ?? (genreKey === 'osr_dungeon'));
        return {
            playstyle: 'cyoa_5',
            cyoaEmojis: true,
            harmMax: 5,
            partyMode: 'solo',
            artStyle: '',
            pacingXp: 5,
            simulationDepth: 'active_fronts',
            relationships: false,
            maxHarmFate: {
                rule: 'Mortal Peril (Last Breath / Dying)',
                statusToken: '(-) Incapacitated',
                cyoaStyle: 'crisis',
            },
            actionTempo: genre.knobs?.action_tempo || 'gritty_default',
            heroicTier: isHeroicDefault,
            knobs: { ...genre.knobs, heroic_tier: isHeroicDefault, action_tempo: genre.knobs?.action_tempo || 'gritty_default' },
            pacingScenes: 4,
        };
    }

    postProcessEmptyDossier(dossier) {
        const genre = this.getGenre(dossier.meta?.systemKey);
        const isHeroicDefault = Boolean(genre.knobs?.heroic_tier ?? (dossier.meta?.systemKey === 'osr_dungeon'));
        const defaultHeroicDomain = isHeroicDefault ? (genre.defaultHeroicDomain || '') : '';
        dossier.pools = dossier.protagonist.pools;
        dossier.knobs = dossier.config.knobs;
        dossier.character = {
            name: '',
            archetype: genre.archetypes?.[0] || '',
            heroic_domain: isHeroicDefault ? (defaultHeroicDomain || null) : null,
            positive_tags: dossier.protagonist.positiveTags,
            negative_tags: dossier.protagonist.negativeTags,
            scenes_completed: 0,
            scenes_target: 4,
        };
    }

    normalizeProtagonist(protagonist, genreKey, dossier) {
        const genre = this.getGenre(genreKey);
        const isHeroic = Boolean(
            dossier?.config?.heroicTier ??
            dossier?.config?.heroic_tier ??
            dossier?.heroicTier ??
            dossier?.heroic_tier ??
            dossier?.config?.knobs?.heroic_tier ??
            (genre.knobs?.heroic_tier ?? false)
        );

        let heroicDomain = protagonist.heroicDomain ?? protagonist.heroic_domain ?? dossier?.character?.heroic_domain;
        if (heroicDomain === undefined || heroicDomain === null) {
            heroicDomain = isHeroic ? (genre.defaultHeroicDomain || null) : null;
        } else if (!isHeroic) {
            heroicDomain = null;
        }
        protagonist.heroicDomain = heroicDomain ? sanitizeHeroicDomain(heroicDomain) : null;

        protagonist.positiveTags = Array.isArray(protagonist.positiveTags)
            ? sanitizeFaePositiveTags(protagonist.positiveTags)
            : (Array.isArray(protagonist.tags) ? sanitizeFaePositiveTags(protagonist.tags) : [...(genre.defaultPositiveTags || [])]);

        protagonist.negativeTags = Array.isArray(protagonist.negativeTags)
            ? protagonist.negativeTags
            : (Array.isArray(protagonist.scars) ? protagonist.scars : []);

        protagonist.pools = protagonist.pools || {};
        if (Object.keys(protagonist.pools).length === 0) {
            for (const [k, p] of Object.entries(genre.pools || {})) {
                if (!protagonist.pools[k]) {
                    protagonist.pools[k] = { ...p, key: p.key || k, passive_drain: p.passive_drain ? { ...p.passive_drain } : null };
                }
            }
        }

        // FAE uses Positive Tags and Pools, not 2d6 startingMoves or duplicate conditions
        protagonist.startingMoves = [];
        delete protagonist.moves;
        protagonist.conditions = [];

        if (dossier) {
            dossier.config = dossier.config || {};
            dossier.config.knobs = { ...genre.knobs, ...(dossier.config.knobs || {}) };
            dossier.config.pacingScenes = dossier.config.pacingScenes || 4;
            dossier.config.heroicTier = isHeroic;
            dossier.config.heroic_tier = isHeroic;
            dossier.config.knobs.heroic_tier = isHeroic;
            dossier.pools = protagonist.pools;
            dossier.knobs = dossier.config.knobs;
            dossier.character = {
                name: protagonist.name || 'Protagonist',
                archetype: protagonist.playbook || protagonist.archetype || genre.archetypes?.[0] || 'Wanderer',
                heroic_domain: isHeroic ? (heroicDomain || null) : null,
                positive_tags: protagonist.positiveTags,
                negative_tags: protagonist.negativeTags,
                scenes_completed: dossier.character?.scenes_completed || 0,
                scenes_target: dossier.config.pacingScenes || 4,
            };
        }
    }

    normalizeMonsters(monsters, genreKey, dossier) {
        if (!Array.isArray(monsters)) return;
        monsters.forEach(m => {
            m.name = (m.name || 'Threat').trim();
            const rawLayers = parseInt(m.layers ?? m.harm?.max ?? m.harm, 10) || 2;
            const rawCur = parseInt(m.currentLayers ?? m.currentHarm ?? m.harm?.current, 10) || 0;
            m.layers = rawLayers;
            m.currentLayers = rawCur;
            m.threatLevel = Math.max(1, Math.min(4, parseInt(m.threatLevel ?? m.threat, 10) || 2));
            m.pressures = Array.isArray(m.pressures) ? m.pressures : (m.pressures && typeof m.pressures === 'string' ? m.pressures.split(',').map(s => s.trim()) : []);
            m.poolsAtRisk = Array.isArray(m.poolsAtRisk) ? m.poolsAtRisk : (m.poolsAtRisk && typeof m.poolsAtRisk === 'string' ? m.poolsAtRisk.split(',').map(s => s.trim()) : null);
            m.instinct = (m.instinct || '').trim();
            m.leverageBarriers = Array.isArray(m.leverageBarriers) ? m.leverageBarriers : (m.leverageBarriers && typeof m.leverageBarriers === 'string' ? m.leverageBarriers.split(';').map(s => s.trim()) : []);
        });
    }

    getDefaultGear() {
        return ['Essential explorer kit', 'Signature tool or weapon'];
    }

    getSystemPrompt(options = {}) {
        return buildFaeConciergeSystemPrompt(options);
    }

    getBuilderPrompt(options = {}) {
        return buildFaeConciergeBuilderPrompt(options);
    }

    getJudgePrompt(options = {}) {
        return buildFaeConciergeCriticPrompt();
    }

    getTalkerPrompt(options = {}) {
        return buildFaeConciergeTalkerPrompt();
    }

    formatPcBio(protagonist, sectionNames, options = {}) {
        return buildPlayerCardBio(protagonist, sectionNames, { ...options, ruleset: 'fae' });
    }

    formatAdversaryContent(monster, sectionNames, options = {}) {
        return buildMonsterEntryContent(monster, sectionNames, { ...options, ruleset: 'fae' });
    }

    async installCartridge(systemKey, overrides, options = {}) {
        if (typeof options.applyFaeCartridge === 'function') {
            return await options.applyFaeCartridge(systemKey, overrides);
        }
        try {
            const { applyFaeCartridge } = await import('./index.js');
            if (typeof applyFaeCartridge === 'function') {
                return await applyFaeCartridge(systemKey, overrides);
            }
        } catch (_) {}
        const cartridge = buildFaeCartridge(systemKey, overrides);
        const effectiveCtx = options.ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
        const rpg = effectiveCtx?.extensionSettings?.rpg_tracker;
        if (rpg && cartridge?.payload) {
            if (cartridge.payload.customSyspromptLibrary) rpg.customSyspromptLibrary = [...cartridge.payload.customSyspromptLibrary];
            if (cartridge.payload.syspromptModules) rpg.syspromptModules = { ...(rpg.syspromptModules || {}), ...cartridge.payload.syspromptModules };
            if (cartridge.payload.stockPrompts) rpg.stockPrompts = { ...(rpg.stockPrompts || {}), ...cartridge.payload.stockPrompts };
            if (cartridge.payload.cyoaConfig) rpg.cyoaConfig = { ...(rpg.cyoaConfig || {}), ...cartridge.payload.cyoaConfig };
        }
        return true;
    }

    formatInitialMemo(dossier, options = {}) {
        return formatInitialFaeMemo(dossier, options);
    }

    mergeLiveMemo(liveMemo, dossier, charName = null) {
        return mergeDossierIntoLiveFaeMemo(liveMemo, dossier, charName);
    }

    syncVitality(rpgSettings, chatId) {
        // FAE syncs HP and secondary bar pools deterministically via fae-state-sync.js
        return false;
    }

    getAssistantName() {
        return 'FAE_Concierge';
    }

    getCritiqueUserInstruction() {
        return 'Audit the current Campaign Blueprint against the 5-point FAE design rubric and emit your [DOSSIER_CRITIQUE] block.';
    }

    hasDial(dialName) {
        return ['playstyle', 'heroicTier', 'actionTempo', 'harmShift', 'fleeGrace', 'simulationDepth', 'cyoaEmojis'].includes(dialName);
    }

    renderDeckStats(elements, protagonist, dossier, { isUntouchedAndUnestablished = false, escapeHtml = (s) => s } = {}) {
        const { vitalsEl, statsEl, movesEl, heroicEl } = elements || {};

        const heroicDomain = protagonist?.heroicDomain || protagonist?.heroic_domain || dossier?.character?.heroic_domain;
        const isHeroicTier = Boolean(dossier?.config?.heroicTier || dossier?.config?.heroic_tier || dossier?.config?.knobs?.heroic_tier);
        if (heroicEl) {
            if (isHeroicTier || heroicDomain) {
                if (typeof heroicEl.find === 'function') {
                    heroicEl.find('#mhc_deck_char_heroic_domain_text').text(heroicDomain || 'Heroic Permissions Active');
                }
                heroicEl.show();
            } else {
                heroicEl.hide();
            }
        }

        if (isUntouchedAndUnestablished) {
            if (vitalsEl && typeof vitalsEl.html === 'function') vitalsEl.html('<span class="mhc-empty-hint">2–3 Resource Pools (e.g. Health, Sanity, Supplies) will be tailored to your setting.</span>').show();
            if (statsEl && typeof statsEl.html === 'function') statsEl.html('<span class="mhc-empty-hint">3–4 Positive Tags & signature gear will be forged in the conversation.</span>');
            if (movesEl && typeof movesEl.text === 'function') movesEl.text('• No scars or lasting debuffs.');
            return;
        }

        const pools = protagonist?.pools || dossier?.pools || {};
        const poolEntries = Object.entries(pools);
        if (poolEntries.length) {
            const html = poolEntries.map(([k, p]) => {
                const col = p.barColor === 'red' ? '#f87171' : p.barColor === 'blue' ? '#60a5fa' : p.barColor === 'purple' ? '#c084fc' : p.barColor === 'amber' ? '#fbbf24' : p.barColor === 'cyan' ? '#22d3ee' : '#4ade80';
                return `<span class="mhc-pill" style="border-color: ${col}66; color: ${col}; background: ${col}18;" title="Zero Debuff: ${escapeHtml(p.zero_debuff || '')}">
                    ${escapeHtml(p.label)}: ${p.current}/${p.max}
                </span>`;
            }).join(' ');
            if (vitalsEl && typeof vitalsEl.html === 'function') vitalsEl.html(html).show();
        } else if (vitalsEl && typeof vitalsEl.empty === 'function') {
            vitalsEl.empty().hide();
        }

        if (statsEl && typeof statsEl.empty === 'function') {
            statsEl.empty();
            const posTags = Array.isArray(protagonist?.positiveTags) ? protagonist.positiveTags : (protagonist?.positive_tags || []);
            if (posTags.length) {
                for (const t of posTags) {
                    statsEl.append(`<span class="mhc-stat-pill" style="border-color: rgba(59, 130, 246, 0.5); color: #93c5fd;">🏷️ ${escapeHtml(t)}</span>`);
                }
            } else {
                statsEl.append('<span class="mhc-empty-hint">No positive tags defined yet.</span>');
            }
        }

        const negTags = Array.isArray(protagonist?.negativeTags) ? protagonist.negativeTags : (protagonist?.negative_tags || []);
        if (movesEl) {
            if (negTags.length) {
                movesEl.html(negTags.map(t => `<div style="color: #f87171;">• <b>⚠️ Scar:</b> ${escapeHtml(t)}</div>`).join(''));
            } else {
                movesEl.text('• No scars or lasting debuffs.');
            }
        }
    }
}

export const faeSystemAdapter = new FaeSystemAdapter();
systemRegistry.register(faeSystemAdapter);

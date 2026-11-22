/**
 * concierge-system-pbta.js — MultiHog Companion
 *
 * Powered by the Apocalypse (PbtA) Game System Adapter.
 * Encapsulates 2d6 moves, standard stat arrays (+2, +1, +1, 0, -1),
 * harm tracks, impending doom countdowns, and PbtA cartridge compilation.
 */

import { ConciergeSystemAdapter } from './concierge-system-base.js';
import { PBTA_GENRES, formatInitialPbtaMemo, resolveEffectivePbtaGenre } from './pbta-ruleset.js';
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
        const genre = resolveEffectivePbtaGenre(genreKey, { dossier });

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

    isProtagonistConfigured(protagonist) {
        if (!protagonist || typeof protagonist !== 'object') return false;
        return Boolean(protagonist.name || protagonist.playbook);
    }

    formatProtagonistForContext(protagonist, dossier) {
        const p = protagonist || {};
        const lines = [
            '[PROTAGONIST]',
            `name: ${p.name || 'Unnamed Adventurer'}`,
        ];
        if (p.gender) lines.push(`gender: ${p.gender}`);
        lines.push(`playbook: ${p.playbook || p.archetype || 'In Development'}`);
        if (p.species) lines.push(`species: ${p.species}`);
        if (p.appearance) lines.push(`appearance: ${p.appearance}`);
        if (p.equipment) lines.push(`equipment: ${p.equipment}`);
        if (p.personality) lines.push(`personality: ${p.personality}`);
        if (p.background) lines.push(`background: ${p.background}`);
        if (p.habits) lines.push(`habits: ${p.habits}`);
        if (p.stats && Object.keys(p.stats).length) {
            lines.push(`stats: ${Object.entries(p.stats).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`);
        }
        if (p.harm) {
            const curH = parseInt(p.harm.current, 10) || 0;
            const maxH = parseInt(p.harm.max, 10) || 5;
            lines.push(curH > 0 ? `harm: ${curH}/${maxH}` : `harm: ${maxH}`);
            lines.push(`armor: ${p.harm?.armor ?? 0}`);
        } else {
            lines.push('harm: 5');
            lines.push('armor: 0');
        }
        if (p.conditions && (Array.isArray(p.conditions) ? p.conditions.length : String(p.conditions).trim())) {
            lines.push(`conditions: ${Array.isArray(p.conditions) ? p.conditions.join(', ') : p.conditions}`);
        }
        if (p.status) lines.push(`status: ${p.status}`);
        if (p.startingMoves && p.startingMoves.length) {
            lines.push('moves:');
            p.startingMoves.forEach(mv => lines.push(`- ${mv}`));
        }
        if (p.gear && p.gear.length) lines.push(`gear: ${p.gear.join(', ')}`);
        if (p.bio) lines.push(`bio: ${p.bio}`);
        lines.push(`portrait: ${p.portraitSrc ? 'set' : 'none'}`);
        lines.push('[/PROTAGONIST]');
        return lines;
    }

    formatMonsterForContext(monster, dossier) {
        const m = monster || {};
        const curHarm = parseInt(m.currentHarm ?? m.harm?.current ?? m.currentLayers, 10) || 0;
        const maxHarm = parseInt(m.harm?.max ?? m.harm ?? m.layers, 10) || 4;
        const lines = [
            '[MONSTER]',
            `name: ${m.name}`,
            curHarm > 0 ? `harm: ${curHarm}/${maxHarm}` : `harm: ${maxHarm}`,
            `armor: ${m.armor || 0}`,
        ];
        if (m.status) lines.push(`status: ${m.status}`);
        if (m.attacks && m.attacks.length) lines.push(`attacks: ${[].concat(m.attacks).join(', ')}`);
        lines.push(`weakness: ${m.weakness || 'Unknown'}`);
        if (m.impendingDoom && m.impendingDoom.length) {
            lines.push('countdown:');
            m.impendingDoom.forEach(d => lines.push(`- ${d}`));
        }
        if (m.notes) lines.push(`notes: ${m.notes}`);
        lines.push('[/MONSTER]');
        return lines;
    }

    renderDeckMonsterHtml(monster, helpers = {}) {
        const escapeHtml = helpers.escapeHtml || ((s) => String(s ?? ''));
        const formatName = helpers.formatBlueprintNameWithBadge || ((name) => ({ cleanName: name || 'Unnamed', badgeHtml: '' }));
        const m = monster || {};
        const { cleanName: mClean, badgeHtml: mTagBadge } = formatName(m.name, {
            badgeBg: 'rgba(239, 68, 68, 0.15)',
            badgeBorder: 'rgba(239, 68, 68, 0.4)',
            badgeColor: '#fca5a5',
        });
        const attacks = m.attacks?.length ? m.attacks.join(', ') : 'Natural attacks';
        const moves = m.moves?.length ? m.moves.join('; ') : '';
        const movesLine = moves ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Moves:</b> ${moves}</div>` : '';
        const doomBadge = m.impendingDoom?.length
            ? `<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(245, 158, 11, 0.4); color: #f59e0b;" title="Active Countdown Front / Impending Doom">⏳ Clock: ${m.impendingDoom.length}</span>`
            : '';
        const doomLine = m.impendingDoom?.length
            ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;"><b>⏳ Impending Doom:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${m.impendingDoom.map(d => `<li>${d}</li>`).join('')}</ul></div>`
            : '';

        const mCur = parseInt(m.currentHarm ?? m.harm?.current, 10) || 0;
        const mMax = parseInt(m.harm?.max ?? m.harm, 10) || 4;
        const mHp = Math.max(0, mMax - mCur);
        const harmBadge = mCur > 0
            ? `<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(239, 68, 68, 0.6); color: #f87171;">🩸 ${mHp}/${mMax} HP (Harm: ${mCur}/${mMax}) · Wounded</span>`
            : `<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(239, 68, 68, 0.4);">Harm: ${mMax} | Armor: ${m.armor}</span>`;

        return `
            <div class="mhc-deck-item collapsible">
                <div class="mhc-deck-item-header">
                    <div class="mhc-deck-item-title" style="color: var(--mhc-danger, #ef4444);">
                        👹 ${escapeHtml(mClean)} ${mTagBadge}${harmBadge} ${doomBadge}
                    </div>
                    <button type="button" class="menu_button mhc-deck-remove-item-btn" data-remove-kind="monster" data-remove-target="${escapeHtml(mClean)}" style="padding: 1px 6px; font-size: 0.72em; color: #f87171; border-color: rgba(239,68,68,0.3); margin-left: auto; margin-right: 4px;" title="Remove Adversary">✕</button>
                    <span class="mhc-deck-item-toggle">▼</span>
                </div>
                <div class="mhc-deck-item-detail">
                    <div style="font-size: 0.85em; opacity: 0.85;"><b>Attacks:</b> ${attacks}</div>
                    <div style="font-size: 0.8em; opacity: 0.75;"><b>Weakness:</b> ${m.weakness || 'None specified'}</div>
                    ${movesLine}
                    ${doomLine}
                </div>
            </div>
        `;
    }

    renderDeckDials($, dossier) {
        if (typeof $ !== 'function') return;
        const cfg = dossier?.config || {};
        $('#mhc_dial_heroic_btn').hide();
        $('#mhc_dial_tempo_btn').hide();
        const harmMax = cfg.harmMax || 5;
        let harmTag = '(Standard)';
        if (harmMax === 3) harmTag = '(Gritty)';
        else if (harmMax === 4) harmTag = '(Tense)';
        else if (harmMax === 6) harmTag = '(Pulp)';
        $('#mhc_dial_harm_btn').text(`❤️ Harm: ${harmMax} ${harmTag}`);

        const maxHarmFate = cfg.maxHarmFate || { rule: 'Mortal Peril (Last Breath / Dying)', statusToken: '(-) Incapacitated' };
        const fateRule = maxHarmFate.rule || 'Mortal Peril';
        let fateShort = 'Mortal Peril';
        let fateIcon = '💀';
        if (/respawn|graveyard|ghost|mmo|shrine/i.test(fateRule)) {
            fateShort = 'Respawn';
            fateIcon = '🔄';
        } else if (/burnout|exhaust|faint|pass out|fatigue/i.test(fateRule)) {
            fateShort = 'Burnout / Faint';
            fateIcon = '💤';
        } else if (/unconscious|capture|knockout|arrest|subdue/i.test(fateRule)) {
            fateShort = 'Knockout / Arrest';
            fateIcon = '⛓️';
        } else if (!/mortal\s*peril|last\s*breath|dying/i.test(fateRule)) {
            fateShort = fateRule.length > 18 ? fateRule.slice(0, 16) + '...' : fateRule;
            fateIcon = '⚡';
        }
        $('#mhc_dial_downed_btn').text(`${fateIcon} Downed: ${fateShort}`);

        const partyMode = cfg.partyMode || 'squad';
        const partyLabel = partyMode.charAt(0).toUpperCase() + partyMode.slice(1);
        const relsOn = cfg.relationships !== false;
        $('#mhc_dial_party_btn').text(`👥 Party: ${partyLabel}`).show();
        $('#mhc_dial_relationships_btn').text(`🤝 Relations: ${relsOn ? 'On' : 'Off'}`).css('opacity', relsOn ? '1' : '0.65').show();
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

/**
 * progression-architect-ui.js — MultiHog Companion
 *
 * Polymorphic Progression Codex & Archetype Architect View.
 * Renders in-drawer progression roadmap and archetype controls across:
 * - D&D 5e (D&D Lite): Single-track 1–20 tier table, Hit Die selector, ability routing badges.
 * - PbtA: Playbook starting moves vs advance matrix, stat arrays, and Harm capacity.
 * - FAE: Approach ladder (+3 to +0), Resource Pool tuning, positive tags, and milestone track.
 *
 * [CATALOG: FEAT-02] See FEATURES.md — Concierge Session Zero & Living World Dossier
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import {
    CORE_DND_PROGRESSIONS,
    getCanonicalDndProgression,
    formatTraitAsPill,
    classifyFeatureKind,
    partitionFeaturesAndAbilities,
    normalizeBlueprint,
} from './level-up-blueprint.js';
import { deriveHitDieForClass } from './level-up-scaffold.js';
import { deduplicateFeatures } from './level-up-runner.js';
import { PBTA_GENRES, formatMoveAsPill } from './pbta-ruleset.js';
import { FAE_GENRES } from './fae-ruleset.js';
import { systemRegistry } from './concierge-system-registry.js';
import { calculateDndModifier } from './concierge-system-dnd5e.js';

/**
 * Escapes HTML characters for safe DOM insertion.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Tiers for D&D 5e 1–20 table: [start, end, label, summary] */
const DND_TIERS = [
    { start: 1, end: 4, name: 'Tier 1: Local Heroes', summary: 'Levels 1–4 · Apprentice & Archetype Specialization' },
    { start: 5, end: 8, name: 'Tier 2: Heroes of the Realm', summary: 'Levels 5–8 · Extra Attack / 3rd-Level Spells' },
    { start: 9, end: 12, name: 'Tier 3: Masters of the Realm', summary: 'Levels 9–12 · Iconic Class Mastery & High Powers' },
    { start: 13, end: 16, name: 'Tier 4: Masters of the World', summary: 'Levels 13–16 · Legendary Feats & Reality Bending' },
    { start: 17, end: 20, name: 'Tier 5: Epic Capstone', summary: 'Levels 17–20 · Godlike Archetype Mastery' },
];

/** Tracks expanded tiers in Session Zero Progression tab */
const expandedTiers = new Set([1]); // Tier 1 open by default

/**
 * Renders the polymorphic Progression Architect view inside target container element.
 *
 * @param {HTMLElement|jQuery} container Target container element
 * @param {object} options
 * @param {object} options.dossier Active Campaign Dossier
 * @param {string} [options.ruleset] Explicit ruleset override
 * @param {Function} [options.onUpdate] Callback when blueprint/sheet data changes
 */
export function renderProgressionArchitect(container, { dossier, ruleset = null, onUpdate = () => {} }) {
    const $el = typeof globalThis.$ === 'function'
        ? globalThis.$(container)
        : (container && typeof container.html === 'function' ? container : null);
    if (!$el || !$el.length) return;

    const detectedRuleset = ruleset || systemRegistry.detectRuleset(dossier);
    $el.empty();

    if (detectedRuleset === 'dnd5e') {
        renderDndProgression($el, dossier, onUpdate);
    } else if (detectedRuleset === 'fae') {
        renderFaeProgression($el, dossier, onUpdate);
    } else {
        renderPbtaProgression($el, dossier, onUpdate);
    }
}

/**
 * Renders D&D 5e (D&D Lite) 1–20 Progression Codex view.
 */
function renderDndProgression($container, dossier, onUpdate) {
    const p = dossier.protagonist || {};
    const className = p.class || 'Fighter';
    const hitDie = deriveHitDieForClass(className, p.hitDie || 'd8');

    // Resolve or auto-seed blueprint
    let bp = dossier.progressionBlueprint;
    if (!bp || !bp.levels || bp.className?.toLowerCase() !== className.toLowerCase()) {
        const canonical = getCanonicalDndProgression(className);
        if (canonical) {
            bp = {
                className: canonical.className,
                hitDie: canonical.hitDie,
                primaryStats: canonical.primaryStats,
                levels: { ...canonical.levels },
            };
            dossier.progressionBlueprint = bp;
        }
    }

    const hasBlueprint = Boolean(bp && bp.levels);

    const headerHtml = `
    <div class="mhc-card" style="margin-bottom: 10px; border-left: 3px solid #fbbf24;">
        <div class="mhc-card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="mhc-card-title">📜 1–20 Class Progression Codex</span>
                <span class="mhc-pill" style="border-color: rgba(251, 191, 36, 0.4); color: #fbbf24;">⚔️ ${escapeHtml(className)}</span>
            </div>
            <div style="font-size: 0.8em; color: #a855f7;">Single-Track D&D Lite</div>
        </div>

        <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; font-size: 0.85em; align-items: center;">
            <div style="display: flex; align-items: center; gap: 6px;">
                <label style="color: #94a3b8;"><i class="fa-solid fa-dice-d20"></i> Hit Die:</label>
                <select id="mhc_prog_dnd_hitdie" class="text_pole" style="font-size: 0.85em; padding: 2px 6px;">
                    <option value="d6" ${hitDie === 'd6' ? 'selected' : ''}>d6 (Wizard, Sorcerer)</option>
                    <option value="d8" ${hitDie === 'd8' ? 'selected' : ''}>d8 (Rogue, Cleric, Bard, Monk, Druid, Warlock)</option>
                    <option value="d10" ${hitDie === 'd10' ? 'selected' : ''}>d10 (Fighter, Paladin, Ranger)</option>
                    <option value="d12" ${hitDie === 'd12' ? 'selected' : ''}>d12 (Barbarian)</option>
                </select>
            </div>
            <div style="color: #9ca3af;">
                Starting HP: <strong style="color: #f87171;">${p.hp?.max || 10}</strong> · AC: <strong style="color: #60a5fa;">${p.ac || 14}</strong>
            </div>
        </div>
    </div>`;

    let tableHtml = '';
    if (!hasBlueprint) {
        tableHtml = `
        <div class="mhc-card" style="text-align: center; padding: 20px; color: #94a3b8;">
            <p>No 1–20 codex generated yet for <strong>${escapeHtml(className)}</strong>.</p>
            <button type="button" id="mhc_prog_seed_srd_btn" class="menu_button menu_button_primary" style="margin-top: 8px;">
                ⚡ Load SRD Core Progression
            </button>
        </div>`;
    } else {
        const tiersHtml = DND_TIERS.map(tier => {
            const isExpanded = expandedTiers.has(tier.start);
            let rowsHtml = '';

            for (let lvl = tier.start; lvl <= tier.end; lvl++) {
                const lvlData = bp.levels[lvl] || { features: [], profBonus: Math.floor((lvl - 1) / 4) + 2 };
                const prof = lvlData.profBonus || (Math.floor((lvl - 1) / 4) + 2);
                const isCurrentLvl = lvl === (p.level || 1);

                const pills = (lvlData.features || []).map(f => {
                    const kind = classifyFeatureKind(f);
                    const isAbility = kind === 'ability';
                    const pillBorder = isAbility ? 'rgba(251, 191, 36, 0.4)' : 'rgba(59, 130, 246, 0.4)';
                    const pillColor = isAbility ? '#fbbf24' : '#93c5fd';
                    const badge = isAbility ? '⚡ Ability' : 'Trait';
                    return `
                    <span class="mhc-pill" style="border-color: ${pillBorder}; color: ${pillColor}; font-size: 0.78em; margin: 1px 2px; cursor: help;" title="${escapeHtml(f)}">
                        <span style="opacity: 0.6; font-size: 0.85em;">[${badge}]</span> ${escapeHtml(f.split('(')[0].trim())}
                    </span>`;
                }).join('');

                const asiBadge = lvlData.asi ? '<span class="mhc-pill" style="border-color: rgba(16, 185, 129, 0.4); color: #34d399; font-size: 0.75em;">🌟 ASI / Feat</span>' : '';
                const subBadge = lvlData.subclass ? '<span class="mhc-pill" style="border-color: rgba(236, 72, 153, 0.4); color: #f472b6; font-size: 0.75em;">👑 Archetype Spec</span>' : '';

                rowsHtml += `
                <tr class="mhc-blueprint-row ${isCurrentLvl ? 'mhc-row-current' : ''}" style="${isCurrentLvl ? 'background: rgba(251, 191, 36, 0.08); border-left: 2px solid #fbbf24;' : ''}">
                    <td style="padding: 4px 8px; font-weight: bold; width: 65px; white-space: nowrap;">
                        Lvl ${lvl}
                        ${isCurrentLvl ? '<span style="color: #fbbf24; font-size: 0.75em;">(Start)</span>' : ''}
                    </td>
                    <td style="padding: 4px 8px; width: 55px; color: #94a3b8; font-size: 0.82em; white-space: nowrap;">
                        +${prof}
                    </td>
                    <td style="padding: 4px 8px;">
                        <div style="display: flex; flex-wrap: wrap; gap: 3px; align-items: center;">
                            ${pills || '<span style="opacity: 0.4; font-style: italic; font-size: 0.8em;">No feature</span>'}
                            ${asiBadge}
                            ${subBadge}
                        </div>
                    </td>
                </tr>`;
            }

            return `
            <div class="mhc-tier-section" style="margin-bottom: 6px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; overflow: hidden;">
                <div class="mhc-tier-header" data-tier-start="${tier.start}" style="background: rgba(255, 255, 255, 0.04); padding: 6px 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none;">
                    <div>
                        <strong style="font-size: 0.88em; color: #e2e8f0;">${tier.name}</strong>
                        <span style="font-size: 0.76em; color: #94a3b8; margin-left: 6px;">(${tier.summary})</span>
                    </div>
                    <span style="font-size: 0.8em; color: #94a3b8;">${isExpanded ? '▼' : '▶'}</span>
                </div>
                <div class="mhc-tier-body" style="display: ${isExpanded ? 'block' : 'none'};">
                    <table class="mhc-blueprint-table" style="width: 100%; border-collapse: collapse; font-size: 0.82em;">
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>`;
        }).join('');

        tableHtml = `
        <div class="mhc-card" style="padding: 6px;">
            <div class="mhc-card-header" style="margin-bottom: 6px;">
                <span class="mhc-card-title" style="font-size: 0.9em;">🗺️ 1–20 Progression Roadmap</span>
                <span style="font-size: 0.75em; color: #94a3b8;">Click tiers to expand/collapse</span>
            </div>
            <div style="max-height: 380px; overflow-y: auto;">
                ${tiersHtml}
            </div>
        </div>`;
    }

    $container.html(`${headerHtml}${tableHtml}`);

    // Tier accordion click delegation
    $container.find('.mhc-tier-header').on('click', function () {
        const tierStart = parseInt($(this).attr('data-tier-start'), 10);
        if (expandedTiers.has(tierStart)) {
            expandedTiers.delete(tierStart);
        } else {
            expandedTiers.add(tierStart);
        }
        renderDndProgression($container, dossier, onUpdate);
    });

    // Hit Die change
    $container.find('#mhc_prog_dnd_hitdie').on('change', function () {
        const newHd = $(this).val();
        if (newHd) {
            p.hitDie = newHd;
            if (bp) bp.hitDie = newHd;
            const hitDieSides = parseInt(newHd.replace('d', ''), 10) || 8;
            const conMod = calculateDndModifier(p.stats?.CON ?? 10);
            const lvl = parseInt(p.level, 10) || 1;
            const baseLevel1Hp = Math.max(1, hitDieSides + conMod);
            const avgGain = Math.max(1, Math.floor(hitDieSides / 2) + 1 + conMod);
            const newMaxHp = lvl === 1 ? baseLevel1Hp : baseLevel1Hp + (avgGain * (lvl - 1));
            p.hp = { current: newMaxHp, max: newMaxHp };
            onUpdate(dossier);
            renderDndProgression($container, dossier, onUpdate);
        }
    });

    // Load SRD Button
    $container.find('#mhc_prog_seed_srd_btn').on('click', function () {
        const canonical = getCanonicalDndProgression(className) || getCanonicalDndProgression('Fighter');
        if (canonical) {
            dossier.progressionBlueprint = {
                className: canonical.className,
                hitDie: canonical.hitDie,
                primaryStats: canonical.primaryStats,
                levels: { ...canonical.levels },
            };
            p.class = canonical.className;
            p.hitDie = canonical.hitDie;
            onUpdate(dossier);
            renderDndProgression($container, dossier, onUpdate);
        }
    });
}

/**
 * Renders PbtA Playbook Moves & Advance Matrix view.
 */
function renderPbtaProgression($container, dossier, onUpdate) {
    const p = dossier.protagonist || {};
    const playbook = p.playbook || 'Wanderer';
    const genreKey = dossier.meta?.systemKey || 'fantasy';
    const genreObj = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;

    const harmMax = dossier.config?.harmMax || p.harm?.max || 5;
    const armor = p.harm?.armor || 0;
    const moves = Array.isArray(p.startingMoves) && p.startingMoves.length > 0
        ? p.startingMoves
        : (Array.isArray(p.moves) ? p.moves : []);

    const movesHtml = moves.map(m => `
        <div class="mhc-pill" style="border-color: rgba(59, 130, 246, 0.4); color: #93c5fd; padding: 4px 8px; margin: 3px 0; display: block;" title="${escapeHtml(m)}">
            ⚡ <strong>${escapeHtml(m.split('(')[0].trim())}</strong>
            <span style="font-size: 0.85em; opacity: 0.85; margin-left: 4px;">${escapeHtml(m.includes('(') ? '(' + m.split('(').slice(1).join('(') : '')}</span>
        </div>
    `).join('') || '<div style="opacity: 0.6; font-style: italic;">No playbook moves selected yet.</div>';

    const advances = [
        '+1 to a Playbook Stat (max +3)',
        'New Move from your Playbook',
        'Cross-Playbook Move (borrow from another archetype)',
        '+1 Max Harm Capacity',
        '+1 Armor (max 3)',
    ];

    const advancesHtml = advances.map(adv => `
        <div style="font-size: 0.82em; padding: 3px 0; display: flex; align-items: center; gap: 6px; color: #cbd5e1;">
            <i class="fa-solid fa-square-check" style="color: #38bdf8;"></i> ${escapeHtml(adv)}
        </div>
    `).join('');

    $container.html(`
    <div class="mhc-card" style="margin-bottom: 10px; border-left: 3px solid #38bdf8;">
        <div class="mhc-card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="mhc-card-title">📜 PbtA Playbook &amp; Advances</span>
                <span class="mhc-pill" style="border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;">🎲 ${escapeHtml(playbook)}</span>
            </div>
            <div style="font-size: 0.8em; color: #93c5fd;">2d6 Narrative Moves</div>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 0.85em; align-items: center;">
            <div>Harm Track: <strong style="color: #f87171;">0/${harmMax}</strong></div>
            <div>Armor: <strong style="color: #60a5fa;">${armor}</strong></div>
            <div>Advance Trigger: <strong style="color: #fbbf24;">Every 5 XP</strong></div>
        </div>
    </div>

    <div class="mhc-card" style="margin-bottom: 10px;">
        <div class="mhc-card-header"><span class="mhc-card-title" style="font-size: 0.9em;">⚡ Starting Playbook Moves</span></div>
        <div style="margin-top: 4px;">${movesHtml}</div>
    </div>

    <div class="mhc-card">
        <div class="mhc-card-header"><span class="mhc-card-title" style="font-size: 0.9em;">🌟 Canonical Playbook Advances (XP 5/5)</span></div>
        <div style="margin-top: 6px; display: flex; flex-direction: column; gap: 3px;">
            ${advancesHtml}
        </div>
    </div>
    `);
}

/**
 * Renders FAE Approach Ladder & Milestone Desk view.
 */
function renderFaeProgression($container, dossier, onUpdate) {
    const p = dossier.protagonist || {};
    const archetype = p.archetype || p.playbook || 'Survivor';
    const pools = p.pools || {};
    const posTags = Array.isArray(p.positiveTags) ? p.positiveTags : [];
    const heroic = p.heroicDomain || '';

    const poolsHtml = Object.entries(pools).map(([k, pool]) => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.82em;">
            <span style="font-weight: 600; color: #e2e8f0;">${escapeHtml(pool.label || k)}</span>
            <span class="mhc-pill" style="border-color: rgba(245, 158, 11, 0.4); color: #fde68a;">${pool.current ?? pool.max}/${pool.max}</span>
        </div>
    `).join('') || '<div style="opacity: 0.6; font-style: italic;">No resource pools allocated yet.</div>';

    const tagsHtml = [
        heroic ? `<span class="mhc-pill" style="border-color: rgba(251, 191, 36, 0.4); color: #fbbf24; margin: 2px;">⚡ ${escapeHtml(heroic)} (Heroic Domain)</span>` : '',
        ...posTags.map(t => `<span class="mhc-pill" style="border-color: rgba(16, 185, 129, 0.4); color: #34d399; margin: 2px;">+ ${escapeHtml(t)}</span>`),
    ].filter(Boolean).join('') || '<span style="opacity: 0.6; font-style: italic;">No positive tags configured.</span>';

    $container.html(`
    <div class="mhc-card" style="margin-bottom: 10px; border-left: 3px solid #f59e0b;">
        <div class="mhc-card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="mhc-card-title">📜 FAE Milestone &amp; Pools</span>
                <span class="mhc-pill" style="border-color: rgba(245, 158, 11, 0.4); color: #fde68a;">🕯️ ${escapeHtml(archetype)}</span>
            </div>
            <div style="font-size: 0.8em; color: #fde68a;">4dF Resource Attrition</div>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 6px; font-size: 0.85em; align-items: center;">
            <div>Milestone Pacing: <strong style="color: #fbbf24;">4 Scenes / Milestone</strong></div>
            <div>Dice: <strong style="color: #93c5fd;">4dF (Range -4 to +4)</strong></div>
        </div>
    </div>

    <div class="mhc-card" style="margin-bottom: 10px;">
        <div class="mhc-card-header"><span class="mhc-card-title" style="font-size: 0.9em;">🛡️ Attrition Resource Pools</span></div>
        <div style="margin-top: 4px;">${poolsHtml}</div>
    </div>

    <div class="mhc-card">
        <div class="mhc-card-header"><span class="mhc-card-title" style="font-size: 0.9em;">🏷️ Positive Tags &amp; Leverage</span></div>
        <div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;">
            ${tagsHtml}
        </div>
    </div>
    `);
}

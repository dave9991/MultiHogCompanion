/**
 * MultiHog Companion — Level-Up & Respec Two-Stage Progression UI
 *
 * Stage 1: Class Definition & 1–20 Progression Codex Architect.
 * Stage 2: Level-Up & Respec Hybrid Review Desk.
 *
 * Provides smooth two-way navigation between Stage 1 (macro class architecture)
 * and Stage 2 (micro advancement / level commits), with zero narrative tokens overhead.
 *
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { formulateLevelUpProposal, applyLevelUpCommit, extractFeatureKey, deduplicateFeatures, mergeUpgradedFeatures, collapseCodexProgression, ensureNamedFeature, matchesFeatureRemovalTarget, applyPbtaAdvanceSelection, extractConciergeDirectives, splitTopLevelDirectives } from './level-up-runner.js';
import { getTierPerks, getCanonicalDndProgression, formatBlueprintSummary, parseBlueprintFromResponse, normalizeBlueprint, normalizeLevelEntry, formatTraitAsPill, classifyFeatureKind, partitionFeaturesAndAbilities } from './level-up-blueprint.js';
import { sendConciergeRequest } from './concierge-connection.js';
import { syncDossierToWorldInfoBook, persistCompanionDossier, parseCharacterBlockFromMemo } from './level-up-scaffold.js';
import { PBTA_GENRES, formatMoveAsPill } from './pbta-ruleset.js';

let _activeModalElement = null;

/**
 * Escapes HTML characters for safe DOM insertion.
 *
 * @param {string} str Raw string.
 * @returns {string} Escaped string.
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

/**
 * Closes and unmounts the active Level-Up / Respec Modal if present.
 */
export function closeLevelUpModal() {
    if (_activeModalElement) {
        _activeModalElement.remove();
        _activeModalElement = null;
    }
    const stale = document.getElementById('mhc-level-up-modal');
    if (stale) stale.remove();
}

/**
 * Opens the Level-Up / Respec Two-Stage Modal.
 *
 * @param {object} params
 * @param {string} params.chatId Active chat ID.
 * @param {object} params.dossier Campaign dossier.
 * @param {object} params.blueprint Progression blueprint.
 * @param {Promise} [params.blueprintPromise=null] Async blueprint promise.
 * @param {number} params.targetLevel Level being advanced to.
 * @param {boolean} [params.isRespec=false] Whether this is a respec.
 * @param {number} [params.initialStage=null] Explicit starting stage (1 or 2).
 * @param {object} [params.rpgSettings=null] MultiHog settings object.
 * @param {Function} [params.onComplete=null] Callback fired on commit.
 */
export function openLevelUpModal({
    chatId,
    dossier,
    blueprint,
    blueprintPromise = null,
    targetLevel,
    isRespec = false,
    initialStage = null,
    rpgSettings = null,
    onComplete = null,
}) {
    closeLevelUpModal();

    const sysKeyLower = (dossier?.meta?.systemKey || '').toLowerCase();
    const isPbta = !!(
        sysKeyLower === 'pbta'
        || (sysKeyLower && PBTA_GENRES[sysKeyLower])
        || dossier?.protagonist?.isPbta
        || dossier?.protagonist?.playbook
        || dossier?.protagonist?.harm
        || (dossier?.meta?.systemLabel && /PbtA|Dungeon World|Fellowship|Apocalypse|Monster of the Week|Sprawl|Masks|Blades in the Dark|Wanderhome/i.test(dossier.meta.systemLabel))
    );

    // Normalize on load so previously stored/LLM blueprints never show HP/ASI/slot bookkeeping as features
    let activeBlueprint = normalizeBlueprint(blueprint || dossier?.progressionBlueprint || null);
    const isLoadingBlueprint = !isPbta && !!blueprintPromise && !activeBlueprint;

    // Stage selection: PbtA always uses Stage 2 (Playbook Desk).
    // For D&D: if initialStage is passed, honor it. Otherwise, if blueprint exists, default to 2; if not, default to 1.
    let currentStage = isPbta ? 2 : (initialStage ? initialStage : (activeBlueprint ? 2 : 1));

    const parsedCurrentSheet = parseCharacterBlockFromMemo(rpgSettings?.currentMemo || '');
    const initialSheetFeatures = Array.isArray(dossier?.protagonist?.features) && dossier.protagonist.features.length > 0
        ? [...dossier.protagonist.features]
        : (parsedCurrentSheet.features || []);

    const proposal = formulateLevelUpProposal(dossier, activeBlueprint, targetLevel, {
        isRespec,
        isPbta,
        currentMemo: rpgSettings?.currentMemo,
    });
    proposal.newFeatures = [...(proposal.newFeatures || [])];
    proposal.activeAbilities = [...(proposal.activeAbilities || [])];
    if (proposal.activeAbilities.length === 0 && Array.isArray(parsedCurrentSheet.abilities) && parsedCurrentSheet.abilities.length > 0) {
        proposal.activeAbilities = [...parsedCurrentSheet.abilities];
    }

    const modal = document.createElement('div');
    modal.id = 'mhc-level-up-modal';
    modal.className = 'mhc-modal-backdrop';

    // ─────────────────────────────────────────────────────────────
    // STAGE 2: ADVANCEMENT / RESPEC REVIEW MARKUP
    // ─────────────────────────────────────────────────────────────

    const stage2Title = isPbta
        ? (isRespec ? `🔄 Playbook Tuning Desk — ${proposal.characterName}` : `⚡ Playbook Advancement Desk — ${proposal.characterName}`)
        : (isRespec ? `🔄 Respec & Tuning Desk — ${proposal.characterName}` : `⬆ Level Up Available — ${proposal.characterName} (Level ${proposal.currentLevel} ➔ ${proposal.targetLevel})`);

    const pbtaStatNames = (Array.isArray(proposal.statNames) && proposal.statNames.length > 0)
        ? proposal.statNames
        : Object.keys(proposal.stats || {});
    const pbtaStatNamesStr = pbtaStatNames.length > 0
        ? pbtaStatNames.join(', ')
        : 'Might, Agility, Wits, Heart, Arcana';

    // PbtA Advancement Picker markup (when advancing a PbtA playbook)
    let pbtaAdvanceSection = '';
    if (isPbta && !isRespec && Array.isArray(proposal.advanceOptions)) {
        const firstAvailable = proposal.advanceOptions.find(o => !o.exhausted)?.id || proposal.advanceOptions[0]?.id || 'stat_boost';
        const optionRowsHtml = proposal.advanceOptions.map(opt => {
            const isChecked = opt.id === firstAvailable && !opt.exhausted;
            const disabledAttr = opt.exhausted ? 'disabled' : '';
            let detailHtml = '';
            if (opt.id === 'stat_boost') {
                const statOpts = pbtaStatNames.map(s => {
                    const cur = Number(proposal.stats?.[s] ?? 0);
                    const maxed = cur >= 3;
                    const curStr = cur >= 0 ? `+${cur}` : String(cur);
                    const nextVal = Math.min(3, cur + 1);
                    const nextStr = nextVal >= 0 ? `+${nextVal}` : String(nextVal);
                    return `<option value="${escapeHtml(s)}" ${maxed ? 'disabled' : ''}>${escapeHtml(s)} (${curStr} ➔ ${maxed ? 'Max +3' : nextStr})</option>`;
                }).join('');
                detailHtml = `
                <div class="mhc-pbta-adv-detail" data-adv-detail="stat_boost" style="margin: 6px 0 4px 24px; ${isChecked ? '' : 'display:none;'}">
                    <label style="font-size: 0.85em; color: #94a3b8; margin-right: 6px;">Select Stat:</label>
                    <select id="mhc_pbta_stat_select" class="text_pole" style="width: auto; display: inline-block;">${statOpts}</select>
                </div>`;
            } else if (opt.id === 'playbook_move') {
                const moveOpts = (opt.suggestedMoves || []).map((m, i) =>
                    `<option value="${escapeHtml(m)}" ${i === 0 ? 'selected' : ''}>${escapeHtml(m.split('(')[0].trim())}</option>`
                ).join('');
                const initialMove = opt.suggestedMoves?.[0] || '';
                detailHtml = `
                <div class="mhc-pbta-adv-detail" data-adv-detail="playbook_move" style="margin: 6px 0 4px 24px; display: ${isChecked ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                    <select id="mhc_pbta_move_select" class="text_pole">
                        ${moveOpts}
                        <option value="custom">Custom Move (write below or ask Playbook Guide)</option>
                    </select>
                    <input type="text" id="mhc_pbta_custom_move_input" class="text_pole" value="${escapeHtml(initialMove)}" placeholder="Move Name [+Stat] (When [trigger], roll +[Stat]...)" />
                </div>`;
            } else if (opt.id === 'cross_playbook_move') {
                const crossOpts = (opt.suggestedMoves || []).map((m, i) =>
                    `<option value="${escapeHtml(m)}" ${i === 0 ? 'selected' : ''}>${escapeHtml(m.split('(')[0].trim())}</option>`
                ).join('');
                const initialCross = opt.suggestedMoves?.[0] || '';
                detailHtml = `
                <div class="mhc-pbta-adv-detail" data-adv-detail="cross_playbook_move" style="margin: 6px 0 4px 24px; display: ${isChecked ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                    <select id="mhc_pbta_cross_move_select" class="text_pole">
                        ${crossOpts}
                        <option value="custom">Custom Cross-Playbook Move</option>
                    </select>
                    <input type="text" id="mhc_pbta_custom_cross_move_input" class="text_pole" value="${escapeHtml(initialCross)}" placeholder="Move Name [+Stat] (When [trigger], roll +[Stat]...)" />
                </div>`;
            }

            return `
            <div class="mhc-pbta-advance-option ${opt.exhausted ? 'mhc-adv-exhausted' : ''}" data-adv-id="${escapeHtml(opt.id)}" style="padding: 4px 0; ${opt.exhausted ? 'opacity: 0.5;' : ''}">
                <label class="mhc-radio-label" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span>
                        <input type="radio" name="mhc_pbta_advance_pick" value="${escapeHtml(opt.id)}" ${isChecked ? 'checked' : ''} ${disabledAttr} />
                        <strong>${escapeHtml(opt.label)}</strong>
                    </span>
                    <span class="mhc-advance-usage-badge" style="font-size: 0.8em; color: #94a3b8;">${opt.exhausted ? 'Max Reached' : `${opt.used}/${opt.maxTimes} taken`}</span>
                </label>
                ${detailHtml}
            </div>`;
        }).join('');

        pbtaAdvanceSection = `
        <div class="mhc-card-section" id="mhc-pbta-advance-picker-card">
            <div class="mhc-section-title" style="justify-content: space-between;">
                <span><i class="fa-solid fa-bolt" style="color: #fbbf24;"></i> Choose Your Playbook Advance</span>
                <span style="font-size: 0.8em; color: #9ca3af;">Advances Taken: ${(proposal.advancesTaken || []).length}</span>
            </div>
            <div class="mhc-asi-radio-group" id="mhc-pbta-advance-options">
                ${optionRowsHtml}
            </div>
        </div>`;
    }

    // ASI / Feat markup if due
    let asiSection = '';
    if (!isPbta && proposal.isAsi && proposal.asiOptions) {
        const { optionA, optionB, recommendedFeats } = proposal.asiOptions;
        const featOptionsHtml = recommendedFeats
            .map(feat => `<option value="${escapeHtml(feat)}">${escapeHtml(feat)}</option>`)
            .join('');

        asiSection = `
        <div class="mhc-card-section">
            <div class="mhc-section-title"><i class="fa-solid fa-gem"></i> Milestone Advancement: ASI or Feat</div>
            <div class="mhc-asi-radio-group">
                <label class="mhc-radio-label">
                    <input type="radio" name="mhc_asi_pick" value="optionA" checked />
                    <span><strong>Option A:</strong> ${escapeHtml(optionA.label)}</span>
                </label>
                <label class="mhc-radio-label">
                    <input type="radio" name="mhc_asi_pick" value="optionB" />
                    <span><strong>Option B:</strong> ${escapeHtml(optionB.label)}</span>
                </label>
                <label class="mhc-radio-label">
                    <input type="radio" name="mhc_asi_pick" value="feat" />
                    <span><strong>Option C (Feat):</strong></span>
                    <select id="mhc_feat_select" class="text_pole" style="width: auto; display: inline-block; margin-left: 8px;">
                        ${featOptionsHtml}
                        <option value="custom">Other (Custom Feat)</option>
                    </select>
                </label>
            </div>
            <input type="text" id="mhc_custom_feat_input" class="text_pole" placeholder="Name custom feat or boon..." style="display:none; margin-top: 6px;" />
        </div>`;
    }

    // Party companions markup
    let partySection = '';
    if (!isPbta && proposal.partyChanges && proposal.partyChanges.length > 0) {
        const partyList = proposal.partyChanges
            .map(pc => `<li><strong>${escapeHtml(pc.name)}:</strong> +${pc.hpGain} Max HP (${escapeHtml(pc.classFeature)})</li>`)
            .join('');

        partySection = `
        <div class="mhc-card-section">
            <div class="mhc-section-title">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    <input type="checkbox" id="mhc_party_sync_chk" checked />
                    <span><i class="fa-solid fa-users"></i> Party Level Sync (Lockstep Growth)</span>
                </label>
            </div>
            <ul class="mhc-party-preview-list">
                ${partyList}
            </ul>
        </div>`;
    }

    // Stage 2 Subbadges HTML
    const stage2SubBadgesHtml = isPbta ? `
        <span class="mhc-badge-class"><i class="fa-solid fa-book-sparkles"></i> Playbook: ${escapeHtml(proposal.playbookName || proposal.className)}</span>
        <span class="mhc-badge-hitdie" id="mhc-pbta-harm-badge" style="border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;"><i class="fa-solid fa-heart-crack"></i> Harm Capacity: ${proposal.harm?.max || 4}</span>
        <span class="mhc-badge-hitdie" id="mhc-pbta-armor-badge" style="border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;"><i class="fa-solid fa-shield"></i> Armor: ${proposal.harm?.armor ?? 1}</span>
        <span class="mhc-badge-mode">${isRespec ? 'Tuning & Respec' : 'Playbook Advance'}</span>
    ` : `
        <span class="mhc-badge-class" id="mhc-stage2-class-badge"><i class="fa-solid fa-shield-halved"></i> ${escapeHtml(proposal.className)}</span>
        <span class="mhc-badge-hitdie" id="mhc-stage2-hitdie-badge"><i class="fa-solid fa-dice-d20"></i> Hit Die: ${escapeHtml(proposal.hitDie)}</span>
        <span class="mhc-badge-mode">${isRespec ? 'Tuning & Respec' : `Advancing to Level ${proposal.targetLevel}`}</span>
    `;

    const pbtaStatsBarHtml = isPbta ? `
        <div class="mhc-pbta-stats-bar" id="mhc-pbta-stats-row" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
            ${pbtaStatNames.map(s => {
                const v = Number(proposal.stats?.[s] ?? 0);
                const disp = v >= 0 ? `+${v}` : String(v);
                return isRespec ? `
                <label class="mhc-hp-pill" style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;">
                    <span class="mhc-hp-label">${escapeHtml(s)}:</span>
                    <input type="number" class="text_pole mhc-pbta-stat-input" data-stat="${escapeHtml(s)}" min="-2" max="3" value="${v}" style="width: 48px; padding: 2px 4px; text-align: center;" />
                </label>` : `
                <div class="mhc-hp-pill" data-stat-pill="${escapeHtml(s)}" style="padding: 3px 8px;">
                    <span class="mhc-hp-label">${escapeHtml(s)}:</span>
                    <span class="mhc-hp-val" data-stat-val="${escapeHtml(s)}">${disp}</span>
                </div>`;
            }).join('')}
        </div>
    ` : '';

    // Vitality card HTML
    const vitalitySectionHtml = isPbta ? `
    <div class="mhc-card-section">
        <div class="mhc-section-title"><i class="fa-solid fa-heart-pulse"></i> Harm, Armor &amp; Playbook Stats</div>
        <div class="mhc-hp-row" style="flex-wrap: wrap; gap: 8px;">
            <div class="mhc-hp-pill">
                <span class="mhc-hp-label">Harm Track:</span>
                <span class="mhc-hp-val" id="mhc-new-hp-display" style="color: ${(proposal.harm?.current || 0) > 0 ? '#f87171' : '#4ade80'};">${proposal.harm?.current || 0} / <span id="mhc-pbta-harm-max-val">${proposal.harm?.max || 4}</span></span>
            </div>
            <label class="mhc-hp-pill" style="border-color: rgba(239, 68, 68, 0.35); display: inline-flex; align-items: center; gap: 4px;">
                <span class="mhc-hp-label">Max Harm:</span>
                <input type="number" id="mhc_pbta_harm_max_input" class="text_pole" min="2" max="8" value="${proposal.harm?.max || 4}" style="width: 48px; padding: 2px 4px; text-align: center;" />
            </label>
            <label class="mhc-hp-pill" style="border-color: rgba(59, 130, 246, 0.35); display: inline-flex; align-items: center; gap: 4px;">
                <span class="mhc-hp-label">Armor:</span>
                <input type="number" id="mhc_pbta_armor_input" class="text_pole" min="0" max="4" value="${proposal.harm?.armor ?? 1}" style="width: 48px; padding: 2px 4px; text-align: center;" />
            </label>
            <div class="mhc-hp-pill" style="border-color: rgba(255, 255, 255, 0.15);">
                <span class="mhc-hp-label">Status:</span>
                <span class="mhc-hp-val" style="font-size: 0.9em; font-weight: 500;">${escapeHtml(proposal.status || 'Healthy')}</span>
            </div>
        </div>
        ${pbtaStatsBarHtml}
    </div>
    ` : `
    <div class="mhc-card-section">
        <div class="mhc-section-title"><i class="fa-solid fa-heart-pulse"></i> Vitality & Hit Points</div>
        ${isRespec ? `
        <div class="mhc-hp-row">
            <div class="mhc-hp-pill">
                <span class="mhc-hp-label">Current Max HP:</span>
                <span class="mhc-hp-val" id="mhc-new-hp-display">${proposal.hpChange.oldMax}</span>
            </div>
            <div class="mhc-hp-pill" style="border-color: rgba(255, 255, 255, 0.15);">
                <span class="mhc-hp-label">Hit Dice:</span>
                <span class="mhc-hp-val" style="color: #60a5fa;"><i class="fa-solid fa-dice-d20"></i> ${proposal.hitDie} (${proposal.targetLevel}/${proposal.targetLevel})</span>
            </div>
            <div class="mhc-hp-toggle-group">
                <span style="font-size: 0.85em; color: #9ca3af; align-self: center;"><i class="fa-solid fa-lock"></i> Maintained at Level ${proposal.currentLevel}</span>
            </div>
        </div>
        ` : `
        <div class="mhc-hp-row">
            <div class="mhc-hp-pill">
                <span class="mhc-hp-label">Current Max HP:</span>
                <span class="mhc-hp-val">${proposal.hpChange.oldMax}</span>
            </div>
            <div class="mhc-hp-arrow"><i class="fa-solid fa-arrow-right"></i></div>
            <div class="mhc-hp-pill mhc-hp-pill-new">
                <span class="mhc-hp-label">New Max HP:</span>
                <span class="mhc-hp-val" id="mhc-new-hp-display">${proposal.hpChange.newMax}</span>
            </div>
            <div class="mhc-hp-toggle-group">
                <button class="menu_button mhc-hp-btn active" id="mhc-hp-avg-btn">Take Average (+${proposal.hpChange.gain})</button>
                <button class="menu_button mhc-hp-btn" id="mhc-hp-roll-btn">Roll ${proposal.hitDie}</button>
            </div>
        </div>
        <div class="mhc-hp-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.06); justify-content: flex-start; gap: 8px;">
            <div class="mhc-hp-pill" style="border-color: rgba(255, 255, 255, 0.15);">
                <span class="mhc-hp-label">Hit Dice Pool:</span>
                <span class="mhc-hp-val" style="color: #60a5fa;"><i class="fa-solid fa-dice-d20"></i> ${proposal.hitDie} (${proposal.targetLevel}/${proposal.targetLevel})</span>
            </div>
            <span style="font-size: 0.82em; color: #9ca3af; align-self: center;"><i class="fa-solid fa-circle-check" style="color: #60a5fa;"></i> 1 Hit Die per character level</span>
        </div>
        `}
    </div>
    `;

    const featuresTitle = isPbta
        ? (isRespec ? 'Active Playbook Moves & Techniques' : 'Playbook Moves & Advancement Choices')
        : (isRespec ? `Active Traits & Perks (Level ${proposal.currentLevel})` : `Class Features (${escapeHtml(proposal.className)} Level ${proposal.targetLevel})`);

    const featuresIcon = isPbta ? 'fa-hand-sparkles' : (isRespec ? 'fa-sliders' : 'fa-star');
    const featuresPlaceholder = isPbta
        ? (isRespec ? 'Add or tweak custom Playbook Move...' : 'Add custom Playbook Move manually...')
        : (isRespec ? 'Add or tweak custom trait or ability...' : 'Add custom trait or ability manually...');

    const harmonizationControlsHtml = (!isPbta && isRespec) ? `
    <div class="mhc-harmonize-bar" style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
        <button class="mhc-chip" id="mhc-sync-codex-traits-btn" title="Harmonize active traits strictly with the 1–20 Progression Codex up to your level">
            <i class="fa-solid fa-arrows-rotate"></i> Sync from Codex Table
        </button>
        <button class="mhc-chip" id="mhc-restore-sheet-traits-btn" title="Restore original starting traits from your adventure character sheet">
            <i class="fa-solid fa-file-lines"></i> Restore Adventure Sheet Traits
        </button>
    </div>
    ` : '';

    const activeAbilitiesSectionHtml = !isPbta ? `
    <div class="mhc-card-section" style="margin-top: 10px;">
        <div class="mhc-section-title" style="justify-content: space-between;">
            <span><i class="fa-solid fa-bolt" style="color: #60a5fa;"></i> Active Powers & Rest Resources ([ABILITIES])</span>
            <span style="font-size: 0.8em; color: #9ca3af;"><i class="fa-solid fa-circle-info"></i> Tracked with clickable resource pills</span>
        </div>
        <ul class="mhc-perks-list" id="mhc-abilities-list-container">
            <!-- Populated dynamically by renderAbilitiesList -->
        </ul>
        <div class="mhc-manual-add-row" style="margin-top: 8px; display: flex; gap: 6px;">
            <input type="text" id="mhc_manual_ability_input" class="text_pole" placeholder="Add active power (e.g. Underworld Broker, 1/1 per short rest)..." style="flex: 1;" />
            <button class="menu_button" id="mhc_manual_ability_add_btn"><i class="fa-solid fa-plus"></i> Add Power</button>
        </div>
    </div>
    ` : '';

    const conciergeTitle = isPbta ? 'Playbook Guide Concierge' : 'Leveling Guide Concierge';
    const conciergeDesc = isPbta
        ? (isRespec ? 'Consult your guide to review your playbook moves, refine stats (-1 to +3), or tune gear and conditions.' : 'Consult your guide for playbook advances, new narrative moves, or rule clarifications.')
        : (isRespec ? 'Consult your guide to review your build, audit active vs passive abilities, or rebalance perks without changing your level.' : 'Consult your guide for build recommendations, rule clarifications, or to request custom thematic perks.');

    let stage2QuickChipsHtml = '';
    if (isPbta) {
        stage2QuickChipsHtml = `
        <button class="mhc-chip" data-prompt="Suggest a new Playbook Move fitting my archetype with a 10+, 7-9, and 6- trigger">🔄 Suggest new Move</button>
        <button class="mhc-chip" data-prompt="Help me rebalance my stats (${escapeHtml(pbtaStatNamesStr)}) within the -1 to +3 range">⚡ Rebalance stats</button>
        <button class="mhc-chip" data-prompt="Review my active conditions, harm capacity, and gear">📜 Review conditions & harm</button>
        `;
    } else if (isRespec) {
        stage2QuickChipsHtml = `
        <button class="mhc-chip" data-prompt="Audit my passive traits and active abilities: detect any duplicates, verify they are in the right place, and clean them up">🔍 Audit & fix duplicates</button>
        <button class="mhc-chip" data-prompt="Rebalance my abilities for a specific weapon or playstyle">🔄 Rebalance abilities</button>
        <button class="mhc-chip" data-prompt="Suggest a custom trait or boon fitting my character">⚡ Suggest custom trait</button>
        <button class="mhc-chip" data-prompt="Review my current build and suggest tweaks">📜 Review build balance</button>
        `;
    } else {
        stage2QuickChipsHtml = `
        <button class="mhc-chip" data-prompt="Audit my traits and active abilities for duplicates or misplaced powers">🔍 Audit & fix duplicates</button>
        <button class="mhc-chip" data-prompt="Suggest a unique martial or magical perk fitting my character">⚡ Suggest custom perk</button>
        <button class="mhc-chip" data-prompt="Explain my class features and how to best use them">📜 Explain my abilities</button>
        <button class="mhc-chip" data-prompt="Recommend an optimal ASI or feat choice">🛡️ Recommend feats</button>
        `;
    }

    const stage2Placeholder = isPbta
        ? (isRespec ? 'Ask your guide, or request custom moves (e.g. \'Suggest an infiltration move\')...' : 'Ask your guide, or request custom playbook moves...')
        : (isRespec ? 'Ask your guide, or request custom boons to tune your build...' : 'Ask your guide, or request custom boons (e.g. \'I want a frost totem perk\')...');

    const confirmBtnText = isPbta
        ? (isRespec ? '<i class="fa-solid fa-floppy-disk"></i> Save Playbook Changes' : '<i class="fa-solid fa-check"></i> Confirm Playbook Advancement')
        : (isRespec ? '<i class="fa-solid fa-floppy-disk"></i> Save Build Changes' : `<i class="fa-solid fa-check"></i> Confirm & Advance to Level ${proposal.targetLevel}`);

    // Return to Stage 1 Button (D&D only)
    const stageSwitchBtnHtml = !isPbta ? `
        <button class="menu_button mhc-btn-stage-switch" id="mhc-switch-to-stage1-btn" title="View or customize the full 1–20 Class Progression Codex">
            <i class="fa-solid fa-book-sparkles"></i> 📜 Class Definition & Roadmap
        </button>
    ` : '';

    // ─────────────────────────────────────────────────────────────
    // STAGE 1: CLASS DEFINITION & 1–20 CODEX MARKUP
    // ─────────────────────────────────────────────────────────────

    const stage1Title = `⚔️ Class Definition & Progression Codex — ${proposal.characterName}`;

    modal.innerHTML = `
    <div class="mhc-modal-dialog">
        <!-- ════════════════ STAGE 1: CLASS DEFINITION ════════════════ -->
        <div class="mhc-stage-view" id="mhc-stage-definition" style="${currentStage === 1 ? 'display:flex;' : 'display:none;'}">
            <div class="mhc-modal-header">
                <div class="mhc-header-title-box">
                    <div class="mhc-modal-title">${escapeHtml(stage1Title)}</div>
                    <div class="mhc-header-subbadges">
                        <span class="mhc-badge-class"><i class="fa-solid fa-wand-magic-sparkles"></i> Class: <span id="mhc-blueprint-badge-class">${escapeHtml(activeBlueprint?.className || proposal.className)}</span></span>
                        <span class="mhc-badge-hitdie"><i class="fa-solid fa-dice-d20"></i> Hit Die: <span id="mhc-blueprint-badge-hitdie">${escapeHtml(activeBlueprint?.hitDie || proposal.hitDie || 'd8')}</span></span>
                        <span class="mhc-badge-mode" style="border-color: rgba(168,85,247,0.4); color: #c084fc;">Stage 1: 1–20 Codex</span>
                    </div>
                </div>
                <button class="mhc-modal-close" id="mhc-stage1-close-btn">&times;</button>
            </div>
            <div class="mhc-modal-body">
                <!-- Class Architecture Overview Card -->
                <div class="mhc-card-section">
                    <div class="mhc-section-title"><i class="fa-solid fa-sliders"></i> Class Configuration & Archetype</div>
                    <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <label for="mhc_blueprint_class_name" style="font-size: 0.85em; color: #94a3b8;">Class Name:</label>
                            <input type="text" id="mhc_blueprint_class_name" class="text_pole" value="${escapeHtml(activeBlueprint?.className || proposal.className)}" style="width: 160px;" />
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <label for="mhc_blueprint_hitdie" style="font-size: 0.85em; color: #94a3b8;">Hit Die:</label>
                            <select id="mhc_blueprint_hitdie" class="text_pole" style="width: auto;">
                                <option value="d6" ${(activeBlueprint?.hitDie || proposal.hitDie) === 'd6' ? 'selected' : ''}>d6 (Mage/Sorcerer)</option>
                                <option value="d8" ${(activeBlueprint?.hitDie || proposal.hitDie) === 'd8' || !(activeBlueprint?.hitDie || proposal.hitDie) ? 'selected' : ''}>d8 (Rogue/Cleric/Monk/Bard)</option>
                                <option value="d10" ${(activeBlueprint?.hitDie || proposal.hitDie) === 'd10' ? 'selected' : ''}>d10 (Fighter/Paladin/Ranger)</option>
                                <option value="d12" ${(activeBlueprint?.hitDie || proposal.hitDie) === 'd12' ? 'selected' : ''}>d12 (Barbarian)</option>
                            </select>
                        </div>
                        <div style="margin-left: auto; font-size: 0.82em; color: #a855f7; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-route"></i> Single-Track 1–20 D&D Lite
                        </div>
                    </div>
                </div>

                <!-- 1–20 Progression Table Card -->
                <div class="mhc-card-section">
                    <div class="mhc-section-title" style="justify-content: space-between;">
                        <span><i class="fa-solid fa-table-list"></i> 1–20 Progression Roadmap</span>
                        <span style="font-size: 0.8em; color: #94a3b8;">Scroll to inspect all 20 levels</span>
                    </div>
                    ${isLoadingBlueprint ? `
                    <div class="mhc-blueprint-shimmer" id="mhc-blueprint-shimmer">
                        <div class="mhc-shimmer-header">
                            <i class="fa-solid fa-wand-magic-sparkles fa-spin"></i>
                            <span>Architecting 1–20 Progression Codex for <strong>${escapeHtml(proposal.className)}</strong>...</span>
                        </div>
                        <div class="mhc-shimmer-bar mhc-shimmer-bar-lg"></div>
                        <div class="mhc-shimmer-bar mhc-shimmer-bar-md"></div>
                        <div class="mhc-shimmer-bar mhc-shimmer-bar-sm"></div>
                    </div>
                    ` : ''}
                    <div class="mhc-blueprint-table-container" id="mhc-blueprint-table-container">
                        <!-- Populated dynamically by renderBlueprintTable -->
                    </div>
                </div>

                <!-- Class Architect Concierge Desk -->
                <div class="mhc-card-section mhc-concierge-section">
                    <div class="mhc-section-title"><i class="fa-solid fa-wand-magic-sparkles"></i> Class Architect Concierge</div>
                    <div class="mhc-concierge-desc">Converse with your RPG systems architect to review or customize your 1–20 progression codex, rename powers, or adjust Hit Dice before advancing.</div>
                    
                    <div class="mhc-concierge-chat-log" id="mhc-stage1-chat-log">
                        <!-- Populated by renderStage1Chat -->
                    </div>

                    <div class="mhc-concierge-typing" id="mhc-stage1-typing" style="display: none;">
                        <i class="fa-solid fa-wand-magic-sparkles fa-spin"></i> Architect is updating your progression table...
                    </div>

                    <div class="mhc-quick-chips" id="mhc-stage1-quick-chips">
                        <button class="mhc-chip" data-prompt="Audit and fix all 20 levels so every feature uses Name (hover tooltip) pill syntax and active powers include X/Y per rest counters">✨ Audit &amp; Fix Roadmap Formatting</button>
                        <button class="mhc-chip" data-prompt="Suggest a signature Level 3 Archetype Specialization for my class">⚡ Suggest Level 3 Specialization</button>
                        <button class="mhc-chip" data-prompt="Rebalance high-tier features (Levels 11–20) with exciting epic abilities">🛡️ Rebalance Levels 11–20</button>
                        <button class="mhc-chip" data-prompt="Change my Hit Die to d10 and adjust traits for a martial playstyle">🎲 Make Hit Die d10 (Martial Focus)</button>
                        <button class="mhc-chip" data-prompt="Design an epic Capstone feature for Level 20">👑 Design Level 20 Capstone</button>
                    </div>

                    <div class="mhc-concierge-input-row">
                        <input type="text" id="mhc_stage1_concierge_input" class="text_pole" placeholder="Ask your architect, or request changes (e.g. 'Make level 6 a lightning teleport')..." />
                        <button class="menu_button menu_button_primary" id="mhc_stage1_concierge_send_btn">
                            <i class="fa-solid fa-paper-plane"></i> Send
                        </button>
                    </div>
                </div>
            </div>
            <div class="mhc-modal-footer">
                <button class="menu_button" id="mhc-stage1-cancel-btn">Cancel</button>
                <button class="menu_button menu_button_primary" id="mhc-proceed-to-stage2-btn">
                    Proceed to Level Up / Respec <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        </div>

        <!-- ════════════════ STAGE 2: LEVEL UP / RESPEC ════════════════ -->
        <div class="mhc-stage-view" id="mhc-stage-advancement" style="${currentStage === 2 ? 'display:flex;' : 'display:none;'}">
            <div class="mhc-modal-header">
                <div class="mhc-header-title-box">
                    <div class="mhc-modal-title">${escapeHtml(stage2Title)}</div>
                    <div class="mhc-header-subbadges">
                        ${stage2SubBadgesHtml}
                        ${stageSwitchBtnHtml}
                    </div>
                </div>
                <button class="mhc-modal-close" id="mhc-stage2-close-btn">&times;</button>
            </div>
            <div class="mhc-modal-body mhc-advancement-split-body">
                <!-- Left Column: Character Build & Features -->
                <div class="mhc-advancement-cards-col">
                    <!-- Vitality / Harm Section -->
                    ${vitalitySectionHtml}

                    <!-- PbtA Advancement Picker (when advancing a playbook) -->
                    ${pbtaAdvanceSection}

                    <!-- Class Features & Active Traits / Moves -->
                    <div class="mhc-card-section">
                        <div class="mhc-section-title" style="justify-content: space-between;">
                            <span><i class="fa-solid ${featuresIcon}"></i> ${escapeHtml(featuresTitle)}</span>
                        </div>
                        ${harmonizationControlsHtml}
                        <ul class="mhc-perks-list" id="mhc-perks-list-container">
                            <!-- Populated dynamically by renderPerksList -->
                        </ul>
                        <div class="mhc-manual-add-row" style="margin-top: 8px; display: flex; gap: 6px;">
                            <input type="text" id="mhc_manual_perk_input" class="text_pole" placeholder="${featuresPlaceholder}" style="flex: 1;" />
                            <button class="menu_button" id="mhc_manual_perk_add_btn"><i class="fa-solid fa-plus"></i> Add</button>
                        </div>
                    </div>

                    <!-- Active Tracked Abilities ([ABILITIES] Module) -->
                    ${activeAbilitiesSectionHtml}

                    <!-- ASI / Feat Section -->
                    ${asiSection}

                    <!-- Party Sync Section -->
                    ${partySection}
                </div>

                <!-- Right Column: Interactive Concierge Desk -->
                <div class="mhc-advancement-concierge-col">
                    <div class="mhc-card-section mhc-concierge-section mhc-concierge-desk-card">
                        <div class="mhc-section-title"><i class="fa-solid fa-wand-magic-sparkles"></i> ${conciergeTitle}</div>
                        <div class="mhc-concierge-desc">${conciergeDesc}</div>
                        
                        <div class="mhc-concierge-chat-log" id="mhc-concierge-chat-log">
                            <!-- Populated by renderStage2Chat -->
                        </div>

                        <div class="mhc-concierge-typing" id="mhc-concierge-typing" style="display: none;">
                            <i class="fa-solid fa-wand-magic-sparkles fa-spin"></i> Guide is considering your request...
                        </div>

                        <div class="mhc-quick-chips">
                            ${stage2QuickChipsHtml}
                        </div>

                        <div class="mhc-concierge-input-row">
                            <input type="text" id="mhc_concierge_input" class="text_pole" placeholder="${stage2Placeholder}" />
                            <button class="menu_button menu_button_primary" id="mhc_concierge_send_btn">
                                <i class="fa-solid fa-paper-plane"></i> Send
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="mhc-modal-footer">
                <button class="menu_button" id="mhc-stage2-cancel-btn">Cancel</button>
                <button class="menu_button menu_button_primary" id="mhc-confirm-apply-btn">
                    ${confirmBtnText}
                </button>
            </div>
        </div>
    </div>`;

    document.body.appendChild(modal);
    _activeModalElement = modal;

    // ─────────────────────────────────────────────────────────────
    // STAGE 1: 1–20 PROGRESSION TABLE RENDERER
    // ─────────────────────────────────────────────────────────────

    const tableContainer = modal.querySelector('#mhc-blueprint-table-container');

    // Signature of the blueprint content that Stage 2 was last derived from
    const blueprintSignature = (bp) => bp ? JSON.stringify([bp.className, bp.hitDie, bp.levels]) : null;
    let lastSyncedBlueprintSig = blueprintSignature(activeBlueprint);

    const expandedTiers = new Set();
    let tiersInitialized = false;

    function renderBlueprintTable() {
        if (!tableContainer) return;
        const shimmerPresent = !!modal.querySelector('#mhc-blueprint-shimmer');
        if (shimmerPresent) {
            tableContainer.innerHTML = '';
            return;
        }

        if (!activeBlueprint || !activeBlueprint.levels) {
            tableContainer.innerHTML = '<div style="padding: 16px; color: #94a3b8; text-align: center;"><em>No progression codex available.</em></div>';
            return;
        }

        const curLvl = targetLevel || proposal.currentLevel || 1;
        const tiers = [
            { label: 'Tier 1', from: 1, to: 4 },
            { label: 'Tier 2', from: 5, to: 10 },
            { label: 'Tier 3', from: 11, to: 16 },
            { label: 'Tier 4', from: 17, to: 20 },
        ];
        const tierOf = (lvl) => tiers.findIndex(t => lvl >= t.from && lvl <= t.to);
        if (!tiersInitialized) {
            expandedTiers.add(tierOf(Math.min(20, Math.max(1, curLvl))));
            tiersInitialized = true;
        }

        const normalizedLevels = {};
        for (let lvl = 1; lvl <= 20; lvl++) {
            normalizedLevels[lvl] = normalizeLevelEntry(activeBlueprint.levels[String(lvl)] ?? activeBlueprint.levels[lvl], lvl);
        }
        // Only fall back to the classic ASI levels when the blueprint declares none itself
        const blueprintDeclaresAsi = Object.values(normalizedLevels).some(l => l.asi);

        let rowsHtml = '';
        tiers.forEach((tier, tierIdx) => {
            const open = expandedTiers.has(tierIdx);
            const tierFeatCount = Array.from({ length: tier.to - tier.from + 1 }, (_, k) => normalizedLevels[tier.from + k].features.length)
                .reduce((a, b) => a + b, 0);
            rowsHtml += `
            <tr class="mhc-tier-row" data-tier="${tierIdx}" style="cursor: pointer;">
                <td colspan="3">
                    <i class="fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-right'} mhc-tier-chevron"></i>
                    <strong>${tier.label}</strong> · Levels ${tier.from}–${tier.to}
                    <span style="opacity: 0.6; font-size: 0.85em;">(${tierFeatCount} abilities)</span>
                </td>
            </tr>`;

            for (let lvl = tier.from; lvl <= tier.to; lvl++) {
                const lvlData = normalizedLevels[lvl];
                const featuresArr = lvlData.features;
                const prof = lvlData.profBonus;

                let milestoneBadge = '';
                const isArchetype = lvlData.subclass
                    || (lvl === 3)
                    || featuresArr.some(f => /archetype|specialization/i.test(f));
                const isAsi = lvlData.asi || (!blueprintDeclaresAsi && [4, 8, 12, 16, 19].includes(lvl));
                if (isArchetype) {
                    milestoneBadge += '<span class="mhc-table-milestone mhc-milestone-archetype"><i class="fa-solid fa-star"></i> Archetype Specialization</span>';
                }
                if (isAsi) {
                    milestoneBadge += '<span class="mhc-table-milestone mhc-milestone-asi"><i class="fa-solid fa-gem"></i> ASI or Feat</span>';
                }
                if (lvl === 20) {
                    milestoneBadge += '<span class="mhc-table-milestone mhc-milestone-capstone"><i class="fa-solid fa-crown"></i> Capstone</span>';
                }

                const isCurrent = (lvl === curLvl);
                const rowClass = `mhc-blueprint-row${isCurrent ? ' mhc-row-current' : ''}`;
                const featsHtml = featuresArr.length > 0
                    ? featuresArr.map(f => {
                        const kind = classifyFeatureKind(f);
                        const kindBadge = kind === 'ability'
                            ? '<span class="mhc-kind-badge mhc-kind-ability" title="Active / Resource Power → routes to [ABILITIES] tracker"><i class="fa-solid fa-bolt"></i> Ability</span>'
                            : '<span class="mhc-kind-badge mhc-kind-trait" title="Passive Trait → routes to [CHARACTER] Traits">Trait</span>';
                        return `<div class="mhc-feat-line">${kindBadge}<span>${escapeHtml(f)}</span></div>`;
                    }).join('')
                    : (isAsi ? '' : '<span style="opacity: 0.4;">—</span>');

                rowsHtml += `
                <tr class="${rowClass}" data-tier="${tierIdx}" ${open ? '' : 'style="display: none;"'}>
                    <td class="mhc-td-lvl">
                        <span class="mhc-lvl-num">Level ${lvl}</span>
                        ${isCurrent ? '<span class="mhc-tag-current">Target</span>' : ''}
                    </td>
                    <td class="mhc-td-prof">+${prof}</td>
                    <td class="mhc-td-feats">
                        ${milestoneBadge}
                        ${featsHtml}
                    </td>
                </tr>`;
            }
        });

        tableContainer.innerHTML = `
        <table class="mhc-blueprint-table">
            <thead>
                <tr>
                    <th style="width: 18%;">Level</th>
                    <th style="width: 12%;">Prof</th>
                    <th style="width: 70%;">Features &amp; Milestones</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>`;

        // Collapse / expand tiers in place (no re-render, preserves scroll)
        tableContainer.querySelectorAll?.('.mhc-tier-row').forEach(headerRow => {
            headerRow.addEventListener('click', () => {
                const idx = parseInt(headerRow.getAttribute('data-tier'), 10);
                const nowOpen = !expandedTiers.has(idx);
                if (nowOpen) expandedTiers.add(idx); else expandedTiers.delete(idx);
                tableContainer.querySelectorAll(`.mhc-blueprint-row[data-tier="${idx}"]`).forEach(r => {
                    r.style.display = nowOpen ? '' : 'none';
                });
                const chev = headerRow.querySelector('.mhc-tier-chevron');
                if (chev) chev.className = `fa-solid ${nowOpen ? 'fa-chevron-down' : 'fa-chevron-right'} mhc-tier-chevron`;
            });
        });
    }

    renderBlueprintTable();

    // Stage 1 Manual Overview Controls Listeners
    const bpClassNameInput = modal.querySelector('#mhc_blueprint_class_name');
    const bpHitDieSelect = modal.querySelector('#mhc_blueprint_hitdie');

    bpClassNameInput?.addEventListener('input', () => {
        const val = bpClassNameInput.value.trim();
        if (val && activeBlueprint) {
            activeBlueprint.className = val;
            const badge = modal.querySelector('#mhc-blueprint-badge-class');
            if (badge) badge.textContent = val;
        }
    });

    bpHitDieSelect?.addEventListener('change', () => {
        const val = bpHitDieSelect.value;
        if (val && activeBlueprint) {
            activeBlueprint.hitDie = val;
            const badge = modal.querySelector('#mhc-blueprint-badge-hitdie');
            if (badge) badge.textContent = val;
        }
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 1: ARCHITECT CONCIERGE CHAT
    // ─────────────────────────────────────────────────────────────

    const stage1ChatLogEl = modal.querySelector('#mhc-stage1-chat-log');
    const stage1ReadyGreeting = `Greetings, ${proposal.characterName}! I am your RPG Systems Architect. Here is your complete 1–20 progression codex for the ${activeBlueprint?.className || proposal.className} class. You can review all 20 levels, customize abilities, change your Hit Die, or request thematic powers before proceeding. What would you like to refine?`;

    const stage1LoadingGreeting = `Greetings, ${proposal.characterName}! I am your RPG Systems Architect. I am actively drafting and balancing your 1–20 Progression Codex for the ${proposal.className} class right now. Please hold for just a few moments while I craft your progression roadmap...`;

    const stage1ChatHistory = [
        {
            role: 'assistant',
            content: isLoadingBlueprint ? stage1LoadingGreeting : stage1ReadyGreeting,
        },
    ];

    function renderStage1Chat() {
        if (!stage1ChatLogEl) return;
        stage1ChatLogEl.innerHTML = stage1ChatHistory.map(m => `
            <div class="mhc-chat-msg mhc-chat-${m.role}">
                <div class="mhc-chat-avatar"><i class="fa-solid ${m.role === 'assistant' ? 'fa-wand-magic-sparkles' : 'fa-user'}"></i></div>
                <div class="mhc-chat-bubble">${escapeHtml(m.content).replace(/\n{3,}/g, '\n\n').replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');
        stage1ChatLogEl.scrollTop = stage1ChatLogEl.scrollHeight;
    }
    renderStage1Chat();

    const stage1Input = modal.querySelector('#mhc_stage1_concierge_input');
    const stage1SendBtn = modal.querySelector('#mhc_stage1_concierge_send_btn');
    const stage1Typing = modal.querySelector('#mhc-stage1-typing');

    if (isLoadingBlueprint) {
        if (stage1Input) {
            stage1Input.disabled = true;
            stage1Input.placeholder = 'Architect is drafting your 1–20 Progression Codex...';
        }
        if (stage1SendBtn) stage1SendBtn.disabled = true;
        if (stage1Typing) {
            stage1Typing.style.display = 'flex';
            stage1Typing.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles fa-spin"></i> Architect is drafting your 1–20 Progression Codex...';
        }
    }

    /**
     * Applies roadmap-level directives ([UPDATE_LEVEL], [SET_HIT_DIE], [SET_CLASS_NAME], or a full JSON blueprint block)
     * from a Concierge reply in either Stage 1 or Stage 2.
     * Uses robust bracket-depth parsing so directives with internal brackets (e.g. [Trait] or [⚡ Ability])
     * are parsed completely rather than truncating at the first inner bracket.
     */
    function applyBlueprintDirectivesFromReply(reply) {
        if (!activeBlueprint || !activeBlueprint.levels || typeof reply !== 'string') return false;
        let modified = false;

        // 1. Check if the Concierge returned a full 1–20 JSON codeblock overhaul
        if (/```(?:json)?[\s\S]*?"levels"[\s\S]*?```/i.test(reply)) {
            const parsedFull = parseBlueprintFromResponse(
                reply,
                activeBlueprint.className || proposal.className,
                activeBlueprint.hitDie || proposal.hitDie || 'd8',
            );
            if (parsedFull && parsedFull.levels) {
                activeBlueprint = parsedFull;
                dossier.progressionBlueprint = activeBlueprint;
                modified = true;
            }
        }

        // 2. Parse bracket-safe directives
        const { directives } = extractConciergeDirectives(reply);
        for (const dir of directives) {
            if (dir.tag === 'UPDATE_LEVEL') {
                const pipeIdx = dir.payload.indexOf('|');
                if (pipeIdx > 0) {
                    const lvlStr = dir.payload.slice(0, pipeIdx).trim();
                    const featsRaw = dir.payload.slice(pipeIdx + 1).trim();
                    const lvlNum = parseInt(lvlStr, 10);
                    if (lvlNum >= 1 && lvlNum <= 20) {
                        const isClear = !featsRaw || /^(?:none|empty|clear|asi(?:\s*only)?|-|—)$/i.test(featsRaw);
                        const feats = isClear
                            ? []
                            : splitTopLevelDirectives(featsRaw, ';')
                                .map(f => f.trim())
                                .filter(f => f && !/^(?:none|empty|clear|-|—)$/i.test(f));
                        const entry = normalizeLevelEntry({ ...(activeBlueprint.levels[lvlStr] || {}), features: feats }, lvlNum);
                        if (!entry.spellSlots) delete entry.spellSlots;
                        activeBlueprint.levels[lvlStr] = entry;
                        modified = true;
                        if (typeof toastr !== 'undefined') toastr.info(entry.features.join(', ') || 'Cleared (ASI / Milestone)', `Level ${lvlStr} Updated`);
                    }
                }
            } else if (dir.tag === 'SET_HIT_DIE') {
                const hdMatch = dir.payload.match(/^(d6|d8|d10|d12)\b/i);
                if (hdMatch) {
                    const newHd = hdMatch[1].toLowerCase();
                    activeBlueprint.hitDie = newHd;
                    proposal.hitDie = newHd;
                    if (bpHitDieSelect) bpHitDieSelect.value = newHd;
                    const badge1 = modal.querySelector('#mhc-blueprint-badge-hitdie');
                    if (badge1) badge1.textContent = newHd;
                    const badge2 = modal.querySelector('#mhc-stage2-hitdie-badge');
                    if (badge2) badge2.innerHTML = `<i class="fa-solid fa-dice-d20"></i> Hit Die: ${escapeHtml(newHd)}`;
                    modified = true;
                    if (typeof toastr !== 'undefined') toastr.info(`Hit Die set to ${newHd}`, 'Hit Die Updated');
                }
            } else if (dir.tag === 'SET_CLASS_NAME') {
                const newName = dir.payload.trim();
                if (newName) {
                    activeBlueprint.className = newName;
                    proposal.className = newName;
                    if (bpClassNameInput) bpClassNameInput.value = newName;
                    const badge1 = modal.querySelector('#mhc-blueprint-badge-class');
                    if (badge1) badge1.textContent = newName;
                    const badge2 = modal.querySelector('#mhc-stage2-class-badge');
                    if (badge2) badge2.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${escapeHtml(newName)}`;
                    modified = true;
                    if (typeof toastr !== 'undefined') toastr.info(`Class renamed to ${newName}`, 'Class Updated');
                }
            }
        }

        if (modified) {
            dossier.progressionBlueprint = activeBlueprint;
            renderBlueprintTable();
            persistCompanionDossier(chatId, dossier);
        }
        return modified;
    }

    async function sendStage1ConciergeMessage(userText) {
        const text = userText?.trim();
        if (!text) return;

        stage1ChatHistory.push({ role: 'user', content: text });
        renderStage1Chat();

        if (stage1Input) {
            stage1Input.value = '';
            stage1Input.disabled = true;
        }
        if (stage1SendBtn) stage1SendBtn.disabled = true;
        if (stage1Typing) stage1Typing.style.display = 'flex';

        const stage1SystemPrompt = `You are the RPG Systems Architect designing the 1–20 Class Progression Codex for "${proposal.characterName}" (${activeBlueprint?.className || proposal.className}).
Character Stats: ${JSON.stringify(dossier?.protagonist?.stats || {})}
Hit Die: ${activeBlueprint?.hitDie || proposal.hitDie || 'd8'}
Established Sheet Traits ([CHARACTER]): ${initialSheetFeatures.join('; ') || 'None'}
Established Active Abilities ([ABILITIES]): ${(proposal.activeAbilities || []).join('; ') || 'None'}
Current 1–20 Progression Table (with current [Trait] vs [Ability] routing tags):
${formatBlueprintSummary(activeBlueprint, { includeTags: true })}

GUIDELINES (D&D LITE PHILOSOPHY & MULTIHOG PILL RENDERING):
1. Single-Track Progression: We use a streamlined single-track model from 1 to 20 with no rigid branching subclass trees or multi-class requirements.
2. MultiHog Interactive Pill Syntax & Trait vs. Ability Routing:
   - Every feature MUST be formatted as "Feature Name (concise hover tooltip description)".
   - Passive perks are tagged [Trait] and route to [CHARACTER] Traits (e.g. "[TRAIT] Shadow Veil (+2 to Stealth in dim light)").
   - Active/resource powers are tagged [⚡ Ability] and route to the [ABILITIES] tracker. Always include a two-number X/Y rest counter inside the parentheses (e.g. "1/1 per short rest" or "2/2 per long rest") or prefix with "[ABILITY]" so MultiHog renders the interactive resource badge!
   - NEVER use colons ("Name: description") or dashes ("Name - description") outside parentheses, and NEVER nest parentheses inside parentheses (use [brackets] inside parentheses if needed).
3. Dynamic Table Updates: When the player asks to change, fix, or customize abilities at any level (or audit all 20 levels), emit one [UPDATE_LEVEL] directive per modified level:
   [UPDATE_LEVEL: <level_number> | <Feature Name 1 (description)>; <Feature Name 2 (description; 1/1 per short rest)>]
   To clear an ASI-only level so it has no extra feature text, emit:
   [UPDATE_LEVEL: <level_number> | None]
   NEVER list HP gain, Hit Die, proficiency bonus, Ability Score Improvements, or spell slot counts as features: the engine tracks those separately.
4. Hit Die Updates: If the player asks to change their Hit Die (d6, d8, d10, or d12), emit:
   [SET_HIT_DIE: <d6|d8|d10|d12>]
5. Class Name Updates: If the player asks to rename the class, emit:
   [SET_CLASS_NAME: <New Class Name>]
6. Concise & Inspiring: Keep your spoken reply evocative, mechanically balanced, and concise (under 120 words), explaining what you modified.`;

        const messages = [
            { role: 'system', content: stage1SystemPrompt },
            ...stage1ChatHistory.slice(-6),
        ];

        try {
            const reply = await sendConciergeRequest(messages);
            if (stage1Typing) stage1Typing.style.display = 'none';
            if (stage1Input) stage1Input.disabled = false;
            if (stage1SendBtn) stage1SendBtn.disabled = false;
            stage1Input?.focus();

            applyBlueprintDirectivesFromReply(reply);
            const { cleanedText } = extractConciergeDirectives(reply);
            stage1ChatHistory.push({ role: 'assistant', content: cleanedText || reply });
            renderStage1Chat();
        } catch (err) {
            console.error('[MultiHog Companion] Stage 1 Concierge error:', err);
            if (stage1Typing) stage1Typing.style.display = 'none';
            if (stage1Input) stage1Input.disabled = false;
            if (stage1SendBtn) stage1SendBtn.disabled = false;
            stage1ChatHistory.push({
                role: 'assistant',
                content: `(The Class Architect is temporarily unreachable: ${err.message || 'Network issue'}. You can still inspect the table and proceed.)`,
            });
            renderStage1Chat();
        }
    }

    stage1SendBtn?.addEventListener('click', () => sendStage1ConciergeMessage(stage1Input?.value));
    stage1Input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendStage1ConciergeMessage(stage1Input?.value);
        }
    });

    modal.querySelectorAll('#mhc-stage1-quick-chips .mhc-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            if (prompt) sendStage1ConciergeMessage(prompt);
        });
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 2: LEVEL UP / RESPEC PERKS & CHAT
    // ─────────────────────────────────────────────────────────────

    const perksContainer = modal.querySelector('#mhc-perks-list-container');
    function renderPerksList() {
        if (!perksContainer) return;
        if (!proposal.newFeatures || proposal.newFeatures.length === 0) {
            perksContainer.innerHTML = `<li class="mhc-perk-item"><em>${isPbta ? 'Active Playbook Moves' : 'Stat & Vitality Progression'}</em></li>`;
            return;
        }

        // Determine origin badges for D&D respec
        let codexFeatKeys = new Set();
        if (!isPbta && isRespec && activeBlueprint?.levels) {
            for (let l = 1; l <= (proposal.currentLevel || targetLevel || 1); l++) {
                const feats = activeBlueprint.levels[String(l)]?.features || [];
                feats.forEach(f => codexFeatKeys.add(extractFeatureKey(f)));
            }
        }
        const sheetFeatKeys = new Set(initialSheetFeatures.map(f => extractFeatureKey(f)));

        perksContainer.innerHTML = proposal.newFeatures.map((f, idx) => {
            let originBadgeHtml = '';
            if (!isPbta && isRespec) {
                const fKey = extractFeatureKey(f);
                const inCodex = codexFeatKeys.has(fKey);
                const inSheet = sheetFeatKeys.has(fKey);
                if (inCodex && inSheet) {
                    originBadgeHtml = `<span class="mhc-trait-origin-badge mhc-trait-origin-harmonized" title="Integrated in both Roadmap Codex and Adventure Sheet">Harmonized</span>`;
                } else if (inCodex) {
                    originBadgeHtml = `<span class="mhc-trait-origin-badge mhc-trait-origin-codex" title="Derived from 1–20 Progression Codex">Codex</span>`;
                } else if (inSheet) {
                    originBadgeHtml = `<span class="mhc-trait-origin-badge mhc-trait-origin-sheet" title="Established on Adventure Character Sheet">Adventure Sheet</span>`;
                }
            }

            const moveBtnHtml = !isPbta
                ? `<button class="mhc-move-to-ability-btn" data-index="${idx}" title="Move to Active Abilities ([ABILITIES])" style="background:none; border:none; color:#60a5fa; cursor:pointer; font-size:0.95em; line-height:1; padding:0 4px;">&#8644;</button>`
                : '';

            return `
            <li class="mhc-perk-item" data-index="${idx}">
                <i class="fa-solid fa-star"></i>
                ${originBadgeHtml}
                <span class="mhc-perk-text" style="flex: 1;">${escapeHtml(f)}</span>
                ${moveBtnHtml}
                <button class="mhc-remove-perk-btn" data-index="${idx}" title="Remove feature" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1em; line-height:1; padding:0 4px;">&times;</button>
            </li>`;
        }).join('');

        perksContainer.querySelectorAll('.mhc-move-to-ability-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx) && idx >= 0 && idx < proposal.newFeatures.length) {
                    const [moved] = proposal.newFeatures.splice(idx, 1);
                    proposal.activeAbilities = mergeUpgradedFeatures(proposal.activeAbilities || [], [moved]);
                    renderPerksList();
                    renderAbilitiesList();
                }
            });
        });

        perksContainer.querySelectorAll('.mhc-remove-perk-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx) && idx >= 0 && idx < proposal.newFeatures.length) {
                    proposal.newFeatures.splice(idx, 1);
                    renderPerksList();
                }
            });
        });
    }
    renderPerksList();

    // Harmonization Buttons (D&D Respec)
    modal.querySelector('#mhc-sync-codex-traits-btn')?.addEventListener('click', () => {
        const syncLvl = proposal.currentLevel || targetLevel || 1;
        let codexFeats = collapseCodexProgression(activeBlueprint, syncLvl);
        if (codexFeats.length === 0 && activeBlueprint) {
            const conMod = Math.floor((((dossier?.protagonist?.stats?.CON ?? 10) - 10) / 2));
            const perks = getTierPerks(activeBlueprint, syncLvl, conMod);
            codexFeats = perks.features || [];
        }
        const { traits: codexTraits, abilities: codexAbilities } = partitionFeaturesAndAbilities(codexFeats);
        proposal.activeAbilities = mergeUpgradedFeatures(proposal.activeAbilities || [], codexAbilities);
        const activeKeys = new Set((proposal.activeAbilities || []).map(a => extractFeatureKey(a)).filter(Boolean));
        proposal.newFeatures = codexTraits.filter(t => !activeKeys.has(extractFeatureKey(t)));
        renderPerksList();
        renderAbilitiesList();
        if (typeof toastr !== 'undefined') {
            toastr.info(`Synchronized traits & active abilities from ${activeBlueprint?.className || 'Class'} Progression Codex.`, 'Codex Harmonizer');
        }
    });

    modal.querySelector('#mhc-restore-sheet-traits-btn')?.addEventListener('click', () => {
        proposal.newFeatures = initialSheetFeatures.length > 0 ? deduplicateFeatures(initialSheetFeatures) : [];
        renderPerksList();
        if (typeof toastr !== 'undefined') {
            toastr.info('Restored starting traits from adventure character sheet.', 'Sheet Harmonizer');
        }
    });

    // Active Abilities List ([ABILITIES] Module)
    const abilitiesContainer = modal.querySelector('#mhc-abilities-list-container');
    function renderAbilitiesList() {
        if (!abilitiesContainer) return;
        if (!proposal.activeAbilities || proposal.activeAbilities.length === 0) {
            abilitiesContainer.innerHTML = `<li class="mhc-perk-item"><em>No active resource abilities configured (all powers are passive or at-will)</em></li>`;
            return;
        }
        abilitiesContainer.innerHTML = proposal.activeAbilities.map((ab, idx) => `
            <li class="mhc-perk-item" data-index="${idx}">
                <i class="fa-solid fa-bolt" style="color: #60a5fa; margin-top: 2px;"></i>
                <span class="mhc-perk-text" style="flex: 1;">${escapeHtml(ab)}</span>
                <button class="mhc-move-to-trait-btn" data-index="${idx}" title="Move to Passive Traits ([CHARACTER])" style="background:none; border:none; color:#94a3b8; cursor:pointer; font-size:0.95em; line-height:1; padding:0 4px;">&#8644;</button>
                <button class="mhc-remove-ability-btn" data-index="${idx}" title="Remove active ability" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1em; line-height:1; padding:0 4px;">&times;</button>
            </li>
        `).join('');

        abilitiesContainer.querySelectorAll('.mhc-move-to-trait-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx) && idx >= 0 && idx < proposal.activeAbilities.length) {
                    const [moved] = proposal.activeAbilities.splice(idx, 1);
                    proposal.newFeatures = mergeUpgradedFeatures(proposal.newFeatures || [], [moved]);
                    renderPerksList();
                    renderAbilitiesList();
                }
            });
        });

        abilitiesContainer.querySelectorAll('.mhc-remove-ability-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx) && idx >= 0 && idx < proposal.activeAbilities.length) {
                    proposal.activeAbilities.splice(idx, 1);
                    renderAbilitiesList();
                }
            });
        });
    }
    renderAbilitiesList();

    const manualAbilityInput = modal.querySelector('#mhc_manual_ability_input');
    const manualAbilityAddBtn = modal.querySelector('#mhc_manual_ability_add_btn');
    const handleManualAbilityAdd = () => {
        const val = manualAbilityInput?.value?.trim();
        if (val) {
            proposal.activeAbilities = proposal.activeAbilities || [];
            const key = extractFeatureKey(val);
            const idx = proposal.activeAbilities.findIndex(a => extractFeatureKey(a) === key);
            if (idx >= 0) {
                proposal.activeAbilities[idx] = val;
            } else {
                proposal.activeAbilities.push(val);
            }
            renderAbilitiesList();
            if (manualAbilityInput) manualAbilityInput.value = '';
        }
    };
    manualAbilityAddBtn?.addEventListener('click', handleManualAbilityAdd);
    manualAbilityInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleManualAbilityAdd();
        }
    });

    // Hook up blueprint promise if generating asynchronously
    if (isLoadingBlueprint && blueprintPromise) {
        blueprintPromise.then((rawResolvedBlueprint) => {
            if (!_activeModalElement || _activeModalElement !== modal) return;
            const resolvedBlueprint = rawResolvedBlueprint ? normalizeBlueprint(rawResolvedBlueprint) : null;
            const shimmerEl = modal.querySelector('#mhc-blueprint-shimmer');
            if (shimmerEl) shimmerEl.remove();

            if (resolvedBlueprint) {
                activeBlueprint = resolvedBlueprint;
                lastSyncedBlueprintSig = blueprintSignature(resolvedBlueprint);
                dossier.progressionBlueprint = resolvedBlueprint;
                persistCompanionDossier(chatId, dossier);

                // Update Stage 1 Concierge message to ready greeting and re-enable input
                stage1ChatHistory[0] = {
                    role: 'assistant',
                    content: `Greetings, ${proposal.characterName}! I am your RPG Systems Architect. Your complete 1–20 progression codex for the ${resolvedBlueprint.className || proposal.className} class is ready! You can review all 20 levels in the roadmap above, customize abilities, change your Hit Die, or request thematic powers before proceeding. What would you like to refine?`,
                };
                renderStage1Chat();

                if (stage1Input) {
                    stage1Input.disabled = false;
                    stage1Input.placeholder = "Ask your architect, or request changes (e.g. 'Make level 6 a lightning teleport')...";
                }
                if (stage1SendBtn) stage1SendBtn.disabled = false;
                if (stage1Typing) {
                    stage1Typing.style.display = 'none';
                    stage1Typing.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles fa-spin"></i> Architect is updating your progression table...';
                }

                // Sync Stage 1 elements
                if (bpClassNameInput) bpClassNameInput.value = resolvedBlueprint.className || proposal.className;
                if (bpHitDieSelect && resolvedBlueprint.hitDie) bpHitDieSelect.value = resolvedBlueprint.hitDie;
                const hdBadge1 = modal.querySelector('#mhc-blueprint-badge-hitdie');
                if (hdBadge1 && resolvedBlueprint.hitDie) hdBadge1.textContent = resolvedBlueprint.hitDie;
                const classBadge1 = modal.querySelector('#mhc-blueprint-badge-class');
                if (classBadge1 && resolvedBlueprint.className) classBadge1.textContent = resolvedBlueprint.className;
                renderBlueprintTable();

                // Sync Stage 2 elements
                const conMod = Math.floor((((dossier?.protagonist?.stats?.CON ?? 10) - 10) / 2));
                const perks = getTierPerks(resolvedBlueprint, targetLevel || 1, conMod);

                if (resolvedBlueprint.hitDie) {
                    proposal.hitDie = resolvedBlueprint.hitDie;
                    const hdBadge2 = modal.querySelector('#mhc-stage2-hitdie-badge');
                    if (hdBadge2) hdBadge2.innerHTML = `<i class="fa-solid fa-dice-d20"></i> Hit Die: ${escapeHtml(proposal.hitDie)}`;
                }

                if (resolvedBlueprint.className) {
                    proposal.className = resolvedBlueprint.className;
                    const classBadge2 = modal.querySelector('#mhc-stage2-class-badge');
                    if (classBadge2) classBadge2.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${escapeHtml(proposal.className)}`;
                }

                const sheetKeys = new Set(initialSheetFeatures.map(f => extractFeatureKey(f)).filter(Boolean));
                if (isRespec) {
                    const codexFeats = collapseCodexProgression(resolvedBlueprint, targetLevel || 1);
                    const { traits: codexTraits, abilities: codexAbilities } = partitionFeaturesAndAbilities(codexFeats);
                    const routedAbilities = codexAbilities.filter(ab => !sheetKeys.has(extractFeatureKey(ab)));
                    if (routedAbilities.length > 0) {
                        proposal.activeAbilities = mergeUpgradedFeatures(proposal.activeAbilities || [], routedAbilities);
                    }
                    const activeKeys = new Set((proposal.activeAbilities || []).map(a => extractFeatureKey(a)).filter(Boolean));
                    proposal.newFeatures = deduplicateFeatures([
                        ...initialSheetFeatures,
                        ...codexTraits.filter(t => !activeKeys.has(extractFeatureKey(t))),
                    ]);
                    if (proposal.newFeatures.length === 0 && (proposal.activeAbilities || []).length === 0) {
                        proposal.newFeatures = perks.traits || perks.features || [];
                    }
                } else {
                    const { traits: lvlTraits, abilities: lvlAbilities } = partitionFeaturesAndAbilities(perks.features || []);
                    const onSheet = lvlAbilities.filter(ab => sheetKeys.has(extractFeatureKey(ab)));
                    const forTracker = lvlAbilities.filter(ab => !sheetKeys.has(extractFeatureKey(ab)));
                    proposal.newFeatures = deduplicateFeatures([...lvlTraits, ...onSheet]);
                    if (forTracker.length > 0) {
                        proposal.activeAbilities = mergeUpgradedFeatures(proposal.activeAbilities || [], forTracker);
                    }
                }
                renderPerksList();
                renderAbilitiesList();
                if (typeof toastr !== 'undefined') {
                    toastr.success(`Progression Codex crafted for ${proposal.className}!`, 'Concierge Codex');
                }
            } else {
                renderBlueprintTable();
                renderPerksList();
            }
        }).catch((err) => {
            console.warn('[MultiHog Companion] Blueprint promise error:', err);
            if (!_activeModalElement || _activeModalElement !== modal) return;
            const shimmerEl = modal.querySelector('#mhc-blueprint-shimmer');
            if (shimmerEl) shimmerEl.remove();
            if (stage1Input) {
                stage1Input.disabled = false;
                stage1Input.placeholder = "Ask your architect, or request changes...";
            }
            if (stage1SendBtn) stage1SendBtn.disabled = false;
            if (stage1Typing) stage1Typing.style.display = 'none';
            renderBlueprintTable();
            renderPerksList();
        });
    }

    // Manual Perk Add
    const manualPerkInput = modal.querySelector('#mhc_manual_perk_input');
    const manualPerkAddBtn = modal.querySelector('#mhc_manual_perk_add_btn');
    const handleManualAdd = () => {
        const rawVal = manualPerkInput?.value?.trim();
        if (rawVal) {
            const val = isPbta ? formatMoveAsPill(rawVal) : rawVal;
            proposal.newFeatures = proposal.newFeatures || [];
            const key = extractFeatureKey(val);
            const idx = proposal.newFeatures.findIndex(f => extractFeatureKey(f) === key);
            if (idx >= 0) {
                proposal.newFeatures[idx] = val;
            } else {
                proposal.newFeatures.push(val);
            }
            renderPerksList();
            if (manualPerkInput) manualPerkInput.value = '';
        }
    };
    manualPerkAddBtn?.addEventListener('click', handleManualAdd);
    manualPerkInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleManualAdd();
        }
    });

    // Stage 2 Concierge Chat History
    const chatLogEl = modal.querySelector('#mhc-concierge-chat-log');
    let initialGreeting = '';
    if (isPbta) {
        initialGreeting = isRespec
            ? `Greetings, ${proposal.characterName}! Welcome to your Playbook Tuning Desk. You are walking the path of ${proposal.playbookName || proposal.className}. Here we can review your Playbook Moves, rebalance stats (-1 to +3: ${pbtaStatNamesStr}), customize techniques, or adjust gear and conditions without D&D level constraints. How would you like to refine your playbook?`
            : `Greetings, ${proposal.characterName}! You have reached the milestone to advance your Playbook as ${proposal.playbookName || proposal.className}. Choose a Playbook Advance on the left, or ask me to craft custom Playbook Moves, advance your stats (${pbtaStatNamesStr}), or review your journey.`;
    } else {
        initialGreeting = isRespec
            ? `Greetings, ${proposal.characterName}! Welcome to the Respec & Tuning Desk. You are currently Level ${proposal.currentLevel}. Here we can review your traits, rebalance your combat techniques, customize abilities, or tweak your build without advancing your level. How would you like to refine your character?`
            : `Greetings, ${proposal.characterName}! You have reached the milestone to advance to Level ${proposal.targetLevel} as a ${proposal.className}. I am at your service to review your new features, recommend feats, or customize unique techniques for your journey.`;
    }

    const stage2ChatHistory = [
        {
            role: 'assistant',
            content: initialGreeting,
        },
    ];

    function renderStage2Chat() {
        if (!chatLogEl) return;
        chatLogEl.innerHTML = stage2ChatHistory.map(m => `
            <div class="mhc-chat-msg mhc-chat-${m.role}">
                <div class="mhc-chat-avatar"><i class="fa-solid ${m.role === 'assistant' ? 'fa-wand-magic-sparkles' : 'fa-user'}"></i></div>
                <div class="mhc-chat-bubble">${escapeHtml(m.content).replace(/\n{3,}/g, '\n\n').replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');
        chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }
    renderStage2Chat();

    const conciergeInput = modal.querySelector('#mhc_concierge_input');
    const conciergeSendBtn = modal.querySelector('#mhc_concierge_send_btn');
    const conciergeTyping = modal.querySelector('#mhc-concierge-typing');

    async function sendStage2ConciergeMessage(userText) {
        const text = userText?.trim();
        if (!text) return;

        stage2ChatHistory.push({ role: 'user', content: text });
        renderStage2Chat();

        if (conciergeInput) {
            conciergeInput.value = '';
            conciergeInput.disabled = true;
        }
        if (conciergeSendBtn) conciergeSendBtn.disabled = true;
        if (conciergeTyping) conciergeTyping.style.display = 'flex';

        const systemPrompt = isPbta ? `You are the Playbook Guide and PbtA narrative systems architect for "${proposal.characterName}", playing the "${proposal.playbookName || proposal.className}" playbook.
Character Stats: ${JSON.stringify(proposal.stats || dossier?.protagonist?.stats || {})}
Harm Capacity: ${proposal.harm?.max || 4} | Current Harm: ${proposal.harm?.current || 0} | Armor: ${proposal.harm?.armor ?? 1}
Active Playbook Moves: ${proposal.newFeatures.join('; ')}
Active Conditions: ${(proposal.conditions || []).join(', ') || 'None'}

STRICT PbtA ARCHITECTURAL RULES:
1. PURE PbtA RULES ONLY: Disadvantage DOES NOT EXIST in PbtA. There are NO D&D levels (1-20), NO Hit Dice (d6, d8, d10, d12), NO HP rolls, NO Armor Class (AC), NO DC saving throws, and NO spell slots. NEVER use D&D terminology.
2. Moves & Mechanics: All moves must have a clear fictional trigger, specify which stat to roll (-1 to +3: ${pbtaStatNamesStr}), and detail outcomes for 10+ (strong hit), 7-9 (weak hit / compromise), and 6- (miss / GM move). You may use "+1 forward" or "-1 forward" or "hold".
3. Dynamic Move Tweaking: When suggesting or granting a new move, emit:
   [ADD_FEATURE: Move Name [+STAT] (When [trigger], roll +[STAT]. On a 10+, [strong hit]. On a 7-9, [weak hit].)]
4. Move Removal: If the user asks to remove a move, emit:
   [REMOVE_FEATURE: Move Name]
5. Stat Updates: If the user asks to adjust a stat (between -2 and +3), emit:
   [SET_STAT: StatName | +Value]
6. Concise & Atmospheric: Keep your response evocative, narrative, mechanically sharp, and under 130 words.`
        : `You are the Level-Up Concierge and RPG systems architect for "${proposal.characterName}", a Level ${proposal.currentLevel} ${proposal.className} advancing to Level ${proposal.targetLevel}.
Character Stats: ${JSON.stringify(dossier?.protagonist?.stats || {})}
Hit Die: ${proposal.hitDie}

CURRENT SHEETS & ABILITIES AUDIT:
- PASSIVE TRAITS ([CHARACTER] sheet):
  ${proposal.newFeatures.join('; ') || 'None'}
- ACTIVE ABILITIES ([ABILITIES] resource tracker):
  ${(proposal.activeAbilities || []).join('; ') || 'None'}
- 1–20 CLASS PROGRESSION ROADMAP (with [Trait] vs [Ability] routing tags):
${formatBlueprintSummary(activeBlueprint, { includeTags: true })}

ARCHITECTURAL RULES (DECIDING WHERE AN ABILITY GOES & AUDITING):
1. Where It Goes — The Golden Rule:
   - Passive Traits ([CHARACTER] Traits): Belongs here if it is a passive skill bonus (e.g. "+2 to Stealth"), environmental/survival perk, sensory advantage (Darkvision), background lore, or constant at-will bonus with NO usage counter.
   - Active Abilities ([ABILITIES] Block): Belongs here if it is an active combat/tactical action, has limited uses per rest (e.g. "1/1 per short rest", "2/2 per long rest"), triggered reactions, or forces enemy saving throws (e.g. "Ref DC 13").
2. Explicit Permission to Audit & Fix Duplicates:
   - You have FULL PERMISSION to audit both lists and the 1–20 Roadmap. If you spot duplicates (e.g. the same mechanic under two different names like "Bad Luck Bearer" in Traits and "Misfortune Gambit" in Abilities), or if an ability is misplaced (e.g. an active limited-use power stuck in passive Traits), clearly explain the distinction and fix it immediately using the command tags below!
   - IMPORTANT: All existing features listed above are KEPT BY DEFAULT. Do NOT emit add commands for features that are already listed unless updating their wording.
3. Directives for Updating Build & 1–20 Roadmap:
   - To add a NEW passive trait: [ADD_FEATURE: Trait Name (constant benefit)]
   - To update/refine an existing passive trait: [UPDATE_FEATURE: Trait Name | Trait Name (constant benefit)]
   - To remove a passive trait: [REMOVE_FEATURE: Trait Name]
   - To add a NEW active/resource power: [ADD_ABILITY: Ability Name (trigger/effect; uses/max per rest)]
   - To update/refine an existing active ability: [UPDATE_ABILITY: Ability Name | Ability Name (trigger/effect; uses/max per rest)]
   - To remove an active power: [REMOVE_ABILITY: Ability Name]
   - To relocate a misplaced passive trait into active abilities: [MOVE_TO_ABILITIES: Trait Name]
   - To relocate an active ability into passive traits: [MOVE_TO_FEATURES: Ability Name]
   - To update any level (1–20) of the Class Progression Roadmap: [UPDATE_LEVEL: <level_number> | <Feature Name 1 (description)>; <Feature Name 2 (description; 1/1 per short rest)>] (or [UPDATE_LEVEL: <level_number> | None] to clear an ASI-only level)
4. CRITICAL FORMATTING REQUIREMENT (MULTIHOG PILL RENDERER):
   - MultiHog renders both [CHARACTER] Traits and [ABILITIES] entries as interactive hover-pills using the exact syntax: Name (hover tooltip description).
   - EVERY ability and trait MUST begin with its title/name, followed by its mechanical effect and any X/Y rest counter INSIDE parentheses so MultiHog extracts the X/Y resource badge and places the description into the hover tooltip.
   - NEVER use colons ("Name: description") or dashes ("Name - description") outside parentheses, and NEVER nest parentheses inside parentheses (use [brackets] inside parentheses if needed).
   - Example Active Power: Misfortune Gambit (Reroll a failed check from critical misfortune; 1/1 per long rest)
   - Example Passive Perk: Street Rat (+2 to Stealth in urban districts)
5. Single-Track Progression: Streamlined D&D Lite model. No rigid subclass branching. The class remains "${proposal.className}".
6. Concise & Inspiring: Keep your spoken reply evocative, clear, and under 130 words.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...stage2ChatHistory.slice(-6),
        ];

        try {
            const reply = await sendConciergeRequest(messages);
            if (conciergeTyping) conciergeTyping.style.display = 'none';
            if (conciergeInput) conciergeInput.disabled = false;
            if (conciergeSendBtn) conciergeSendBtn.disabled = false;
            conciergeInput?.focus();

            const { directives, cleanedText } = extractConciergeDirectives(reply);

            for (const dir of directives) {
                if (dir.tag === 'ADD_FEATURE') {
                    const rawFeat = dir.payload.trim();
                    const feat = isPbta ? formatMoveAsPill(rawFeat) : formatTraitAsPill(rawFeat);
                    if (feat) {
                        const key = extractFeatureKey(feat);
                        const idx = proposal.newFeatures.findIndex(f => extractFeatureKey(f) === key);
                        if (idx >= 0) {
                            proposal.newFeatures[idx] = feat;
                        } else {
                            proposal.newFeatures.push(feat);
                            if (typeof toastr !== 'undefined') toastr.info(feat, isPbta ? 'Added New Move' : 'Added New Trait');
                        }
                    }
                } else if (dir.tag === 'UPDATE_FEATURE') {
                    const pipeIdx = dir.payload.indexOf('|');
                    if (pipeIdx > 0) {
                        const featureName = dir.payload.slice(0, pipeIdx).trim();
                        const targetKey = extractFeatureKey(featureName);
                        const rawNewText = ensureNamedFeature(featureName, dir.payload.slice(pipeIdx + 1).trim());
                        const newText = isPbta ? formatMoveAsPill(rawNewText) : formatTraitAsPill(rawNewText);
                        const idx = proposal.newFeatures.findIndex(f => extractFeatureKey(f) === targetKey);
                        if (idx >= 0) {
                            proposal.newFeatures[idx] = newText;
                        } else {
                            proposal.newFeatures.push(newText);
                        }
                    }
                } else if (dir.tag === 'SET_STAT' && isPbta && proposal.stats) {
                    const pipeIdx = dir.payload.indexOf('|');
                    if (pipeIdx > 0) {
                        const statRaw = dir.payload.slice(0, pipeIdx).trim();
                        const statVal = Math.max(-2, Math.min(3, parseInt(dir.payload.slice(pipeIdx + 1).trim(), 10)));
                        const matchKey = Object.keys(proposal.stats).find(k => k.toLowerCase() === statRaw.toLowerCase()) || statRaw;
                        if (!isNaN(statVal)) {
                            proposal.stats[matchKey] = statVal;
                            const statInput = modal.querySelector(`.mhc-pbta-stat-input[data-stat="${matchKey}"]`);
                            if (statInput) statInput.value = String(statVal);
                            const statDisp = modal.querySelector(`[data-stat-val="${matchKey}"]`);
                            if (statDisp) statDisp.textContent = statVal >= 0 ? `+${statVal}` : String(statVal);
                        }
                    }
                } else if (dir.tag === 'REMOVE_FEATURE') {
                    proposal.newFeatures = proposal.newFeatures.filter(f => !matchesFeatureRemovalTarget(f, dir.payload));
                } else if (dir.tag === 'ADD_ABILITY') {
                    proposal.activeAbilities = proposal.activeAbilities || [];
                    const ab = formatTraitAsPill(dir.payload.trim());
                    if (ab) {
                        const key = extractFeatureKey(ab);
                        const idx = proposal.activeAbilities.findIndex(a => extractFeatureKey(a) === key);
                        if (idx >= 0) {
                            proposal.activeAbilities[idx] = ab;
                        } else {
                            proposal.activeAbilities.push(ab);
                            if (typeof toastr !== 'undefined') toastr.info(ab, 'Added Active Ability');
                        }
                    }
                } else if (dir.tag === 'UPDATE_ABILITY') {
                    const pipeIdx = dir.payload.indexOf('|');
                    if (pipeIdx > 0) {
                        const abilityName = dir.payload.slice(0, pipeIdx).trim();
                        const targetKey = extractFeatureKey(abilityName);
                        const newText = formatTraitAsPill(ensureNamedFeature(abilityName, dir.payload.slice(pipeIdx + 1).trim()));
                        const idx = proposal.activeAbilities.findIndex(a => extractFeatureKey(a) === targetKey);
                        if (idx >= 0) {
                            proposal.activeAbilities[idx] = newText;
                        } else {
                            proposal.activeAbilities.push(newText);
                        }
                    }
                } else if (dir.tag === 'REMOVE_ABILITY') {
                    proposal.activeAbilities = proposal.activeAbilities.filter(a => !matchesFeatureRemovalTarget(a, dir.payload));
                } else if (dir.tag === 'MOVE_TO_ABILITIES') {
                    const targetKey = extractFeatureKey(dir.payload);
                    const foundIdx = proposal.newFeatures.findIndex(f => extractFeatureKey(f) === targetKey);
                    if (foundIdx >= 0) {
                        const movedItem = proposal.newFeatures.splice(foundIdx, 1)[0];
                        if (!proposal.activeAbilities.some(a => extractFeatureKey(a) === targetKey)) {
                            proposal.activeAbilities.push(movedItem);
                        }
                        if (typeof toastr !== 'undefined') toastr.info(movedItem, 'Relocated to Active Powers');
                    }
                } else if (dir.tag === 'MOVE_TO_FEATURES') {
                    const targetKey = extractFeatureKey(dir.payload);
                    const foundIdx = proposal.activeAbilities.findIndex(a => extractFeatureKey(a) === targetKey);
                    if (foundIdx >= 0) {
                        const movedItem = proposal.activeAbilities.splice(foundIdx, 1)[0];
                        if (!proposal.newFeatures.some(f => extractFeatureKey(f) === targetKey)) {
                            proposal.newFeatures.push(movedItem);
                        }
                        if (typeof toastr !== 'undefined') toastr.info(movedItem, 'Relocated to Passive Traits');
                    }
                }
            }

            if (!isPbta) {
                applyBlueprintDirectivesFromReply(reply);
            }

            proposal.newFeatures = deduplicateFeatures(proposal.newFeatures);
            proposal.activeAbilities = deduplicateFeatures(proposal.activeAbilities);

            renderPerksList();
            renderAbilitiesList();

            stage2ChatHistory.push({ role: 'assistant', content: cleanedText || reply });
            renderStage2Chat();
        } catch (err) {
            console.error('[MultiHog Companion] Concierge chat error:', err);
            if (conciergeTyping) conciergeTyping.style.display = 'none';
            if (conciergeInput) conciergeInput.disabled = false;
            if (conciergeSendBtn) conciergeSendBtn.disabled = false;
            stage2ChatHistory.push({
                role: 'assistant',
                content: `(The Leveling Guide is temporarily unreachable: ${err.message || 'Network issue'}. You can still manually customize your abilities and confirm.)`,
            });
            renderStage2Chat();
        }
    }

    conciergeSendBtn?.addEventListener('click', () => sendStage2ConciergeMessage(conciergeInput?.value));
    conciergeInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendStage2ConciergeMessage(conciergeInput?.value);
        }
    });

    modal.querySelectorAll('#mhc-stage-advancement .mhc-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            if (prompt) sendStage2ConciergeMessage(prompt);
        });
    });

    // ─────────────────────────────────────────────────────────────
    // TWO-STAGE NAVIGATION & TRANSITIONS
    // ─────────────────────────────────────────────────────────────

    const s1View = modal.querySelector('#mhc-stage-definition');
    const s2View = modal.querySelector('#mhc-stage-advancement');

    function switchStage(targetStage) {
        if (targetStage === 2) {
            // Sync Stage 1 configuration into activeBlueprint & proposal
            if (activeBlueprint) {
                if (bpClassNameInput?.value?.trim()) {
                    activeBlueprint.className = bpClassNameInput.value.trim();
                }
                if (bpHitDieSelect?.value) {
                    activeBlueprint.hitDie = bpHitDieSelect.value;
                }
                dossier.progressionBlueprint = activeBlueprint;
                if (dossier.protagonist) {
                    if (activeBlueprint.className) dossier.protagonist.class = activeBlueprint.className;
                    if (activeBlueprint.hitDie) dossier.protagonist.hitDie = activeBlueprint.hitDie;
                }
                persistCompanionDossier(chatId, dossier);

                // Only re-derive Stage 2 features/HP when the blueprint actually changed since the last sync.
                // Otherwise keep the user's Stage 2 edits (added/removed features, HP roll) intact.
                const blueprintChanged = blueprintSignature(activeBlueprint) !== lastSyncedBlueprintSig;
                lastSyncedBlueprintSig = blueprintSignature(activeBlueprint);

                proposal.hitDie = activeBlueprint.hitDie;
                proposal.className = activeBlueprint.className;

                const hdBadge = modal.querySelector('#mhc-stage2-hitdie-badge');
                if (hdBadge) hdBadge.innerHTML = `<i class="fa-solid fa-dice-d20"></i> Hit Die: ${escapeHtml(proposal.hitDie)}`;
                const classBadge = modal.querySelector('#mhc-stage2-class-badge');
                if (classBadge) classBadge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${escapeHtml(proposal.className)}`;

                const conMod = Math.floor((((dossier?.protagonist?.stats?.CON ?? 10) - 10) / 2));
                const perks = getTierPerks(activeBlueprint, targetLevel || 1, conMod);

                const sheetKeys = new Set(initialSheetFeatures.map(f => extractFeatureKey(f)).filter(Boolean));
                if (!blueprintChanged) {
                    // Nothing to re-derive: preserve Stage 2 edits
                } else if (isRespec) {
                    const codexFeats = collapseCodexProgression(activeBlueprint, targetLevel || 1);
                    const { traits: codexTraits, abilities: codexAbilities } = partitionFeaturesAndAbilities(codexFeats);
                    const routedAbilities = codexAbilities.filter(ab => !sheetKeys.has(extractFeatureKey(ab)));
                    if (routedAbilities.length > 0) {
                        proposal.activeAbilities = mergeUpgradedFeatures(proposal.activeAbilities || [], routedAbilities);
                    }
                    const activeKeys = new Set((proposal.activeAbilities || []).map(a => extractFeatureKey(a)).filter(Boolean));
                    proposal.newFeatures = deduplicateFeatures([
                        ...initialSheetFeatures,
                        ...codexTraits.filter(t => !activeKeys.has(extractFeatureKey(t))),
                    ]);
                    if (proposal.newFeatures.length === 0 && (proposal.activeAbilities || []).length === 0) {
                        proposal.newFeatures = perks.traits || perks.features || [];
                    }
                } else {
                    const { traits: lvlTraits, abilities: lvlAbilities } = partitionFeaturesAndAbilities(perks.features || []);
                    const onSheet = lvlAbilities.filter(ab => sheetKeys.has(extractFeatureKey(ab)));
                    const forTracker = lvlAbilities.filter(ab => !sheetKeys.has(extractFeatureKey(ab)));
                    proposal.newFeatures = deduplicateFeatures([...lvlTraits, ...onSheet]);
                    if (forTracker.length > 0) {
                        proposal.activeAbilities = mergeUpgradedFeatures(proposal.activeAbilities || [], forTracker);
                    }
                    if (proposal.hpChange) {
                        proposal.hpChange.gain = perks.averageHpGain;
                        proposal.hpChange.newMax = (proposal.hpChange.oldMax || 0) + perks.averageHpGain;
                        currentHpGain = perks.averageHpGain;
                        modal.querySelector('#mhc-hp-roll-btn')?.classList.remove('active');
                        modal.querySelector('#mhc-hp-avg-btn')?.classList.add('active');
                        const avgBtn = modal.querySelector('#mhc-hp-avg-btn');
                        if (avgBtn) avgBtn.textContent = `Take Average (+${perks.averageHpGain})`;
                        const hpDisp = modal.querySelector('#mhc-new-hp-display');
                        if (hpDisp) hpDisp.textContent = String(proposal.hpChange.newMax);
                    }
                }
                renderPerksList();
                renderAbilitiesList();
            }

            if (s1View) s1View.style.display = 'none';
            if (s2View) s2View.style.display = 'flex';
            currentStage = 2;
        } else {
            renderBlueprintTable();
            if (s2View) s2View.style.display = 'none';
            if (s1View) s1View.style.display = 'flex';
            currentStage = 1;
        }
    }

    // Stage 1 -> Stage 2 Proceed Button
    modal.querySelector('#mhc-proceed-to-stage2-btn')?.addEventListener('click', () => {
        switchStage(2);
    });

    // Stage 2 -> Stage 1 Return Button
    modal.querySelector('#mhc-switch-to-stage1-btn')?.addEventListener('click', () => {
        switchStage(1);
    });

    // Close and Cancel buttons across both stages
    const handleClose = () => closeLevelUpModal();
    modal.querySelector('#mhc-stage1-close-btn')?.addEventListener('click', handleClose);
    modal.querySelector('#mhc-stage2-close-btn')?.addEventListener('click', handleClose);
    modal.querySelector('#mhc-stage1-cancel-btn')?.addEventListener('click', handleClose);
    modal.querySelector('#mhc-stage2-cancel-btn')?.addEventListener('click', handleClose);

    // HP Roll and Avg toggles
    const hpAvgBtn = modal.querySelector('#mhc-hp-avg-btn');
    const hpRollBtn = modal.querySelector('#mhc-hp-roll-btn');
    const hpDisplay = modal.querySelector('#mhc-new-hp-display');
    const featSelect = modal.querySelector('#mhc_feat_select');
    const customFeatInput = modal.querySelector('#mhc_custom_feat_input');

    let currentHpGain = proposal.hpChange?.gain || 0;
    hpRollBtn?.addEventListener('click', () => {
        hpAvgBtn?.classList.remove('active');
        hpRollBtn?.classList.add('active');
        const dieSides = parseInt((proposal.hitDie || 'd8').replace(/\D/g, ''), 10) || 8;
        const rolled = Math.floor(Math.random() * dieSides) + 1;
        // Same formula as "Take Average": die + CON modifier (min 1 HP per level)
        const rollConMod = Math.floor((((dossier?.protagonist?.stats?.CON ?? 10) - 10) / 2));
        currentHpGain = Math.max(1, rolled + rollConMod);
        if (hpDisplay) hpDisplay.textContent = String((proposal.hpChange?.oldMax || 0) + currentHpGain);
    });

    hpAvgBtn?.addEventListener('click', () => {
        hpRollBtn?.classList.remove('active');
        hpAvgBtn?.classList.add('active');
        currentHpGain = proposal.hpChange?.gain || 0;
        if (hpDisplay) hpDisplay.textContent = String((proposal.hpChange?.oldMax || 0) + currentHpGain);
    });

    featSelect?.addEventListener('change', () => {
        if (customFeatInput) {
            customFeatInput.style.display = featSelect.value === 'custom' ? 'block' : 'none';
        }
    });

    // PbtA Harm, Armor, Stats & Advance Picker controls
    if (isPbta) {
        const harmMaxInput = modal.querySelector('#mhc_pbta_harm_max_input');
        const armorInput = modal.querySelector('#mhc_pbta_armor_input');
        const harmMaxValEl = modal.querySelector('#mhc-pbta-harm-max-val');
        const harmBadgeEl = modal.querySelector('#mhc-pbta-harm-badge');
        const armorBadgeEl = modal.querySelector('#mhc-pbta-armor-badge');

        harmMaxInput?.addEventListener('change', () => {
            const v = Math.max(2, Math.min(8, parseInt(harmMaxInput.value, 10) || 4));
            harmMaxInput.value = String(v);
            proposal.harm = proposal.harm || { current: 0, max: 4, armor: 1 };
            proposal.harm.max = v;
            if (harmMaxValEl) harmMaxValEl.textContent = String(v);
            if (harmBadgeEl) harmBadgeEl.innerHTML = `<i class="fa-solid fa-heart-crack"></i> Harm Capacity: ${v}`;
        });

        armorInput?.addEventListener('change', () => {
            const v = Math.max(0, Math.min(4, parseInt(armorInput.value, 10) || 0));
            armorInput.value = String(v);
            proposal.harm = proposal.harm || { current: 0, max: 4, armor: 1 };
            proposal.harm.armor = v;
            if (armorBadgeEl) armorBadgeEl.innerHTML = `<i class="fa-solid fa-shield"></i> Armor: ${v}`;
        });

        modal.querySelectorAll('.mhc-pbta-stat-input').forEach(inp => {
            inp.addEventListener('change', () => {
                const statName = inp.getAttribute('data-stat');
                const v = Math.max(-2, Math.min(3, parseInt(inp.value, 10) || 0));
                inp.value = String(v);
                if (statName && proposal.stats) {
                    proposal.stats[statName] = v;
                }
            });
        });

        // Toggle detail sub-panels when switching PbtA Advance radio options
        const advRadios = modal.querySelectorAll('input[name="mhc_pbta_advance_pick"]');
        advRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                const chosen = modal.querySelector('input[name="mhc_pbta_advance_pick"]:checked')?.value;
                modal.querySelectorAll('.mhc-pbta-adv-detail').forEach(det => {
                    const id = det.getAttribute('data-adv-detail');
                    det.style.display = id === chosen ? (id === 'stat_boost' ? 'block' : 'flex') : 'none';
                });
            });
        });

        const pbtaMoveSelect = modal.querySelector('#mhc_pbta_move_select');
        const pbtaCustomMoveInput = modal.querySelector('#mhc_pbta_custom_move_input');
        pbtaMoveSelect?.addEventListener('change', () => {
            if (!pbtaCustomMoveInput) return;
            if (pbtaMoveSelect.value === 'custom') {
                pbtaCustomMoveInput.value = '';
                pbtaCustomMoveInput.focus();
            } else {
                pbtaCustomMoveInput.value = pbtaMoveSelect.value;
            }
        });

        const pbtaCrossSelect = modal.querySelector('#mhc_pbta_cross_move_select');
        const pbtaCustomCrossInput = modal.querySelector('#mhc_pbta_custom_cross_move_input');
        pbtaCrossSelect?.addEventListener('change', () => {
            if (!pbtaCustomCrossInput) return;
            if (pbtaCrossSelect.value === 'custom') {
                pbtaCustomCrossInput.value = '';
                pbtaCustomCrossInput.focus();
            } else {
                pbtaCustomCrossInput.value = pbtaCrossSelect.value;
            }
        });
    }

    // Confirm & Apply Advancement
    const confirmBtn = modal.querySelector('#mhc-confirm-apply-btn');
    confirmBtn?.addEventListener('click', () => {
        if (isPbta && !isRespec) {
            const selectedAdvType = modal.querySelector('input[name="mhc_pbta_advance_pick"]:checked')?.value;
            if (selectedAdvType === 'stat_boost') {
                const statVal = modal.querySelector('#mhc_pbta_stat_select')?.value || pbtaStatNames[0];
                proposal.pbtaAdvance = { type: 'stat_boost', stat: statVal, amount: 1 };
            } else if (selectedAdvType === 'playbook_move') {
                const moveVal = modal.querySelector('#mhc_pbta_custom_move_input')?.value?.trim()
                    || (modal.querySelector('#mhc_pbta_move_select')?.value !== 'custom' ? modal.querySelector('#mhc_pbta_move_select')?.value : '')
                    || '';
                proposal.pbtaAdvance = { type: 'playbook_move', move: moveVal };
            } else if (selectedAdvType === 'cross_playbook_move') {
                const crossVal = modal.querySelector('#mhc_pbta_custom_cross_move_input')?.value?.trim()
                    || (modal.querySelector('#mhc_pbta_cross_move_select')?.value !== 'custom' ? modal.querySelector('#mhc_pbta_cross_move_select')?.value : '')
                    || '';
                proposal.pbtaAdvance = { type: 'cross_playbook_move', move: crossVal };
            } else if (selectedAdvType === 'harm_capacity') {
                proposal.pbtaAdvance = { type: 'harm_capacity', amount: 1 };
            } else if (selectedAdvType === 'armor_training') {
                proposal.pbtaAdvance = { type: 'armor_training', amount: 1 };
            }
            if (proposal.pbtaAdvance) {
                applyPbtaAdvanceSelection(proposal, proposal.pbtaAdvance);
            }
        }

        const selectedAsiRadio = modal.querySelector('input[name="mhc_asi_pick"]:checked')?.value;
        let asiChoice = null;
        if (selectedAsiRadio === 'optionA') {
            asiChoice = proposal.asiOptions?.optionA;
        } else if (selectedAsiRadio === 'optionB') {
            asiChoice = proposal.asiOptions?.optionB;
        } else if (selectedAsiRadio === 'feat') {
            const featVal = featSelect?.value === 'custom'
                ? (customFeatInput?.value?.trim() || 'Custom Feat')
                : (featSelect?.value || 'Feat');
            asiChoice = { type: 'feat', featName: featVal };
            proposal.newFeatures = [...(proposal.newFeatures || []), `Feat: ${featVal}`];
        }

        const partySyncChk = modal.querySelector('#mhc_party_sync_chk');
        const includeParty = partySyncChk ? partySyncChk.checked : true;

        if (proposal.hpChange) {
            proposal.hpChange.gain = currentHpGain;
            proposal.hpChange.newMax = (proposal.hpChange.oldMax || 0) + currentHpGain;
        }
        proposal.asiChoice = asiChoice;
        if (!includeParty) proposal.partyChanges = [];

        const currentMemo = rpgSettings?.currentMemo || '';
        const commitResult = applyLevelUpCommit({
            chatId,
            currentMemo,
            proposal,
            isRespec,
            rpgSettings,
        });

        if (commitResult.success) {
            if (dossier?.protagonist) {
                if (isPbta) {
                    dossier.protagonist.moves = [...(proposal.newFeatures || [])];
                    if (proposal.harm) dossier.protagonist.harm = { ...proposal.harm };
                    if (proposal.stats) dossier.protagonist.stats = { ...proposal.stats };
                    if (Array.isArray(proposal.advancesTaken)) dossier.protagonist.advancesTaken = [...proposal.advancesTaken];
                } else {
                    if (!isRespec) {
                        dossier.protagonist.level = proposal.targetLevel;
                    }
                    if (proposal.hpChange?.newMax) {
                        dossier.protagonist.hp = dossier.protagonist.hp || {};
                        // Mirror the memo commit: current HP rises by the gain (0 is a valid current HP)
                        const priorCurrent = Number.isFinite(dossier.protagonist.hp.current)
                            ? dossier.protagonist.hp.current
                            : (proposal.hpChange.oldMax || 0);
                        dossier.protagonist.hp.max = proposal.hpChange.newMax;
                        dossier.protagonist.hp.current = Math.min(
                            proposal.hpChange.newMax,
                            priorCurrent + Math.max(0, currentHpGain)
                        );
                    }
                    if (proposal.newFeatures && Array.isArray(proposal.newFeatures)) {
                        dossier.protagonist.features = isRespec
                            ? [...proposal.newFeatures]
                            : [ ...new Set([...(dossier.protagonist.features || []), ...proposal.newFeatures]) ];
                    }
                    if (proposal.activeAbilities && Array.isArray(proposal.activeAbilities)) {
                        dossier.protagonist.abilities = [...proposal.activeAbilities];
                    }
                }
            }

            persistCompanionDossier(chatId, dossier);

            if (typeof toastr !== 'undefined') {
                const successMsg = isPbta
                    ? (isRespec ? 'Playbook moves and harm clocks updated!' : `Playbook advanced for ${proposal.characterName}!`)
                    : (isRespec ? `Build changes saved for ${proposal.characterName} (Level ${proposal.currentLevel})!` : `Advanced to Level ${proposal.targetLevel}!`);
                toastr.success(successMsg, 'Level-Up Engine');
            }

            closeLevelUpModal();
            if (typeof onComplete === 'function') onComplete(commitResult);
        } else {
            if (typeof toastr !== 'undefined') {
                toastr.error(commitResult.error || 'Failed to update character memo.', 'Level-Up Error');
            }
        }
    });
}

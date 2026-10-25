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

import { formulateLevelUpProposal, applyLevelUpCommit } from './level-up-runner.js';
import { getTierPerks, getCanonicalDndProgression, formatBlueprintSummary } from './level-up-blueprint.js';
import { sendConciergeRequest } from './concierge-connection.js';
import { syncDossierToWorldInfoBook } from './level-up-scaffold.js';

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

    const isPbta = !!(
        dossier?.meta?.systemKey === 'pbta'
        || dossier?.protagonist?.isPbta
        || dossier?.protagonist?.playbook
        || dossier?.protagonist?.harm
        || (dossier?.meta?.systemLabel && /PbtA|Dungeon World|Fellowship|Apocalypse/i.test(dossier.meta.systemLabel))
    );

    let activeBlueprint = blueprint || dossier?.progressionBlueprint || null;
    const isLoadingBlueprint = !isPbta && !!blueprintPromise && !activeBlueprint;

    // Stage selection: PbtA always uses Stage 2 (Playbook Desk).
    // For D&D: if initialStage is passed, honor it. Otherwise, if blueprint exists, default to 2; if not, default to 1.
    let currentStage = isPbta ? 2 : (initialStage ? initialStage : (activeBlueprint ? 2 : 1));

    const proposal = formulateLevelUpProposal(dossier, activeBlueprint, targetLevel, { isRespec, isPbta });
    proposal.newFeatures = [...(proposal.newFeatures || [])];

    const modal = document.createElement('div');
    modal.id = 'mhc-level-up-modal';
    modal.className = 'mhc-modal-backdrop';

    // ─────────────────────────────────────────────────────────────
    // STAGE 2: ADVANCEMENT / RESPEC REVIEW MARKUP
    // ─────────────────────────────────────────────────────────────

    const stage2Title = isPbta
        ? (isRespec ? `🔄 Playbook Tuning Desk — ${proposal.characterName}` : `⚡ Playbook Advancement Desk — ${proposal.characterName}`)
        : (isRespec ? `🔄 Respec & Tuning Desk — ${proposal.characterName}` : `⬆ Level Up Available — ${proposal.characterName} (Level ${proposal.currentLevel} ➔ ${proposal.targetLevel})`);

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
        <span class="mhc-badge-hitdie" style="border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;"><i class="fa-solid fa-heart-crack"></i> Harm Capacity: ${proposal.harm?.max || 4}</span>
        <span class="mhc-badge-hitdie" style="border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;"><i class="fa-solid fa-shield"></i> Armor: ${proposal.harm?.armor ?? 1}</span>
        <span class="mhc-badge-mode">${isRespec ? 'Tuning & Respec' : 'Playbook Advance'}</span>
    ` : `
        <span class="mhc-badge-class" id="mhc-stage2-class-badge"><i class="fa-solid fa-shield-halved"></i> ${escapeHtml(proposal.className)}</span>
        <span class="mhc-badge-hitdie" id="mhc-stage2-hitdie-badge"><i class="fa-solid fa-dice-d20"></i> Hit Die: ${escapeHtml(proposal.hitDie)}</span>
        <span class="mhc-badge-mode">${isRespec ? 'Tuning & Respec' : `Advancing to Level ${proposal.targetLevel}`}</span>
    `;

    // Vitality card HTML
    const vitalitySectionHtml = isPbta ? `
    <div class="mhc-card-section">
        <div class="mhc-section-title"><i class="fa-solid fa-heart-pulse"></i> Harm & Resilience Clocks</div>
        <div class="mhc-hp-row">
            <div class="mhc-hp-pill">
                <span class="mhc-hp-label">Harm Track:</span>
                <span class="mhc-hp-val" id="mhc-new-hp-display" style="color: ${(proposal.harm?.current || 0) > 0 ? '#f87171' : '#4ade80'};">${proposal.harm?.current || 0} / ${proposal.harm?.max || 4}</span>
            </div>
            <div class="mhc-hp-pill" style="border-color: rgba(59, 130, 246, 0.35);">
                <span class="mhc-hp-label">Armor:</span>
                <span class="mhc-hp-val">${proposal.harm?.armor ?? 1}</span>
            </div>
            <div class="mhc-hp-pill" style="border-color: rgba(255, 255, 255, 0.15);">
                <span class="mhc-hp-label">Status:</span>
                <span class="mhc-hp-val" style="font-size: 0.9em; font-weight: 500;">${escapeHtml(proposal.status || 'Healthy')}</span>
            </div>
            <div class="mhc-hp-toggle-group">
                <span style="font-size: 0.85em; color: #9ca3af; align-self: center;"><i class="fa-solid fa-lock"></i> Playbook Harm Clock Active</span>
            </div>
        </div>
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
                <span class="mhc-hp-label">Hit Die:</span>
                <span class="mhc-hp-val">${proposal.hitDie}</span>
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

    const conciergeTitle = isPbta ? 'Playbook Guide Concierge' : 'Leveling Guide Concierge';
    const conciergeDesc = isPbta
        ? (isRespec ? 'Consult your guide to review your playbook moves, refine stats (-1 to +3), or tune gear and conditions.' : 'Consult your guide for playbook advances, new narrative moves, or rule clarifications.')
        : (isRespec ? 'Consult your guide to review your build, rebalance techniques, or customize perks without changing your level.' : 'Consult your guide for build recommendations, rule clarifications, or to request custom thematic perks.');

    let stage2QuickChipsHtml = '';
    if (isPbta) {
        stage2QuickChipsHtml = `
        <button class="mhc-chip" data-prompt="Suggest a new Playbook Move fitting my archetype with a 10+, 7-9, and 6- trigger">🔄 Suggest new Move</button>
        <button class="mhc-chip" data-prompt="Help me rebalance my stats (Might, Agility, Wits, Heart, Arcana) within the -1 to +3 range">⚡ Rebalance stats</button>
        <button class="mhc-chip" data-prompt="Review my active conditions, harm capacity, and gear">📜 Review conditions & harm</button>
        `;
    } else if (isRespec) {
        stage2QuickChipsHtml = `
        <button class="mhc-chip" data-prompt="Rebalance my abilities for a specific weapon or playstyle">🔄 Rebalance abilities</button>
        <button class="mhc-chip" data-prompt="Suggest a custom trait or boon fitting my character">⚡ Suggest custom trait</button>
        <button class="mhc-chip" data-prompt="Review my current build and suggest tweaks">📜 Review build balance</button>
        `;
    } else {
        stage2QuickChipsHtml = `
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
            <div class="mhc-modal-body">
                <!-- Vitality / Harm Section -->
                ${vitalitySectionHtml}

                <!-- Class Features & Active Traits / Moves -->
                <div class="mhc-card-section">
                    <div class="mhc-section-title" style="justify-content: space-between;">
                        <span><i class="fa-solid ${featuresIcon}"></i> ${escapeHtml(featuresTitle)}</span>
                    </div>
                    <ul class="mhc-perks-list" id="mhc-perks-list-container">
                        <!-- Populated dynamically by renderPerksList -->
                    </ul>
                    <div class="mhc-manual-add-row" style="margin-top: 8px; display: flex; gap: 6px;">
                        <input type="text" id="mhc_manual_perk_input" class="text_pole" placeholder="${featuresPlaceholder}" style="flex: 1;" />
                        <button class="menu_button" id="mhc_manual_perk_add_btn"><i class="fa-solid fa-plus"></i> Add</button>
                    </div>
                </div>

                <!-- ASI / Feat Section -->
                ${asiSection}

                <!-- Party Sync Section -->
                ${partySection}

                <!-- Interactive Concierge Desk -->
                <div class="mhc-card-section mhc-concierge-section">
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
        let rowsHtml = '';
        for (let lvl = 1; lvl <= 20; lvl++) {
            const lvlData = activeBlueprint.levels[String(lvl)] || activeBlueprint.levels[lvl] || { features: [], profBonus: Math.floor((lvl - 1) / 4) + 2 };
            const featuresArr = Array.isArray(lvlData.features) ? lvlData.features : (lvlData.features ? [lvlData.features] : []);
            const prof = lvlData.profBonus || (Math.floor((lvl - 1) / 4) + 2);

            let milestoneBadge = '';
            if (lvl === 3) {
                milestoneBadge = '<span class="mhc-table-milestone mhc-milestone-archetype"><i class="fa-solid fa-star"></i> Archetype Specialization</span>';
            } else if (lvlData.asi || [4, 8, 12, 16, 19].includes(lvl)) {
                milestoneBadge = '<span class="mhc-table-milestone mhc-milestone-asi"><i class="fa-solid fa-gem"></i> ASI or Feat</span>';
            } else if (lvl === 20) {
                milestoneBadge = '<span class="mhc-table-milestone mhc-milestone-capstone"><i class="fa-solid fa-crown"></i> Capstone</span>';
            }

            const isCurrent = (lvl === curLvl);
            const rowClass = isCurrent ? 'mhc-blueprint-row mhc-row-current' : 'mhc-blueprint-row';

            rowsHtml += `
            <tr class="${rowClass}">
                <td class="mhc-td-lvl">
                    <span class="mhc-lvl-num">Level ${lvl}</span>
                    ${isCurrent ? '<span class="mhc-tag-current">Target</span>' : ''}
                </td>
                <td class="mhc-td-prof">+${prof}</td>
                <td class="mhc-td-feats">
                    ${milestoneBadge}
                    <span class="mhc-table-feats-text">${escapeHtml(featuresArr.join(', ') || 'Standard progression')}</span>
                </td>
            </tr>`;
        }

        tableContainer.innerHTML = `
        <table class="mhc-blueprint-table">
            <thead>
                <tr>
                    <th style="width: 18%;">Level</th>
                    <th style="width: 12%;">Prof</th>
                    <th style="width: 70%;">Features & Milestones</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>`;
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
    const stage1Greeting = `Greetings, ${proposal.characterName}! I am your RPG Systems Architect. Here is your complete 1–20 progression codex for the ${activeBlueprint?.className || proposal.className} class. You can review all 20 levels, customize abilities, change your Hit Die, or request thematic powers before proceeding. What would you like to refine?`;

    const stage1ChatHistory = [
        {
            role: 'assistant',
            content: stage1Greeting,
        },
    ];

    function renderStage1Chat() {
        if (!stage1ChatLogEl) return;
        stage1ChatLogEl.innerHTML = stage1ChatHistory.map(m => `
            <div class="mhc-chat-msg mhc-chat-${m.role}">
                <div class="mhc-chat-avatar"><i class="fa-solid ${m.role === 'assistant' ? 'fa-wand-magic-sparkles' : 'fa-user'}"></i></div>
                <div class="mhc-chat-bubble">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');
        stage1ChatLogEl.scrollTop = stage1ChatLogEl.scrollHeight;
    }
    renderStage1Chat();

    const stage1Input = modal.querySelector('#mhc_stage1_concierge_input');
    const stage1SendBtn = modal.querySelector('#mhc_stage1_concierge_send_btn');
    const stage1Typing = modal.querySelector('#mhc-stage1-typing');

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
Current Progression Table:
${formatBlueprintSummary(activeBlueprint)}

GUIDELINES (D&D LITE PHILOSOPHY):
1. Single-Track Progression: We use a streamlined single-track model from 1 to 20 with no rigid branching subclass trees or multi-class requirements.
2. Dynamic Table Updates: When the player asks to change, add, or customize abilities at any level, emit:
   [UPDATE_LEVEL: <level_number> | <feature1>; <feature2>]
3. Hit Die Updates: If the player asks to change their Hit Die (d6, d8, d10, or d12), emit:
   [SET_HIT_DIE: <d6|d8|d10|d12>]
4. Class Name Updates: If the player asks to rename the class, emit:
   [SET_CLASS_NAME: <New Class Name>]
5. Concise & Inspiring: Keep your spoken reply evocative, mechanically balanced, and concise (under 120 words), explaining what you modified.`;

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

            if (activeBlueprint && activeBlueprint.levels) {
                // Parse [UPDATE_LEVEL: <level> | <features>]
                const updateMatches = [...reply.matchAll(/\[UPDATE_LEVEL:\s*(\d+)\s*\|\s*([^\]]+)\]/gi)];
                for (const match of updateMatches) {
                    const lvlStr = match[1];
                    const featsRaw = match[2];
                    const feats = featsRaw.split(';').map(f => f.trim()).filter(Boolean);
                    if (feats.length > 0) {
                        activeBlueprint.levels[lvlStr] = activeBlueprint.levels[lvlStr] || { profBonus: Math.floor((parseInt(lvlStr, 10) - 1) / 4) + 2 };
                        activeBlueprint.levels[lvlStr].features = feats;
                        if (typeof toastr !== 'undefined') toastr.info(feats.join(', '), `Level ${lvlStr} Updated`);
                    }
                }

                // Parse [SET_HIT_DIE: <d6|d8|d10|d12>]
                const hdMatch = reply.match(/\[SET_HIT_DIE:\s*(d6|d8|d10|d12)\]/i);
                if (hdMatch) {
                    const newHd = hdMatch[1].toLowerCase();
                    activeBlueprint.hitDie = newHd;
                    if (bpHitDieSelect) bpHitDieSelect.value = newHd;
                    const badge = modal.querySelector('#mhc-blueprint-badge-hitdie');
                    if (badge) badge.textContent = newHd;
                    if (typeof toastr !== 'undefined') toastr.info(`Hit Die set to ${newHd}`, 'Hit Die Updated');
                }

                // Parse [SET_CLASS_NAME: <name>]
                const nameMatch = reply.match(/\[SET_CLASS_NAME:\s*([^\]]+)\]/i);
                if (nameMatch) {
                    const newName = nameMatch[1].trim();
                    activeBlueprint.className = newName;
                    if (bpClassNameInput) bpClassNameInput.value = newName;
                    const badge = modal.querySelector('#mhc-blueprint-badge-class');
                    if (badge) badge.textContent = newName;
                    if (typeof toastr !== 'undefined') toastr.info(`Class renamed to ${newName}`, 'Class Updated');
                }

                renderBlueprintTable();
            }

            const cleanReply = reply.replace(/\[(?:UPDATE_LEVEL|SET_HIT_DIE|SET_CLASS_NAME):[^\]]+\]/gi, '').trim();
            stage1ChatHistory.push({ role: 'assistant', content: cleanReply || reply });
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
        perksContainer.innerHTML = proposal.newFeatures.map((f, idx) => `
            <li class="mhc-perk-item" data-index="${idx}">
                <i class="fa-solid fa-star"></i>
                <span class="mhc-perk-text" style="flex: 1;">${escapeHtml(f)}</span>
                <button class="mhc-remove-perk-btn" data-index="${idx}" title="Remove feature" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1em; line-height:1; padding:0 4px;">&times;</button>
            </li>
        `).join('');

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

    // Hook up blueprint promise if generating asynchronously
    if (isLoadingBlueprint && blueprintPromise) {
        blueprintPromise.then((resolvedBlueprint) => {
            if (!_activeModalElement || _activeModalElement !== modal) return;
            const shimmerEl = modal.querySelector('#mhc-blueprint-shimmer');
            if (shimmerEl) shimmerEl.remove();

            if (resolvedBlueprint) {
                activeBlueprint = resolvedBlueprint;
                dossier.progressionBlueprint = resolvedBlueprint;

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

                if (isRespec) {
                    let feats = [];
                    if (resolvedBlueprint.levels) {
                        for (let l = 1; l <= (targetLevel || 1); l++) {
                            const lvlFeats = resolvedBlueprint.levels[String(l)]?.features || [];
                            feats.push(...lvlFeats);
                        }
                    }
                    if (Array.isArray(dossier?.protagonist?.features) && dossier.protagonist.features.length > 0) {
                        feats.push(...dossier.protagonist.features);
                    }
                    proposal.newFeatures = Array.from(new Set(feats));
                    if (proposal.newFeatures.length === 0) proposal.newFeatures = perks.features || [];
                } else {
                    proposal.newFeatures = perks.features || [];
                }
                renderPerksList();
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
            renderBlueprintTable();
            renderPerksList();
        });
    }

    // Manual Perk Add
    const manualPerkInput = modal.querySelector('#mhc_manual_perk_input');
    const manualPerkAddBtn = modal.querySelector('#mhc_manual_perk_add_btn');
    const handleManualAdd = () => {
        const val = manualPerkInput?.value?.trim();
        if (val) {
            proposal.newFeatures.push(val);
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
            ? `Greetings, ${proposal.characterName}! Welcome to your Playbook Tuning Desk. You are walking the path of ${proposal.playbookName || proposal.className}. Here we can review your Playbook Moves, rebalance stats (-1 to +3: Might, Agility, Wits, Heart, Arcana), customize techniques, or adjust gear and conditions without D&D level constraints. How would you like to refine your playbook?`
            : `Greetings, ${proposal.characterName}! You have reached the milestone to advance your Playbook as ${proposal.playbookName || proposal.className}. I am at your service to suggest new Playbook Moves, advance your stats, or clear conditions for your journey.`;
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
                <div class="mhc-chat-bubble">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
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
2. Moves & Mechanics: All moves must have a clear fictional trigger, specify which stat to roll (-1 to +3: Might, Agility, Wits, Heart, Arcana), and detail outcomes for 10+ (strong hit), 7-9 (weak hit / compromise), and 6- (miss / GM move). You may use "+1 forward" or "-1 forward" or "hold".
3. Dynamic Move Tweaking: When suggesting or granting a new move, emit:
   [ADD_FEATURE: Move Name: When [trigger], roll +[STAT]. On a 10+, [strong hit]. On a 7-9, [weak hit].]
4. Move Removal: If the user asks to remove a move, emit:
   [REMOVE_FEATURE: Move Name]
5. Concise & Atmospheric: Keep your response evocative, narrative, mechanically sharp, and under 130 words.`
        : `You are the Level-Up Concierge and RPG systems architect for "${proposal.characterName}", a Level ${proposal.currentLevel} ${proposal.className} advancing to Level ${proposal.targetLevel}.
Character Stats: ${JSON.stringify(dossier?.protagonist?.stats || {})}
Hit Die: ${proposal.hitDie}
Current Proposed Features: ${proposal.newFeatures.join(', ')}

GUIDELINES (D&D LITE PHILOSOPHY):
1. Single-Track Progression: We follow a streamlined D&D Lite model with no rigid branching subclass trees. The character's class remains purely "${proposal.className}".
2. Dynamic Flavor via Boons: When the player wants specific thematic flavor (e.g. Totem Warrior vibes, Assassin tricks, Battle Master maneuvers, Eldritch magic), do NOT tell them to switch classes or pick a rigid subclass. Instead, grant them tailored custom perks, traits, or boons directly via:
   [ADD_FEATURE: Feature Name: Description]
3. Feature Removal: If the user asks to remove a feature, emit:
   [REMOVE_FEATURE: Feature Name]
4. Concise & Atmospheric: Keep your response inspiring, mechanically balanced, and concise (under 120 words).`;

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

            const addMatches = [...reply.matchAll(/\[ADD_FEATURE:\s*([^\]]+)\]/gi)];
            for (const match of addMatches) {
                const feat = match[1].trim();
                if (feat && !proposal.newFeatures.includes(feat)) {
                    proposal.newFeatures.push(feat);
                    if (typeof toastr !== 'undefined') toastr.info(feat, 'Added New Feature');
                }
            }

            const removeMatches = [...reply.matchAll(/\[REMOVE_FEATURE:\s*([^\]]+)\]/gi)];
            for (const match of removeMatches) {
                const target = match[1].trim().toLowerCase();
                proposal.newFeatures = proposal.newFeatures.filter(f => !f.toLowerCase().includes(target));
            }

            renderPerksList();

            const cleanReply = reply.replace(/\[(?:ADD|REMOVE)_FEATURE:[^\]]+\]/gi, '').trim();
            stage2ChatHistory.push({ role: 'assistant', content: cleanReply || reply });
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
                syncDossierToWorldInfoBook(chatId, dossier).catch(() => {});

                // Recalculate Stage 2 features and Hit Die
                proposal.hitDie = activeBlueprint.hitDie;
                proposal.className = activeBlueprint.className;

                const hdBadge = modal.querySelector('#mhc-stage2-hitdie-badge');
                if (hdBadge) hdBadge.innerHTML = `<i class="fa-solid fa-dice-d20"></i> Hit Die: ${escapeHtml(proposal.hitDie)}`;
                const classBadge = modal.querySelector('#mhc-stage2-class-badge');
                if (classBadge) classBadge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${escapeHtml(proposal.className)}`;

                const conMod = Math.floor((((dossier?.protagonist?.stats?.CON ?? 10) - 10) / 2));
                const perks = getTierPerks(activeBlueprint, targetLevel || 1, conMod);

                if (isRespec) {
                    let feats = [];
                    if (activeBlueprint.levels) {
                        for (let l = 1; l <= (targetLevel || 1); l++) {
                            const lvlFeats = activeBlueprint.levels[String(l)]?.features || [];
                            feats.push(...lvlFeats);
                        }
                    }
                    if (Array.isArray(dossier?.protagonist?.features) && dossier.protagonist.features.length > 0) {
                        feats.push(...dossier.protagonist.features);
                    }
                    proposal.newFeatures = Array.from(new Set(feats));
                    if (proposal.newFeatures.length === 0) proposal.newFeatures = perks.features || [];
                } else {
                    proposal.newFeatures = perks.features || [];
                    if (proposal.hpChange) {
                        proposal.hpChange.gain = perks.averageHpGain;
                        proposal.hpChange.newMax = (proposal.hpChange.oldMax || 0) + perks.averageHpGain;
                        const avgBtn = modal.querySelector('#mhc-hp-avg-btn');
                        if (avgBtn) avgBtn.textContent = `Take Average (+${perks.averageHpGain})`;
                        const hpDisp = modal.querySelector('#mhc-new-hp-display');
                        if (hpDisp) hpDisp.textContent = String(proposal.hpChange.newMax);
                    }
                }
                renderPerksList();
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
        currentHpGain = Math.max(1, rolled);
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

    // Confirm & Apply Advancement
    const confirmBtn = modal.querySelector('#mhc-confirm-apply-btn');
    confirmBtn?.addEventListener('click', () => {
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
                } else {
                    if (!isRespec) {
                        dossier.protagonist.level = proposal.targetLevel;
                    }
                    if (proposal.hpChange?.newMax) {
                        dossier.protagonist.hp = dossier.protagonist.hp || {};
                        dossier.protagonist.hp.max = proposal.hpChange.newMax;
                        dossier.protagonist.hp.current = Math.min(
                            proposal.hpChange.newMax,
                            (dossier.protagonist.hp.current || 10) + currentHpGain
                        );
                    }
                    if (proposal.newFeatures && Array.isArray(proposal.newFeatures)) {
                        dossier.protagonist.features = [
                            ...new Set([...(dossier.protagonist.features || []), ...proposal.newFeatures]),
                        ];
                    }
                }
            }

            try {
                const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
                if (ctx?.chat_metadata) {
                    ctx.chat_metadata.mhc_dossier = dossier;
                    if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
                }
            } catch (_) {}

            syncDossierToWorldInfoBook(chatId, dossier).catch(() => {});

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

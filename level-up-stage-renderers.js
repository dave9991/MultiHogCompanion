/// <reference path="./types.d.ts" />
/**
 * MultiHog Companion — Level-Up & Respec Stage HTML Renderers
 *
 * Pure HTML template builders for Stage 1 (Class Definition & 1–20 Progression Codex)
 * and Stage 2 (D&D 5e / PbtA / FAE Advancement & Tuning Review Desk).
 *
 * [CATALOG: FEAT-10] See FEATURES.md — Autonomous Level-Up Concierge & Class Progression Codex
 */

import { normalizeLevelEntry, classifyFeatureKind } from './level-up-blueprint.js';
import { isConciergeCreatedDossier } from './concierge-ui.js';
import { escapeHtml } from './mhc-utils.js';

/**
 * Builds the PbtA Playbook Advancement Picker card HTML.
 *
 * @param {object} params
 * @param {boolean} params.isPbta
 * @param {boolean} params.isRespec
 * @param {LevelUpProposal} params.proposal
 * @param {string[]} params.pbtaStatNames
 * @returns {string}
 */
export function buildPbtaAdvanceSectionHtml({ isPbta, isRespec, proposal, pbtaStatNames }) {
    if (!isPbta || isRespec || !Array.isArray(proposal?.advanceOptions)) {
        return '';
    }

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

    return `
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

/**
 * Builds D&D 5e ASI/Feat selection and lockstep Party Sync card HTML.
 *
 * @param {object} params
 * @param {boolean} params.isPbta
 * @param {boolean} params.isFae
 * @param {boolean} params.isRespec
 * @param {LevelUpProposal} params.proposal
 * @returns {{ asiSection: string, partySection: string }}
 */
export function buildDndAsiAndPartyHtml({ isPbta, isFae, isRespec: _isRespec, proposal }) {
    let asiSection = '';
    if (!isPbta && !isFae && proposal?.isAsi && proposal?.asiOptions) {
        const { optionA, optionB, recommendedFeats } = proposal.asiOptions;
        const featOptionsHtml = (recommendedFeats || [])
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

    let partySection = '';
    if (!isPbta && !isFae && proposal?.partyChanges && proposal.partyChanges.length > 0) {
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

    return { asiSection, partySection };
}

/**
 * Builds FAE Milestone Reward Picker and Pools/Knobs/Tags Tuning card HTML.
 *
 * @param {object} params
 * @param {boolean} params.isFae
 * @param {boolean} params.isRespec
 * @param {LevelUpProposal} params.proposal
 * @returns {{ faeMilestoneSection: string, faeTuningSection: string }}
 */
export function buildFaeMilestoneAndTuningHtml({ isFae, isRespec, proposal }) {
    let faeMilestoneSection = '';
    if (isFae && !isRespec && Array.isArray(proposal?.milestoneOptions)) {
        const healOpt = proposal.milestoneOptions.find(o => o.id === 'heal_scar');
        const capOpt = proposal.milestoneOptions.find(o => o.id === 'new_capability');
        const hardOpt = proposal.milestoneOptions.find(o => o.id === 'hardened_reserve');

        const scarsList = proposal.negativeTags || [];
        const scarOptionsHtml = scarsList.length > 0
            ? scarsList.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')
            : '<option value="" disabled>No active scars or debuffs</option>';

        const reducedPools = healOpt?.reducedPools || [];
        const reducedPoolsHtml = reducedPools.length > 0
            ? `<div style="margin-top: 4px;">
                <label style="font-size: 0.85em; color: #94a3b8; margin-right: 6px;">Or Restore Lost Max Capacity:</label>
                <select id="mhc_fae_restore_pool_select" class="text_pole">
                    <option value="">-- Choose pool to restore +1 max --</option>
                    ${reducedPools.map(rp => `<option value="${escapeHtml(rp.key)}">${escapeHtml(rp.label)} (${rp.currentMax} ➔ ${rp.currentMax + 1})</option>`).join('')}
                </select>
            </div>`
            : '';

        const suggestedTags = capOpt?.suggestedTags || [];
        const suggestedTagsHtml = suggestedTags.map(t =>
            `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`
        ).join('');
        const initialTag = suggestedTags[0] || '';

        const poolChoices = hardOpt?.pools || [];
        const poolChoicesHtml = poolChoices.map(p =>
            `<option value="${escapeHtml(p.key)}" ${p.disabled ? 'disabled' : ''}>${escapeHtml(p.label)} (${p.current}/${p.max} ➔ ${p.disabled ? 'Cap 12 Reached' : `${p.current + 1}/${p.nextMax}`})</option>`
        ).join('');

        faeMilestoneSection = `
        <div class="mhc-card-section" id="mhc-fae-milestone-picker-card">
            <div class="mhc-section-title" style="justify-content: space-between;">
                <span><i class="fa-solid fa-trophy" style="color: #fbbf24;"></i> Choose Your Milestone Reward (Every 3–5 Scenes)</span>
                <span style="font-size: 0.8em; color: #9ca3af;">Pacing: ${proposal.pacingScenes || 4} Scenes</span>
            </div>
            <div class="mhc-asi-radio-group" id="mhc-fae-milestone-options">
                <!-- 1. Heal a Scar -->
                <div class="mhc-fae-milestone-option" data-milestone-id="heal_scar" style="padding: 6px 0;">
                    <label class="mhc-radio-label" style="display: flex; align-items: center; gap: 8px;">
                        <input type="radio" name="mhc_fae_milestone_pick" value="heal_scar" checked />
                        <strong>Heal a Scar / Restore Capacity</strong>
                    </label>
                    <div class="mhc-fae-milestone-detail" data-milestone-detail="heal_scar" style="margin: 6px 0 4px 24px; display: flex; flex-direction: column; gap: 6px;">
                        <div>
                            <label style="font-size: 0.85em; color: #94a3b8; margin-right: 6px;">Select Scar/Debuff to heal:</label>
                            <select id="mhc_fae_heal_scar_select" class="text_pole">
                                ${scarOptionsHtml}
                            </select>
                        </div>
                        ${reducedPoolsHtml}
                    </div>
                </div>

                <!-- 2. New Capability -->
                <div class="mhc-fae-milestone-option" data-milestone-id="new_capability" style="padding: 6px 0;">
                    <label class="mhc-radio-label" style="display: flex; align-items: center; gap: 8px;">
                        <input type="radio" name="mhc_fae_milestone_pick" value="new_capability" />
                        <strong>New Capability (personal trait, signature gear, or loyal companion tag)</strong>
                    </label>
                    <div class="mhc-fae-milestone-detail" data-milestone-detail="new_capability" style="margin: 6px 0 4px 24px; display: none; flex-direction: column; gap: 6px;">
                        <select id="mhc_fae_tag_select" class="text_pole">
                            ${suggestedTagsHtml}
                            <option value="custom">Custom Tag (write below)</option>
                        </select>
                        <input type="text" id="mhc_fae_custom_tag_input" class="text_pole" value="${escapeHtml(initialTag)}" placeholder="e.g., Shield-Bearer, Strong [for breaching doors], Companion: Mira (Scout)" />
                        <span style="font-size:0.8em; color:#a3e635;"><i class="fa-solid fa-circle-info"></i> Scope: ~25–30% applicability. Use bracketed qualifiers like <code>Trait [context]</code> for broad abilities.</span>
                    </div>
                </div>

                <!-- 3. Hardened Reserve -->
                <div class="mhc-fae-milestone-option" data-milestone-id="hardened_reserve" style="padding: 6px 0;">
                    <label class="mhc-radio-label" style="display: flex; align-items: center; gap: 8px;">
                        <input type="radio" name="mhc_fae_milestone_pick" value="hardened_reserve" />
                        <strong>Hardened Reserve (Increase Pool Max by +1, up to 12)</strong>
                    </label>
                    <div class="mhc-fae-milestone-detail" data-milestone-detail="hardened_reserve" style="margin: 6px 0 4px 24px; display: none; flex-direction: column; gap: 6px;">
                        <select id="mhc_fae_hardened_pool_select" class="text_pole">
                            ${poolChoicesHtml}
                        </select>
                    </div>
                </div>
            </div>
        </div>`;
    }

    let faeTuningSection = '';
    if (isFae) {
        const pools = proposal?.pools || {};
        const poolRowsHtml = Object.entries(pools).map(([k, p]) => {
            const barColorHex = p.barColor === 'purple' ? '#a855f7' : (p.barColor === 'amber' ? '#f59e0b' : (p.barColor === 'blue' ? '#3b82f6' : '#22c55e'));
            return `
            <div class="mhc-fae-pool-row" data-pool-key="${escapeHtml(k)}" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding: 6px 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;">
                <span style="font-weight: 600; min-width: 120px;">
                    <span class="mhc-badge-hitdie" style="border-color: ${barColorHex}; color: ${barColorHex};">${escapeHtml(p.label || k)}</span>
                </span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <label style="font-size: 0.85em; color: #94a3b8;">Cur:</label>
                    <input type="number" class="text_pole mhc-fae-pool-cur" data-pool="${escapeHtml(k)}" min="0" max="${p.max}" value="${p.current}" style="width: 50px; text-align: center; padding: 2px;" />
                    <span style="color: #64748b;">/</span>
                    <label style="font-size: 0.85em; color: #94a3b8;">Max:</label>
                    <input type="number" class="text_pole mhc-fae-pool-max" data-pool="${escapeHtml(k)}" min="1" max="12" value="${p.max}" style="width: 50px; text-align: center; padding: 2px;" />
                </div>
                <span style="font-size: 0.78em; color: #94a3b8; flex: 1; text-align: right;" title="Recovery: ${escapeHtml(p.recovery || 'rest')}">Zero: ${escapeHtml(p.zero_debuff || 'Down')}</span>
            </div>`;
        }).join('');

        const shiftVal = proposal?.knobs?.base_attrition_shift ?? 0;
        const overflowVal = proposal?.knobs?.overflow_default || 'scar_and_ko';

        faeTuningSection = `
        <!-- FAE Resource Pools Card -->
        <div class="mhc-card-section" id="mhc-fae-pools-card">
            <div class="mhc-section-title"><i class="fa-solid fa-droplet" style="color: #38bdf8;"></i> Attrition Resource Pools</div>
            <div class="mhc-fae-pools-list" id="mhc-fae-pools-list">
                ${poolRowsHtml}
            </div>
        </div>

        <!-- FAE Knobs Card -->
        <div class="mhc-card-section" id="mhc-fae-knobs-card">
            <div class="mhc-section-title"><i class="fa-solid fa-sliders" style="color: #a78bfa;"></i> Narrative &amp; Attrition Knobs</div>
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.9em;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                    <input type="checkbox" id="mhc_fae_flee_grace_chk" ${proposal?.knobs?.flee_grace_toggle ? 'checked' : ''} />
                    <span><strong>Flee Grace:</strong> Grant +1 to Flee actions during retreat</span>
                </label>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <label style="color: #94a3b8;">Base Attrition Shift:</label>
                    <select id="mhc_fae_shift_select" class="text_pole" style="width: auto;">
                        <option value="-1" ${shiftVal === -1 ? 'selected' : ''}>-1 (Hardened / Heavy Attrition)</option>
                        <option value="0" ${shiftVal === 0 ? 'selected' : ''}>0 (Standard)</option>
                        <option value="1" ${shiftVal === 1 ? 'selected' : ''}>+1 (Heroic / Forgiving)</option>
                    </select>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <label style="color: #94a3b8;">Overflow Default:</label>
                    <select id="mhc_fae_overflow_select" class="text_pole" style="width: auto;">
                        <option value="scar_and_ko" ${overflowVal === 'scar_and_ko' ? 'selected' : ''}>Scar &amp; KO (Incapacitation + Negative Tag)</option>
                        <option value="lethal" ${overflowVal === 'lethal' ? 'selected' : ''}>Lethal (Fatal Injury / Terminal Doom)</option>
                        <option value="gear_loss" ${overflowVal === 'gear_loss' ? 'selected' : ''}>Gear Loss (Signature Item Destroyed)</option>
                        <option value="narrative_fail" ${overflowVal === 'narrative_fail' ? 'selected' : ''}>Narrative Consequence (Severe Permanent Shift)</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- FAE Positive Tags Card -->
        <div class="mhc-card-section" id="mhc-fae-pos-tags-card">
            <div class="mhc-section-title"><i class="fa-solid fa-tag" style="color: #4ade80;"></i> Positive Tags &amp; Capabilities</div>
            <ul class="mhc-perks-list" id="mhc-fae-pos-tags-list">
                <!-- Populated by renderFaePosTags -->
            </ul>
            <div class="mhc-manual-add-row" style="margin-top: 8px; display: flex; gap: 6px;">
                <input type="text" id="mhc_fae_manual_pos_tag_input" class="text_pole" placeholder="Add Positive Tag (e.g. Shield-Bearer, Strong [for breaching doors], Service Revolver)..." style="flex: 1;" />
                <button class="menu_button" id="mhc_fae_manual_pos_tag_btn"><i class="fa-solid fa-plus"></i> Add Tag</button>
            </div>
        </div>

        <!-- FAE Scars & Debuffs Card -->
        <div class="mhc-card-section" id="mhc-fae-neg-tags-card">
            <div class="mhc-section-title"><i class="fa-solid fa-skull-crossbones" style="color: #f87171;"></i> Scars &amp; Debuffs (Negative Tags)</div>
            <ul class="mhc-perks-list" id="mhc-fae-neg-tags-list">
                <!-- Populated by renderFaeNegTags -->
            </ul>
            <div class="mhc-manual-add-row" style="margin-top: 8px; display: flex; gap: 6px;">
                <input type="text" id="mhc_fae_manual_neg_tag_input" class="text_pole" placeholder="Add Scar/Debuff (e.g. Fractured Ribs, Shaking Hands)..." style="flex: 1;" />
                <button class="menu_button" id="mhc_fae_manual_neg_tag_btn"><i class="fa-solid fa-plus"></i> Add Scar</button>
            </div>
        </div>`;
    }

    return { faeMilestoneSection, faeTuningSection };
}

/**
 * Combines Stage 1 (Class Definition) and Stage 2 (Advancement / Respec Desk) markup
 * into the complete `.mhc-modal-dialog` innerHTML string.
 *
 * @param {object} params
 * @param {1|2} params.currentStage
 * @param {boolean} params.isFae
 * @param {boolean} params.isPbta
 * @param {boolean} params.isRespec
 * @param {boolean} params.isLoadingBlueprint
 * @param {CompanionDossier|null} params.dossier
 * @param {ProgressionBlueprint|null} params.activeBlueprint
 * @param {LevelUpProposal} params.proposal
 * @param {string[]} params.pbtaStatNames
 * @param {string} params.pbtaStatNamesStr
 * @returns {string}
 */
export function buildLevelUpModalHtml({
    currentStage,
    isFae,
    isPbta,
    isRespec,
    isLoadingBlueprint,
    dossier,
    activeBlueprint,
    proposal,
    pbtaStatNames,
    pbtaStatNamesStr,
}) {
    const stage2Title = isFae
        ? (isRespec ? `🕯️ FAE Attrition & Knob Tuning Desk — ${proposal.characterName}` : `🏆 FAE Milestone Reward Desk — ${proposal.characterName}`)
        : (isPbta
            ? (isRespec ? `🔄 Playbook Tuning Desk — ${proposal.characterName}` : `⚡ Playbook Advancement Desk — ${proposal.characterName}`)
            : (isRespec ? `🔄 Respec & Tuning Desk — ${proposal.characterName}` : `⬆ Level Up Available — ${proposal.characterName} (Level ${proposal.currentLevel} ➔ ${proposal.targetLevel})`));

    const pbtaAdvanceSection = buildPbtaAdvanceSectionHtml({ isPbta, isRespec, proposal, pbtaStatNames });
    const { asiSection, partySection } = buildDndAsiAndPartyHtml({ isPbta, isFae, isRespec, proposal });
    const { faeMilestoneSection, faeTuningSection } = buildFaeMilestoneAndTuningHtml({ isFae, isRespec, proposal });

    const primaryPoolKey = proposal.pools ? Object.keys(proposal.pools)[0] : null;
    const primaryPool = primaryPoolKey ? proposal.pools[primaryPoolKey] : null;

    const stage2SubBadgesHtml = isFae ? `
        <span class="mhc-badge-class"><i class="fa-solid fa-skull"></i> Genre: ${escapeHtml(proposal.genreKey || 'cosmic_horror')}</span>
        <span class="mhc-badge-hitdie" style="border-color: rgba(34, 197, 94, 0.4); color: #86efac;"><i class="fa-solid fa-heart-pulse"></i> ${escapeHtml(primaryPool?.label || 'Pool')}: ${primaryPool?.current ?? 0}/${primaryPool?.max ?? 8}</span>
        <span class="mhc-badge-mode">${isRespec ? 'Attrition & Knob Tuning' : 'Milestone Reward'}</span>
    ` : (isPbta ? `
        <span class="mhc-badge-class"><i class="fa-solid fa-book-sparkles"></i> Playbook: ${escapeHtml(proposal.playbookName || proposal.className)}</span>
        <span class="mhc-badge-hitdie" id="mhc-pbta-harm-badge" style="border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;"><i class="fa-solid fa-heart-crack"></i> Harm Capacity: ${proposal.harm?.max || 4}</span>
        <span class="mhc-badge-hitdie" id="mhc-pbta-armor-badge" style="border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;"><i class="fa-solid fa-shield"></i> Armor: ${proposal.harm?.armor ?? 1}</span>
        <span class="mhc-badge-mode">${isRespec ? 'Tuning & Respec' : 'Playbook Advance'}</span>
    ` : `
        <span class="mhc-badge-class" id="mhc-stage2-class-badge"><i class="fa-solid fa-shield-halved"></i> ${escapeHtml(proposal.className)}</span>
        <span class="mhc-badge-hitdie" id="mhc-stage2-hitdie-badge"><i class="fa-solid fa-dice-d20"></i> Hit Die: ${escapeHtml(proposal.hitDie)}</span>
        <span class="mhc-badge-mode">${isRespec ? 'Tuning & Respec' : `Advancing to Level ${proposal.targetLevel}`}</span>
    `);

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
                <span class="mhc-hp-val" style="color: #60a5fa;"><i class="fa-solid fa-dice-d20"></i> ${escapeHtml(proposal.hitDie)} (${proposal.targetLevel}/${proposal.targetLevel})</span>
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
                <button class="menu_button mhc-hp-btn" id="mhc-hp-roll-btn">Roll ${escapeHtml(proposal.hitDie)}</button>
            </div>
        </div>
        <div class="mhc-hp-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.06); justify-content: flex-start; gap: 8px;">
            <div class="mhc-hp-pill" style="border-color: rgba(255, 255, 255, 0.15);">
                <span class="mhc-hp-label">Hit Dice Pool:</span>
                <span class="mhc-hp-val" style="color: #60a5fa;"><i class="fa-solid fa-dice-d20"></i> ${escapeHtml(proposal.hitDie)} (${proposal.targetLevel}/${proposal.targetLevel})</span>
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

    const harmonizationControlsHtml = (!isPbta && !isFae && isRespec) ? `
    <div class="mhc-harmonize-bar" style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
        <button class="mhc-chip" id="mhc-sync-codex-traits-btn" title="Harmonize active traits strictly with the 1–20 Progression Codex up to your level">
            <i class="fa-solid fa-arrows-rotate"></i> Sync from Codex Table
        </button>
        <button class="mhc-chip" id="mhc-restore-sheet-traits-btn" title="Restore original starting traits from your adventure character sheet">
            <i class="fa-solid fa-file-lines"></i> Restore Adventure Sheet Traits
        </button>
    </div>
    ` : '';

    const activeAbilitiesSectionHtml = (!isPbta && !isFae) ? `
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

    const conciergeTitle = isFae
        ? 'FAE Attrition & Milestone Guide'
        : (isPbta ? 'Playbook Guide Concierge' : 'Leveling Guide Concierge');
    const conciergeDesc = isFae
        ? (isRespec ? 'Consult your guide to tune attrition pools, adjust narrative knobs, or refine positive tags and scars.' : 'Consult your guide for milestone capabilities, healing scars, or increasing pool capacities.')
        : (isPbta
            ? (isRespec ? 'Consult your guide to review your playbook moves, refine stats (-1 to +3), or tune gear and conditions.' : 'Consult your guide for playbook advances, new narrative moves, or rule clarifications.')
            : (isRespec ? 'Consult your guide to review your build, audit active vs passive abilities, or rebalance perks without changing your level.' : 'Consult your guide for build recommendations, rule clarifications, or to request custom thematic perks.'));

    let stage2QuickChipsHtml = '';
    if (isFae) {
        stage2QuickChipsHtml = `
        <button class="mhc-chip" data-prompt="Suggest a new genre-appropriate Positive Tag for my character (following Trait Qualification Protocol, ~25–30% scope or Trait [context])">⚡ Suggest Positive Tag</button>
        <button class="mhc-chip" data-prompt="Help me heal or replace one of my active Scars or Debuffs">🩹 Heal a Scar</button>
        <button class="mhc-chip" data-prompt="Recommend which pool capacity to increase based on recent scenes">🛡️ Hardened Reserve Advice</button>
        <button class="mhc-chip" data-prompt="Review my FAE Knobs (Flee Grace, Shift, Overflow) for the upcoming scenario">⚙️ Review Knobs &amp; Pools</button>
        `;
    } else if (isPbta) {
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

    const stage2Placeholder = isFae
        ? (isRespec ? 'Ask your guide, or request adjustments to pools, knobs, or tags...' : 'Ask your guide, or request custom milestone capabilities...')
        : (isPbta
            ? (isRespec ? 'Ask your guide, or request custom moves (e.g. \'Suggest an infiltration move\')...' : 'Ask your guide, or request custom playbook moves...')
            : (isRespec ? 'Ask your guide, or request custom boons to tune your build...' : 'Ask your guide, or request custom boons (e.g. \'I want a frost totem perk\')...'));

    const confirmBtnText = isFae
        ? (isRespec ? '<i class="fa-solid fa-floppy-disk"></i> Save Attrition &amp; Knob Changes' : '<i class="fa-solid fa-check"></i> Confirm Milestone Advancement')
        : (isPbta
            ? (isRespec ? '<i class="fa-solid fa-floppy-disk"></i> Save Playbook Changes' : '<i class="fa-solid fa-check"></i> Confirm Playbook Advancement')
            : (isRespec ? '<i class="fa-solid fa-floppy-disk"></i> Save Build Changes' : `<i class="fa-solid fa-check"></i> Confirm & Advance to Level ${proposal.targetLevel}`));

    const stageSwitchBtnHtml = (!isPbta && !isFae) ? `
        <button class="menu_button mhc-btn-stage-switch" id="mhc-switch-to-stage1-btn" title="View or customize the full 1–20 Class Progression Codex">
            <i class="fa-solid fa-book-sparkles"></i> 📜 Class Definition & Roadmap
        </button>
    ` : '';

    const stage1Title = `⚔️ Class Definition & Progression Codex — ${proposal.characterName}`;
    const showLivingWorldInitially = isConciergeCreatedDossier(dossier);

    return `
    <div class="mhc-modal-dialog">
        <!-- ════════════════ STAGE 1: CLASS DEFINITION ════════════════ -->
        <div class="mhc-stage-view" id="mhc-stage-definition" style="${currentStage === 1 ? 'display:flex;' : 'display:none;'}">
            <div class="mhc-modal-header">
                <div class="mhc-header-title-box">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                        <div class="mhc-modal-title">${escapeHtml(stage1Title)}</div>
                        <div class="mhc-mode-switcher-bar" style="display: inline-flex; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 2px; gap: 2px;">
                            <button type="button" class="mhc-mode-nav-btn active" data-nav-mode="character" style="border: none; background: rgba(59,130,246,0.35); color: #93c5fd; font-size: 0.78em; font-weight: 600; padding: 3px 8px; border-radius: 4px; cursor: pointer;" title="Character &amp; Leveling Desk"><i class="fa-solid fa-shield-halved"></i> Character</button>
                            <button type="button" class="mhc-mode-nav-btn" data-nav-mode="living-world" style="border: none; background: transparent; color: #9ca3af; font-size: 0.78em; font-weight: 600; padding: 3px 8px; border-radius: 4px; cursor: pointer; ${showLivingWorldInitially ? '' : 'display: none;'}" title="View Living World Dossier for Active Campaign"><i class="fa-solid fa-earth-americas"></i> Living World</button>
                            <button type="button" class="mhc-mode-nav-btn" data-nav-mode="new-adventure" style="border: none; background: transparent; color: #9ca3af; font-size: 0.78em; font-weight: 600; padding: 3px 8px; border-radius: 4px; cursor: pointer;" title="Start Session Zero for a New Adventure"><i class="fa-solid fa-compass"></i> Session Zero Concierge</button>
                        </div>
                    </div>
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
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                        <div class="mhc-modal-title">${escapeHtml(stage2Title)}</div>
                        <div class="mhc-mode-switcher-bar" style="display: inline-flex; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 2px; gap: 2px;">
                            <button type="button" class="mhc-mode-nav-btn active" data-nav-mode="character" style="border: none; background: rgba(59,130,246,0.35); color: #93c5fd; font-size: 0.78em; font-weight: 600; padding: 3px 8px; border-radius: 4px; cursor: pointer;" title="Character &amp; Leveling Desk"><i class="fa-solid fa-shield-halved"></i> Character</button>
                            <button type="button" class="mhc-mode-nav-btn" data-nav-mode="living-world" style="border: none; background: transparent; color: #9ca3af; font-size: 0.78em; font-weight: 600; padding: 3px 8px; border-radius: 4px; cursor: pointer; ${showLivingWorldInitially ? '' : 'display: none;'}" title="View Living World Dossier for Active Campaign"><i class="fa-solid fa-earth-americas"></i> Living World</button>
                            <button type="button" class="mhc-mode-nav-btn" data-nav-mode="new-adventure" style="border: none; background: transparent; color: #9ca3af; font-size: 0.78em; font-weight: 600; padding: 3px 8px; border-radius: 4px; cursor: pointer;" title="Start Session Zero for a New Adventure"><i class="fa-solid fa-compass"></i> Session Zero Concierge</button>
                        </div>
                    </div>
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
                    ${isFae ? `
                        ${!isRespec ? faeMilestoneSection : ''}
                        ${faeTuningSection}
                    ` : `
                        <!-- Vitality / Harm Section -->
                        ${vitalitySectionHtml}

                        <!-- PbtA Advancement Picker (when advancing a playbook) -->
                        ${pbtaAdvanceSection}

                        <!-- Class Features & Active Traits / Moves -->
                        <div class="mhc-card-section">
                            <div class="mhc-section-title" style="justify-content: space-between;">
                                <span><i class="fa-solid ${featuresIcon}"></i> ${featuresTitle}</span>
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
                    `}
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
}

/**
 * Pure HTML table builder for Stage 1's 4-tier collapsible 1–20 progression roadmap.
 *
 * @param {object} params
 * @param {ProgressionBlueprint|null} params.activeBlueprint
 * @param {number|null} [params.targetLevel]
 * @param {number|null} [params.currentLevel]
 * @param {Set<number>} [params.expandedTiers]
 * @returns {string}
 */
export function buildBlueprintTableHtml({ activeBlueprint, targetLevel, currentLevel, expandedTiers }) {
    if (!activeBlueprint || !activeBlueprint.levels) {
        return '<div style="padding: 16px; color: #94a3b8; text-align: center;"><em>No progression codex available.</em></div>';
    }

    const curLvl = Math.min(20, Math.max(1, targetLevel || currentLevel || 1));
    const tiers = [
        { label: 'Tier 1', from: 1, to: 4 },
        { label: 'Tier 2', from: 5, to: 10 },
        { label: 'Tier 3', from: 11, to: 16 },
        { label: 'Tier 4', from: 17, to: 20 },
    ];
    const effectiveExpanded = expandedTiers instanceof Set
        ? expandedTiers
        : new Set([tiers.findIndex(t => curLvl >= t.from && curLvl <= t.to)].filter(i => i >= 0));

    const normalizedLevels = {};
    for (let lvl = 1; lvl <= 20; lvl++) {
        normalizedLevels[lvl] = normalizeLevelEntry(activeBlueprint.levels[String(lvl)] ?? activeBlueprint.levels[lvl], lvl);
    }
    const blueprintDeclaresAsi = Object.values(normalizedLevels).some(l => l.asi);

    let rowsHtml = '';
    tiers.forEach((tier, tierIdx) => {
        const open = effectiveExpanded.has(tierIdx);
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

    return `
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
}

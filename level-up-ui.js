/// <reference path="./types.d.ts" />
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

import { formulateLevelUpProposal, applyLevelUpCommit, extractFeatureKey, deduplicateFeatures, mergeUpgradedFeatures, collapseCodexProgression, ensureNamedFeature, matchesFeatureRemovalTarget, applyPbtaAdvanceSelection, applyFaeMilestoneSelection, resolveFaeGenreKey, extractConciergeDirectives, splitTopLevelDirectives, buildFaeMilestonePrompt } from './level-up-runner.js';
import { getTierPerks, getCanonicalDndProgression, formatBlueprintSummary, parseBlueprintFromResponse, normalizeBlueprint, normalizeLevelEntry, formatTraitAsPill, partitionFeaturesAndAbilities } from './level-up-blueprint.js';
import { sendConciergeRequest } from './concierge-connection.js';
import { syncDossierToWorldInfoBook, persistCompanionDossier, parseCharacterBlockFromMemo } from './level-up-scaffold.js';
import { PBTA_GENRES, formatMoveAsPill } from './pbta-ruleset.js';
import { FAE_GENRES, sanitizeFaePositiveTags } from './fae-ruleset.js';
import { normalizeFaePill } from './fae-state-sync.js';
import { loadActiveCampaignDossier } from './concierge-ui.js';
import { systemRegistry } from './concierge-system-registry.js';
import './concierge-system-pbta.js';
import './concierge-system-fae.js';
import './concierge-system-dnd5e.js';
import { escapeHtml } from './mhc-utils.js';
import {
    buildPbtaAdvanceSectionHtml,
    buildDndAsiAndPartyHtml,
    buildFaeMilestoneAndTuningHtml,
    buildLevelUpModalHtml,
    buildBlueprintTableHtml,
} from './level-up-stage-renderers.js';

export {
    buildPbtaAdvanceSectionHtml,
    buildDndAsiAndPartyHtml,
    buildFaeMilestoneAndTuningHtml,
    buildLevelUpModalHtml,
    buildBlueprintTableHtml,
};

let _activeModalElement = null;

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

    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('mhc_last_concierge_desk', 'character');
        }
    } catch (_) {}

    const detectedRuleset = systemRegistry.detectRuleset(dossier, {
        memo: rpgSettings?.currentMemo || '',
        fallback: 'dnd5e',
    });
    const isFae = detectedRuleset === 'fae';
    const isPbta = detectedRuleset === 'pbta';

    // Normalize on load so previously stored/LLM blueprints never show HP/ASI/slot bookkeeping as features
    let activeBlueprint = normalizeBlueprint(blueprint || dossier?.progressionBlueprint || null);
    const isLoadingBlueprint = !isPbta && !isFae && !!blueprintPromise && !activeBlueprint;

    // Stage selection: PbtA and FAE always use Stage 2 (Playbook / Milestone Desk).
    // For D&D: if initialStage is passed, honor it. Otherwise, if blueprint exists, default to 2; if not, default to 1.
    let currentStage = (isPbta || isFae) ? 2 : (initialStage ? initialStage : (activeBlueprint ? 2 : 1));

    const parsedCurrentSheet = parseCharacterBlockFromMemo(rpgSettings?.currentMemo || '');
    const initialSheetFeatures = Array.isArray(dossier?.protagonist?.features) && dossier.protagonist.features.length > 0
        ? [...dossier.protagonist.features]
        : (parsedCurrentSheet.features || []);

    const proposal = formulateLevelUpProposal(dossier, activeBlueprint, targetLevel, {
        isRespec,
        isPbta,
        isFae,
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

    const pbtaStatNames = (Array.isArray(proposal.statNames) && proposal.statNames.length > 0)
        ? proposal.statNames
        : Object.keys(proposal.stats || {});
    const pbtaStatNamesStr = pbtaStatNames.length > 0
        ? pbtaStatNames.join(', ')
        : 'Might, Agility, Wits, Heart, Arcana';

    modal.innerHTML = buildLevelUpModalHtml({
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
    });

    document.body.appendChild(modal);
    _activeModalElement = modal;

    loadActiveCampaignDossier(chatId).then(found => {
        modal.querySelectorAll('.mhc-mode-nav-btn[data-nav-mode="living-world"]').forEach(btn => {
            btn.style.display = found ? '' : 'none';
        });
    }).catch(() => {});

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

        if (activeBlueprint && activeBlueprint.levels && !tiersInitialized) {
            const curLvl = Math.min(20, Math.max(1, targetLevel || proposal.currentLevel || 1));
            const tiers = [
                { from: 1, to: 4 },
                { from: 5, to: 10 },
                { from: 11, to: 16 },
                { from: 17, to: 20 },
            ];
            const tierIdx = tiers.findIndex(t => curLvl >= t.from && curLvl <= t.to);
            if (tierIdx >= 0) expandedTiers.add(tierIdx);
            tiersInitialized = true;
        }

        tableContainer.innerHTML = buildBlueprintTableHtml({
            activeBlueprint,
            targetLevel,
            currentLevel: proposal.currentLevel,
            expandedTiers,
        });

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

    // FAE Positive Tags Rendering
    const faePosTagsContainer = modal.querySelector('#mhc-fae-pos-tags-list');
    function renderFaePosTags() {
        if (!faePosTagsContainer) return;
        const tags = proposal.positiveTags || [];
        if (tags.length === 0) {
            faePosTagsContainer.innerHTML = '<li class="mhc-perk-item"><em>None</em></li>';
            return;
        }
        faePosTagsContainer.innerHTML = tags.map((t, idx) => `
            <li class="mhc-perk-item" data-pos-tag-index="${idx}">
                <i class="fa-solid fa-tag" style="color: #4ade80;"></i>
                <span class="mhc-perk-text" style="flex: 1;">${escapeHtml(t)}</span>
                <button class="mhc-remove-fae-pos-tag-btn" data-index="${idx}" title="Remove tag" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1em; line-height:1; padding:0 4px;">&times;</button>
            </li>
        `).join('');

        faePosTagsContainer.querySelectorAll('.mhc-remove-fae-pos-tag-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx) && idx >= 0 && idx < proposal.positiveTags.length) {
                    proposal.positiveTags.splice(idx, 1);
                    proposal.newFeatures = [...proposal.positiveTags];
                    renderFaePosTags();
                }
            });
        });
    }

    // FAE Negative Tags (Scars & Debuffs) Rendering
    const faeNegTagsContainer = modal.querySelector('#mhc-fae-neg-tags-list');
    function renderFaeNegTags() {
        if (!faeNegTagsContainer) return;
        const scars = proposal.negativeTags || [];
        if (scars.length === 0) {
            faeNegTagsContainer.innerHTML = '<li class="mhc-perk-item"><em>None</em></li>';
            return;
        }
        faeNegTagsContainer.innerHTML = scars.map((s, idx) => `
            <li class="mhc-perk-item" data-neg-tag-index="${idx}">
                <i class="fa-solid fa-skull-crossbones" style="color: #f87171;"></i>
                <span class="mhc-perk-text" style="flex: 1;">${escapeHtml(s)}</span>
                <button class="mhc-remove-fae-neg-tag-btn" data-index="${idx}" title="Remove scar" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:1.1em; line-height:1; padding:0 4px;">&times;</button>
            </li>
        `).join('');

        faeNegTagsContainer.querySelectorAll('.mhc-remove-fae-neg-tag-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx) && idx >= 0 && idx < proposal.negativeTags.length) {
                    proposal.negativeTags.splice(idx, 1);
                    proposal.scars = [...proposal.negativeTags];
                    renderFaeNegTags();
                }
            });
        });
    }

    if (isFae) {
        renderFaePosTags();
        renderFaeNegTags();
    }

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
    if (isFae) {
        initialGreeting = isRespec
            ? `Greetings, ${proposal.characterName}! Welcome to your FAE Attrition & Knob Tuning Desk. Here we can tune your resource pools, adjust narrative knobs (Flee Grace, Attrition Shift, Overflow), and refine your positive capabilities or scars. How would you like to tune your character?`
            : `Greetings, ${proposal.characterName}! You have reached an FAE Milestone after completing ${proposal.pacingScenes || 4} scenes. Choose your milestone reward on the left, or ask me for advice on capabilities, healing scars, or hardening pool reserves.`;
    } else if (isPbta) {
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

        const systemPrompt = isFae ? buildFaeMilestonePrompt(proposal, dossier)
        : (isPbta ? `You are the Playbook Guide and PbtA narrative systems architect for "${proposal.characterName}", playing the "${proposal.playbookName || proposal.className}" playbook.
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
6. Concise & Inspiring: Keep your spoken reply evocative, clear, and under 130 words.`);

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
                if (dir.tag === 'ADD_TAG' && isFae) {
                    const rawTag = dir.payload.trim();
                    if (rawTag) {
                        const norm = normalizeFaePill(rawTag);
                        proposal.positiveTags = proposal.positiveTags || [];
                        const key = extractFeatureKey(norm);
                        const idx = proposal.positiveTags.findIndex(t => extractFeatureKey(t) === key);
                        if (idx >= 0) {
                            proposal.positiveTags[idx] = norm;
                        } else {
                            proposal.positiveTags.push(norm);
                        }
                        proposal.newFeatures = [...proposal.positiveTags];
                        renderFaePosTags();
                        if (typeof toastr !== 'undefined') toastr.info(norm, 'Added Positive Tag');
                    }
                } else if (dir.tag === 'REMOVE_TAG' && isFae) {
                    const target = dir.payload.trim();
                    proposal.positiveTags = (proposal.positiveTags || []).filter(t => !matchesFeatureRemovalTarget(t, target));
                    proposal.newFeatures = [...proposal.positiveTags];
                    renderFaePosTags();
                } else if (dir.tag === 'ADD_SCAR' && isFae) {
                    let rawScar = dir.payload.trim();
                    if (rawScar.startsWith('(-)')) rawScar = rawScar.replace(/^\(-\)\s*/, '');
                    const norm = normalizeFaePill(rawScar);
                    proposal.negativeTags = proposal.negativeTags || [];
                    const key = extractFeatureKey(norm);
                    const idx = proposal.negativeTags.findIndex(s => extractFeatureKey(s) === key);
                    if (idx >= 0) {
                        proposal.negativeTags[idx] = norm;
                    } else {
                        proposal.negativeTags.push(norm);
                    }
                    proposal.scars = [...proposal.negativeTags];
                    renderFaeNegTags();
                    if (typeof toastr !== 'undefined') toastr.info(norm, 'Added Scar / Debuff');
                } else if (dir.tag === 'REMOVE_SCAR' && isFae) {
                    const target = dir.payload.trim();
                    proposal.negativeTags = (proposal.negativeTags || []).filter(s => !matchesFeatureRemovalTarget(s, target));
                    proposal.scars = [...proposal.negativeTags];
                    renderFaeNegTags();
                } else if (dir.tag === 'SET_POOL' && isFae && proposal.pools) {
                    const pipeIdx = dir.payload.indexOf('|');
                    if (pipeIdx > 0) {
                        const pTarget = dir.payload.slice(0, pipeIdx).trim().toLowerCase();
                        const pVal = dir.payload.slice(pipeIdx + 1).trim();
                        const poolEntry = Object.entries(proposal.pools).find(([k, p]) =>
                            k.toLowerCase() === pTarget || (p.label && p.label.toLowerCase() === pTarget)
                        );
                        if (poolEntry) {
                            const [pKey, pool] = poolEntry;
                            const slashMatch = pVal.match(/^(\d+)(?:\s*\/\s*(\d+))?$/);
                            if (slashMatch) {
                                const cur = parseInt(slashMatch[1], 10);
                                if (slashMatch[2]) {
                                    pool.max = Math.min(12, Math.max(1, parseInt(slashMatch[2], 10)));
                                    pool.current = Math.min(pool.max, Math.max(0, cur));
                                } else {
                                    pool.current = Math.min(pool.max, Math.max(0, cur));
                                }
                                const curInput = modal.querySelector(`.mhc-fae-pool-cur[data-pool="${pKey}"]`);
                                if (curInput) {
                                    curInput.value = String(pool.current);
                                    curInput.max = String(pool.max);
                                }
                                const maxInput = modal.querySelector(`.mhc-fae-pool-max[data-pool="${pKey}"]`);
                                if (maxInput) maxInput.value = String(pool.max);
                            }
                        }
                    }
                } else if (dir.tag === 'SET_KNOB' && isFae) {
                    const pipeIdx = dir.payload.indexOf('|');
                    if (pipeIdx > 0) {
                        const knobName = dir.payload.slice(0, pipeIdx).trim().toLowerCase();
                        const knobVal = dir.payload.slice(pipeIdx + 1).trim();
                        proposal.knobs = proposal.knobs || {};
                        if (knobName.includes('flee')) {
                            proposal.knobs.flee_grace_toggle = /^(on|true|yes|1)$/i.test(knobVal);
                            const chk = modal.querySelector('#mhc_fae_flee_grace_chk');
                            if (chk) chk.checked = proposal.knobs.flee_grace_toggle;
                        } else if (knobName.includes('shift')) {
                            proposal.knobs.base_attrition_shift = Math.max(-1, Math.min(1, parseInt(knobVal, 10) || 0));
                            const sel = modal.querySelector('#mhc_fae_shift_select');
                            if (sel) sel.value = String(proposal.knobs.base_attrition_shift);
                        } else if (knobName.includes('overflow')) {
                            proposal.knobs.overflow_default = knobVal;
                            const sel = modal.querySelector('#mhc_fae_overflow_select');
                            if (sel) sel.value = knobVal;
                        }
                    }
                } else if (dir.tag === 'ADD_FEATURE') {
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

            if (!isPbta && !isFae) {
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

    // Header Mode Switcher (.mhc-mode-nav-btn)
    let _isLevelUpNavigating = false;
    modal.querySelectorAll('.mhc-mode-nav-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (_isLevelUpNavigating) return;
            const mode = btn.getAttribute('data-nav-mode');
            if (mode === 'character') return;
            _isLevelUpNavigating = true;
            try {
                if (typeof sessionStorage !== 'undefined') {
                    sessionStorage.setItem('mhc_last_concierge_desk', mode);
                }
            } catch (_) {}
            try {
                closeLevelUpModal();
                const { openConciergeModal } = await import('./concierge-ui.js');
                await openConciergeModal({
                    ruleset: mode === 'new-adventure' ? null : (isFae ? 'fae' : (isPbta ? 'pbta' : 'dnd5e')),
                    navMode: mode,
                });
            } finally {
                setTimeout(() => { _isLevelUpNavigating = false; }, 300);
            }
        });
    });

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

    // FAE Controls & Handlers
    if (isFae) {
        const posTagInput = modal.querySelector('#mhc_fae_manual_pos_tag_input');
        const posTagAddBtn = modal.querySelector('#mhc_fae_manual_pos_tag_btn');

        const handleAddPosTag = () => {
            const val = posTagInput?.value?.trim();
            if (!val) return;
            const norm = normalizeFaePill(val);
            proposal.positiveTags = proposal.positiveTags || [];
            const key = extractFeatureKey(norm);
            const idx = proposal.positiveTags.findIndex(t => extractFeatureKey(t) === key);
            if (idx >= 0) {
                proposal.positiveTags[idx] = norm;
            } else {
                proposal.positiveTags.push(norm);
            }
            proposal.newFeatures = [...proposal.positiveTags];
            posTagInput.value = '';
            renderFaePosTags();
        };

        posTagAddBtn?.addEventListener('click', handleAddPosTag);
        posTagInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddPosTag();
            }
        });

        const negTagInput = modal.querySelector('#mhc_fae_manual_neg_tag_input');
        const negTagAddBtn = modal.querySelector('#mhc_fae_manual_neg_tag_btn');

        const handleAddNegTag = () => {
            let val = negTagInput?.value?.trim();
            if (!val) return;
            if (val.startsWith('(-)')) val = val.replace(/^\(-\)\s*/, '');
            const norm = normalizeFaePill(val);
            proposal.negativeTags = proposal.negativeTags || [];
            const key = extractFeatureKey(norm);
            const idx = proposal.negativeTags.findIndex(s => extractFeatureKey(s) === key);
            if (idx >= 0) {
                proposal.negativeTags[idx] = norm;
            } else {
                proposal.negativeTags.push(norm);
            }
            proposal.scars = [...proposal.negativeTags];
            negTagInput.value = '';
            renderFaeNegTags();
        };

        negTagAddBtn?.addEventListener('click', handleAddNegTag);
        negTagInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddNegTag();
            }
        });

        // Pool inputs
        modal.querySelectorAll('.mhc-fae-pool-cur').forEach(input => {
            input.addEventListener('change', () => {
                const pKey = input.getAttribute('data-pool');
                if (proposal.pools?.[pKey]) {
                    const val = parseInt(input.value, 10);
                    proposal.pools[pKey].current = Math.min(proposal.pools[pKey].max, Math.max(0, isNaN(val) ? 0 : val));
                    input.value = String(proposal.pools[pKey].current);
                }
            });
        });

        modal.querySelectorAll('.mhc-fae-pool-max').forEach(input => {
            input.addEventListener('change', () => {
                const pKey = input.getAttribute('data-pool');
                if (proposal.pools?.[pKey]) {
                    const val = parseInt(input.value, 10);
                    proposal.pools[pKey].max = Math.min(12, Math.max(1, isNaN(val) ? 1 : val));
                    proposal.pools[pKey].current = Math.min(proposal.pools[pKey].max, proposal.pools[pKey].current);
                    input.value = String(proposal.pools[pKey].max);
                    const curInput = modal.querySelector(`.mhc-fae-pool-cur[data-pool="${pKey}"]`);
                    if (curInput) {
                        curInput.max = String(proposal.pools[pKey].max);
                        curInput.value = String(proposal.pools[pKey].current);
                    }
                }
            });
        });

        modal.querySelector('#mhc_fae_flee_grace_chk')?.addEventListener('change', (e) => {
            proposal.knobs = proposal.knobs || {};
            proposal.knobs.flee_grace_toggle = e.target.checked;
        });

        modal.querySelector('#mhc_fae_shift_select')?.addEventListener('change', (e) => {
            proposal.knobs = proposal.knobs || {};
            proposal.knobs.base_attrition_shift = parseInt(e.target.value, 10) || 0;
        });

        modal.querySelector('#mhc_fae_overflow_select')?.addEventListener('change', (e) => {
            proposal.knobs = proposal.knobs || {};
            proposal.knobs.overflow_default = e.target.value;
        });

        // Milestone radio selection
        modal.querySelectorAll('input[name="mhc_fae_milestone_pick"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const val = radio.value;
                modal.querySelectorAll('.mhc-fae-milestone-detail').forEach(el => {
                    const det = el.getAttribute('data-milestone-detail');
                    el.style.display = (det === val) ? 'flex' : 'none';
                });
            });
        });

        const tagSelect = modal.querySelector('#mhc_fae_tag_select');
        const customTagInput = modal.querySelector('#mhc_fae_custom_tag_input');
        tagSelect?.addEventListener('change', () => {
            if (!customTagInput) return;
            if (tagSelect.value !== 'custom') {
                customTagInput.value = tagSelect.value;
            } else {
                customTagInput.value = '';
                customTagInput.focus();
            }
        });
    }

    // Confirm & Apply Advancement
    const confirmBtn = modal.querySelector('#mhc-confirm-apply-btn');
    confirmBtn?.addEventListener('click', () => {
        if (isFae && !isRespec) {
            const selectedMilestoneType = modal.querySelector('input[name="mhc_fae_milestone_pick"]:checked')?.value;
            if (selectedMilestoneType === 'heal_scar') {
                const scarVal = modal.querySelector('#mhc_fae_heal_scar_select')?.value || '';
                const restorePoolVal = modal.querySelector('#mhc_fae_restore_pool_select')?.value || '';
                if (scarVal) {
                    proposal.faeMilestone = { type: 'heal_scar', scar: scarVal };
                } else if (restorePoolVal) {
                    proposal.faeMilestone = { type: 'heal_scar', restorePool: restorePoolVal };
                } else {
                    proposal.faeMilestone = { type: 'heal_scar' };
                }
            } else if (selectedMilestoneType === 'new_capability') {
                const customInputVal = modal.querySelector('#mhc_fae_custom_tag_input')?.value?.trim();
                const selectVal = modal.querySelector('#mhc_fae_tag_select')?.value;
                const chosenTag = customInputVal || (selectVal !== 'custom' ? selectVal : '') || '';
                proposal.faeMilestone = { type: 'new_capability', tag: chosenTag };
            } else if (selectedMilestoneType === 'hardened_reserve') {
                const targetPool = modal.querySelector('#mhc_fae_hardened_pool_select')?.value;
                proposal.faeMilestone = { type: 'hardened_reserve', pool: targetPool };
            }
            if (proposal.faeMilestone) {
                applyFaeMilestoneSelection(proposal, proposal.faeMilestone);
            }
        }

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
                if (isFae) {
                    dossier.protagonist.pools = JSON.parse(JSON.stringify(proposal.pools));
                    dossier.protagonist.positiveTags = [...(proposal.positiveTags || [])];
                    dossier.protagonist.negativeTags = [...(proposal.negativeTags || [])];
                    dossier.config = dossier.config || {};
                    dossier.config.knobs = { ...(proposal.knobs || {}) };
                } else if (isPbta) {
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
                const successMsg = isFae
                    ? (isRespec ? `FAE pools, tags, and knobs tuned and saved for ${proposal.characterName}!` : `Milestone reward applied for ${proposal.characterName}!`)
                    : (isPbta
                        ? (isRespec ? 'Playbook moves and harm clocks updated!' : `Playbook advanced for ${proposal.characterName}!`)
                        : (isRespec ? `Build changes saved for ${proposal.characterName} (Level ${proposal.currentLevel})!` : `Advanced to Level ${proposal.targetLevel}!`));
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

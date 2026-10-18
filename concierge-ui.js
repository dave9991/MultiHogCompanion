/**
 * concierge-ui.js — MultiHog Companion
 *
 * Controller for the PbtA Concierge Session Zero modal interface.
 * Handles chat messaging, drag-and-drop / file attachments, character card & lorebook
 * imports, live dossier updating, and campaign launching.
 */

import {
    getConciergeConnectionSettings,
    updateConciergeConnectionSettings,
    sendConciergeRequest,
} from './concierge-connection.js';
import {
    readImageAsDataUrl,
    extractDocumentContent,
    formatDocumentPromptBlock,
    formatChatTranscriptPromptBlock,
} from './concierge-files.js';
import {
    parseCharacterFile,
    formatCharacterInspirationBlock,
    normalizeCharacterCard,
    resolveCardMacros,
    stripSillyTavernMacros,
} from './concierge-card-reader.js';
import {
    fetchWorldInfoBook,
    processLorebookForConcierge,
} from './concierge-lore-reader.js';
import {
    buildConciergeSystemPrompt,
    buildConciergeBuilderContext,
    buildConciergeCriticContext,
    buildConciergeRefinerContext,
    buildConciergeTalkerContext,
} from './concierge-prompt.js';
import {
    createEmptyDossier,
    stripConciergeStateBlocks,
    parseConciergeStateBlock,
    applyDossierUpdates,
    parseDossierCritique,
    shouldRunContemplativeJudgePass,
    formatDossierForContext,
    formatChangelogForContext,
    serializeDossierToMarkdown,
    classifyBuilderReport,
    buildTalkerInstructionNotice,
    formatDiagnosticTrace as formatDiagnosticTraceParser,
    healAndNormalizeDossier,
    parseMarkdownToDossier,
    validateDraft,
    isDossierEmptyOrUntouched,
    escapeHtml,
    buildAxiomCardHtml,
} from './concierge-parser.js';
import { launchPbtaCampaign, syncPbtaCampaignUpdates, reconstituteDossierWithAi } from './concierge-runner.js';
import {
    getExistingAdventureNames,
    checkAdventureNameExists,
    findNextAdventureVersionName,
} from './adventure-chat.js';
import { PBTA_GENRES } from './pbta-ruleset.js';
import { buildNameRagSeedsForConcierge, resolveDossierNamePlaceholders } from './namerag-hooks.js';
import {
    getCompanionActiveCartridge,
    getCandidateChatIds,
} from './pbta-ruleset-persistence.js';
let extension_settings = globalThis.extension_settings || {};
try {
    const extModule = await import('../../../extensions.js');
    if (extModule?.extension_settings) extension_settings = extModule.extension_settings;
} catch (_) {}

export const STORAGE_DRAFT_KEY = 'mhc_pbta_concierge_draft';

let modalInitialized = false;
let activeDossier = createEmptyDossier();
let loadedCampaignOriginChatId = null;
let loadedCampaignOriginTitle = null;
let chatHistory = [];
let changelog = [];
let pendingAttachments = [];
let isGenerating = false;
let activeImports = [];
let activeNameRagSeeds = '';
let activeNameRagKey = '';

function startImportProgress(label) {
    if (!label) return;
    activeImports.push(label);
    renderAttachmentTray();
}

function stopImportProgress(label) {
    if (!label) return;
    const idx = activeImports.indexOf(label);
    if (idx >= 0) activeImports.splice(idx, 1);
    renderAttachmentTray();
}

/**
 * Ensure the modal HTML template is loaded and mounted in the document.
 */
async function ensureModalMounted() {
    if (document.getElementById('mhc_concierge_modal')) return;

    try {
        const res = await fetch('scripts/extensions/third-party/MultiHogCompanion/concierge-modal.html');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container.firstElementChild);
    } catch (err) {
        console.error('[PbtA Concierge] Could not load modal HTML template:', err);
    }
}

/**
 * Save current session draft to localStorage.
 * Only saves if there is active progress (chat messages or modified blueprint).
 * Untouched sessions do not pollute storage.
 */
function saveDraft() {
    try {
        const hasChat = Array.isArray(chatHistory) && chatHistory.length > 0;
        const isUntouched = !hasChat && isDossierEmptyOrUntouched(activeDossier);
        if (isUntouched) {
            localStorage.removeItem(STORAGE_DRAFT_KEY);
            return;
        }
        const payload = {
            dossier: activeDossier,
            chatHistory,
            changelog,
            originChatId: loadedCampaignOriginChatId,
            originCampaignTitle: loadedCampaignOriginTitle,
            timestamp: Date.now(),
        };
        localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(payload));
    } catch (_) {}
}

/**
 * Load and strictly validate draft from localStorage.
 * Returns { draft } if valid, { corrupted: true } if invalid/partial, or null if empty.
 */
export function loadValidatedDraft() {
    try {
        const raw = localStorage.getItem(STORAGE_DRAFT_KEY);
        if (!raw) return null;
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (parseErr) {
            console.warn('[PbtA Concierge] Corrupted JSON in draft storage; purging:', parseErr);
            localStorage.removeItem(STORAGE_DRAFT_KEY);
            return { corrupted: true };
        }
        const validated = validateDraft(parsed);
        if (!validated) {
            console.warn('[PbtA Concierge] Incomplete draft detected; purging for clean start.');
            localStorage.removeItem(STORAGE_DRAFT_KEY);
            return { corrupted: true };
        }
        return { draft: validated };
    } catch (err) {
        console.warn('[PbtA Concierge] Unexpected error reading draft; purging:', err);
        try { localStorage.removeItem(STORAGE_DRAFT_KEY); } catch (_) {}
        return { corrupted: true };
    }
}

/**
 * Displays an in-modal confirmation overlay inside #mhc_concierge_modal instead of native window.confirm()
 * (which is silently auto-cancelled when browser automation/CDP sessions or popup blockers are active).
 * Dynamically mounts the overlay if cached HTML did not include it.
 *
 * @param {object} opts
 * @param {string} [opts.icon='↺']
 * @param {string} [opts.title='Confirm Action']
 * @param {string} opts.message
 * @param {string} [opts.confirmLabel='Confirm']
 * @param {string} [opts.confirmColor='#dc2626']
 * @returns {Promise<boolean>}
 */
function showConciergeConfirm({
    icon = '↺',
    title = 'Confirm Action',
    message = 'Are you sure?',
    confirmLabel = 'Confirm',
    confirmColor = '#dc2626',
} = {}) {
    if (typeof document === 'undefined') {
        return Promise.resolve(true);
    }
    const modalRoot = document.getElementById('mhc_concierge_modal');
    if (!modalRoot) {
        return Promise.resolve(true);
    }

    let overlay = document.getElementById('mhc_confirm_overlay');
    if (!overlay) {
        const cardContainer = modalRoot.querySelector('.mhc-concierge-window') || modalRoot;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div id="mhc_confirm_overlay" class="mhc-launch-overlay" style="display: none; z-index: 110;">
                <div class="mhc-launch-card" style="width: 440px; max-width: 92%; text-align: left;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                        <span id="mhc_confirm_icon" style="font-size: 1.4em;"></span>
                        <h3 id="mhc_confirm_title" style="margin: 0; font-size: 1.15em; color: #f87171;"></h3>
                    </div>
                    <p id="mhc_confirm_message" style="font-size: 0.9em; line-height: 1.45; opacity: 0.9; margin: 0 0 18px 0; white-space: pre-line;"></p>
                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button type="button" id="mhc_confirm_cancel_btn" class="menu_button" style="padding: 6px 14px; font-size: 0.88em;">Cancel</button>
                        <button type="button" id="mhc_confirm_ok_btn" class="menu_button" style="background: #dc2626; border: 1px solid #ef4444; color: white; font-weight: bold; padding: 6px 16px; font-size: 0.88em;"></button>
                    </div>
                </div>
            </div>
        `;
        cardContainer.appendChild(wrapper.firstElementChild);
        overlay = document.getElementById('mhc_confirm_overlay');
    }

    $('#mhc_confirm_icon').text(icon);
    $('#mhc_confirm_title').text(title);
    $('#mhc_confirm_message').text(message);
    $('#mhc_confirm_ok_btn').text(confirmLabel).css({
        background: confirmColor,
        borderColor: confirmColor,
    });

    return new Promise(resolve => {
        const cleanup = (result) => {
            $('#mhc_confirm_ok_btn').off('click.mhcConfirm');
            $('#mhc_confirm_cancel_btn').off('click.mhcConfirm');
            $('#mhc_confirm_overlay').fadeOut(120);
            resolve(result);
        };
        $('#mhc_confirm_ok_btn').off('click.mhcConfirm').on('click.mhcConfirm', () => cleanup(true));
        $('#mhc_confirm_cancel_btn').off('click.mhcConfirm').on('click.mhcConfirm', () => cleanup(false));
        $('#mhc_confirm_overlay').fadeIn(120);
    });
}

/**
 * Completely resets in-memory Session Zero state, blueprint, and UI.
 * Cleans out any saved draft from localStorage.
 */
export function resetConciergeState({ showGreeting = true } = {}) {
    try {
        localStorage.removeItem(STORAGE_DRAFT_KEY);
    } catch (_) {}

    activeDossier = createEmptyDossier();
    loadedCampaignOriginChatId = null;
    loadedCampaignOriginTitle = null;
    chatHistory = [];
    changelog = [];
    pendingAttachments = [];
    isGenerating = false;
    activeNameRagSeeds = '';
    activeNameRagKey = '';
    window._mhcLastBuilderTransaction = null;
    window._lastConciergeBuilderDiagnostic = null;

    renderDebugInspectorView(null);
    $('#mhc_chat_messages').empty();
    $('#mhc_chat_input').val('');
    $('#mhc_sync_active_campaign_btn').hide();
    $('#mhc_confirm_overlay').hide();
    renderAttachmentTray();
    updateBlueprintDeck();

    if (showGreeting) {
        appendChatBubble(
            'assistant',
            "Welcome to Session Zero! I'm your PbtA Concierge. Tell me what kind of game or adventure you'd like to play, or drop in a screenshot, character art, or lore document to inspire our world. What genre or vibe are you aiming for?",
        );
    }
}

/**
 * Render the Live Blueprint cards from activeDossier.
 */
function updateBlueprintDeck() {
    const meta = activeDossier.meta || {};
    const proto = activeDossier.protagonist || {};
    const npcs = activeDossier.npcs || [];
    const monsters = activeDossier.monsters || [];
    const maps = activeDossier.maps || [];
    const kick = activeDossier.theKick || {};

    // Header Badge & System Card
    const sysLabel = meta.systemLabel || PBTA_GENRES.fantasy.label;
    $('#mhc_header_system_badge').text(`🎲 ${sysLabel}`);
    $('#mhc_deck_system_tag').text(meta.systemKey?.toUpperCase() || 'FANTASY');
    const campTitle = (meta.title || '').trim() || 'Untitled PbtA Campaign';
    $('#mhc_deck_campaign_title').text(campTitle);
    $('#mhc_deck_system_desc').text(meta.premise || `PbtA ${sysLabel} fiction-first narrative engine.`);
    if (meta.tone) {
        $('#mhc_deck_system_tone_text').text(meta.tone);
        $('#mhc_deck_system_tone').show();
    } else {
        $('#mhc_deck_system_tone').hide();
    }

    // Campaign Calibration Dials Card
    const cfg = activeDossier.config || {};
    const playstyle = cfg.playstyle || 'cyoa_5';
    let playstyleLabel = 'CYOA (5 Choices)';
    let playstyleDialLabel = '🧭 CYOA: 5 Choices';
    if (playstyle === 'freeform') {
        playstyleLabel = 'Pure Freeform (No Choices)';
        playstyleDialLabel = '🧭 CYOA: Freeform';
    } else if (playstyle === 'cyoa_3') {
        playstyleLabel = 'CYOA (3 Choices)';
        playstyleDialLabel = '🧭 CYOA: 3 Choices';
    }
    $('#mhc_deck_dial_playstyle').text(playstyleLabel);
    $('#mhc_dial_playstyle_btn').text(playstyleDialLabel);

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
    $('#mhc_dial_party_btn').text(`👥 Party: ${partyLabel}`);

    const emojisOn = cfg.cyoaEmojis !== false;
    $('#mhc_dial_emojis_btn').text(`✨ Emojis: ${emojisOn ? 'On' : 'Off'}`);

    const simDepth = cfg.simulationDepth || 'active_fronts';
    let simLabel = 'Active Fronts';
    if (simDepth === 'living_world') simLabel = 'Living World';
    else if (simDepth === 'static') simLabel = 'Static Solo';
    $('#mhc_dial_sim_depth_btn').text(`🌍 Sim: ${simLabel}`);

    const relsOn = cfg.relationships !== false;
    $('#mhc_dial_relationships_btn').text(`🤝 Relations: ${relsOn ? 'On' : 'Off'}`).css('opacity', relsOn ? '1' : '0.65');

    if (cfg.artStyle) {
        $('#mhc_deck_dial_art_text').text(cfg.artStyle);
        $('#mhc_deck_dial_art').show();
    } else {
        $('#mhc_deck_dial_art').hide();
    }

    // World Axioms & Laws Card
    const worldRules = activeDossier.worldRules || { axioms: [], customModule: null };
    const axioms = worldRules.axioms || [];
    $('#mhc_deck_world_rules_count').text(axioms.length);
    const wrList = $('#mhc_deck_world_rules_list');
    wrList.empty();
    if (axioms.length) {
        axioms.forEach(ax => {
            wrList.append(buildAxiomCardHtml(ax));
        });
    } else {
        wrList.append('<div class="mhc-empty-hint">Standard world physics & tropes apply.</div>');
    }

    // Custom HUD Tracker Module Card
    const customMod = worldRules.customModule;
    const customModTag = customMod ? (customMod.tag || customMod.fieldKey || '') : '';
    const customModSample = customMod ? (customMod.sampleContent || customMod.sample || '') : '';
    if (customMod && (customModTag || customMod.label)) {
        $('#mhc_deck_custom_module_tag').text((customModTag || 'CUSTOM').toUpperCase());
        $('#mhc_deck_custom_module_label').text(customMod.label || customModTag);
        $('#mhc_deck_custom_module_instruction').text(customMod.instruction || '');
        if (customModSample) {
            $('#mhc_deck_custom_module_sample').text(customModSample).show();
        } else {
            $('#mhc_deck_custom_module_sample').hide();
        }
        $('#mhc_deck_custom_module_card').show();
    } else {
        $('#mhc_deck_custom_module_card').hide();
    }

    // Protagonist Card
    $('#mhc_deck_char_playbook').text(proto.playbook || 'In Development');
    $('#mhc_deck_char_name').text(proto.name || 'Unnamed Adventurer');

    const curHarm = parseInt(proto.harm?.current, 10) || 0;
    const maxHarm = parseInt(proto.harm?.max ?? activeDossier.config?.harmMax, 10) || 5;
    const curHp = Math.max(0, maxHarm - curHarm);
    if (curHarm > 0 || (proto.conditions && proto.conditions.length) || proto.status) {
        const condList = Array.isArray(proto.conditions) ? proto.conditions : (proto.conditions ? [proto.conditions] : []);
        const condText = condList.length ? ` · ${condList.join(', ')}` : '';
        const statusLabel = proto.status || (curHarm > 0 ? 'Wounded' : 'Healthy');
        $('#mhc_deck_char_vitals').html(`
            <span class="mhc-pill" style="border-color: rgba(239, 68, 68, 0.5); color: #f87171; background: rgba(239, 68, 68, 0.1);" title="Vitals & Injuries">
                🩸 ${curHp}/${maxHarm} HP (Harm: ${curHarm}/${maxHarm}) · ${escapeHtml(statusLabel)}${escapeHtml(condText)}
            </span>
        `).show();
    } else {
        $('#mhc_deck_char_vitals').empty().hide();
    }

    const statsEl = $('#mhc_deck_char_stats');
    statsEl.empty();
    const statsObj = proto.stats && Object.keys(proto.stats).length ? proto.stats : { Might: 0, Agility: 0, Wits: 0, Heart: 0, Arcana: 0 };
    for (const [sName, sVal] of Object.entries(statsObj)) {
        const sign = sVal >= 0 ? '+' : '';
        statsEl.append(`<span class="mhc-stat-pill">${sName} ${sign}${sVal}</span>`);
    }

    const movesEl = $('#mhc_deck_char_moves');
    if (proto.startingMoves && proto.startingMoves.length) {
        movesEl.html(proto.startingMoves.map(m => `<div>• <b>${m}</b></div>`).join(''));
    } else {
        movesEl.text('• Moves will be forged in the conversation.');
    }

    // Supporting Cast & Allies (NPCs) Card
    $('#mhc_deck_npc_count').text(npcs.length);
    const npcList = $('#mhc_deck_npcs_list');
    npcList.empty();
    if (npcs.length) {
        npcs.forEach(n => {
            const role = n.role || 'Ally';
            const demeanor = n.demeanor ? ` · <i>${n.demeanor}</i>` : '';
            const app = n.appearance ? `<div style="font-size: 0.8em; opacity: 0.85;"><b>Look:</b> ${n.appearance}</div>` : '';
            const rel = n.relationship ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Bond:</b> ${n.relationship}</div>` : '';
            const boons = n.movesOrBoons ? `<div style="font-size: 0.8em; opacity: 0.75;"><b>Boons/Moves:</b> ${n.movesOrBoons}</div>` : '';

            let woundBadge = '';
            let condsHtml = '';
            if (n.harm && (n.harm.current > 0 || n.status || (n.conditions && n.conditions.length))) {
                const nCur = parseInt(n.harm.current, 10) || 0;
                const nMax = parseInt(n.harm.max, 10) || 5;
                const nHp = Math.max(0, nMax - nCur);
                if (nCur > 0) {
                    woundBadge = ` <span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(239, 68, 68, 0.5); color: #f87171;">🩸 ${nHp}/${nMax} HP (${nCur}/${nMax} Harm)</span>`;
                }
            }
            if (n.conditions && n.conditions.length) {
                const condList = Array.isArray(n.conditions) ? n.conditions : [n.conditions];
                condsHtml = `<div style="font-size: 0.8em; opacity: 0.85; color: #f87171;"><b>Conditions:</b> ${escapeHtml(condList.join(', '))}</div>`;
            }

            let relControls = '';
            if (relsOn) {
                const fVal = n.friendship ?? 0;
                const aVal = n.affection ?? 0;
                const fSign = fVal >= 0 ? '+' : '';
                const aSign = aVal >= 0 ? '+' : '';
                relControls = `
                    <div class="mhc-npc-rel-controls" style="margin-top: 6px; padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 0.78em;">
                            <span style="color: #4ade80;">🤝 Friendship: <b class="mhc-rel-val-friendship">${fSign}${fVal}</b></span>
                            <input type="range" class="mhc-npc-rel-slider" data-npc="${encodeURIComponent(n.name)}" data-axis="friendship" min="-150" max="150" step="5" value="${fVal}" style="flex: 1; max-width: 130px; height: 3px; accent-color: #4ade80; cursor: pointer;">
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.78em;">
                            <span style="color: #f472b6;">💗 Affection: <b class="mhc-rel-val-affection">${aSign}${aVal}</b></span>
                            <input type="range" class="mhc-npc-rel-slider" data-npc="${encodeURIComponent(n.name)}" data-axis="affection" min="-150" max="150" step="5" value="${aVal}" style="flex: 1; max-width: 130px; height: 3px; accent-color: #f472b6; cursor: pointer;">
                        </div>
                    </div>
                `;
            }

            npcList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title" style="color: var(--mhc-accent, #3b82f6);">
                            👤 ${n.name} <span class="mhc-pill" style="font-size: 0.72em;">${role}</span>${woundBadge}${demeanor}
                        </div>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        ${app}
                        ${rel}
                        ${condsHtml}
                        ${relControls}
                        ${boons}
                    </div>
                </div>
            `);
        });
    } else {
        npcList.append('<div class="mhc-empty-hint">No supporting NPCs queued yet.</div>');
    }

    // Adversaries & Monsters Card
    $('#mhc_deck_monster_count').text(monsters.length);
    const mList = $('#mhc_deck_monsters_list');
    mList.empty();
    if (monsters.length) {
        monsters.forEach(m => {
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

            mList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title" style="color: var(--mhc-danger, #ef4444);">
                            👹 ${m.name} ${harmBadge} ${doomBadge}
                        </div>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        <div style="font-size: 0.85em; opacity: 0.85;"><b>Attacks:</b> ${attacks}</div>
                        <div style="font-size: 0.8em; opacity: 0.75;"><b>Weakness:</b> ${m.weakness || 'None specified'}</div>
                        ${movesLine}
                        ${doomLine}
                    </div>
                </div>
            `);
        });
    } else {
        mList.append('<div class="mhc-empty-hint">No monsters queued yet.</div>');
    }

    // Maps Card
    $('#mhc_deck_map_count').text(maps.length);
    const mapList = $('#mhc_deck_maps_list');
    mapList.empty();
    if (maps.length) {
        const startSiteName = (kick?.startingLocation || maps[0]?.site || '').toLowerCase().trim();
        maps.forEach(map => {
            const desc = map.briefDescription || map.prompt || '';
            const entrance = map.entrance ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Entrance:</b> ${map.entrance}</div>` : '';
            const features = map.features?.length ? `<div style="font-size: 0.8em; opacity: 0.8; margin-top: 4px;"><b>Features:</b> ${map.features.join(', ')}</div>` : '';
            const isPrimary = (map.site || '').toLowerCase().trim() === startSiteName;
            const stageBadge = isPrimary
                ? '<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;" title="Starting location: Generated immediately at launch">⭐ Starting Site</span>'
                : '<span class="mhc-pill" style="font-size: 0.72em; opacity: 0.75;" title="Queued in Locations lorebook for lazy on-entry generation">📦 Staged for Entry</span>';
            mapList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title">
                            🗺️ ${map.site} <span class="mhc-pill" style="font-size: 0.72em;">${map.kind || 'Site'} · ${map.threat || 'Threat'}</span> ${stageBadge}
                        </div>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        ${entrance}
                        <div style="font-size: 0.82em; opacity: 0.85;">${desc}</div>
                        ${features}
                    </div>
                </div>
            `);
        });
    } else {
        mapList.append('<div class="mhc-empty-hint">No maps queued yet.</div>');
    }

    // Factions & Powers Card
    const factions = activeDossier.factions || [];
    $('#mhc_deck_faction_count').text(factions.length);
    const fList = $('#mhc_deck_factions_list');
    if (fList.length) {
        fList.empty();
        if (factions.length) {
            factions.forEach(f => {
                const standing = f.standing || 'Neutral';
                let badgeColor = 'rgba(156, 163, 175, 0.4)';
                if (/friendly|allied|ally/i.test(standing)) badgeColor = 'rgba(34, 197, 94, 0.4)';
                else if (/hostile|enemy/i.test(standing)) badgeColor = 'rgba(239, 68, 68, 0.4)';
                const notes = f.notes ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Notes:</b> ${f.notes}</div>` : '';
                fList.append(`
                    <div class="mhc-deck-item collapsible">
                        <div class="mhc-deck-item-header">
                            <div class="mhc-deck-item-title" style="color: var(--mhc-warning, #f59e0b);">
                                🚩 ${f.name} <span class="mhc-pill" style="font-size: 0.72em; border-color: ${badgeColor};">${standing}</span>
                            </div>
                            <span class="mhc-deck-item-toggle">▼</span>
                        </div>
                        <div class="mhc-deck-item-detail">
                            <div style="font-size: 0.85em; opacity: 0.85;"><b>Agenda:</b> ${f.agenda || 'Unstated'}</div>
                            ${notes}
                        </div>
                    </div>
                `);
            });
        } else {
            fList.append('<div class="mhc-empty-hint">No factions queued yet.</div>');
        }
    }

    // Kick Card
    if (kick.crisis || kick.startingLocation) {
        $('#mhc_deck_kick_text').html(`
            <b>Start:</b> ${kick.startingLocation || 'Unknown'}<br>
            <b>Crisis:</b> ${kick.crisis || 'Imminent danger'}
        `);
    } else {
        $('#mhc_deck_kick_text').text('The starting scene and crisis will be staged here.');
    }

    // Raw Markdown Tab
    $('#mhc_raw_markdown_text').val(serializeDossierToMarkdown(activeDossier));
}

/**
 * Append a chat bubble to the message stream.
 */
function appendChatBubble(role, text, imageSrc = null, hasDiagnostic = false) {
    const stream = document.getElementById('mhc_chat_messages');
    if (!stream) return;

    const bubble = document.createElement('div');
    bubble.className = `mhc-bubble mhc-bubble-${role}`;

    let html = '';
    if (imageSrc) {
        html += `<img class="mhc-thumb-preview" src="${imageSrc}" alt="Attached Image">`;
    }

    if (text) {
        const formatted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.*?)\*/g, '<i>$1</i>')
            .replace(/\n/g, '<br>');
        html += `<div>${formatted}</div>`;
    }

    if (hasDiagnostic) {
        html += `
            <div style="margin-top: 8px;">
                <button type="button" class="mhc-copy-debug-trace-btn" style="font-size: 0.78em; padding: 4px 10px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 4px; color: #ef4444; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                    📋 Copy Antigravity Debug Trace
                </button>
            </div>
        `;
    }

    bubble.innerHTML = html;
    stream.appendChild(bubble);
    stream.scrollTop = stream.scrollHeight;
}

/**
 * Render the attachment tray chips.
 */
function renderAttachmentTray() {
    const tray = $('#mhc_attachment_tray');
    tray.empty();

    if (!pendingAttachments.length && !activeImports.length) {
        tray.hide();
        return;
    }

    tray.show();

    // 1. Settled attachment chips
    pendingAttachments.forEach((att, idx) => {
        let icon = '📄';
        if (att.type === 'image') icon = '🖼️';
        if (att.type === 'char') icon = '👤';
        if (att.type === 'lore') icon = '📚';
        if (att.type === 'chat') icon = '💬';

        const chip = $(`
            <div class="mhc-chip">
                <span>${icon} ${att.name}</span>
                <span class="mhc-chip-remove" data-index="${idx}" title="Remove attachment">✕</span>
            </div>
        `);
        tray.append(chip);
    });

    // 2. Active in-progress import chips
    activeImports.forEach(label => {
        const loadingChip = $(`
            <div class="mhc-chip mhc-chip-loading" title="Processing import...">
                <span class="mhc-spin">⏳</span>
                <span>Importing <b>${label}</b>...</span>
            </div>
        `);
        tray.append(loadingChip);
    });

    $('.mhc-chip-remove').on('click', function () {
        const idx = parseInt($(this).attr('data-index'), 10);
        pendingAttachments.splice(idx, 1);
        renderAttachmentTray();
    });
}

/**
 * Populate Connection dropdowns.
 */
function updateConnectionDropdowns() {
    const s = getConciergeConnectionSettings();
    const sourceSelect = $('#mhc_concierge_connection_source');
    const profileSelect = $('#mhc_concierge_profile_select');

    sourceSelect.val(s.connectionSource);

    const ctx = SillyTavern.getContext();
    const profiles = ctx.extensionSettings?.connectionManager?.profiles || [];

    profileSelect.empty();
    profileSelect.append('<option value="">-- Select Profile --</option>');
    profiles.forEach(p => {
        profileSelect.append(`<option value="${p.id}">${p.name || p.id}</option>`);
    });

    if (s.connectionSource === 'profile') {
        profileSelect.show();
        profileSelect.val(s.connectionProfileId);
    } else {
        profileSelect.hide();
    }
}

/**
 * Populate the Character and Lorebook inspiration dropdowns.
 */
function populateInspirationDropdowns() {
    const ctx = SillyTavern.getContext();

    // 1. ST Characters
    const chars = ctx.characters || [];
    const charSelect = $('#mhc_st_char_select');
    charSelect.empty();
    charSelect.append('<option value="">-- Choose Character --</option>');
    chars.forEach((c, idx) => {
        if (c?.name) {
            charSelect.append(`<option value="${idx}">${c.name}</option>`);
        }
    });

    // 2. ST Lorebooks
    const loreSelect = $('#mhc_st_lore_select');
    loreSelect.empty();
    loreSelect.append('<option value="">-- Choose Lorebook --</option>');

    let bookNames = [];
    if (Array.isArray(window.world_names)) {
        bookNames = window.world_names;
    } else {
        $('#world_info option').each(function () {
            const txt = $(this).text().trim();
            if (txt && !bookNames.includes(txt)) bookNames.push(txt);
        });
    }

    bookNames.forEach(b => {
        loreSelect.append(`<option value="${b}">${b}</option>`);
    });
}

/**
 * Process a user submission.
 */
async function handleUserSend() {
    if (isGenerating) return;

    const input = $('#mhc_chat_input');
    const text = input.val().trim();
    if (!text && !pendingAttachments.length) return;

    input.val('');
    const attachmentsToProcess = [...pendingAttachments];
    pendingAttachments = [];
    renderAttachmentTray();

    // 1. Process attachments into prompt additions
    let imageSrcForDisplay = null;
    let imagePayload = null;
    let documentPromptAdditions = '';

    for (const att of attachmentsToProcess) {
        if (att.type === 'image') {
            imageSrcForDisplay = att.dataUrl;
            imagePayload = {
                type: 'image_url',
                image_url: { url: att.dataUrl },
            };
            if (!activeDossier.protagonist.portraitSrc) {
                activeDossier.protagonist.portraitSrc = att.dataUrl;
            }
        } else if (att.type === 'doc') {
            documentPromptAdditions += formatDocumentPromptBlock(att.name, att.text, 5000, activeDossier?.protagonist?.name || '');
        } else if (att.type === 'char') {
            if (att.avatar && !imageSrcForDisplay) {
                imageSrcForDisplay = att.avatar;
            }
            if (att.avatar && !activeDossier.protagonist.portraitSrc) {
                activeDossier.protagonist.portraitSrc = att.avatar;
            }
            documentPromptAdditions += `\n${att.promptAddition}\n`;
        } else if (att.type === 'chat') {
            documentPromptAdditions += formatChatTranscriptPromptBlock(att.chatData, att.name, 40, activeDossier?.protagonist?.name || '');
        } else if (att.type === 'lore') {
            documentPromptAdditions += `\n${att.promptAddition}\n`;
        }
    }

    const rawUserText = (text + (documentPromptAdditions ? `\n${documentPromptAdditions}` : '')).trim();
    const fullUserText = resolveCardMacros(rawUserText, activeDossier?.protagonist?.name || '');

    // Display user bubble
    const displayUserText = text || '(Provided inspiration details)';
    appendChatBubble('user', displayUserText, imageSrcForDisplay);

    // Format LLM message payload
    let userMsgLlmContent;
    if (imagePayload) {
        userMsgLlmContent = [
            { type: 'text', text: fullUserText || 'Please analyze this inspiration image for our PbtA campaign.' },
            imagePayload,
        ];
    } else {
        userMsgLlmContent = fullUserText;
    }

    chatHistory.push({
        role: 'user',
        content: displayUserText,
        displayContent: displayUserText,
        llmContent: userMsgLlmContent,
        imageSrc: imageSrcForDisplay,
    });

    // Show typing bubble
    const stream = document.getElementById('mhc_chat_messages');
    const typingBubble = document.createElement('div');
    typingBubble.className = 'mhc-bubble mhc-bubble-assistant';
    typingBubble.id = 'mhc_typing_indicator';
    typingBubble.innerHTML = '<i>🎩 The Concierge is contemplating the fiction...</i>';
    stream.appendChild(typingBubble);
    stream.scrollTop = stream.scrollHeight;

    isGenerating = true;
    $('#mhc_send_btn').prop('disabled', true);

    try {
        const refreshNameRagSeedsIfNeeded = async () => {
            if (extension_settings?.multihog_companion?.nameRagEnhanceConcierge === false || extension_settings?.multihog_companion?.enableNameRag === false) {
                return;
            }
            const genreKey = activeDossier?.meta?.systemKey || activeDossier?.meta?.system || 'fantasy';
            const premiseKey = (activeDossier?.meta?.premise || '').trim().slice(0, 80);
            const nextKey = `${genreKey}|${premiseKey}`;
            if (!activeNameRagSeeds || activeNameRagKey !== nextKey) {
                try {
                    const seeds = await buildNameRagSeedsForConcierge({
                        genre: genreKey,
                        premise: activeDossier?.meta?.premise || '',
                        limit: 8,
                    });
                    if (seeds) {
                        activeNameRagSeeds = seeds;
                        activeNameRagKey = nextKey;
                    }
                } catch (_) {}
            }
        };

        await refreshNameRagSeedsIfNeeded();

        const preTurnDossier = JSON.parse(JSON.stringify(activeDossier));

        const formatHistoryMessage = (m) => {
            if (m.role === 'assistant') {
                const cleanContent = stripConciergeStateBlocks(m.content) || m.content;
                const reportPrefix = m.builderReport ? `[BUILDER_REPORT: ${m.builderReport}]\n\n` : '';
                return {
                    role: 'assistant',
                    name: 'PbtA_Concierge',
                    content: `${reportPrefix}${cleanContent}`,
                };
            }
            return {
                role: m.role,
                name: 'Player',
                content: m.llmContent ?? m.content,
            };
        };

        const typingEl = document.getElementById('mhc_typing_indicator');

        // ── Stage 1: The Builder (Pass 1 — Contemplation & Extraction) ─────
        if (typingEl) {
            typingEl.innerHTML = '<i>🎩 The Concierge is contemplating &amp; scaffolding the blueprint...</i>';
        }

        const builderMessages = [
            {
                role: 'system',
                name: 'System',
                content: buildConciergeBuilderContext(activeDossier, changelog, activeNameRagSeeds),
            },
            ...chatHistory.map(formatHistoryMessage),
        ];

        let builderAttempts = 0;
        const maxBuilderAttempts = 2;
        let builderRawResponse = '';
        let builderReport = null;
        let builderFailed = false;
        let currentBuilderMessages = [...builderMessages];
        const diagnosticAttempts = [];

        let latestNameRagResolutions = [];

        while (builderAttempts < maxBuilderAttempts) {
            builderAttempts++;
            builderRawResponse = await sendConciergeRequest(currentBuilderMessages);
            const preNameRagResponse = builderRawResponse;
            let turnNameRagResolutions = [];

            // Resolve unique Name Diversity placeholders ([[NAME:...]]) via NameRAG before parsing
            if (extension_settings?.multihog_companion?.enableNameRag !== false) {
                try {
                    const resolved = await resolveDossierNamePlaceholders(builderRawResponse, activeDossier, { returnDetails: true });
                    builderRawResponse = resolved.text;
                    turnNameRagResolutions = resolved.resolutions || [];
                    if (turnNameRagResolutions.length > 0) {
                        latestNameRagResolutions = turnNameRagResolutions;
                    }
                } catch (resErr) {
                    console.warn('[MultiHog Companion] Placeholder name resolution error:', resErr);
                }
            }

            builderReport = applyDossierUpdates(builderRawResponse, activeDossier);

            diagnosticAttempts.push({
                attempt: builderAttempts,
                rawResponse: builderRawResponse,
                rawResponseBeforeNameRag: preNameRagResponse,
                nameRagResolutions: turnNameRagResolutions,
                errors: builderReport.errors,
                hasMutations: builderReport.hasMutations,
                isNoop: builderReport.isNoop,
                builderSummary: builderReport.builderSummary,
                report: builderReport,
            });

            if (builderReport.hasMutations || builderReport.isNoop) {
                break;
            }

            // If syntax errors occurred and attempts remain, retry with error feedback
            if (builderAttempts < maxBuilderAttempts && builderReport.errors.length > 0) {
                if (typingEl) {
                    typingEl.innerHTML = '<i>🎩 The Concierge is recalibrating the blueprint...</i>';
                }
                currentBuilderMessages = [
                    ...builderMessages,
                    { role: 'assistant', name: 'PbtA_Builder', content: builderRawResponse },
                    {
                        role: 'system',
                        name: 'System',
                        content: `[PARSER_ERROR: Blueprint update contained errors: ${builderReport.errors.join('; ')}. Please correct these syntax errors and re-emit the [UPDATE_DOSSIER] block.]`,
                    },
                ];
            } else if (builderAttempts < maxBuilderAttempts && !builderReport.hasMutations && !builderReport.isNoop) {
                if (typingEl) {
                    typingEl.innerHTML = '<i>🎩 The Concierge is recalibrating the blueprint...</i>';
                }
                currentBuilderMessages = [
                    ...builderMessages,
                    { role: 'assistant', name: 'PbtA_Builder', content: builderRawResponse },
                    {
                        role: 'system',
                        name: 'System',
                        content: `[PARSER_ERROR: No [UPDATE_DOSSIER] or [NOOP] block found in output. You must emit either an [UPDATE_DOSSIER] block containing blueprint directives or a [NOOP] block.]`,
                    },
                ];
            }
        }

        const finalStatus = classifyBuilderReport(builderReport);
        builderFailed = (finalStatus === 'SYNTAX_ERROR' || finalStatus === 'UNRECOGNIZED_OUTPUT');

        let builderSummaryText = '';
        let critiqueResult = null;
        let refinerReportResult = null;

        if (finalStatus === 'MUTATED') {
            activeDossier = builderReport.updatedDossier;
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            builderReport.changes.forEach(c => changelog.push(`[${timeStr}] ${c}`));
            updateBlueprintDeck();
            saveDraft();
            builderSummaryText = builderReport.builderSummary || builderReport.changes.join('; ') || 'Blueprint updated';

            // Refresh NameRAG seeds if genre or premise changed during Pass 1
            await refreshNameRagSeedsIfNeeded();

            // ── Stage 1b: Smart-Gated Blueprint Judge / Critic Pass & Second-Pass Refiner ──
            const shouldJudge = shouldRunContemplativeJudgePass({
                prevDossier: preTurnDossier,
                updatedDossier: activeDossier,
                builderReport,
                hasAttachments: attachmentsToProcess.length > 0,
            });

            if (shouldJudge) {
                try {
                    if (typingEl) {
                        typingEl.innerHTML = '<i>⚖️ The Concierge is grading blueprint depth &amp; entanglement...</i>';
                    }
                    const criticMessages = [
                        {
                            role: 'system',
                            name: 'System',
                            content: buildConciergeCriticContext(
                                activeDossier,
                                displayUserText,
                                builderSummaryText,
                                builderReport.contemplation || activeDossier.contemplation,
                            ),
                        },
                        {
                            role: 'user',
                            name: 'Player',
                            content: 'Audit the current Campaign Blueprint against the 5-point PbtA design rubric and emit your [DOSSIER_CRITIQUE] block.',
                        },
                    ];

                    const criticRawResponse = await sendConciergeRequest(criticMessages);
                    critiqueResult = parseDossierCritique(criticRawResponse);

                    if (critiqueResult.shouldRevise) {
                        if (typingEl) {
                            typingEl.innerHTML = `<i>🔨 The Concierge is executing a second architectural pass (${critiqueResult.grade} · ${critiqueResult.score}/100)...</i>`;
                        }
                        const refinerMessages = [
                            {
                                role: 'system',
                                name: 'System',
                                content: buildConciergeRefinerContext(activeDossier, changelog, critiqueResult, activeNameRagSeeds),
                            },
                            ...chatHistory.map(formatHistoryMessage),
                            {
                                role: 'user',
                                name: 'System',
                                content: `Execute the Blueprint Judge's refinement directives now (${critiqueResult.directives.join('; ')}). Emit only the delta [UPDATE_DOSSIER] block.`,
                            },
                        ];

                        let refinerRawResponse = await sendConciergeRequest(refinerMessages);
                        let refinerNameRagResolutions = [];
                        if (extension_settings?.multihog_companion?.enableNameRag !== false) {
                            try {
                                const resolvedRefiner = await resolveDossierNamePlaceholders(refinerRawResponse, activeDossier, { returnDetails: true });
                                refinerRawResponse = resolvedRefiner.text;
                                refinerNameRagResolutions = resolvedRefiner.resolutions || [];
                                if (refinerNameRagResolutions.length > 0) {
                                    latestNameRagResolutions = [...latestNameRagResolutions, ...refinerNameRagResolutions];
                                }
                            } catch (_) {}
                        }

                        const refinerReport = applyDossierUpdates(refinerRawResponse, activeDossier);
                        refinerReportResult = refinerReport;

                        diagnosticAttempts.push({
                            attempt: `${builderAttempts}b (Refiner)`,
                            rawResponse: refinerRawResponse,
                            nameRagResolutions: refinerNameRagResolutions,
                            errors: refinerReport.errors,
                            hasMutations: refinerReport.hasMutations,
                            isNoop: refinerReport.isNoop,
                            builderSummary: refinerReport.builderSummary,
                            report: refinerReport,
                        });

                        if (refinerReport.hasMutations) {
                            activeDossier = refinerReport.updatedDossier;
                            refinerReport.changes.forEach(c => changelog.push(`[${timeStr} · Pass 2] ${c}`));
                            updateBlueprintDeck();
                            saveDraft();
                            const refinerSummaryPart = refinerReport.builderSummary || refinerReport.changes.join('; ');
                            builderSummaryText = `${builderSummaryText} [Refined in Pass 2 (${critiqueResult.grade}): ${refinerSummaryPart}]`;
                        }
                    }
                } catch (judgeErr) {
                    console.warn('[PbtA Concierge] Contemplative Judge/Refiner pass skipped due to error:', judgeErr);
                }
            }
        } else if (finalStatus === 'NOOP') {
            builderSummaryText = `NOOP (${builderReport.builderSummary || 'No blueprint changes requested'})`;
        } else if (finalStatus === 'SYNTAX_ERROR') {
            builderSummaryText = `SYNTAX_ERROR: ${builderReport.errors.join('; ')}`;
        } else {
            builderSummaryText = `UNRECOGNIZED_OUTPUT: No [UPDATE_DOSSIER] or [NOOP] block detected.`;
        }

        const transactionRecord = {
            timestamp: new Date().toISOString(),
            systemEngine: activeDossier?.meta?.systemKey || 'fantasy',
            userPrompt: displayUserText,
            builderRequest: {
                messages: currentBuilderMessages,
            },
            attempts: diagnosticAttempts,
            finalStatus,
            builderSummary: builderSummaryText,
            contemplation: builderReport?.contemplation || activeDossier?.contemplation || null,
            critique: critiqueResult,
            refinerPass: refinerReportResult,
            nameRagResolutions: latestNameRagResolutions,
            activeDossierSnapshot: JSON.parse(JSON.stringify(activeDossier)),
        };
        window._mhcLastBuilderTransaction = transactionRecord;
        window._lastConciergeBuilderDiagnostic = transactionRecord;
        renderDebugInspectorView(transactionRecord);

        // ── Stage 2: The Talker (Conversational Session Zero GM) ───────────
        if (typingEl) {
            typingEl.innerHTML = '<i>🎩 The Concierge is contemplating the fiction...</i>';
        }

        const talkerInstruction = buildTalkerInstructionNotice(finalStatus, builderSummaryText, builderReport?.errors);

        const talkerMessages = [
            {
                role: 'system',
                name: 'System',
                content: buildConciergeTalkerContext(activeDossier, changelog, activeNameRagSeeds),
            },
            ...chatHistory.map(formatHistoryMessage),
            {
                role: 'system',
                name: 'System',
                content: talkerInstruction,
            },
        ];

        let finalChatBubbleText = '';
        try {
            const talkerResponse = await sendConciergeRequest(talkerMessages);
            finalChatBubbleText = stripConciergeStateBlocks(talkerResponse) || talkerResponse;
        } catch (talkerErr) {
            console.warn('[PbtA Concierge] Talker error, falling back to basic response:', talkerErr);
            finalChatBubbleText = builderSummaryText ? `I have noted: ${builderSummaryText}` : 'Could not generate conversational response.';
        }

        typingBubble.remove();

        // Render clean bubble to the user (with debug trace button if failure occurred)
        appendChatBubble('assistant', finalChatBubbleText, null, Boolean(builderFailed));

        // Record clean conversation text and builder report in history
        chatHistory.push({
            role: 'assistant',
            content: finalChatBubbleText,
            builderReport: builderSummaryText,
        });
        saveDraft();
    } catch (err) {
        typingBubble.remove();
        console.error('[PbtA Concierge] Request failed:', err);
        appendChatBubble('assistant', `⚠️ **Error communicating with Concierge:** ${err.message || String(err)}`);
    } finally {
        isGenerating = false;
        $('#mhc_send_btn').prop('disabled', false);
    }
}

/**
 * Handle file input or dropped files.
 */
async function handleFilesSelected(files) {
    for (const file of Array.from(files)) {
        startImportProgress(file.name);
        try {
            // 1. Try Character Card (PNG metadata or JSON)
            let handledAsCard = false;
            try {
                const card = await parseCharacterFile(file);
                if (card) {
                    handledAsCard = true;
                    pendingAttachments.push({
                        type: 'char',
                        name: card.name,
                        card,
                        promptAddition: formatCharacterInspirationBlock(card),
                        avatar: card.avatar,
                    });
                    toastr?.success(`Imported character: "${card.name}".`);

                    // If character card embeds a world book, import that too!
                    if (card.characterBook) {
                        startImportProgress(`${card.name}'s Worldbook`);
                        try {
                            const loreRes = await processLorebookForConcierge(`${card.name}'s Lorebook`, card.characterBook, () => {}, card.name);
                            pendingAttachments.push({
                                type: 'lore',
                                name: `${card.name}'s Lorebook`,
                                promptAddition: loreRes.block,
                                mode: loreRes.mode,
                            });
                            toastr?.info(`Imported embedded worldbook for "${card.name}".`);
                        } catch (_) {}
                        finally {
                            stopImportProgress(`${card.name}'s Worldbook`);
                        }
                    }
                    renderAttachmentTray();
                    continue;
                }
            } catch (_) {}

            if (handledAsCard) continue;

            // 2. Try Lorebook JSON (has entries)
            if (file.name.endsWith('.json')) {
                let handledAsLore = false;
                try {
                    const text = await file.text();
                    const json = JSON.parse(text);
                    if (json.entries && (typeof json.entries === 'object' || Array.isArray(json.entries))) {
                        handledAsLore = true;
                        const loreRes = await processLorebookForConcierge(
                            file.name.replace(/\.json$/i, ''),
                            json,
                            msg => toastr?.info(msg),
                            activeDossier?.protagonist?.name || '',
                        );
                        pendingAttachments.push({
                            type: 'lore',
                            name: file.name.replace(/\.json$/i, ''),
                            promptAddition: loreRes.block,
                            mode: loreRes.mode,
                        });
                        toastr?.success(`Imported lorebook: "${file.name}" (${loreRes.mode === 'synthesized' ? 'Synthesized' : 'Direct'}).`);
                        renderAttachmentTray();
                        continue;
                    }
                } catch (_) {}
                if (handledAsLore) continue;
            }

            // 3. Fallback to image or document
            if (file.type.startsWith('image/')) {
                try {
                    const dataUrl = await readImageAsDataUrl(file);
                    pendingAttachments.push({
                        type: 'image',
                        file,
                        name: file.name,
                        dataUrl,
                    });
                } catch (err) {
                    toastr?.error(`Could not read image "${file.name}": ${err.message}`);
                }
            } else {
                try {
                    const doc = await extractDocumentContent(file);
                    if (doc.type === 'chat') {
                        pendingAttachments.push({
                            type: 'chat',
                            file,
                            name: doc.chatData?.charName ? `${doc.chatData.charName} (Chat)` : doc.filename,
                            chatData: doc.chatData,
                        });
                        toastr?.success(`Imported prior chat log: "${doc.chatData?.charName || doc.filename}" (${doc.chatData?.messages?.length || 0} messages).`);
                    } else {
                        pendingAttachments.push({
                            type: 'doc',
                            file,
                            name: doc.filename,
                            text: doc.text,
                        });
                        toastr?.info(`Extracted text from "${doc.filename}".`);
                    }
                } catch (err) {
                    toastr?.error(`Could not parse document "${file.name}": ${err.message}`);
                }
            }
        } finally {
            stopImportProgress(file.name);
        }
    }
    renderAttachmentTray();
}

/**
 * Find and heal active campaign dossier from memory or World Info for a given chat (or active chat).
 * @param {string|null} [targetChatId=null]
 * @returns {Promise<object|null>}
 */
export async function loadActiveCampaignDossier(targetChatId = null) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const currentChatId = targetChatId
        || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
        || ctx?.getCurrentChatId?.()
        || ctx?.chatId
        || ctx?.chatMetadata?.chat_id
        || '';
    const rpgSettings = ctx?.extensionSettings?.rpg_tracker;
    const candidateIds = getCandidateChatIds(currentChatId, rpgSettings);

    // 1. Primary Source: Check explicit CompanionActiveCartridge record (persisted in line 1 of chat .jsonl)
    const activeCart = getCompanionActiveCartridge(currentChatId, rpgSettings);
    if (activeCart?.dossier) {
        return healAndNormalizeDossier(activeCart.dossier);
    }

    // 2. Check candidate chatStates partitions in memory
    for (const cid of candidateIds) {
        if (rpgSettings?.chatStates?.[cid]?.pbtaCampaignDossier) {
            return healAndNormalizeDossier(rpgSettings.chatStates[cid].pbtaCampaignDossier);
        }
    }

    // 3. Fallback: Check World Info books
    const cleanId = currentChatId ? currentChatId.replace(/\.jsonl$/i, '').trim() : '';
    const bookCandidates = [
        ctx?.chatMetadata?.world_info,
        cleanId ? `Campaign_${cleanId}` : null,
        'Campaign_PbtA',
    ].filter(Boolean);

    for (const book of bookCandidates) {
        try {
            const data = await fetchWorldInfoBook(book);
            if (!data?.entries) continue;
            for (const entry of Object.values(data.entries)) {
                if (entry?.comment?.includes('CAMPAIGN_DOSSIER') ||
                    entry?.comment?.includes('PbtA Concierge') ||
                    entry?.key?.includes('campaign_dossier') ||
                    entry?.content?.includes('CAMPAIGN DOSSIER') ||
                    entry?.content?.includes('Protagonist:')) {
                    const parsed = parseMarkdownToDossier(entry.content);
                    if (parsed) return parsed;
                }
            }
        } catch (_) {}
    }
    return null;
}

/**
 * Dynamically evaluate whether the '🔄 Sync to Active Game' button should be shown.
 * Shows the button ONLY if:
 * 1. The currently active chat has an ongoing campaign (loadActiveCampaignDossier returns non-null).
 * 2. An active campaign was loaded into Session Zero (loadedCampaignOriginChatId or dossier origin).
 * 3. The currently active chat matches the origin chat of the loaded campaign (or campaign identity matches).
 *
 * @param {string|null} [targetChatId=null]
 * @returns {Promise<boolean>} Whether the button is visible
 */
export async function updateSyncButtonState(targetChatId = null) {
    const syncBtn = $('#mhc_sync_active_campaign_btn');
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const currentChatId = targetChatId
        || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
        || ctx?.getCurrentChatId?.()
        || ctx?.chatId
        || ctx?.chatMetadata?.chat_id
        || '';

    let activeRunning = null;
    try {
        activeRunning = await loadActiveCampaignDossier(currentChatId);
    } catch (_) {}

    // Check 1: If current chat has no active running campaign, we can never sync to it
    if (!activeRunning) {
        if (syncBtn.length) syncBtn.hide();
        return false;
    }

    // Check 2: Session Zero must have an active dossier with content
    if (!activeDossier || isDossierEmptyOrUntouched(activeDossier)) {
        if (syncBtn.length) syncBtn.hide();
        return false;
    }

    // Check 3: Chat affinity check
    const originId = loadedCampaignOriginChatId || activeDossier._originChatId;
    const originTitle = (loadedCampaignOriginTitle || activeDossier._originCampaignTitle || '').trim().toLowerCase();
    const runningTitle = (activeRunning.meta?.title || '').trim().toLowerCase();
    const activeDossierTitle = (activeDossier.meta?.title || '').trim().toLowerCase();

    let matches = false;

    if (originId && currentChatId) {
        const currentCandidates = getCandidateChatIds(currentChatId);
        const originCandidates = getCandidateChatIds(originId);
        if (currentCandidates.some(id => originCandidates.includes(id))) {
            matches = true;
        }
    }

    // Fallback: If titles match explicitly between running campaign and loaded campaign
    if (!matches && originTitle && runningTitle && originTitle === runningTitle) {
        matches = true;
    } else if (!matches && !originId && runningTitle && activeDossierTitle && runningTitle === activeDossierTitle && runningTitle !== 'untitled pbta campaign') {
        matches = true;
    }

    if (matches) {
        if (syncBtn.length) syncBtn.show();
        return true;
    } else {
        if (syncBtn.length) syncBtn.hide();
        return false;
    }
}

/**
 * Refreshes active chat context indicators in Concierge:
 * - Updates 'Load Active Campaign' button with current chat's adventure title.
 * - Updates 'Sync to Active Game' button visibility based on chat affinity.
 *
 * @param {string|null} [targetChatId=null]
 */
export async function refreshConciergeActiveContext(targetChatId = null) {
    try {
        const activeRunning = await loadActiveCampaignDossier(targetChatId);
        if (activeRunning?.meta?.title && activeRunning.meta.title !== 'Untitled PbtA Campaign') {
            const shortTitle = activeRunning.meta.title.length > 20 ? `${activeRunning.meta.title.slice(0, 18)}...` : activeRunning.meta.title;
            $('#mhc_load_active_campaign_btn')
                .attr('title', `Active campaign "${activeRunning.meta.title}" detected in this chat! Click to pull into Session Zero.`)
                .html(`📂 Load "${shortTitle}"`);
        } else {
            $('#mhc_load_active_campaign_btn')
                .attr('title', 'Pull the active chat\'s Campaign Dossier into Session Zero to view or edit')
                .html('📂 Load Active Campaign');
        }

        await updateSyncButtonState(targetChatId);
    } catch (_) {}
}

export function getLoadedCampaignOrigin() {
    return {
        originChatId: loadedCampaignOriginChatId,
        originCampaignTitle: loadedCampaignOriginTitle,
    };
}

export function setLoadedCampaignOrigin(chatId, title = null, dossier = null) {
    loadedCampaignOriginChatId = chatId;
    loadedCampaignOriginTitle = title;
    if (dossier) {
        activeDossier = dossier;
    }
    if (activeDossier) {
        activeDossier._originChatId = chatId;
        activeDossier._originCampaignTitle = title;
    }
}

/**
 * Bind modal DOM events.
 */
function bindModalEvents() {
    if (modalInitialized) return;
    modalInitialized = true;

    // Close
    $('#mhc_concierge_close').on('click', () => {
        saveDraft();
        $('#mhc_concierge_modal').fadeOut(180);
    });

    // Connection controls
    $('#mhc_concierge_connection_source').on('change', function () {
        const val = $(this).val();
        updateConciergeConnectionSettings({ conciergeConnectionSource: val });
        updateConnectionDropdowns();
    });

    $('#mhc_concierge_profile_select').on('change', function () {
        updateConciergeConnectionSettings({ conciergeConnectionProfileId: $(this).val() });
    });

    // Inspiration Toolbar: ST Character Picker
    $('#mhc_pick_st_char_btn').on('click', () => {
        $('#mhc_st_char_select').toggle();
    });

    $('#mhc_st_char_select').on('change', async function () {
        const idx = $(this).val();
        if (idx === '') return;
        $(this).hide();
        $(this).val('');

        const ctx = SillyTavern.getContext();
        const rawChar = ctx.characters?.[idx];
        if (!rawChar) return;

        const charLabel = rawChar.name || 'Character';
        startImportProgress(charLabel);
        try {
            const avatarUrl = rawChar.avatar ? `/characters/${encodeURIComponent(rawChar.avatar)}` : null;
            const card = normalizeCharacterCard(rawChar, avatarUrl);
            if (!card) return;

            pendingAttachments.push({
                type: 'char',
                name: card.name,
                card,
                promptAddition: formatCharacterInspirationBlock(card),
                avatar: card.avatar,
            });
            renderAttachmentTray();
            toastr?.success(`Imported character: "${card.name}".`);

            if (card.characterBook) {
                startImportProgress(`${card.name}'s Worldbook`);
                try {
                    const loreRes = await processLorebookForConcierge(`${card.name}'s Lorebook`, card.characterBook, () => {}, card.name);
                    pendingAttachments.push({
                        type: 'lore',
                        name: `${card.name}'s Lorebook`,
                        promptAddition: loreRes.block,
                        mode: loreRes.mode,
                    });
                    renderAttachmentTray();
                    toastr?.info(`Imported embedded worldbook for "${card.name}".`);
                } catch (_) {}
                finally {
                    stopImportProgress(`${card.name}'s Worldbook`);
                }
            }
        } finally {
            stopImportProgress(charLabel);
        }
    });

    // Inspiration Toolbar: Load Active Campaign Dossier
    $('#mhc_load_active_campaign_btn').on('click', async () => {
        startImportProgress('Active Campaign');
        try {
            toastr?.info('Scanning for active campaign dossier...');
            let dossier = await loadActiveCampaignDossier();
            if (!dossier) {
                const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
                const bookName = ctx?.chatMetadata?.world_info || (ctx?.chatId ? `Campaign_${ctx.chatId}` : '');
                let rawEntryText = '';
                if (bookName) {
                    try {
                        const data = await fetchWorldInfoBook(bookName);
                        const found = Object.values(data?.entries || {}).find(e =>
                            e?.comment?.includes('PbtA Concierge') || e?.content?.includes('Protagonist')
                        );
                        if (found) rawEntryText = found.content;
                    } catch (_) {}
                }

                if (rawEntryText) {
                    const rehydrateOk = await showConciergeConfirm({
                        icon: '🧙‍♂️',
                        title: 'Rehydrate Legacy Campaign?',
                        message: 'A legacy or unparsed campaign entry was found. Would you like the AI Campaign Architect to rehydrate and heal it?',
                        confirmLabel: '✨ Rehydrate Dossier',
                        confirmColor: '#2563eb',
                    });
                    if (rehydrateOk) {
                        dossier = await reconstituteDossierWithAi(rawEntryText, msg => toastr?.info(msg));
                    }
                }
            }

            if (!dossier) {
                toastr?.warning('No active PbtA campaign dossier found in this chat.');
                return;
            }

            const candidateTitle = (dossier.meta?.title || '').trim() || 'Active Adventure';
            const hasExistingSessionProgress = (Array.isArray(chatHistory) && chatHistory.length > 0) || !isDossierEmptyOrUntouched(activeDossier);

            if (hasExistingSessionProgress) {
                const proceed = await showConciergeConfirm({
                    icon: '📂',
                    title: 'Overwrite Unlaunched Draft?',
                    message: `An in-progress Session Zero draft is currently open.\n\nLoading "${candidateTitle}" will discard your unlaunched draft and restart the conversation for this campaign.\n\nProceed?`,
                    confirmLabel: '📂 Load Active Campaign',
                    confirmColor: '#2563eb',
                });
                if (!proceed) {
                    toastr?.info('Load cancelled. Current Session Zero draft retained.');
                    return;
                }
            }

            // Cleanly reset Session Zero state without default welcome bubble
            resetConciergeState({ showGreeting: false });

            // Install active campaign into live dossier & deck
            activeDossier = healAndNormalizeDossier(dossier);
            const ctxEarly = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            const currentChatId = (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
                || ctxEarly?.getCurrentChatId?.()
                || ctxEarly?.chatId
                || ctxEarly?.chatMetadata?.chat_id
                || '';
            loadedCampaignOriginChatId = currentChatId;
            loadedCampaignOriginTitle = (activeDossier.meta?.title || '').trim();
            activeDossier._originChatId = loadedCampaignOriginChatId;
            activeDossier._originCampaignTitle = loadedCampaignOriginTitle;

            updateBlueprintDeck();
            await updateSyncButtonState();

            const loadNotice = `📂 **Active Campaign Loaded:** "${activeDossier.meta?.title}"\n\nYou can now adjust Harm capacity, campaign dials, party mode, or supporting cast in the Blueprint Deck on the right. When you're ready, click **"🔄 Sync to Active Game"** to apply your changes without resetting the story!`;
            appendChatBubble('assistant', loadNotice);
            chatHistory.push({ role: 'assistant', content: loadNotice });

            saveDraft();
            toastr?.success(`Loaded active campaign: "${candidateTitle}"! Dials and cards are now editable.`);
        } catch (err) {
            toastr?.error(`Failed to load active campaign: ${err.message}`);
        } finally {
            stopImportProgress('Active Campaign');
        }
    });

    // Inspiration Toolbar: ST Lorebook Picker
    $('#mhc_pick_st_lore_btn').on('click', () => {
        $('#mhc_st_lore_select').toggle();
    });

    $('#mhc_st_lore_select').on('change', async function () {
        const bookName = $(this).val();
        if (!bookName) return;
        $(this).hide();
        $(this).val('');

        startImportProgress(bookName);
        try {
            toastr?.info(`Loading lorebook "${bookName}"...`);
            const bookData = await fetchWorldInfoBook(bookName);
            if (!bookData) {
                toastr?.error(`Could not load lorebook "${bookName}".`);
                return;
            }

            const loreRes = await processLorebookForConcierge(bookName, bookData, msg => toastr?.info(msg), activeDossier?.protagonist?.name || '');
            pendingAttachments.push({
                type: 'lore',
                name: bookName,
                promptAddition: loreRes.block,
                mode: loreRes.mode,
            });
            renderAttachmentTray();
            toastr?.success(`Imported lorebook: "${bookName}" (${loreRes.mode === 'synthesized' ? 'Synthesized' : 'Direct'}).`);
        } catch (err) {
            toastr?.error(`Lorebook import failed: ${err.message}`);
        } finally {
            stopImportProgress(bookName);
        }
    });

    // Send on button or Enter (Shift+Enter for newline)
    $('#mhc_send_btn').on('click', handleUserSend);
    $('#mhc_chat_input').on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleUserSend();
        }
    });

    // Attachment button & file input
    $('#mhc_attach_btn').on('click', () => $('#mhc_file_input').click());
    $('#mhc_file_input').on('change', function () {
        if (this.files && this.files.length) {
            handleFilesSelected(this.files);
            this.value = '';
        }
    });

    // Drag and drop onto chat stream
    const dropArea = document.getElementById('mhc_concierge_modal');
    dropArea.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    dropArea.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer?.files?.length) {
            handleFilesSelected(e.dataTransfer.files);
        }
    });

    // Campaign Title manual edit interaction
    $('#mhc_deck_edit_title_btn, #mhc_deck_campaign_title').on('click', () => {
        const currentTitle = activeDossier.meta?.title === 'Untitled PbtA Campaign' ? '' : (activeDossier.meta?.title || '');
        const newTitle = window.prompt('Enter campaign title (2-3 words recommended):', currentTitle);
        if (newTitle !== null) {
            const clean = newTitle.trim().replace(/[\\/:*?"<>|]/g, '');
            if (clean) {
                activeDossier.meta = activeDossier.meta || {};
                activeDossier.meta.title = clean;
                changelog.push(`Renamed campaign title to "${clean}"`);
                updateBlueprintDeck();
                saveDraft();
            }
        }
    });

    // Custom HUD Tracker Module dismiss / remove button
    $('#mhc_deck_remove_custom_mod_btn').on('click', (e) => {
        e.stopPropagation();
        if (activeDossier.worldRules) {
            activeDossier.worldRules.customModule = null;
            changelog.push('Removed custom HUD tracker module');
            updateBlueprintDeck();
            saveDraft();
        }
    });

    // Campaign Calibration Dial click interactions (manual cycling)
    const cyclePlaystyle = () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.playstyle || 'cyoa_5';
        const cycle = { 'cyoa_5': 'cyoa_3', 'cyoa_3': 'freeform', 'freeform': 'cyoa_5' };
        activeDossier.config.playstyle = cycle[current] || 'cyoa_5';
        changelog.push(`Toggled playstyle to ${activeDossier.config.playstyle}`);
        updateBlueprintDeck();
        saveDraft();
    };
    $('#mhc_deck_dial_playstyle').on('click', cyclePlaystyle);
    $('#mhc_dial_playstyle_btn').on('click', cyclePlaystyle);

    $('#mhc_dial_harm_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.harmMax || 5;
        const cycle = { 5: 3, 3: 4, 4: 6, 6: 5 };
        const nextHarm = cycle[current] || 5;
        activeDossier.config.harmMax = nextHarm;
        if (activeDossier.protagonist) {
            activeDossier.protagonist.harm = activeDossier.protagonist.harm || {};
            if (typeof activeDossier.protagonist.harm === 'object') {
                activeDossier.protagonist.harm.max = nextHarm;
            } else {
                activeDossier.protagonist.harm = { current: 0, max: nextHarm };
            }
        }
        changelog.push(`Toggled Harm capacity to ${activeDossier.config.harmMax}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_downed_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const presets = [
            { key: 'mortal_peril', label: 'Mortal Peril', rule: 'Mortal Peril (Last Breath / Dying)', statusToken: '(-) Incapacitated', cyoaStyle: 'crisis' },
            { key: 'burnout', label: 'Burnout / Faint', rule: 'Emotional & Physical Burnout (Faint or collapse, retreat to rest)', statusToken: '(-) Burnt Out', cyoaStyle: 'burnout' },
            { key: 'respawn', label: 'MMO Respawn', rule: 'MMO / Soul Respawn (Return to nearest shrine or graveyard)', statusToken: '(-) Ghost', cyoaStyle: 'respawn' },
            { key: 'knockout', label: 'Knockout / Capture', rule: 'Knocked Out / Captured (Subdued, unconscious, or taken prisoner)', statusToken: '(-) Unconscious', cyoaStyle: 'knockout' },
        ];
        const curRule = (activeDossier.config.maxHarmFate?.rule || '').toLowerCase();
        let curIdx = 0;
        if (/burnout|exhaust|faint|pass out/i.test(curRule)) curIdx = 1;
        else if (/respawn|graveyard|ghost|mmo|shrine/i.test(curRule)) curIdx = 2;
        else if (/unconscious|capture|knockout|arrest/i.test(curRule)) curIdx = 3;
        else curIdx = 0;

        const nextPreset = presets[(curIdx + 1) % presets.length];
        activeDossier.config.maxHarmFate = {
            rule: nextPreset.rule,
            statusToken: nextPreset.statusToken,
            cyoaStyle: nextPreset.cyoaStyle,
        };
        changelog.push(`Toggled Max Harm fate to "${nextPreset.label}"`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_party_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.partyMode || 'squad';
        const cycle = { 'squad': 'solo', 'solo': 'duo', 'duo': 'squad' };
        activeDossier.config.partyMode = cycle[current] || 'squad';
        changelog.push(`Toggled party mode to ${activeDossier.config.partyMode}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_emojis_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        activeDossier.config.cyoaEmojis = activeDossier.config.cyoaEmojis === false ? true : false;
        changelog.push(`Toggled choice emojis to ${activeDossier.config.cyoaEmojis ? 'On' : 'Off'}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_sim_depth_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.simulationDepth || 'active_fronts';
        const cycle = { 'active_fronts': 'living_world', 'living_world': 'static', 'static': 'active_fronts' };
        activeDossier.config.simulationDepth = cycle[current] || 'active_fronts';
        const label = activeDossier.config.simulationDepth === 'static' ? 'Static Solo' : activeDossier.config.simulationDepth === 'living_world' ? 'Living World' : 'Active Fronts';
        changelog.push(`Toggled simulation depth to ${label}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_relationships_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        activeDossier.config.relationships = activeDossier.config.relationships === false ? true : false;
        changelog.push(`Toggled NPC relationships to ${activeDossier.config.relationships ? 'On' : 'Off'}`);
        updateBlueprintDeck();
        saveDraft();
    });

    // NPC relationship slider adjustments
    $('#mhc_concierge_modal').on('input change', '.mhc-npc-rel-slider', function (e) {
        e.stopPropagation();
        const rawName = decodeURIComponent($(this).data('npc') || '');
        const axis = $(this).data('axis');
        const val = parseInt($(this).val(), 10) || 0;
        const sign = val >= 0 ? '+' : '';

        if (!activeDossier?.npcs) return;
        const npc = activeDossier.npcs.find(n => n.name && n.name.toLowerCase() === rawName.toLowerCase());
        if (npc) {
            npc[axis] = val;
            const container = $(this).closest('.mhc-npc-rel-controls');
            if (axis === 'friendship') {
                container.find('.mhc-rel-val-friendship').text(`${sign}${val}`);
            } else if (axis === 'affection') {
                container.find('.mhc-rel-val-affection').text(`${sign}${val}`);
            }
        }
        if (e.type === 'change') {
            saveDraft();
        }
    });

    $('#mhc_concierge_modal').on('click', '.mhc-npc-rel-controls', function (e) {
        e.stopPropagation();
    });

    // Collapsible blueprint items (NPCs, Monsters, Maps)
    $('#mhc_concierge_modal').on('click', '.mhc-deck-item.collapsible .mhc-deck-item-header', function () {
        const item = $(this).closest('.mhc-deck-item');
        const detail = item.find('.mhc-deck-item-detail');
        item.toggleClass('open');
        detail.slideToggle(140);
    });

    // Tab buttons
    $('.mhc-tab-btn').on('click', function () {
        $('.mhc-tab-btn').removeClass('active');
        $('.mhc-tab-content').removeClass('active');
        $(this).addClass('active');
        const tab = $(this).attr('data-tab');
        $(`#mhc_tab_${tab}`).addClass('active');
        if (tab === 'debug') {
            renderDebugInspectorView();
        }
    });

    // Copy Markdown
    $('#mhc_copy_markdown_btn').on('click', () => {
        const text = $('#mhc_raw_markdown_text').val();
        navigator.clipboard.writeText(text).then(() => {
            toastr?.success('Campaign Dossier copied to clipboard!');
        });
    });

    // Save Draft
    $('#mhc_save_draft_btn').on('click', () => {
        saveDraft();
        toastr?.success('Draft saved successfully!');
    });

    // Export Dossier
    $('#mhc_export_dossier_btn').on('click', () => {
        const text = serializeDossierToMarkdown(activeDossier);
        const filename = `${(activeDossier.meta?.title || 'pbta_campaign').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_dossier.md`;
        const blob = new Blob([text], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Reset Session
    $('#mhc_reset_session_btn').on('click', async (e) => {
        const hasProgress = (Array.isArray(chatHistory) && chatHistory.length > 0) || !isDossierEmptyOrUntouched(activeDossier);
        if (hasProgress && !e?.shiftKey) {
            const ok = await showConciergeConfirm({
                icon: '↺',
                title: 'Reset Session Zero?',
                message: 'Reset current Session Zero and start fresh? All unlaunched progress will be lost.',
                confirmLabel: '↺ Reset Session',
                confirmColor: '#dc2626',
            });
            if (!ok) return;
        }
        resetConciergeState({ showGreeting: true });
        toastr?.info('Session Zero reset to fresh start.', 'Reset');
    });

    // Helper to execute campaign launch with progress overlay
    async function executeCampaignLaunch({ wipeOldTitle = null } = {}) {
        const overlay = $('#mhc_launch_progress_overlay');
        const label = $('#mhc_launch_progress_label');
        const bar = $('#mhc_launch_progress_bar');

        overlay.show();
        const progressCb = (msg, pct) => {
            label.text(msg);
            bar.css('width', `${pct}%`);
        };

        const res = await launchPbtaCampaign(activeDossier, progressCb, { wipeOldTitle });
        setTimeout(() => {
            overlay.hide();
            if (res.success) {
                resetConciergeState({ showGreeting: true });
                $('#mhc_concierge_modal').fadeOut(250);
                toastr?.success('PbtA Campaign ready! The game is now beginning.', 'Adventure Launched');
            } else {
                toastr?.error(`Launch error: ${res.message}`, 'Launch Failed');
            }
        }, 600);
    }

    // Helper to display adventure name conflict dialog
    function showAdventureConflictDialog(title, existingNames) {
        const conflictOverlay = $('#mhc_launch_conflict_overlay');
        const titleLabel = $('#mhc_conflict_adventure_title');
        const renameInput = $('#mhc_conflict_rename_input');
        const renameBtn = $('#mhc_conflict_rename_btn');
        const wipeBtn = $('#mhc_conflict_wipe_btn');
        const cancelBtn = $('#mhc_conflict_cancel_btn');
        const feedback = $('#mhc_conflict_rename_feedback');

        const nextVersion = findNextAdventureVersionName(title, existingNames);
        titleLabel.text(`"${title}"`);
        renameInput.val(nextVersion);
        feedback.hide().text('');
        renameBtn.prop('disabled', false).css('opacity', '1');

        function validateRenameInput() {
            const val = renameInput.val().trim();
            if (!val) {
                feedback.text('Please enter an adventure name.').show();
                renameBtn.prop('disabled', true).css('opacity', '0.5');
                return false;
            }
            if (checkAdventureNameExists(val, existingNames)) {
                feedback.text(`An adventure named "${val}" also already exists.`).show();
                renameBtn.prop('disabled', true).css('opacity', '0.5');
                return false;
            }
            feedback.hide().text('');
            renameBtn.prop('disabled', false).css('opacity', '1');
            return true;
        }

        renameInput.off('input').on('input', validateRenameInput);

        wipeBtn.off('click').on('click', async () => {
            conflictOverlay.hide();
            await executeCampaignLaunch({ wipeOldTitle: title });
        });

        renameBtn.off('click').on('click', async () => {
            if (!validateRenameInput()) return;
            const newTitle = renameInput.val().trim();
            conflictOverlay.hide();
            activeDossier.meta.title = newTitle;
            updateBlueprintDeck();
            saveDraft();
            await executeCampaignLaunch();
        });

        cancelBtn.off('click').on('click', () => {
            conflictOverlay.hide();
        });

        conflictOverlay.fadeIn(150);
    }

    // Finalize & Launch Campaign
    $('#mhc_launch_campaign_btn').on('click', async () => {
        const castEmpty = !(activeDossier?.npcs?.length) && !(activeDossier?.monsters?.length);
        if (castEmpty) {
            const launchOk = await showConciergeConfirm({
                icon: '🚀',
                title: 'Launch Without Staged Cast?',
                message: 'No NPCs or monsters have been staged for this campaign. Launch anyway?\n\n(Tip: ask the Concierge to propose a cast based on your outline.)',
                confirmLabel: '🚀 Launch Anyway',
                confirmColor: '#2563eb',
            });
            if (!launchOk) return;
        }

        const candidateTitle = (activeDossier?.meta?.title || '').trim();
        if (candidateTitle) {
            try {
                const existingNames = await getExistingAdventureNames();
                if (checkAdventureNameExists(candidateTitle, existingNames)) {
                    showAdventureConflictDialog(candidateTitle, existingNames);
                    return;
                }
            } catch (err) {
                console.warn('[MultiHog Companion] Pre-flight conflict check encountered error:', err);
            }
        }

        await executeCampaignLaunch();
    });

    // Sync Active Campaign (in-place update without resetting chat)
    $('#mhc_sync_active_campaign_btn').on('click', async () => {
        const activeRunning = await loadActiveCampaignDossier();
        if (!activeRunning) {
            toastr?.error('No active PbtA campaign found in this chat to synchronize with.', 'Sync Blocked');
            return;
        }

        const overlay = $('#mhc_launch_progress_overlay');
        const label = $('#mhc_launch_progress_label');
        const bar = $('#mhc_launch_progress_bar');

        overlay.show();
        const progressCb = (msg, pct) => {
            label.text(msg);
            bar.css('width', `${pct}%`);
        };

        const res = await syncPbtaCampaignUpdates(activeDossier, progressCb);
        setTimeout(() => {
            overlay.hide();
            if (res.success) {
                resetConciergeState({ showGreeting: true });
                $('#mhc_concierge_modal').fadeOut(250);
                toastr?.success(res.message, 'Campaign Synchronized');
            } else {
                toastr?.error(`Sync error: ${res.message}`, 'Sync Failed');
            }
        }, 500);
    });

    // Copy Antigravity Debug Trace
    $('#mhc_concierge_modal').on('click', '.mhc-copy-debug-trace-btn', function () {
        const trace = window._mhcLastBuilderTransaction || window._lastConciergeBuilderDiagnostic;
        if (!trace) {
            toastr?.warning('No diagnostic trace found.');
            return;
        }
        const md = formatDiagnosticTrace(trace);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(md).then(() => {
                toastr?.success('Copied Antigravity debug trace to clipboard!');
            }).catch(() => {
                prompt('Copy Antigravity debug trace:', md);
            });
        } else {
            prompt('Copy Antigravity debug trace:', md);
        }
    });
}



/**
 * Format a builder transaction as a rich Markdown diagnostic trace for Antigravity or bug reporting.
 * @param {object} [tx]
 * @returns {string}
 */
export function formatDiagnosticTrace(tx = (window._mhcLastBuilderTransaction || window._lastConciergeBuilderDiagnostic)) {
    return formatDiagnosticTraceParser(tx);
}

/**
 * Renders the latest Builder transaction state into the in-modal debug inspector.
 * @param {object} [tx]
 */
export function renderDebugInspectorView(tx = (window._mhcLastBuilderTransaction || window._lastConciergeBuilderDiagnostic)) {
    // 1. In-Modal Tab Elements
    const modalBadge = $('#mhc_debug_status_badge');
    const modalTime = $('#mhc_debug_timestamp');
    const modalSummary = $('#mhc_debug_summary_text');
    const modalChanges = $('#mhc_debug_changes_list');
    const modalErrors = $('#mhc_debug_errors_list');
    const modalCritiqueBadge = $('#mhc_debug_critique_badge');
    const modalContempBox = $('#mhc_debug_contemplation_box');
    const modalRaw = $('#mhc_debug_raw_output');
    const modalAttempts = $('#mhc_debug_attempt_count');
    const modalPrompt = $('#mhc_debug_prompt_input');
    const modalDossier = $('#mhc_debug_dossier_json');
    const modalNameRagCount = $('#mhc_debug_namerag_count');
    const modalNameRagList = $('#mhc_debug_namerag_list');

    if (!tx) {
        modalBadge.text('Awaiting Turn').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc', borderColor: 'rgba(156,163,175,0.4)' });
        modalTime.text('--:--:--');
        modalSummary.text('No build transactions recorded yet.');
        modalChanges.empty();
        modalErrors.empty();
        modalCritiqueBadge.text('Not Evaluated').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        modalContempBox.html('<div style="opacity: 0.6; font-style: italic;">No architectural contemplation or judge critique recorded yet.</div>');
        modalNameRagCount.text('0 resolved').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        modalNameRagList.html('<div style="opacity: 0.6; font-style: italic;">No name placeholders resolved in this transaction.</div>');
        modalRaw.text('(No raw Builder response captured yet)');
        modalAttempts.text('Attempt 0/2');
        modalPrompt.text('(No prompt recorded yet)');
        modalDossier.text(JSON.stringify(activeDossier || {}, null, 2));
        return;
    }

    const attempts = tx.attempts || [];
    const lastAttempt = attempts.length ? attempts[attempts.length - 1] : null;
    const rawText = lastAttempt?.rawResponse || '(empty)';
    const status = tx.finalStatus || 'UNKNOWN';
    const timeFormatted = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : '--:--:--';

    let badgeColor = '#ccc';
    let badgeBg = 'rgba(150,150,150,0.2)';
    let badgeBorder = 'rgba(255,255,255,0.15)';

    if (status === 'MUTATED') {
        badgeColor = '#4ade80';
        badgeBg = 'rgba(34, 197, 94, 0.2)';
        badgeBorder = 'rgba(34, 197, 94, 0.4)';
    } else if (status === 'NOOP') {
        badgeColor = '#60a5fa';
        badgeBg = 'rgba(59, 130, 246, 0.2)';
        badgeBorder = 'rgba(59, 130, 246, 0.4)';
    } else if (status === 'SYNTAX_ERROR') {
        badgeColor = '#f87171';
        badgeBg = 'rgba(239, 68, 68, 0.2)';
        badgeBorder = 'rgba(239, 68, 68, 0.4)';
    } else if (status === 'UNRECOGNIZED_OUTPUT') {
        badgeColor = '#fbbf24';
        badgeBg = 'rgba(245, 158, 11, 0.2)';
        badgeBorder = 'rgba(245, 158, 11, 0.4)';
    }

    modalBadge.text(status).css({ color: badgeColor, background: badgeBg, borderColor: badgeBorder });
    modalTime.text(timeFormatted);
    modalSummary.text(tx.builderSummary || 'No summary available');

    modalChanges.empty();
    const changes = lastAttempt?.report?.changes || [];
    if (changes.length) {
        modalChanges.html(`<b>Mutations:</b> ${changes.map(c => `• ${escapeHtml(c)}`).join(' ')}`);
    }

    modalErrors.empty();
    const errors = lastAttempt?.report?.errors || lastAttempt?.errors || [];
    if (errors.length) {
        modalErrors.html(`<b>Errors:</b> ${errors.map(e => `⚠️ ${escapeHtml(e)}`).join('; ')}`);
    }

    // Contemplation & Blueprint Judge Critique
    const contemp = tx.contemplation || tx.activeDossierSnapshot?.contemplation;
    const critique = tx.critique;
    const contempParts = [];
    if (contemp && (contemp.coreTension || contemp.worldConsequences || contemp.webOfEntanglement || contemp.kickPressure)) {
        contempParts.push(`
            <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(192, 132, 252, 0.25); border-radius: 4px; padding: 6px 8px;">
                <div style="font-weight: 600; color: #e9d5ff; margin-bottom: 3px;">🧠 Pass 1 Architectural Scratchpad</div>
                ${contemp.coreTension ? `<div><b>Core Tension:</b> ${escapeHtml(contemp.coreTension)}</div>` : ''}
                ${contemp.worldConsequences ? `<div><b>World Consequences:</b> ${escapeHtml(contemp.worldConsequences)}</div>` : ''}
                ${contemp.webOfEntanglement ? `<div><b>Web of Entanglement:</b> ${escapeHtml(contemp.webOfEntanglement)}</div>` : ''}
                ${contemp.kickPressure ? `<div><b>Kick Pressure:</b> ${escapeHtml(contemp.kickPressure)}</div>` : ''}
            </div>
        `);
    }
    if (critique) {
        const isRevise = Boolean(critique.shouldRevise);
        modalCritiqueBadge.text(`${critique.grade || 'B'} (${critique.score}/100 · ${critique.verdict})`).css({
            background: isRevise ? 'rgba(251, 191, 36, 0.2)' : 'rgba(74, 222, 128, 0.2)',
            color: isRevise ? '#fbbf24' : '#4ade80',
        });
        contempParts.push(`
            <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(250, 204, 21, 0.25); border-radius: 4px; padding: 6px 8px;">
                <div style="font-weight: 600; color: #fde047; margin-bottom: 3px;">⚖️ Judge Verdict: ${escapeHtml(critique.verdict)} (${critique.score}/100 · ${escapeHtml(critique.grade)})</div>
                ${critique.strengths?.length ? `<div style="color: #86efac;"><b>Strengths:</b> ${critique.strengths.map(s => escapeHtml(s)).join(' · ')}</div>` : ''}
                ${critique.weaknesses?.length ? `<div style="color: #fca5a5;"><b>Weaknesses:</b> ${critique.weaknesses.map(w => escapeHtml(w)).join(' · ')}</div>` : ''}
                ${critique.directives?.length ? `<div style="color: #93c5fd;"><b>Directives:</b> ${critique.directives.map(d => escapeHtml(d)).join(' · ')}</div>` : ''}
                ${tx.refinerPass?.hasMutations ? `<div style="color: #c4b5fd; margin-top: 3px;"><b>🔨 Pass 2 Refiner Applied:</b> ${tx.refinerPass.changes.map(c => escapeHtml(c)).join('; ')}</div>` : ''}
            </div>
        `);
    } else if (contempParts.length > 0) {
        modalCritiqueBadge.text('Scratchpad Active').css({ background: 'rgba(192, 132, 252, 0.2)', color: '#c084fc' });
    } else {
        modalCritiqueBadge.text('Bypassed / Minor Turn').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
    }

    if (contempParts.length > 0) {
        modalContempBox.html(contempParts.join(''));
    } else {
        modalContempBox.html('<div style="opacity: 0.6; font-style: italic;">No architectural contemplation or judge critique recorded in this turn.</div>');
    }

    // Name Diversity Engine (NameRAG) Resolutions
    const resolutions = tx.nameRagResolutions || lastAttempt?.nameRagResolutions || [];
    if (resolutions.length > 0) {
        modalNameRagCount.text(`${resolutions.length} resolved`).css({ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' });
        const itemsHtml = resolutions.map((r, i) => {
            const candidatesStr = (r.candidates && r.candidates.length)
                ? r.candidates.map(c => c === r.selectedName ? `<b style="color: #4ade80;">${escapeHtml(c)} (picked)</b>` : escapeHtml(c)).join(', ')
                : '(none returned)';
            return `
                <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 6px 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <span style="font-weight: 600; color: #facc15;">${escapeHtml(r.placeholder)}</span>
                        <span style="font-size: 0.85em; opacity: 0.75;">${escapeHtml(r.source || 'NameRAG')}</span>
                    </div>
                    <div style="color: #94a3b8; font-size: 0.9em; margin-bottom: 2px;"><b>Query:</b> <i>"${escapeHtml(r.query || '')}"</i></div>
                    <div style="color: #cbd5e1; font-size: 0.9em;"><b>Pool:</b> ${candidatesStr}</div>
                </div>
            `;
        }).join('');
        modalNameRagList.html(itemsHtml);
    } else {
        modalNameRagCount.text('0 resolved').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        modalNameRagList.html('<div style="opacity: 0.6; font-style: italic;">No name placeholders resolved in this transaction.</div>');
    }

    modalRaw.text(rawText);
    modalAttempts.text(`Attempt ${attempts.length}/2`);
    modalPrompt.text(JSON.stringify(tx.builderRequest?.messages || [], null, 2));
    modalDossier.text(JSON.stringify(tx.activeDossierSnapshot || tx.currentDossierSnapshot || activeDossier || {}, null, 2));
}

/**
 * Open the PbtA Concierge modal window.
 */
export async function openConciergeModal() {
    await ensureModalMounted();
    bindModalEvents();
    updateConnectionDropdowns();
    populateInspirationDropdowns();

    // Check for existing draft or initialize greeting
    const draftResult = loadValidatedDraft();

    if (draftResult?.corrupted) {
        // Corrupted or incomplete draft in storage: discard and reset cleanly
        resetConciergeState({ showGreeting: true });
        toastr?.info('Previous uncompleted draft could not be fully loaded and was reset to a fresh Session Zero.', 'Session Zero');
    } else if (draftResult?.draft) {
        // Valid draft found: restore it if in-memory history isn't already active
        const { draft } = draftResult;
        loadedCampaignOriginChatId = draft.originChatId || draft.dossier?._originChatId || null;
        loadedCampaignOriginTitle = draft.originCampaignTitle || draft.dossier?._originCampaignTitle || null;
        if (!chatHistory.length) {
            activeDossier = draft.dossier;
            chatHistory = draft.chatHistory;
            changelog = draft.changelog || [];
            $('#mhc_chat_messages').empty();
            chatHistory.forEach(msg => {
                const displayStr = msg.displayContent || (typeof msg.content === 'string' ? msg.content : '');
                if (displayStr) {
                    const isAssistant = msg.role === 'assistant';
                    const text = isAssistant ? stripConciergeStateBlocks(displayStr) : displayStr;
                    appendChatBubble(msg.role, text, msg.imageSrc || null);
                } else if (Array.isArray(msg.content)) {
                    let text = '';
                    let imgSrc = null;
                    msg.content.forEach(p => {
                        if (p.type === 'text') text += p.text;
                        if (p.type === 'image_url') imgSrc = p.image_url?.url;
                    });
                    appendChatBubble(msg.role, text, imgSrc || msg.imageSrc || null);
                }
            });
            toastr?.info('Resumed previous Session Zero draft in progress.', 'Session Zero');
        }
    } else {
        // No draft exists in storage
        if (chatHistory.length > 0) {
            // Storage was cleared or campaign was previously built; reset in-memory state cleanly
            resetConciergeState({ showGreeting: true });
        } else if (!$('#mhc_chat_messages').children().length) {
            // Pristine first open: show greeting
            resetConciergeState({ showGreeting: true });
        }
    }

    // Refresh active chat context indicators and sync button visibility
    await refreshConciergeActiveContext();

    updateBlueprintDeck();
    renderDebugInspectorView();
    $('#mhc_concierge_modal').fadeIn(200);
}

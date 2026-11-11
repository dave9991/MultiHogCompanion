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
    ConciergeLoopError,
    ConciergeTimeoutError,
    detectRepetition,
    stripThinkingContent,
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
    stageCanonSource,
    unstageCanonSource,
    clearStagedCanon,
    setModeOverride,
    getModeOverride,
    getCurrentMode,
    getStagedTokenTotal,
    getStagedCanonEntries,
    buildInventoryBlock,
    shouldBrief,
    markBriefed,
    parseSuggestedStarts,
    isVectorsWorldInfoEnabled,
    retrieveCanonSlice,
    buildFocusBlock,
    parsePromoteRequests,
    resolvePromoteRequests,
    markSlicePromoted,
    getPromotedSet,
    decideMode,
    estimateTokens,
    detectCanonBucket,
    stageRawCanonSource,
    getStagedSourcesSummary,
    extractSourcesStructuralOutline,
    buildCanonFromFraming,
    setStagedCanonEntries,
    toggleCanonEntryDisabled,
    upsertCanonEntry,
    removeCanonEntry,
    snapshotFraming,
    computeFramingDiff,
    snapshotCanon,
    computeCanonDiff,
    snapshotAdventure,
    computeAdventureDiff,
    extractAgnosticAdventureBones,
} from './concierge-canon.js';
import {
    buildConciergeSystemPrompt,
    buildArchivistBriefingPrompt,
    buildConciergeBuilderContext,
    buildConciergeCriticContext,
    buildConciergeRefinerContext,
    buildConciergeTalkerContext,
    buildStage1InitialBuilderPrompt,
    buildStage1InitialTalkerPrompt,
    buildStage2CanonBuilderPrompt,
    buildStage2CanonTalkerPrompt,
    buildStage3AdventureBuilderPrompt,
    buildStage3AdventureTalkerPrompt,
    buildStage4CharacterBuilderPrompt,
    buildStage4CharacterTalkerPrompt,
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
    isDefaultUntitledCampaignTitle,
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
import { FAE_GENRES, TEMPO_WINDOWS } from './fae-ruleset.js';
import { buildNameRagSeedsForConcierge, resolveDossierNamePlaceholders } from './namerag-hooks.js';
import {
    getCompanionActiveCartridge,
    getCandidateChatIds,
    isFaeActive,
} from './pbta-ruleset-persistence.js';
import { systemRegistry } from './concierge-system-registry.js';
import { renderProgressionArchitect } from './progression-architect-ui.js';
import './concierge-system-pbta.js';
import './concierge-system-fae.js';
import './concierge-system-dnd5e.js';
let extension_settings = globalThis.extension_settings || {};
try {
    const extModule = await import('../../../extensions.js');
    if (extModule?.extension_settings) extension_settings = extModule.extension_settings;
} catch (_) {}

export const STORAGE_DRAFT_KEY = 'mhc_pbta_concierge_draft';

/**
 * Returns the scoped localStorage draft key for the given ruleset.
 * Format: mhc_concierge_draft_{ruleset}
 * @param {string} [ruleset='pbta']
 * @returns {string}
 */
export function getDraftStorageKey(ruleset = 'pbta') {
    return systemRegistry.get(ruleset)?.getDraftStorageKey() || `mhc_concierge_draft_${ruleset === 'fae' ? 'fae' : 'pbta'}`;
}

let modalInitialized = false;
let activeDossier = createEmptyDossier();
let loadedCampaignOriginChatId = null;
let loadedCampaignOriginTitle = null;
let chatHistory = [];
let changelog = [];
let pendingAttachments = [];
let pendingPromotions = []; // Canon entry names the Concierge asked to pull in next turn
let isGenerating = false;
/** Active Builder/Judge/Talker turn: { controller, cancelled } — lets Stop/reset cancel and invalidate stale work. */
let activeTurn = null;
/** Max prior chat messages sent to each LLM pass (blueprint carries long-term state). */
const MAX_PASS_HISTORY = 24;
/** Max chars of a failed Builder reply echoed back on retry (never feed a loop back to the model). */
const MAX_RETRY_ECHO_CHARS = 1500;
let activeImports = [];
let isImportCommitPending = false;
let importStatusText = '';
let importAbortController = null;
export function getImportCommitPending() { return isImportCommitPending; }
export function setImportCommitPending(val) { isImportCommitPending = Boolean(val); }
let activeNameRagSeeds = '';
let activeNameRagKey = '';

let currentNavMode = 'new-adventure';
let lastActiveConciergeMode = 'new-adventure';
let currentAdventureStep = 'initial';
let unlockedSteps = { initial: true, canon: false, adventure: false, character: false };
let stageChatHistories = { initial: [], canon: [], adventure: [], character: [] };
let lastSyncedSnapshots = { framing: null, canon: null, adventure: null };
let attachedSources = [];

// ── Two-Track Architecture: Session Zero Sandbox vs Active Living World ──
const sessionZeroTrack = {
    dossier: createEmptyDossier(),
    chatHistory: [],
    changelog: [],
    currentAdventureStep: 'initial',
    unlockedSteps: { initial: true, canon: false, adventure: false, character: false },
    stageChatHistories: { initial: [], canon: [], adventure: [], character: [] },
    lastSyncedSnapshots: { framing: null, canon: null, adventure: null },
    attachedSources: [],
    stagedCanonEntries: [],
    pendingAttachments: [],
    activeImports: [],
    rulesetConfirmed: false,
};

const livingWorldTrack = {
    chatId: null,
    campaignTitle: null,
    dossier: null,
    chatHistory: [],
    stagedCanonEntries: [],
};

function snapshotCurrentToSessionZeroTrack() {
    sessionZeroTrack.dossier = activeDossier;
    sessionZeroTrack.chatHistory = [...chatHistory];
    sessionZeroTrack.changelog = [...changelog];
    sessionZeroTrack.currentAdventureStep = currentAdventureStep;
    sessionZeroTrack.unlockedSteps = { ...unlockedSteps };
    sessionZeroTrack.stageChatHistories = { ...stageChatHistories };
    sessionZeroTrack.lastSyncedSnapshots = { ...lastSyncedSnapshots };
    sessionZeroTrack.attachedSources = [...attachedSources];
    sessionZeroTrack.stagedCanonEntries = getStagedCanonEntries();
    sessionZeroTrack.pendingAttachments = [...pendingAttachments];
    sessionZeroTrack.activeImports = [...activeImports];
    sessionZeroTrack.rulesetConfirmed = Boolean(activeDossier?.meta?.rulesetConfirmed);
}

function restoreSessionZeroTrack() {
    activeDossier = sessionZeroTrack.dossier;
    chatHistory = sessionZeroTrack.chatHistory;
    changelog = sessionZeroTrack.changelog || [];
    currentAdventureStep = sessionZeroTrack.currentAdventureStep || 'initial';
    unlockedSteps = { ...sessionZeroTrack.unlockedSteps };
    stageChatHistories = { ...sessionZeroTrack.stageChatHistories };
    lastSyncedSnapshots = { ...sessionZeroTrack.lastSyncedSnapshots };
    attachedSources = [...(sessionZeroTrack.attachedSources || [])];
    setStagedCanonEntries(sessionZeroTrack.stagedCanonEntries || []);
    pendingAttachments = [...(sessionZeroTrack.pendingAttachments || [])];
    activeImports = [...(sessionZeroTrack.activeImports || [])];
}

export function getConciergeStageState() {
    return {
        currentNavMode,
        currentAdventureStep,
        unlockedSteps: { ...unlockedSteps },
        rulesetConfirmed: Boolean(activeDossier?.meta?.rulesetConfirmed),
        lastActiveConciergeMode,
    };
}

export function getActiveConciergeDossier() {
    return activeDossier;
}

export function getSessionZeroTrack() {
    return sessionZeroTrack;
}

export function getLivingWorldTrack() {
    return livingWorldTrack;
}

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
    // Only save when in Session Zero track! Never save Living World to Session Zero draft storage!
    if (currentNavMode !== 'new-adventure') return;
    try {
        const ruleset = systemRegistry.detectRuleset(activeDossier);
        const adapter = systemRegistry.get(ruleset);
        const key = adapter.getDraftStorageKey();
        const hasChat = Array.isArray(chatHistory) && chatHistory.length > 0;
        const isUntouched = !hasChat && isDossierEmptyOrUntouched(activeDossier);
        if (isUntouched) {
            localStorage.removeItem(key);
            if (adapter.id === 'pbta') {
                localStorage.removeItem(STORAGE_DRAFT_KEY);
            }
            return;
        }
        const payload = {
            dossier: activeDossier,
            chatHistory,
            changelog,
            originChatId: null,
            originCampaignTitle: null,
            timestamp: Date.now(),
            currentNavMode: 'new-adventure',
            currentAdventureStep,
            unlockedSteps,
            stageChatHistories,
            stagedCanonEntries: getStagedCanonEntries(),
            lastSyncedSnapshots,
            attachedSources,
        };
        localStorage.setItem(key, JSON.stringify(payload));
    } catch (_) {}
}

/**
 * Load and strictly validate draft from localStorage.
 * Returns { draft } if valid, { corrupted: true } if invalid/partial, or null if empty.
 * @param {string|null} [targetRuleset=null]
 */
export function loadValidatedDraft(targetRuleset = null) {
    const ruleset = targetRuleset
        || (currentNavMode === 'new-adventure' ? systemRegistry.detectRuleset(activeDossier) : null)
        || systemRegistry.detectRuleset(sessionZeroTrack.dossier)
        || (isFaeActive() ? 'fae' : 'pbta');
    const adapter = systemRegistry.get(ruleset);
    const key = adapter.getDraftStorageKey();
    try {
        let raw = localStorage.getItem(key);
        // Migration: read legacy 'mhc_pbta_concierge_draft' only for pbta
        if (!raw && adapter.id === 'pbta') {
            raw = localStorage.getItem(STORAGE_DRAFT_KEY);
            if (raw) {
                try {
                    localStorage.setItem(key, raw);
                    localStorage.removeItem(STORAGE_DRAFT_KEY);
                } catch (_) {}
            }
        }
        if (!raw) return null;
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (parseErr) {
            console.warn(`[${adapter.label} Concierge] Corrupted JSON in draft storage; purging:`, parseErr);
            localStorage.removeItem(key);
            if (adapter.id === 'pbta') localStorage.removeItem(STORAGE_DRAFT_KEY);
            return { corrupted: true };
        }
        const validated = validateDraft(parsed);
        if (!validated) {
            console.warn(`[${adapter.label} Concierge] Incomplete draft detected; purging for clean start.`);
            localStorage.removeItem(key);
            if (adapter.id === 'pbta') localStorage.removeItem(STORAGE_DRAFT_KEY);
            return { corrupted: true };
        }
        return { draft: validated };
    } catch (err) {
        console.warn(`[${adapter.label} Concierge] Unexpected error reading draft; purging:`, err);
        try {
            localStorage.removeItem(key);
            if (adapter.id === 'pbta') localStorage.removeItem(STORAGE_DRAFT_KEY);
        } catch (_) {}
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
    if (typeof document === 'undefined' || globalThis.__MHC_TEST_AUTO_CONFIRM__ !== undefined) {
        return Promise.resolve(globalThis.__MHC_TEST_AUTO_CONFIRM__ !== false);
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
export function resetConciergeState({ showGreeting = true, ruleset = null, genreKey = null } = {}) {
    const effectiveRuleset = ruleset || (isFaeActive() ? 'fae' : 'pbta');
    const adapter = systemRegistry.get(effectiveRuleset);
    try {
        localStorage.removeItem(adapter.getDraftStorageKey());
        if (adapter.id === 'pbta') {
            localStorage.removeItem(STORAGE_DRAFT_KEY);
        }
    } catch (_) {}

    activeDossier = createEmptyDossier(adapter.id, genreKey);
    loadedCampaignOriginChatId = null;
    loadedCampaignOriginTitle = null;
    chatHistory = [];
    changelog = [];
    pendingAttachments = [];
    clearStagedCanon();
    pendingPromotions = [];
    isImportCommitPending = false;
    importStatusText = '';
    currentNavMode = 'new-adventure';
    currentAdventureStep = 'initial';
    unlockedSteps = { initial: true, canon: false, adventure: false, character: false };
    stageChatHistories = { initial: [], canon: [], adventure: [], character: [] };
    lastSyncedSnapshots = { framing: null, canon: null, adventure: null };
    attachedSources = [];
    if (importAbortController) {
        try { importAbortController.abort(); } catch (_) {}
        importAbortController = null;
    }
    if (activeTurn) {
        activeTurn.cancelled = true;
        try { activeTurn.controller.abort(); } catch (_) {}
        activeTurn = null;
    }
    isGenerating = false;
    const stopBtnEl = typeof document !== 'undefined' ? document.getElementById?.('mhc_stop_btn') : null;
    if (stopBtnEl) stopBtnEl.style.display = 'none';
    const sendBtnEl = typeof document !== 'undefined' ? document.getElementById?.('mhc_send_btn') : null;
    if (sendBtnEl) sendBtnEl.disabled = false;
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
    setConciergeTab('cards');

    if (showGreeting) {
        const greeting = "Welcome to Session Zero! I'm your Concierge. Tell me what kind of game or adventure you'd like to play, or drop in a screenshot, character art, or lore document to inspire our world. What genre or vibe are you aiming for?";
        appendChatBubble('assistant', greeting);
        chatHistory.push({ role: 'assistant', content: greeting });
        stageChatHistories.initial = [...chatHistory];
    }
    evaluateStepUnlocks();
    snapshotCurrentToSessionZeroTrack();
}

/**
 * Switches the active ruleset mode (e.g. between 'pbta' and 'fae').
 *
 * @param {string} newRuleset 'pbta' or 'fae'
 * @param {string|null} [newGenreKey]
 */
export function switchRulesetMode(newRuleset = 'pbta', newGenreKey = null) {
    if (activeDossier?.meta?.ruleset === newRuleset && !newGenreKey) {
        return;
    }

    const isUntouched = (!Array.isArray(chatHistory) || chatHistory.length === 0) && isDossierEmptyOrUntouched(activeDossier);
    if (isUntouched) {
        resetConciergeState({ showGreeting: true, ruleset: newRuleset, genreKey: newGenreKey });
        return;
    }

    const adapter = systemRegistry.get(newRuleset);
    const defaultGenre = newGenreKey || adapter.getDefaultGenre();
    activeDossier = createEmptyDossier(newRuleset, newGenreKey);
    chatHistory = [];
    $('#mhc_chat_messages').empty();
    changelog.push(`Switched ruleset mode to ${adapter.label} (${activeDossier.meta?.systemKey || defaultGenre})`);
    updateBlueprintDeck();
    saveDraft();
    const modeLabel = `${adapter.label} (${adapter.diceEngine})`;
    appendChatBubble(
        'assistant',
        `Switched Session Zero mode to **${modeLabel}** (${activeDossier.meta?.systemLabel || defaultGenre}). What kind of adventure or setting would you like to build?`
    );
}

/**
 * Re-renders the message stream DOM from current chatHistory array.
 */
function renderChatHistoryFromState() {
    $('#mhc_chat_messages').empty();
    if (!Array.isArray(chatHistory)) return;
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
}

/**
 * Evaluates step unlocking conditions across the 4-step progressive pipeline:
 * 1. Initial ➔ 2. Canon ➔ 3. Adventure ➔ 4. Character
 */
export function evaluateStepUnlocks() {
    unlockedSteps.initial = true;

    // Step 2 (Canon) unlocks if already unlocked OR framingComplete OR has premise and (not big bucket or has lens)
    if (!unlockedSteps.canon) {
        const framingDone = Boolean(activeDossier?.meta?.framingComplete);
        const hasPremise = Boolean(activeDossier?.meta?.premise?.trim());
        const bucket = detectCanonBucket(getStagedTokenTotal());
        const hasLens = Boolean(activeDossier?.meta?.focalLens?.trim());
        if (framingDone || (hasPremise && (bucket !== 'big' || hasLens))) {
            unlockedSteps.canon = true;
        }
    }

    // Step 3 (Adventure) unlocks if already unlocked OR staged Canon entries exist OR worldRules axioms exist
    if (!unlockedSteps.adventure) {
        const hasCanon = getStagedCanonEntries().length > 0;
        const hasAxioms = Array.isArray(activeDossier?.worldRules?.axioms) && activeDossier.worldRules.axioms.length > 0;
        if (hasCanon || hasAxioms) {
            unlockedSteps.adventure = true;
        }
    }

    // Step 4 (Character) unlocks if already unlocked OR (ruleset confirmed AND Episode 1 content exists)
    if (!unlockedSteps.character) {
        const rulesetConfirmed = Boolean(activeDossier?.meta?.rulesetConfirmed);
        const kick = activeDossier?.theKick || {};
        const hasEpisode1Content = Boolean(
            kick.crisis ||
            kick.startingLocation ||
            activeDossier?.maps?.length ||
            activeDossier?.monsters?.length ||
            activeDossier?.npcs?.length
        );
        if (rulesetConfirmed && hasEpisode1Content) {
            unlockedSteps.character = true;
        }
    }

    // Stepper DOM buttons & arrows visibility
    const canonArrow = $('#mhc_step_arrow_canon');
    if (typeof canonArrow.show === 'function' && typeof canonArrow.hide === 'function') {
        if (unlockedSteps.canon) canonArrow.show(); else canonArrow.hide();
    }
    const canonBtn = $('#mhc_step_btn_canon');
    if (typeof canonBtn.show === 'function' && typeof canonBtn.hide === 'function') {
        if (unlockedSteps.canon) canonBtn.show(); else canonBtn.hide();
    }

    const advArrow = $('#mhc_step_arrow_adventure');
    if (typeof advArrow.show === 'function' && typeof advArrow.hide === 'function') {
        if (unlockedSteps.adventure) advArrow.show(); else advArrow.hide();
    }
    const advBtn = $('#mhc_step_btn_adventure');
    if (typeof advBtn.show === 'function' && typeof advBtn.hide === 'function') {
        if (unlockedSteps.adventure) advBtn.show(); else advBtn.hide();
    }

    const charArrow = $('#mhc_step_arrow_character');
    if (typeof charArrow.show === 'function' && typeof charArrow.hide === 'function') {
        if (unlockedSteps.character) charArrow.show(); else charArrow.hide();
    }
    const charBtn = $('#mhc_step_btn_character');
    if (typeof charBtn.show === 'function' && typeof charBtn.hide === 'function') {
        if (unlockedSteps.character) charBtn.show(); else charBtn.hide();
    }

    const stepperBtns = $('#mhc_new_adventure_stepper .mhc-step-btn');
    if (typeof stepperBtns.removeClass === 'function') {
        stepperBtns.removeClass('active');
    }
    const curBtn = $(`#mhc_step_btn_${currentAdventureStep}`);
    if (typeof curBtn.addClass === 'function') {
        curBtn.addClass('active');
    }

    // Launch button state
    const launchBtn = $('#mhc_launch_campaign_btn');
    const isReady = currentNavMode !== 'new-adventure' || currentAdventureStep === 'character' || unlockedSteps.character;
    if (typeof launchBtn.prop === 'function') {
        launchBtn.prop('disabled', !isReady);
    }
    if (typeof launchBtn.css === 'function') {
        launchBtn.css({ opacity: isReady ? '1' : '0.5', 'pointer-events': isReady ? 'auto' : 'none' });
    }
}

/**
 * Runs a single Stage Builder + Talker harmonization pass.
 */
async function runStageHarmonizationPass(stage, { upstreamDiff = '', agnosticBones = null } = {}) {
    let builderSys = '';
    let talkerSys = '';
    const stagedCanon = getStagedCanonEntries();

    if (stage === 'canon') {
        builderSys = buildStage2CanonBuilderPrompt(activeDossier, stagedCanon, upstreamDiff);
        talkerSys = buildStage2CanonTalkerPrompt(activeDossier, stagedCanon, upstreamDiff);
    } else if (stage === 'adventure') {
        builderSys = buildStage3AdventureBuilderPrompt(activeDossier, stagedCanon, { upstreamDiff, agnosticBones });
        talkerSys = buildStage3AdventureTalkerPrompt(activeDossier, stagedCanon, { upstreamDiff, agnosticBones });
    } else if (stage === 'character') {
        builderSys = buildStage4CharacterBuilderPrompt(activeDossier, stagedCanon, { upstreamDiff });
        talkerSys = buildStage4CharacterTalkerPrompt(activeDossier, stagedCanon, { upstreamDiff });
    }

    const builderMsgs = [
        { role: 'system', name: 'System', content: builderSys },
        { role: 'user', name: 'Player', content: upstreamDiff ? `[UPSTREAM_DIFF]:\n${upstreamDiff}\nPlease harmonize this stage with upstream updates.` : 'Please harmonize this stage with upstream updates.' },
    ];
    const builderRaw = await sendConciergeRequest(builderMsgs);
    const builderReport = applyDossierUpdates(builderRaw, activeDossier);

    if (stage === 'canon' && builderReport?.canonMutations?.length > 0) {
        for (const m of builderReport.canonMutations) {
            if (m.action === 'upsert' && m.entry) upsertCanonEntry(m.entry);
            else if (m.action === 'disable') toggleCanonEntryDisabled(m.target, true);
            else if (m.action === 'enable') toggleCanonEntryDisabled(m.target, false);
            else if (m.action === 'remove') removeCanonEntry(m.target);
        }
        builderReport.hasMutations = true;
    }

    if (builderReport.hasMutations) {
        activeDossier = builderReport.updatedDossier;
    }

    const talkerMsgs = [
        { role: 'system', name: 'System', content: talkerSys },
        { role: 'user', name: 'Player', content: 'What updates were made?' },
    ];
    const talkerRaw = await sendConciergeRequest(talkerMsgs);
    const cleanTalker = stripConciergeStateBlocks(stripThinkingContent(talkerRaw || '')).trim() || 'Stage harmonized with upstream updates.';

    $('#mhc_chat_messages').empty();
    appendChatBubble('assistant', cleanTalker);
    chatHistory = [{ role: 'assistant', content: cleanTalker }];
    stageChatHistories[stage] = [...chatHistory];
    updateBlueprintDeck();
}

/**
 * Runs an autonomous stage Builder + Talker pass to generate stage contents.
 */
async function runStageAutoPass(stage, promptText, { agnosticBones = null, upstreamDiff = '' } = {}) {
    const stream = document.getElementById('mhc_chat_messages');
    const typingBubble = document.createElement('div');
    typingBubble.className = 'mhc-bubble mhc-bubble-assistant';
    typingBubble.id = 'mhc_typing_indicator';
    typingBubble.innerHTML = '<i class="mhc-stage">🎩 The Concierge is constructing Episode 1 Adventure...</i>';
    if (stream) {
        stream.appendChild(typingBubble);
        stream.scrollTop = stream.scrollHeight;
    }

    try {
        const stagedCanon = getStagedCanonEntries();
        let builderSys = '';
        let talkerSys = '';

        if (stage === 'adventure') {
            builderSys = buildStage3AdventureBuilderPrompt(activeDossier, stagedCanon, { upstreamDiff, agnosticBones });
            talkerSys = buildStage3AdventureTalkerPrompt(activeDossier, stagedCanon, { upstreamDiff, agnosticBones });
        } else if (stage === 'character') {
            builderSys = buildStage4CharacterBuilderPrompt(activeDossier, stagedCanon, { upstreamDiff });
            talkerSys = buildStage4CharacterTalkerPrompt(activeDossier, stagedCanon, { upstreamDiff });
        }

        const builderMsgs = [
            { role: 'system', name: 'System', content: builderSys },
            { role: 'user', name: 'Player', content: promptText },
        ];
        const builderRaw = await sendConciergeRequest(builderMsgs);
        const report = applyDossierUpdates(builderRaw, activeDossier);
        if (report.hasMutations) {
            activeDossier = report.updatedDossier;
        }

        const talkerMsgs = [
            { role: 'system', name: 'System', content: talkerSys },
            { role: 'user', name: 'Player', content: promptText },
        ];
        const talkerRaw = await sendConciergeRequest(talkerMsgs);
        const cleanTalker = stripConciergeStateBlocks(stripThinkingContent(talkerRaw || '')).trim() || 'Episode 1 Adventure constructed.';

        typingBubble.remove();
        $('#mhc_chat_messages').empty();
        appendChatBubble('assistant', cleanTalker);
        chatHistory = [{ role: 'assistant', content: cleanTalker }];
        stageChatHistories[stage] = [...chatHistory];
        evaluateStepUnlocks();
        updateBlueprintDeck();
        saveDraft();
    } catch (err) {
        typingBubble.remove();
        console.error('[MultiHog Companion] Stage auto-pass error:', err);
        toastr?.error(`Auto-pass failed: ${err.message}`);
    }
}

/**
 * Transitions the UI stage controller to targetStep:
 * 'initial' | 'canon' | 'adventure' | 'character'
 */
export async function setAdventureStep(targetStep, opts = {}) {
    if (!['initial', 'canon', 'adventure', 'character'].includes(targetStep)) return;
    if (!unlockedSteps[targetStep] && !opts.force) return;

    // 1. Before leaving current step, save chat history and snapshot
    stageChatHistories[currentAdventureStep] = [...chatHistory];

    if (currentAdventureStep === 'initial' && lastSyncedSnapshots.framing === null) {
        lastSyncedSnapshots.framing = snapshotFraming(activeDossier);
    } else if (currentAdventureStep === 'canon' && lastSyncedSnapshots.canon === null) {
        lastSyncedSnapshots.canon = snapshotCanon(getStagedCanonEntries(), activeDossier?.worldRules);
    } else if (currentAdventureStep === 'adventure' && lastSyncedSnapshots.adventure === null) {
        lastSyncedSnapshots.adventure = snapshotAdventure(activeDossier);
    }

    currentAdventureStep = targetStep;

    // 2. Handle step transition logic
    if (targetStep === 'initial') {
        $('.mhc-chat-column').show();
        chatHistory = [...(stageChatHistories.initial || [])];
        renderChatHistoryFromState();
    } else if (targetStep === 'canon') {
        $('.mhc-chat-column').show();
        const framingDiff = lastSyncedSnapshots.framing
            ? computeFramingDiff(lastSyncedSnapshots.framing, snapshotFraming(activeDossier))
            : null;

        if (getStagedCanonEntries().length === 0 && !opts.skipCanonBuild) {
            stageChatHistories.canon = [];
            chatHistory = [];
            $('#mhc_chat_messages').empty();
            appendChatBubble('assistant', '🗃️ Building & organizing Series Bible Canon from your framing...');

            try {
                await buildCanonFromFraming({
                    title: activeDossier.meta?.title,
                    premise: activeDossier.meta?.premise,
                    focalLens: activeDossier.meta?.focalLens,
                    tone: activeDossier.meta?.tone,
                }, {
                    send: (msgs, sig) => sendConciergeRequest(msgs, sig),
                    onStatus: msg => toastr?.info(msg),
                });
            } catch (err) {
                console.error('[MultiHog Companion] Canon build error:', err);
                toastr?.error(`Failed building Canon: ${err.message}`);
            }

            lastSyncedSnapshots.framing = snapshotFraming(activeDossier);
            lastSyncedSnapshots.canon = snapshotCanon(getStagedCanonEntries(), activeDossier?.worldRules);
            unlockedSteps.adventure = true;

            const canon = getStagedCanonEntries();
            const activeCount = canon.filter(e => !e.disabled).length;
            const disabledCount = canon.filter(e => e.disabled).length;
            const cats = [...new Set(canon.map(e => e.kind))].join(', ') || 'LORE';

            $('#mhc_chat_messages').empty();
            const welcomeText = `📚 **Series Bible Canon Generated!**\n\nI have structured **${canon.length}** canon entries (${cats}).\n• **${activeCount}** active entries in play.\n• **${disabledCount}** background/deferred entries.\n\nYou can review, expand, or toggle entries in the Series Bible on the right, or click **3. 🗺️ Adventure** up top to choose your ruleset engine and forge Episode 1!`;
            appendChatBubble('assistant', welcomeText);
            chatHistory = [{ role: 'assistant', content: welcomeText }];
            stageChatHistories.canon = [...chatHistory];
        } else if (framingDiff?.hasChanges && !opts.skipHarmonization) {
            stageChatHistories.canon = [];
            chatHistory = [];
            $('#mhc_chat_messages').empty();
            appendChatBubble('assistant', '🔄 Harmonizing Canon with your updated Initial framing...');

            try {
                await runStageHarmonizationPass('canon', { upstreamDiff: framingDiff.block });
                lastSyncedSnapshots.framing = snapshotFraming(activeDossier);
            } catch (err) {
                console.error('[MultiHog Companion] Canon harmonization error:', err);
                toastr?.error(`Failed harmonizing Canon: ${err.message}`);
            }
        } else {
            chatHistory = [...(stageChatHistories.canon || [])];
            renderChatHistoryFromState();
        }
    } else if (targetStep === 'adventure') {
        const rulesetConfirmed = Boolean(activeDossier?.meta?.rulesetConfirmed);
        if (!rulesetConfirmed) {
            chatHistory = [...(stageChatHistories.adventure || [])];
            renderChatHistoryFromState();
        } else {
            $('.mhc-chat-column').show();
            const canonDiff = lastSyncedSnapshots.canon
                ? computeCanonDiff(lastSyncedSnapshots.canon, snapshotCanon(getStagedCanonEntries(), activeDossier?.worldRules))
                : null;

            if (canonDiff?.hasChanges && !opts.skipHarmonization) {
                stageChatHistories.adventure = [];
                chatHistory = [];
                $('#mhc_chat_messages').empty();
                appendChatBubble('assistant', '🔄 Harmonizing Episode 1 Adventure with updated Canon...');

                try {
                    await runStageHarmonizationPass('adventure', { upstreamDiff: canonDiff.block });
                    lastSyncedSnapshots.canon = snapshotCanon(getStagedCanonEntries(), activeDossier?.worldRules);
                } catch (err) {
                    console.error('[MultiHog Companion] Adventure harmonization error:', err);
                    toastr?.error(`Failed harmonizing Adventure: ${err.message}`);
                }
            } else {
                chatHistory = [...(stageChatHistories.adventure || [])];
                renderChatHistoryFromState();
            }
        }
    } else if (targetStep === 'character') {
        $('.mhc-chat-column').show();
        const canonDiff = lastSyncedSnapshots.canon
            ? computeCanonDiff(lastSyncedSnapshots.canon, snapshotCanon(getStagedCanonEntries(), activeDossier?.worldRules))
            : null;
        const advDiff = lastSyncedSnapshots.adventure
            ? computeAdventureDiff(lastSyncedSnapshots.adventure, snapshotAdventure(activeDossier))
            : null;

        const combinedDiff = [
            canonDiff?.hasChanges ? canonDiff.block : '',
            advDiff?.hasChanges ? advDiff.block : '',
        ].filter(Boolean).join('\n\n');

        if (combinedDiff && !opts.skipHarmonization) {
            stageChatHistories.character = [];
            chatHistory = [];
            $('#mhc_chat_messages').empty();
            appendChatBubble('assistant', '🔄 Harmonizing Protagonist with updated Adventure & Canon...');

            try {
                await runStageHarmonizationPass('character', { upstreamDiff: combinedDiff });
                lastSyncedSnapshots.adventure = snapshotAdventure(activeDossier);
                lastSyncedSnapshots.canon = snapshotCanon(getStagedCanonEntries(), activeDossier?.worldRules);
            } catch (err) {
                console.error('[MultiHog Companion] Character harmonization error:', err);
                toastr?.error(`Failed harmonizing Character: ${err.message}`);
            }
        } else if (!stageChatHistories.character || stageChatHistories.character.length === 0) {
            chatHistory = [];
            $('#mhc_chat_messages').empty();
            const charGreeting = "👤 **Step 4: Character & Protagonist**\n\nNow let's forge your Protagonist! Tell me who you want to play, or pick an existing SillyTavern character / persona inspiration from the toolbar below. You can also view and customize your **📜 Progression Codex** using the tab on the right.";
            appendChatBubble('assistant', charGreeting);
            chatHistory = [{ role: 'assistant', content: charGreeting }];
            stageChatHistories.character = [...chatHistory];
        } else {
            chatHistory = [...(stageChatHistories.character || [])];
            renderChatHistoryFromState();
        }
    }

    evaluateStepUnlocks();
    updateBlueprintDeck();
    saveDraft();
}

/**
 * Render the Live Blueprint cards from activeDossier.
 */
export function updateBlueprintDeck() {
    const meta = activeDossier.meta || {};
    const proto = activeDossier.protagonist || {};
    const npcs = activeDossier.npcs || [];
    const monsters = activeDossier.monsters || [];
    const maps = activeDossier.maps || [];
    const kick = activeDossier.theKick || {};

    // Header Badge & System Card
    const rulesetId = systemRegistry.detectRuleset(activeDossier);
    const adapter = systemRegistry.get(rulesetId);
    const isFae = adapter.id === 'fae';
    const isUntouchedAndUnestablished = !meta.genreEstablished && isDossierEmptyOrUntouched(activeDossier);

    const titlePrefix = adapter.id === 'fae' ? 'FAE' : adapter.id === 'pbta' ? 'PbtA' : adapter.id.toUpperCase();
    if (currentNavMode === 'living-world') {
        const campTitle = (activeDossier.meta?.title || loadedCampaignOriginTitle || '').trim() || 'Active Campaign';
        $('#mhc_concierge_modal_title').text(`Living World Dossier: ${campTitle}`);
    } else {
        $('#mhc_concierge_modal_title').text('Session Zero Concierge');
    }
    $('#mhc_deck_engine_title').text(`${adapter.badgeIcon} ${titlePrefix} Engine`);

    const toggleContainer = $('#mhc_header_ruleset_toggle');
    if (toggleContainer.length && typeof toggleContainer.find === 'function') {
        let existingBtns = toggleContainer.find('.mhc-ruleset-btn');
        const registeredList = systemRegistry.list();
        if (existingBtns && typeof existingBtns.each === 'function') {
            if (existingBtns.length !== registeredList.length && typeof toggleContainer.empty === 'function') {
                toggleContainer.empty();
                for (const ad of registeredList) {
                    if (typeof globalThis.$ === 'function') {
                        const btn = $('<button type="button" class="mhc-ruleset-btn"></button>')
                            .attr('data-ruleset', ad.id)
                            .css({ border: 'none', 'font-size': '0.78em', 'font-weight': '600', padding: '4px 10px', 'border-radius': '4px', cursor: 'pointer' })
                            .text(`${ad.badgeIcon} ${ad.id.toUpperCase()} (${ad.diceEngine.split(' ')[0]})`);
                        if (typeof toggleContainer.append === 'function') toggleContainer.append(btn);
                    }
                }
                existingBtns = toggleContainer.find('.mhc-ruleset-btn');
            }
            if (existingBtns && typeof existingBtns.each === 'function') {
                existingBtns.each(function () {
                    const btnRuleset = $(this).attr('data-ruleset');
                    const active = btnRuleset === adapter.id;
                    if (typeof $(this).toggleClass === 'function') $(this).toggleClass('active', active);
                    if (typeof $(this).css === 'function') {
                        if (active) {
                            let activeStyle = { background: 'rgba(59, 130, 246, 0.35)', color: '#93c5fd' };
                            if (adapter.id === 'fae') {
                                activeStyle = { background: 'rgba(245, 158, 11, 0.35)', color: '#fde68a' };
                            } else if (adapter.id === 'dnd5e') {
                                activeStyle = { background: 'rgba(217, 119, 6, 0.35)', color: '#fbbf24' };
                            }
                            $(this).css(activeStyle);
                        } else {
                            $(this).css({ background: 'transparent', color: '#9ca3af' });
                        }
                    }
                });
            }
        }
    }

    const isSessionZeroAgnostic = currentNavMode === 'new-adventure' && (currentAdventureStep === 'initial' || currentAdventureStep === 'canon' || !meta.rulesetConfirmed);
    if (isSessionZeroAgnostic || isUntouchedAndUnestablished) {
        $('#mhc_header_system_badge')
            .text('✨ Any Genre / Custom')
            .attr('title', isSessionZeroAgnostic
                ? 'Ruleset and engine will be chosen in Step 3 (Adventure)'
                : `Active Engine: ${adapter.label} (${adapter.diceEngine}) — Use any preset or forge custom setting`);
        $('#mhc_deck_system_tag').text('ANY GENRE / CUSTOM');
        $('#mhc_deck_system_desc').text(meta.premise || (isFae
            ? 'Single-pass 4dF attrition engine — pick any preset or forge custom Resource Pools.'
            : 'Fiction-first 2d6 narrative engine — pick any preset or forge custom stats & moves.'
        ));
    } else {
        const sysLabel = meta.systemLabel || adapter.getGenre(meta.systemKey)?.label || (isFae ? 'Custom FAE Setting' : PBTA_GENRES.fantasy.label);
        const badgeIcon = adapter.badgeIcon || (isFae ? '🕯️' : '🎲');
        $('#mhc_header_system_badge')
            .text(`${badgeIcon} ${sysLabel}`)
            .attr('title', `Active ${adapter.id.toUpperCase()} Genre: ${sysLabel} (${adapter.diceEngine})`);
        $('#mhc_deck_system_tag').text((meta.systemKey || (isFae ? 'CUSTOM' : 'FANTASY')).toUpperCase());
        $('#mhc_deck_system_desc').text(meta.premise || `${titlePrefix} ${sysLabel} narrative engine.`);
    }

    const defaultCampTitle = isSessionZeroAgnostic ? 'Untitled Campaign' : `Untitled ${titlePrefix} Campaign`;
    const campTitle = (meta.title || '').trim();
    const effectiveCampTitle = isSessionZeroAgnostic && isDefaultUntitledCampaignTitle(campTitle)
        ? 'Untitled Campaign'
        : (campTitle || defaultCampTitle);
    $('#mhc_deck_campaign_title').text(effectiveCampTitle);
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

    if (isFae) {
        const knobs = cfg.knobs || activeDossier.knobs || {};
        const shiftVal = knobs.base_attrition_shift ?? 0;
        const shiftStr = shiftVal >= 0 ? `+${shiftVal}` : `${shiftVal}`;
        const fleeStr = knobs.flee_grace_toggle ? 'ON' : 'OFF';
        $('#mhc_dial_harm_btn').text(`⚖️ Shift: ${shiftStr}`);
        $('#mhc_dial_downed_btn').text(`🏃 Flee Grace: ${fleeStr}`);

        const isHeroic = Boolean(cfg.heroicTier || cfg.heroic_tier || knobs.heroic_tier);
        $('#mhc_dial_heroic_btn')
            .text(`⚡ Heroic: ${isHeroic ? 'ON' : 'OFF'}`)
            .css('opacity', isHeroic ? '1' : '0.65')
            .show();

        const curTempo = cfg.actionTempo || knobs.action_tempo || 'gritty_default';
        const tempoLabel = TEMPO_WINDOWS[curTempo]?.label || TEMPO_WINDOWS.gritty_default.label;
        $('#mhc_dial_tempo_btn')
            .text(`⏱️ Tempo: ${tempoLabel}`)
            .show();
    } else {
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
    }

    const partyMode = cfg.partyMode || 'squad';
    const partyLabel = partyMode.charAt(0).toUpperCase() + partyMode.slice(1);
    const relsOn = cfg.relationships !== false;

    if (isFae) {
        $('#mhc_dial_party_btn').hide();
        $('#mhc_dial_relationships_btn').hide();
    } else {
        $('#mhc_dial_party_btn').text(`👥 Party: ${partyLabel}`).show();
        $('#mhc_dial_relationships_btn').text(`🤝 Relations: ${relsOn ? 'On' : 'Off'}`).css('opacity', relsOn ? '1' : '0.65').show();
    }

    const emojisOn = cfg.cyoaEmojis !== false;
    $('#mhc_dial_emojis_btn').text(`✨ Emojis: ${emojisOn ? 'On' : 'Off'}`);

    const simDepth = cfg.simulationDepth || 'active_fronts';
    let simLabel = 'Active Fronts';
    if (simDepth === 'living_world') simLabel = 'Living World';
    else if (simDepth === 'static') simLabel = 'Static Solo';
    $('#mhc_dial_sim_depth_btn').text(`🌍 Sim: ${simLabel}`);

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
    $('#mhc_deck_char_playbook').text(proto.archetype || proto.playbook || 'In Development');
    $('#mhc_deck_char_name').text(proto.name || 'Unnamed Adventurer');

    adapter.renderDeckStats({
        vitalsEl: $('#mhc_deck_char_vitals'),
        statsEl: $('#mhc_deck_char_stats'),
        movesEl: $('#mhc_deck_char_moves'),
        heroicEl: $('#mhc_deck_char_heroic_domain'),
    }, proto, activeDossier, { isUntouchedAndUnestablished, escapeHtml });

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
            const boonsLabel = isFae ? 'Fictional Leverage:' : 'Boons/Moves:';
            const boons = n.movesOrBoons ? `<div style="font-size: 0.8em; opacity: 0.75;"><b>${boonsLabel}</b> ${n.movesOrBoons}</div>` : '';

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
            if (relsOn && !isFae) {
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
        if (isFae) {
            monsters.forEach(m => {
                const threat = m.threat_level ?? m.threatLevel ?? 1;
                const layers = m.layers ?? m.hp ?? 1;
                const poolsAtRisk = Array.isArray(m.pools_at_risk) ? m.pools_at_risk.join(', ') : (m.pools_at_risk || m.poolsAtRisk || 'Health');
                const pressures = Array.isArray(m.pressures) ? m.pressures.join('; ') : (m.pressures || '');
                const pressuresLine = pressures ? `<div style="font-size: 0.8em; opacity: 0.85;"><b>Pressures:</b> ${escapeHtml(pressures)}</div>` : '';
                const barriers = Array.isArray(m.leverage_barriers) ? m.leverage_barriers.join(' / ') : (m.leverage_barriers || m.leverageBarriers || '');
                const barrierLine = barriers ? `<div style="font-size: 0.8em; opacity: 0.85; color: #fbbf24;"><b>Leverage Barriers:</b> ${escapeHtml(barriers)}</div>` : '';
                const finish = Array.isArray(m.full_finish_triggers) ? m.full_finish_triggers.join('; ') : (m.full_finish_triggers || m.fullFinishTriggers || '');
                const finishLine = finish ? `<div style="font-size: 0.8em; opacity: 0.85; color: #4ade80;"><b>Full Finish Triggers:</b> ${escapeHtml(finish)}</div>` : '';

                const threatBadge = `<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(239, 68, 68, 0.6); color: #f87171;">Threat: ${threat} | ${layers} Layer(s)</span>`;
                const poolBadge = `<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(59, 130, 246, 0.4); color: #93c5fd;">Pools: ${escapeHtml(poolsAtRisk)}</span>`;

                mList.append(`
                    <div class="mhc-deck-item collapsible">
                        <div class="mhc-deck-item-header">
                            <div class="mhc-deck-item-title" style="color: var(--mhc-danger, #ef4444);">
                                👹 ${escapeHtml(m.name)} ${threatBadge} ${poolBadge}
                            </div>
                            <span class="mhc-deck-item-toggle">▼</span>
                        </div>
                        <div class="mhc-deck-item-detail">
                            ${barrierLine}
                            ${pressuresLine}
                            ${finishLine}
                        </div>
                    </div>
                `);
            });
        } else {
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
        }
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

    // Step 1 Initial Framing Card
    const isFramingReady = Boolean(meta.framingComplete);
    $('#mhc_initial_framing_status')
        .text(isFramingReady ? '✓ Ready for Canon' : 'In Progress')
        .css({
            borderColor: isFramingReady ? 'rgba(34, 197, 94, 0.4)' : 'rgba(59, 130, 246, 0.4)',
            color: isFramingReady ? '#4ade80' : '#93c5fd',
        });
    const initialCampTitle = (!meta.rulesetConfirmed && isDefaultUntitledCampaignTitle(meta.title))
        ? 'Untitled Campaign'
        : ((meta.title || '').trim() || 'Untitled Campaign');
    $('#mhc_initial_title').text(initialCampTitle);
    $('#mhc_initial_premise').text((meta.premise || '').trim() || '(Waiting for premise...)');
    $('#mhc_initial_focal_lens').text((meta.focalLens || '').trim() || '(Waiting for focal lens/pivot...)');
    $('#mhc_initial_tone').text((meta.tone || '').trim() || '(Waiting for tone...)');

    // Step 1 Attached Sources Card
    const sourceSummaryList = getStagedSourcesSummary();
    const mergedSources = [...attachedSources];
    for (const src of sourceSummaryList) {
        if (!mergedSources.some(m => m.name === src.name)) {
            mergedSources.push(src);
        }
    }
    $('#mhc_initial_sources_count').text(mergedSources.length);
    const initialSourcesList = $('#mhc_initial_sources_list');
    initialSourcesList.empty();
    if (mergedSources.length) {
        mergedSources.forEach(s => {
            let icon = '📄';
            if (s.type === 'lore') icon = '📚';
            else if (s.type === 'char') icon = '👤';
            else if (s.type === 'image') icon = '🖼️';
            const tokStr = s.tokens ? `~${s.tokens} tok` : '';
            initialSourcesList.append(`
                <div class="mhc-initial-source-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span>${icon}</span>
                        <span style="font-size: 0.82em; font-weight: 600; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.name)}</span>
                        ${tokStr ? `<span class="mhc-pill" style="font-size: 0.7em; opacity: 0.7;">${tokStr}</span>` : ''}
                    </div>
                    <button type="button" class="menu_button mhc-source-remove-btn" data-name="${escapeHtml(s.name)}" style="padding: 1px 6px; font-size: 0.75em; color: #f87171; border-color: rgba(239,68,68,0.3);" title="Remove source">✕</button>
                </div>
            `);
        });
    } else {
        initialSourcesList.append('<div class="mhc-empty-hint">No sources attached yet. Click 📎 to attach lore, cards, or notes.</div>');
    }

    // Step 2 Series Bible (_Canon Lorebook) Card
    const stagedCanon = getStagedCanonEntries();
    $('#mhc_deck_canon_count').text(stagedCanon.length);
    const canonDeckList = $('#mhc_deck_canon_list');
    canonDeckList.empty();
    if (stagedCanon.length) {
        const grouped = {};
        for (const entry of stagedCanon) {
            const kind = (entry.kind || 'LORE').toUpperCase();
            if (!grouped[kind]) grouped[kind] = [];
            grouped[kind].push(entry);
        }
        const order = ['FACTION', 'LOCATION', 'NPC', 'RULE', 'EVENT', 'LORE'];
        const allKinds = [...new Set([...order, ...Object.keys(grouped)])];
        for (const k of allKinds) {
            const entries = grouped[k];
            if (!entries || !entries.length) continue;
            canonDeckList.append(`
                <div class="mhc-canon-group-header" style="font-size: 0.78em; font-weight: 700; color: #93c5fd; text-transform: uppercase; margin-top: 4px; padding-bottom: 2px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                    ${escapeHtml(k)} (${entries.length})
                </div>
            `);
            for (const entry of entries) {
                const comment = entry.comment || `[${entry.kind}] ${entry.name}`;
                const isDisabled = Boolean(entry.disabled);
                const statusLabel = isDisabled ? '⊘ Disabled' : '✓ Active';
                const statusStyle = isDisabled
                    ? 'background: rgba(107, 114, 128, 0.25); border-color: rgba(156, 163, 175, 0.4); color: #9ca3af;'
                    : 'background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.5); color: #4ade80;';
                const impBadge = entry.importance !== undefined ? `<span class="mhc-pill" style="font-size: 0.7em;">Imp: ${entry.importance}</span>` : '';
                canonDeckList.append(`
                    <div class="mhc-deck-item collapsible" style="opacity: ${isDisabled ? '0.6' : '1'};">
                        <div class="mhc-deck-item-header" style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                            <div class="mhc-deck-item-title" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                <span style="font-weight: 600;">${escapeHtml(entry.name || 'Untitled')}</span>
                                <span class="mhc-pill" style="font-size: 0.7em; margin-left: 4px;">${escapeHtml(entry.kind || k)}</span>
                                ${impBadge}
                            </div>
                            <button type="button" class="menu_button mhc-canon-toggle-btn" data-comment="${escapeHtml(comment)}" style="font-size: 0.72em; padding: 2px 8px; border-radius: 4px; font-weight: 600; cursor: pointer; ${statusStyle}" title="Toggle between Active and Disabled">
                                ${statusLabel}
                            </button>
                            <span class="mhc-deck-item-toggle">▼</span>
                        </div>
                        <div class="mhc-deck-item-detail">
                            <div style="font-size: 0.82em; opacity: 0.85; white-space: pre-wrap; line-height: 1.35;">${escapeHtml(entry.content || '')}</div>
                        </div>
                    </div>
                `);
            }
        }
    } else {
        canonDeckList.append('<div class="mhc-empty-hint">No Series Bible entries generated yet. Advance from Initial Framing to build Canon.</div>');
    }

    // Stage-specific cards visibility based on mode & currentAdventureStep
    if (currentNavMode === 'living-world') {
        $('#mhc_new_adventure_stepper').hide();
        $('#mhc_tab_progression_btn').show();
        $('.mhc-chat-column').show();
        $('#mhc_adventure_ruleset_gate_hint').hide();

        $('#mhc_card_initial_framing').hide();
        $('#mhc_card_initial_sources').hide();
        $('#mhc_card_canon_entries').show();
        $('#mhc_deck_world_rules_card').show();
        $('.mhc-card-system').show();
        $('.mhc-card-dials').show();
        $('.mhc-card-char').show();
        $('.mhc-card-npcs').show();
        $('.mhc-card-monsters').show();
        $('.mhc-card-maps').show();
        $('.mhc-card-factions').show();
        $('.mhc-card-kick').show();
    } else {
        $('#mhc_new_adventure_stepper').show();
        $('#mhc_tab_cards .mhc-card').hide();

        if (currentAdventureStep === 'initial') {
            $('#mhc_card_initial_framing').show();
            $('#mhc_card_initial_sources').show();
            $('#mhc_tab_progression_btn').hide();
            $('.mhc-chat-column').show();
            renderAttachmentTray();
        } else if (currentAdventureStep === 'canon') {
            $('#mhc_deck_world_rules_card').show();
            $('#mhc_card_canon_entries').show();
            $('#mhc_tab_progression_btn').hide();
            $('.mhc-chat-column').show();
        } else if (currentAdventureStep === 'adventure') {
            $('.mhc-card-system').show();
            $('.mhc-card-dials').show();
            $('#mhc_tab_progression_btn').hide();

            const rulesetConfirmed = Boolean(activeDossier.meta?.rulesetConfirmed);
            if (rulesetConfirmed) {
                $('.mhc-card-kick').show();
                $('.mhc-card-maps').show();
                $('.mhc-card-monsters').show();
                $('.mhc-card-npcs').show();
                $('.mhc-card-factions').show();
                $('#mhc_adventure_ruleset_gate_hint').hide();
                $('.mhc-chat-column').show();
            } else {
                $('#mhc_adventure_ruleset_gate_hint').show();
                $('#mhc_dial_harm_btn').hide();
                $('#mhc_dial_downed_btn').hide();
                $('#mhc_dial_heroic_btn').hide();
                $('#mhc_dial_tempo_btn').hide();
            }
        } else if (currentAdventureStep === 'character') {
            $('.mhc-card-char').show();
            if (worldRules.customModule && (worldRules.customModule.tag || worldRules.customModule.label)) {
                $('#mhc_deck_custom_module_card').show();
            }
            $('#mhc_tab_progression_btn').show();
            $('.mhc-chat-column').show();
        }
    }

    // Footer button visibility per track
    if (currentNavMode === 'living-world') {
        $('#mhc_save_draft_btn').hide();
        $('#mhc_reset_session_btn').hide();
        $('#mhc_launch_campaign_btn').hide();
        $('#mhc_fork_campaign_btn').show();
        $('#mhc_sync_active_campaign_btn').show();
    } else {
        $('#mhc_save_draft_btn').show();
        $('#mhc_reset_session_btn').show();
        $('#mhc_launch_campaign_btn').show();
        $('#mhc_fork_campaign_btn').hide();
        $('#mhc_sync_active_campaign_btn').hide();
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
        html += `<img class="mhc-thumb-preview" src="${escapeHtml(imageSrc)}" alt="Attached Image">`;
    }

    if (text) {
        const formatted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(?!\s)([^*\n]+?)\*/g, '<i>$1</i>')
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
    return bubble;
}

/**
 * Synchronize the Import & Commit Box visibility and state with active imports and staged canon entries.
 */
export function syncImportCommitBoxUI() {
    const hasImporting = activeImports.length > 0 && isImportCommitPending;
    const canonEntries = getCurrentMode() === 'archivist' ? getStagedCanonEntries() : [];
    const needsCommit = isImportCommitPending && (hasImporting || (canonEntries.length > 0 && shouldBrief()));
    if (needsCommit) {
        $('.mhc-chat-input-row').hide();
        $('#mhc_import_commit_box').show();
        if (hasImporting) {
            $('#mhc_import_commit_icon').html('<span class="mhc-spin">⏳</span>');
            $('#mhc_import_commit_status_text').text(importStatusText || `Importing ${activeImports.join(', ')}...`);
            $('#mhc_import_commit_btn').prop('disabled', true).text('⏳ Importing Lore...');
            $('#mhc_import_cancel_btn').show();
            $('#mhc_import_use_vibe_btn').hide();
        } else {
            $('#mhc_import_commit_icon').text('🗃️');
            $('#mhc_import_commit_status_text').text(`Ready: ${canonEntries.length} canon entries catalogued (~${getStagedTokenTotal()} tok). Add more files or click Commit for your setting overview.`);
            $('#mhc_import_commit_btn').prop('disabled', false).text(`✅ Commit & Review Lore (${canonEntries.length} entries)`);
            $('#mhc_import_cancel_btn').hide();
            $('#mhc_import_use_vibe_btn').show();
        }
    } else {
        isImportCommitPending = false;
        $('#mhc_import_commit_box').hide();
        $('.mhc-chat-input-row').show();
    }
}

/**
 * Stage a source for Archivist-mode Canon ingest (labels it when total size warrants).
 * Throws and rolls back on failure so failed sources are never attached.
 */
async function stageSourceForCanon(source, label) {
    const sourceTokens = Array.isArray(source.entries)
        ? source.entries.reduce((a, e) => a + estimateTokens(e.content), 0)
        : estimateTokens(source.text);
    const willBeArchivist = decideMode(getStagedTokenTotal() + sourceTokens, getModeOverride()) === 'archivist';
    if (willBeArchivist) {
        isImportCommitPending = true;
        importStatusText = `Cataloguing "${label}" into Canon...`;
    }
    if (!importAbortController) {
        importAbortController = new AbortController();
    }
    startImportProgress(`Canon: ${label}`);
    const timeoutMs = Math.max(30000, (Number(getConciergeConnectionSettings()?.timeoutSec) || 300) * 1000);
    try {
        const res = await stageCanonSource(source, {
            send: (messages, signal) => sendConciergeRequest(messages, signal),
            onStatus: msg => {
                importStatusText = `${label}: ${msg}`;
                syncImportCommitBoxUI();
                toastr?.info(msg);
            },
            signal: importAbortController.signal,
            timeoutMs,
        });
        if (res.mode === 'archivist') {
            toastr?.success(`Archivist mode: ${res.entries.length} canon entries catalogued.`);
        }
        return res;
    } catch (err) {
        unstageCanonSource(source.name);
        if (getStagedCanonEntries().length === 0) isImportCommitPending = false;
        if (importAbortController?.signal?.aborted) {
            toastr?.info(`Import cancelled for "${label}".`);
        } else {
            toastr?.error(`Canon cataloguing failed for "${label}": ${err.message}`);
        }
        throw err;
    } finally {
        importStatusText = '';
        stopImportProgress(`Canon: ${label}`);
    }
}

async function attachLoreSource(name, loreRes) {
    if (currentNavMode === 'new-adventure' && currentAdventureStep === 'initial') {
        stageRawCanonSource({ name, type: 'lore', entries: loreRes.entries });
        if (!attachedSources.some(s => s.name === name)) {
            attachedSources.push({
                id: `lore_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name,
                type: 'lore',
                tokens: Array.isArray(loreRes.entries) ? loreRes.entries.reduce((a, e) => a + estimateTokens(e.content), 0) : 0,
                entries: loreRes.entries,
            });
        }
        evaluateStepUnlocks();
        updateBlueprintDeck();
        toastr?.success(`Attached lorebook "${name}" for Initial Intake.`);
        return;
    }
    await stageSourceForCanon({ name, type: 'lore', entries: loreRes.entries }, name);
    pendingAttachments.push({
        type: 'lore',
        name,
        promptAddition: loreRes.block,
        mode: loreRes.mode,
        entries: loreRes.entries,
    });
}

async function stageDocForCanon(name, text) {
    if (currentNavMode === 'new-adventure' && currentAdventureStep === 'initial') {
        stageRawCanonSource({ name, type: 'doc', text });
        if (!attachedSources.some(s => s.name === name)) {
            attachedSources.push({
                id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name,
                type: 'doc',
                tokens: estimateTokens(text),
                text,
            });
        }
        evaluateStepUnlocks();
        updateBlueprintDeck();
        toastr?.success(`Attached document "${name}" for Initial Intake.`);
        return;
    }
    const res = await stageSourceForCanon({ name, type: 'doc', text }, name);
    const words = String(text || '').split(/\s+/).length;
    if (res?.mode === 'vibe' && words > 5000) {
        toastr?.warning(`"${name}" is ${words} words; Quick vibe mode only sends the first 5,000 words. Switch to Big lore mode to catalogue the full text.`);
    }
}

/**
 * Attaches a SillyTavern character card to the Session Zero session.
 * Stages the card into Canon sources (for Step 1 outline & Step 2 Canon build),
 * records it in attachedSources, queues it in pendingAttachments, and refreshes the deck.
 *
 * @param {object} card Normalized character card object
 * @param {File|null} [file=null] Optional uploaded File object
 */
export function attachCharacterCardToSession(card, file = null) {
    if (!card?.name) return;
    const promptAddition = formatCharacterInspirationBlock(card);
    const sourceName = `${card.name} (Character Card)`;

    // Stage raw source for Canon / Step 1 framing outline
    stageRawCanonSource({
        name: sourceName,
        type: 'char',
        rawText: promptAddition,
        text: promptAddition,
        card,
        entries: null,
    });

    // Update attachedSources
    const tokens = estimateTokens(promptAddition);
    const existingIdx = attachedSources.findIndex(s => s.name === sourceName || s.name === card.name);
    const sourceRecord = { name: sourceName, type: 'char', tokens, cardName: card.name };
    if (existingIdx >= 0) attachedSources[existingIdx] = sourceRecord;
    else attachedSources.push(sourceRecord);

    // Push/update pendingAttachments so next chat turn receives promptAddition
    pendingAttachments = pendingAttachments.filter(a => !(a.type === 'char' && a.name === card.name));
    pendingAttachments.push({
        type: 'char',
        file,
        name: card.name,
        sourceName,
        card,
        promptAddition,
        avatar: null,
    });

    renderAttachmentTray();
    evaluateStepUnlocks();
    updateBlueprintDeck();
    saveDraft();
}

/**
 * Render the attachment tray chips.
 */
function renderAttachmentTray() {
    const tray = $('#mhc_attachment_tray');
    tray.empty();

    if (!pendingAttachments.length && !activeImports.length) {
        tray.hide();
        syncImportCommitBoxUI();
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

    // 1b. Mode chip: Auto / Quick vibe / Big lore
    if (pendingAttachments.some(a => a.type === 'lore' || a.type === 'doc')) {
        const mode = getCurrentMode();
        const ov = getModeOverride();
        const modeChip = $(`
            <div class="mhc-chip" title="Quick vibe: scaffold immediately. Big lore: catalogue everything into a Canon lorebook.">
                <span>${mode === 'archivist' ? '🗃️ Big lore' : '✨ Quick vibe'} (~${getStagedTokenTotal()} tok)</span>
                <select class="mhc-mode-override" style="margin-left:6px;">
                    <option value="auto" ${ov === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="vibe" ${ov === 'vibe' ? 'selected' : ''}>Quick vibe</option>
                    <option value="archivist" ${ov === 'archivist' ? 'selected' : ''}>Big lore</option>
                </select>
            </div>
        `);
        tray.append(modeChip);

        if (mode === 'vibe') {
            const upgradeBtn = $(`
                <button type="button" class="menu_button mhc-bar-btn mhc-upgrade-archivist-btn" title="Catalogue attached documents/lorebooks into a vectorized Campaign Canon Lorebook">
                    🗃️ Build Canon Lorebook
                </button>
            `);
            tray.append(upgradeBtn);
        }
    }

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

    $('.mhc-upgrade-archivist-btn').on('click', async function () {
        setModeOverride('archivist');
        isImportCommitPending = true;
        syncImportCommitBoxUI();
        try {
            for (const att of pendingAttachments) {
                if (att.type === 'lore') await stageSourceForCanon({ name: att.name, type: 'lore', entries: att.entries || [] }, att.name);
                if (att.type === 'doc') await stageSourceForCanon({ name: att.name, type: 'doc', text: att.text }, att.name);
            }
        } catch (_) {}
        finally {
            renderAttachmentTray();
        }
    });

    $('.mhc-mode-override').on('change', async function () {
        const newMode = $(this).val();
        setModeOverride(newMode);
        if (newMode === 'archivist') {
            isImportCommitPending = true;
            syncImportCommitBoxUI();
        }
        // Re-stage so an override to Big lore labels already-attached sources now.
        try {
            for (const att of pendingAttachments) {
                if (att.type === 'lore') await stageSourceForCanon({ name: att.name, type: 'lore', entries: att.entries || [] }, att.name);
                if (att.type === 'doc') await stageSourceForCanon({ name: att.name, type: 'doc', text: att.text }, att.name);
            }
        } catch (_) {}
        finally {
            renderAttachmentTray();
        }
    });

    $('.mhc-chip-remove').on('click', function () {
        const idx = parseInt($(this).attr('data-index'), 10);
        const removed = pendingAttachments.splice(idx, 1)[0];
        if (removed) {
            const targetName = removed.sourceName || removed.name;
            if (targetName) {
                unstageCanonSource(targetName);
                attachedSources = attachedSources.filter(s => s.name !== targetName && s.name !== removed.name && s.cardName !== removed.name);
            }
            if (removed.type === 'lore' || removed.type === 'doc') {
                unstageCanonSource(removed.name);
            }
            evaluateStepUnlocks();
            updateBlueprintDeck();
            saveDraft();
        }
        renderAttachmentTray();
    });

    syncImportCommitBoxUI();
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
        profileSelect.append(`<option value="${escapeHtml(String(p.id))}">${escapeHtml(String(p.name || p.id))}</option>`);
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
            charSelect.append(`<option value="${idx}">${escapeHtml(String(c.name))}</option>`);
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
        loreSelect.append(`<option value="${escapeHtml(String(b))}">${escapeHtml(String(b))}</option>`);
    });
}

/**
 * Clip a failed Builder reply before echoing it back for a retry. A looping/garbage reply is
 * replaced entirely so the model is never conditioned on its own degenerate output.
 */
function clipRetryEcho(raw) {
    const text = String(raw || '');
    if (detectRepetition(text)) return '[previous reply discarded: repetitive output]';
    return text.length > MAX_RETRY_ECHO_CHARS ? `${text.slice(0, MAX_RETRY_ECHO_CHARS)}\n[…truncated]` : text;
}

/** True when a generation failed because it was stopped by the user, looped, or timed out. */
function classifyTurnAbort(err) {
    if (err?.name === 'AbortError') return 'user';
    if (err instanceof ConciergeLoopError || err?.name === 'ConciergeLoopError') return 'loop';
    if (err instanceof ConciergeTimeoutError || err?.name === 'ConciergeTimeoutError') return 'timeout';
    return null;
}

/**
 * Render "where to start" quick-reply chips under the latest assistant bubble.
 * Clicking a chip fills the input and sends it.
 */
function renderStartChips(starts) {
    $('.mhc-start-chips').remove();
    if (!starts?.length) return;
    const wrap = $('<div class="mhc-start-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;"></div>');
    for (const label of starts) {
        const chip = $('<button type="button" class="mhc-chip mhc-start-chip" style="cursor:pointer;"></button>').text(`▶ ${label}`);
        chip.on('click', () => {
            $('.mhc-start-chips').remove();
            $('#mhc_chat_input').val(`Let's start with: ${label}`);
            handleUserSend();
        });
        wrap.append(chip);
    }
    $('#mhc_chat_messages').append(wrap);
    const box = document.getElementById('mhc_chat_messages');
    if (box) box.scrollTop = box.scrollHeight;
}

/**
 * Offer one-click "pull in from Canon" chips for entries the Concierge asked to promote.
 */
function renderPromoteChips(found) {
    $('.mhc-start-chips').remove();
    const wrap = $('<div class="mhc-start-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;"></div>');
    const chip = $('<button type="button" class="mhc-chip mhc-start-chip" style="cursor:pointer;"></button>')
        .text(`📥 Pull in from Canon: ${found.map(e => e.name).join(', ')}`);
    chip.on('click', () => {
        $('.mhc-start-chips').remove();
        $('#mhc_chat_input').val(`Build out ${found.map(e => e.name).join(' and ')} from the canon.`);
        handleUserSend();
    });
    wrap.append(chip);
    $('#mhc_chat_messages').append(wrap);
    const box = document.getElementById('mhc_chat_messages');
    if (box) box.scrollTop = box.scrollHeight;
}

/**
 * Commit imported world lore into Canon and generate the Archivist setting overview & suggested starts.
 */
export async function handleCommitImportedLore() {
    if (isGenerating || activeImports.length > 0) return;
    const canonEntries = getStagedCanonEntries();
    if (!canonEntries.length) {
        isImportCommitPending = false;
        syncImportCommitBoxUI();
        return;
    }

    const inventoryBlock = buildInventoryBlock(canonEntries);
    const userBubbleEl = appendChatBubble('user', `🗃️ Committed imported world lore (${canonEntries.length} canon entries)`);
    const commitPromptText = `Please review the committed world lore and provide a setting overview / vibe check along with suggested starting points.\n${inventoryBlock}`;
    chatHistory.push({
        role: 'user',
        content: `🗃️ Committed imported world lore (${canonEntries.length} canon entries)`,
        displayContent: `🗃️ Committed imported world lore (${canonEntries.length} canon entries)`,
        llmContent: commitPromptText,
    });

    const stream = document.getElementById('mhc_chat_messages');
    const typingBubble = document.createElement('div');
    typingBubble.className = 'mhc-bubble mhc-bubble-assistant';
    typingBubble.id = 'mhc_typing_indicator';
    typingBubble.innerHTML = '<i class="mhc-stage">🗃️ The Archivist is reviewing the catalogued lore...</i><div class="mhc-stream-preview" style="margin-top:6px;font-size:0.78em;opacity:0.65;white-space:pre-wrap;word-break:break-word;"></div>';
    if (stream) {
        stream.appendChild(typingBubble);
        stream.scrollTop = stream.scrollHeight;
    }

    const turn = { controller: new AbortController(), cancelled: false };
    activeTurn = turn;
    isGenerating = true;
    $('#mhc_import_commit_btn').prop('disabled', true).text('⏳ Generating Overview...');
    $('#mhc_import_add_more_btn').hide();
    $('#mhc_import_use_vibe_btn').hide();
    $('#mhc_import_cancel_btn').text('⏹ Stop Overview').show();
    $('#mhc_stop_btn').show();

    let lastPreviewAt = 0;
    const llm = (messages) => sendConciergeRequest(messages, turn.controller.signal, {
        onProgress: ({ content, thinking, chars, thinkingChars }) => {
            const now = Date.now();
            if (now - lastPreviewAt < 150) return;
            lastPreviewAt = now;
            const prev = typingBubble.querySelector('.mhc-stream-preview');
            if (!prev) return;
            const tail = (content || thinking || '').slice(-220).replace(/\s+/g, ' ');
            const looping = detectRepetition(content || thinking || '');
            prev.textContent = `${looping ? '⚠️ repeating… ' : ''}${chars} chars${thinkingChars ? ` + ${thinkingChars} thinking` : ''} — …${tail}`;
            const box = document.getElementById('mhc_chat_messages');
            if (box) box.scrollTop = box.scrollHeight;
        },
    });

    try {
        const reply = await llm([
            { role: 'system', name: 'System', content: buildArchivistBriefingPrompt() },
            { role: 'user', name: 'Player', content: commitPromptText },
        ]);
        if (turn.cancelled || turn.controller.signal.aborted) return;
        const cleanedReply = stripThinkingContent(reply || '').trim();
        const { text: briefingText, starts } = parseSuggestedStarts(cleanedReply);
        if (!briefingText) {
            throw new Error('Archivist briefing failed: the LLM returned an empty response.');
        }
        typingBubble.remove();
        appendChatBubble('assistant', briefingText);
        renderStartChips(starts);
        chatHistory.push({ role: 'assistant', content: briefingText });
        markBriefed();
        pendingAttachments = pendingAttachments.filter(a => a.type !== 'doc' && a.type !== 'lore');
        isImportCommitPending = false;
        renderAttachmentTray();
        if (!isVectorsWorldInfoEnabled(extension_settings)) {
            toastr?.info('Tip: enable SillyTavern → Vector Storage → "Enable for World Info" so Canon entries also match by meaning, not just keywords.');
        }
        saveDraft();
    } catch (err) {
        typingBubble?.remove();
        userBubbleEl?.remove();
        if (chatHistory.length && chatHistory[chatHistory.length - 1]?.content?.startsWith('🗃️ Committed imported world lore')) {
            chatHistory.pop();
        }
        isImportCommitPending = true;
        syncImportCommitBoxUI();
        if (turn.controller.signal.aborted) {
            toastr?.info('Archivist overview cancelled.');
        } else {
            toastr?.error(`Overview generation failed: ${err.message}`);
        }
    } finally {
        isGenerating = false;
        activeTurn = null;
        $('#mhc_stop_btn').hide();
        $('#mhc_import_cancel_btn').text('⏹ Cancel Import');
        $('#mhc_import_add_more_btn').show();
    }
}

/**
 * Process a user submission.
 */
async function handleUserSend() {
    if (isGenerating) return;

    const input = $('#mhc_chat_input');
    const text = input.val().trim();
    if (!text && !pendingAttachments.length) return;

    // Rollback snapshot: a failed/stopped turn restores everything to exactly this state.
    const rollback = {
        dossier: JSON.parse(JSON.stringify(activeDossier)),
        historyLength: chatHistory.length,
        changelogLength: changelog.length,
        text,
        attachments: [...pendingAttachments],
    };

    input.val('');
    const attachmentsToProcess = [...pendingAttachments];
    pendingAttachments = [];
    renderAttachmentTray();

    // 1. Process attachments into prompt additions
    let imageSrcForDisplay = null;
    let imagePayload = null;
    let documentPromptAdditions = '';

    // Big lore: the model sees a compact Canon inventory instead of raw lore/doc blocks.
    const canonEntries = getCurrentMode() === 'archivist' ? getStagedCanonEntries() : [];
    const useCanonInventory = canonEntries.length > 0;
    const briefingTurn = shouldBrief();
    if (useCanonInventory && attachmentsToProcess.some(a => a.type === 'lore' || a.type === 'doc')) {
        documentPromptAdditions += buildInventoryBlock(canonEntries);
    }

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
            if (useCanonInventory) continue;
            documentPromptAdditions += formatDocumentPromptBlock(att.name, att.text, 5000, activeDossier?.protagonist?.name || '');
        } else if (att.type === 'char') {
            documentPromptAdditions += `\n${att.promptAddition}\n`;
        } else if (att.type === 'chat') {
            documentPromptAdditions += formatChatTranscriptPromptBlock(att.chatData, att.name, 40, activeDossier?.protagonist?.name || '');
        } else if (att.type === 'lore') {
            if (useCanonInventory) continue;
            documentPromptAdditions += `\n${att.promptAddition}\n`;
        }
    }

    // Big lore (post-briefing): add the full canon for what the player is asking about, plus
    // any entries the Concierge asked to promote last turn. Already-shown entries aren't repeated.
    if (useCanonInventory && !briefingTurn) {
        const forced = resolvePromoteRequests(pendingPromotions, canonEntries).found;
        pendingPromotions = [];
        const slice = [
            ...forced,
            ...retrieveCanonSlice(canonEntries, text, { exclude: getPromotedSet() }),
        ].filter((e, i, a) => a.indexOf(e) === i);
        if (slice.length) {
            documentPromptAdditions += buildFocusBlock(slice);
            markSlicePromoted(slice);
        }
    }

    const rawUserText = (text + (documentPromptAdditions ? `\n${documentPromptAdditions}` : '')).trim();
    const fullUserText = resolveCardMacros(rawUserText, activeDossier?.protagonist?.name || '');

    // Display user bubble
    const displayUserText = text || '(Provided inspiration details)';
    const userBubbleEl = appendChatBubble('user', displayUserText, imageSrcForDisplay);

    // Format LLM message payload
    let userMsgLlmContent;
    if (imagePayload) {
        const rulesetLabel = activeDossier?.meta?.ruleset === 'fae' ? 'FAE' : 'PbtA';
        userMsgLlmContent = [
            { type: 'text', text: fullUserText || `Please analyze this inspiration image for our ${rulesetLabel} campaign.` },
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
    typingBubble.innerHTML = '<i class="mhc-stage">🎩 The Concierge is contemplating the fiction...</i><div class="mhc-stream-preview" style="margin-top:6px;font-size:0.78em;opacity:0.65;white-space:pre-wrap;word-break:break-word;"></div>';
    stream.appendChild(typingBubble);
    stream.scrollTop = stream.scrollHeight;

    const turn = { controller: new AbortController(), cancelled: false };
    activeTurn = turn;
    isGenerating = true;
    $('#mhc_send_btn').prop('disabled', true);
    $('#mhc_stop_btn').show();

    const setStage = (html) => {
        const el = typingBubble.querySelector('.mhc-stage');
        if (el) el.innerHTML = html;
        const prev = typingBubble.querySelector('.mhc-stream-preview');
        if (prev) prev.textContent = '';
    };
    // Live stream preview (direct Ollama/OpenAI endpoints): char counter + tail of output so loops are visible.
    let lastPreviewAt = 0;
    const llm = (messages) => sendConciergeRequest(messages, turn.controller.signal, {
        onProgress: ({ content, thinking, chars, thinkingChars }) => {
            const now = Date.now();
            if (now - lastPreviewAt < 150) return;
            lastPreviewAt = now;
            const prev = typingBubble.querySelector('.mhc-stream-preview');
            if (!prev) return;
            const tail = (content || thinking || '').slice(-220).replace(/\s+/g, ' ');
            const looping = detectRepetition(content || thinking || '');
            prev.textContent = `${looping ? '⚠️ repeating… ' : ''}${chars} chars${thinkingChars ? ` + ${thinkingChars} thinking` : ''} — …${tail}`;
            const box = document.getElementById('mhc_chat_messages');
            if (box) box.scrollTop = box.scrollHeight;
        },
    });
    const recentHistory = () => chatHistory.slice(-MAX_PASS_HISTORY);

    try {
        // ── Archivist briefing turn: summarize the catalogued lore and ask where to start ──
        if (briefingTurn) {
            const typingStage = typingBubble.querySelector('.mhc-stage');
            if (typingStage) typingStage.innerHTML = '<i>🗃️ The Archivist is reviewing the catalogued lore...</i>';
            const reply = await llm([
                { role: 'system', name: 'System', content: buildArchivistBriefingPrompt() },
                { role: 'user', name: 'Player', content: userMsgLlmContent },
            ]);
            if (turn.cancelled) return;
            const cleanedReply = stripThinkingContent(reply || '').trim();
            const { text: briefingText, starts } = parseSuggestedStarts(cleanedReply);
            if (!briefingText) {
                throw new Error('Archivist briefing failed: the LLM returned an empty response.');
            }
            typingBubble.remove();
            appendChatBubble('assistant', briefingText);
            renderStartChips(starts);
            chatHistory.push({ role: 'assistant', content: briefingText });
            markBriefed();
            if (!isVectorsWorldInfoEnabled(extension_settings)) {
                toastr?.info('Tip: enable SillyTavern → Vector Storage → "Enable for World Info" so Canon entries also match by meaning, not just keywords.');
            }
            saveDraft();
            return;
        }

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
                const activeAdapter = systemRegistry.get(systemRegistry.detectRuleset(activeDossier));
                return {
                    role: 'assistant',
                    name: activeAdapter.getAssistantName(),
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
            setStage('<i>🎩 The Concierge is contemplating &amp; scaffolding the blueprint...</i>');
        }

        let builderPromptContent = '';
        if (currentNavMode === 'new-adventure') {
            const stagedCanon = getStagedCanonEntries();
            if (currentAdventureStep === 'initial') {
                builderPromptContent = buildStage1InitialBuilderPrompt(activeDossier, extractSourcesStructuralOutline());
            } else if (currentAdventureStep === 'canon') {
                builderPromptContent = buildStage2CanonBuilderPrompt(activeDossier, stagedCanon);
            } else if (currentAdventureStep === 'adventure') {
                builderPromptContent = buildStage3AdventureBuilderPrompt(activeDossier, stagedCanon);
            } else if (currentAdventureStep === 'character') {
                builderPromptContent = buildStage4CharacterBuilderPrompt(activeDossier, stagedCanon);
            }
        } else {
            builderPromptContent = buildConciergeBuilderContext(activeDossier, changelog, activeNameRagSeeds);
        }

        const builderMessages = [
            {
                role: 'system',
                name: 'System',
                content: builderPromptContent,
            },
            ...recentHistory().map(formatHistoryMessage),
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
            builderRawResponse = await llm(currentBuilderMessages);
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
                if (currentNavMode === 'new-adventure' && currentAdventureStep === 'canon' && builderReport.canonMutations?.length > 0) {
                    for (const m of builderReport.canonMutations) {
                        if (m.action === 'upsert' && m.entry) upsertCanonEntry(m.entry);
                        else if (m.action === 'disable') toggleCanonEntryDisabled(m.target, true);
                        else if (m.action === 'enable') toggleCanonEntryDisabled(m.target, false);
                        else if (m.action === 'remove') removeCanonEntry(m.target);
                    }
                    builderReport.hasMutations = true;
                }
                break;
            }

            // If syntax errors occurred and attempts remain, retry with error feedback
            if (builderAttempts < maxBuilderAttempts && builderReport.errors.length > 0) {
                if (typingEl) {
                    setStage('<i>🎩 The Concierge is recalibrating the blueprint...</i>');
                }
                currentBuilderMessages = [
                    ...builderMessages,
                    { role: 'assistant', name: 'Concierge_Builder', content: clipRetryEcho(builderRawResponse) },
                    {
                        role: 'system',
                        name: 'System',
                        content: `[PARSER_ERROR: Blueprint update contained errors: ${builderReport.errors.join('; ')}. Please correct these syntax errors and re-emit the [UPDATE_DOSSIER] block.]`,
                    },
                ];
            } else if (builderAttempts < maxBuilderAttempts && !builderReport.hasMutations && !builderReport.isNoop) {
                if (typingEl) {
                    setStage('<i>🎩 The Concierge is recalibrating the blueprint...</i>');
                }
                currentBuilderMessages = [
                    ...builderMessages,
                    { role: 'assistant', name: 'Concierge_Builder', content: clipRetryEcho(builderRawResponse) },
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
            const isLightweightStage = currentNavMode === 'new-adventure' && (currentAdventureStep === 'initial' || currentAdventureStep === 'canon');
            const shouldJudge = !isLightweightStage && shouldRunContemplativeJudgePass({
                prevDossier: preTurnDossier,
                updatedDossier: activeDossier,
                builderReport,
                hasAttachments: attachmentsToProcess.length > 0,
            });

            if (shouldJudge) {
                try {
                    if (typingEl) {
                        setStage('<i>⚖️ The Concierge is grading blueprint depth &amp; entanglement...</i>');
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
                            content: systemRegistry.get(systemRegistry.detectRuleset(activeDossier)).getCritiqueUserInstruction(),
                        },
                    ];

                    const criticRawResponse = await llm(criticMessages);
                    critiqueResult = parseDossierCritique(criticRawResponse);

                    if (critiqueResult.shouldRevise) {
                        if (typingEl) {
                            setStage(`<i>🔨 The Concierge is executing a second architectural pass (${critiqueResult.grade} · ${critiqueResult.score}/100)...</i>`);
                        }
                        const refinerMessages = [
                            {
                                role: 'system',
                                name: 'System',
                                content: buildConciergeRefinerContext(activeDossier, changelog, critiqueResult, activeNameRagSeeds),
                            },
                            ...recentHistory().map(formatHistoryMessage),
                            {
                                role: 'user',
                                name: 'System',
                                content: `Execute the Blueprint Judge's refinement directives now (${critiqueResult.directives.join('; ')}). Emit only the delta [UPDATE_DOSSIER] block.`,
                            },
                        ];

                        let refinerRawResponse = await llm(refinerMessages);
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
                    throw judgeErr;
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
            setStage('<i>🎩 The Concierge is contemplating the fiction...</i>');
        }

        const talkerInstruction = buildTalkerInstructionNotice(finalStatus, builderSummaryText, builderReport?.errors);

        let talkerPromptContent = '';
        if (currentNavMode === 'new-adventure') {
            const stagedCanon = getStagedCanonEntries();
            if (currentAdventureStep === 'initial') {
                talkerPromptContent = buildStage1InitialTalkerPrompt(activeDossier, extractSourcesStructuralOutline());
            } else if (currentAdventureStep === 'canon') {
                talkerPromptContent = buildStage2CanonTalkerPrompt(activeDossier, stagedCanon);
            } else if (currentAdventureStep === 'adventure') {
                talkerPromptContent = buildStage3AdventureTalkerPrompt(activeDossier, stagedCanon);
            } else if (currentAdventureStep === 'character') {
                talkerPromptContent = buildStage4CharacterTalkerPrompt(activeDossier, stagedCanon);
            }
        } else {
            talkerPromptContent = buildConciergeTalkerContext(activeDossier, changelog, activeNameRagSeeds);
        }

        const talkerMessages = [
            {
                role: 'system',
                name: 'System',
                content: talkerPromptContent,
            },
            ...recentHistory().map(formatHistoryMessage),
            {
                role: 'system',
                name: 'System',
                content: talkerInstruction,
            },
        ];

        const talkerResponse = await llm(talkerMessages);
        const finalChatBubbleText = (stripConciergeStateBlocks(talkerResponse) || talkerResponse || '').trim();
        if (!finalChatBubbleText) {
            throw new Error('The Concierge Talker returned an empty response.');
        }

        if (turn.cancelled) return;
        typingBubble.remove();

        // Big lore: the Concierge may request canon entries it can't see in full yet.
        if (useCanonInventory) {
            const requested = parsePromoteRequests(`${builderRawResponse}\n${finalChatBubbleText}`);
            const { found } = resolvePromoteRequests(requested, getStagedCanonEntries());
            if (found.length) {
                pendingPromotions = found.map(e => e.name);
                renderPromoteChips(found);
            }
        }

        // Render clean bubble to the user (with debug trace button if failure occurred)
        appendChatBubble('assistant', finalChatBubbleText, null, Boolean(builderFailed));

        // Record clean conversation text and builder report in history
        chatHistory.push({
            role: 'assistant',
            content: finalChatBubbleText,
            builderReport: builderSummaryText,
        });
        stageChatHistories[currentAdventureStep] = [...chatHistory];
        evaluateStepUnlocks();
        updateBlueprintDeck();
        saveDraft();
    } catch (err) {
        // Reset already tore down this turn's UI/state; nothing to roll back.
        if (turn.cancelled) return;
        typingBubble.remove();

        // Roll the turn back completely so nothing dangles and the user can simply resend.
        activeDossier = rollback.dossier;
        chatHistory.length = Math.min(chatHistory.length, rollback.historyLength);
        changelog.length = Math.min(changelog.length, rollback.changelogLength);
        userBubbleEl?.remove();
        pendingAttachments = rollback.attachments;
        renderAttachmentTray();
        $('#mhc_chat_input').val(rollback.text);
        updateBlueprintDeck();
        saveDraft();

        const kind = classifyTurnAbort(err);
        if (kind === 'user') {
            globalThis.toastr?.info('Generation stopped. Your message was restored — edit it or press Send to retry.', 'PbtA Concierge');
        } else {
            console.error('[PbtA Concierge] Request failed:', err);
            const hint = kind === 'loop'
                ? 'The model got stuck repeating itself and was stopped. Your message was restored — press Send to retry (a lower temperature, repeat penalty, or a different model can help).'
                : kind === 'timeout'
                    ? `${err.message} Your message was restored — press Send to retry.`
                    : `${err.message || String(err)} Your message was restored — press Send to retry.`;
            appendChatBubble('assistant', `⚠️ **Concierge request stopped:** ${hint}`);
            globalThis.toastr?.warning(kind === 'loop' ? 'Local model loop detected — generation stopped.' : 'Concierge request failed.', 'PbtA Concierge');
        }
    } finally {
        if (activeTurn === turn) {
            activeTurn = null;
            isGenerating = false;
            $('#mhc_stop_btn').hide();
            $('#mhc_send_btn').prop('disabled', false);
        }
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
                    attachCharacterCardToSession(card, file);
                    toastr?.success(`Imported character: "${card.name}".`);

                    // If character card embeds a world book, import that too!
                    if (card.characterBook) {
                        startImportProgress(`${card.name}'s Worldbook`);
                        try {
                            const loreRes = await processLorebookForConcierge(
                                `${card.name}'s Lorebook`,
                                card.characterBook,
                                msg => {
                                    isImportCommitPending = true;
                                    importStatusText = msg;
                                    syncImportCommitBoxUI();
                                    toastr?.info(msg);
                                },
                                card.name,
                            );
                            await attachLoreSource(`${card.name}'s Lorebook`, loreRes);
                            toastr?.info(`Imported embedded worldbook for "${card.name}".`);
                        } catch (err) {
                            toastr?.error(`Embedded worldbook for "${card.name}" could not be imported: ${err.message}`);
                        }
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
                            msg => {
                                isImportCommitPending = true;
                                importStatusText = msg;
                                syncImportCommitBoxUI();
                                toastr?.info(msg);
                            },
                            activeDossier?.protagonist?.name || '',
                        );
                        await attachLoreSource(file.name.replace(/\.json$/i, ''), loreRes);
                        toastr?.success(`Imported lorebook: "${file.name}" (${loreRes.mode === 'synthesized' ? 'Synthesized' : 'Direct'}).`);
                        renderAttachmentTray();
                        continue;
                    }
                } catch (err) {
                    if (handledAsLore) {
                        toastr?.error(`Lorebook "${file.name}" could not be imported: ${err.message}`);
                    }
                }
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
                let doc;
                try {
                    doc = await extractDocumentContent(file);
                } catch (err) {
                    toastr?.error(`Could not parse document "${file.name}": ${err.message}`);
                    continue;
                }
                if (doc.type === 'chat') {
                    pendingAttachments.push({
                        type: 'chat',
                        file,
                        name: doc.chatData?.charName ? `${doc.chatData.charName} (Chat)` : doc.filename,
                        chatData: doc.chatData,
                    });
                    toastr?.success(`Imported prior chat log: "${doc.chatData?.charName || doc.filename}" (${doc.chatData?.messages?.length || 0} messages).`);
                } else {
                    toastr?.info(`Extracted text from "${doc.filename}".`);
                    try {
                        await stageDocForCanon(doc.filename, doc.text);
                        pendingAttachments.push({
                            type: 'doc',
                            file,
                            name: doc.filename,
                            text: doc.text,
                        });
                    } catch (_) {
                        /* stageSourceForCanon already toasted the error */
                    }
                }
            }
        } finally {
            stopImportProgress(file.name);
        }
    }
    renderAttachmentTray();
    evaluateStepUnlocks();
    updateBlueprintDeck();
    saveDraft();
}

/**
 * Determines whether a campaign dossier was genuinely created via Session Zero Concierge
 * (as opposed to an auto-scaffolded stub from the Level-Up/Character Desk).
 *
 * @param {object} dossier
 * @returns {boolean}
 */
export function isConciergeCreatedDossier(dossier) {
    if (!dossier || typeof dossier !== 'object') return false;
    if (dossier.meta?.isStub === true || dossier.meta?.autoScaffolded === true) return false;
    if (dossier.meta?.conciergeCreated === true) return true;
    if (isDossierEmptyOrUntouched(dossier)) return false;
    // For legacy Concierge dossiers created prior to the conciergeCreated flag:
    // Must have genuine Session Zero world/adventure structure (not just a protagonist + progressionBlueprint stub)
    const hasWorldOrAdventure = Boolean(
        (dossier.meta?.premise && dossier.meta.premise.trim()) ||
        (dossier.theKick?.startingLocation && dossier.theKick.startingLocation.trim()) ||
        (dossier.theKick?.incitingIncident && dossier.theKick.incitingIncident.trim()) ||
        (Array.isArray(dossier.npcs) && dossier.npcs.length > 0) ||
        (Array.isArray(dossier.maps) && dossier.maps.length > 0) ||
        (Array.isArray(dossier.monsters) && dossier.monsters.length > 0) ||
        (Array.isArray(dossier.factions) && dossier.factions.length > 0) ||
        (Array.isArray(dossier.worldRules?.axioms) && dossier.worldRules.axioms.length > 0) ||
        (dossier.world?.overview && dossier.world.overview.trim())
    );
    return hasWorldOrAdventure;
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
    if (activeCart?.dossier && isConciergeCreatedDossier(activeCart.dossier)) {
        return healAndNormalizeDossier(activeCart.dossier);
    }

    // 2. Check candidate chatStates partitions in memory
    for (const cid of candidateIds) {
        const part = rpgSettings?.chatStates?.[cid];
        if (part) {
            for (const key of ['pbtaCampaignDossier', 'faeCampaignDossier', 'campaignDossier', 'companionDossier']) {
                if (part[key] && isConciergeCreatedDossier(part[key])) {
                    return healAndNormalizeDossier(part[key]);
                }
            }
        }
    }

    const compSettings = (typeof extension_settings !== 'undefined' ? extension_settings?.multihog_companion : null)
        || globalThis.extension_settings?.multihog_companion;
    if (compSettings?.chatStates) {
        for (const cid of candidateIds) {
            const part = compSettings.chatStates[cid];
            if (part) {
                for (const key of ['pbtaCampaignDossier', 'faeCampaignDossier', 'campaignDossier', 'companionDossier']) {
                    if (part[key] && isConciergeCreatedDossier(part[key])) {
                        return healAndNormalizeDossier(part[key]);
                    }
                }
            }
        }
    }

    // 3. Fallback: Check World Info books
    const cleanId = currentChatId ? currentChatId.replace(/\.jsonl$/i, '').trim() : '';
    const bookCandidates = [
        ctx?.chatMetadata?.world_info,
        cleanId ? `Campaign_${cleanId}` : null,
        (!cleanId && !ctx?.chatMetadata?.world_info) ? 'Campaign_PbtA' : null,
    ].filter(Boolean);

    for (const book of bookCandidates) {
        try {
            const data = await fetchWorldInfoBook(book);
            if (!data?.entries) continue;
            for (const entry of Object.values(data.entries)) {
                if (entry?.comment?.includes('CAMPAIGN_DOSSIER') ||
                    entry?.comment?.includes('PbtA Concierge') ||
                    entry?.key?.includes('campaign_dossier') ||
                    entry?.content?.includes('CAMPAIGN DOSSIER')) {
                    const parsed = parseMarkdownToDossier(entry.content);
                    if (parsed && isConciergeCreatedDossier(parsed)) return parsed;
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
    if (!syncBtn.length) return false;

    // Strict Track Guard: Sync button only appears if in living-world mode OR if viewing the origin chat of a loaded campaign
    if (currentNavMode !== 'living-world' && !loadedCampaignOriginChatId) {
        console.log('EARLY EXIT: Not living-world and no loadedCampaignOriginChatId');
        syncBtn.hide();
        return false;
    }

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
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const currentChatId = targetChatId
            || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
            || ctx?.getCurrentChatId?.()
            || ctx?.chatId
            || ctx?.chatMetadata?.chat_id
            || '';

        if (activeRunning) {
            $('.mhc-mode-nav-btn[data-nav-mode="living-world"]').show();
            const rawTitle = (activeRunning.meta?.title || '').trim();
            const hasCustomTitle = rawTitle && !isDefaultUntitledCampaignTitle(rawTitle);
            const displayTitle = hasCustomTitle ? rawTitle : 'Active Game';
            $('#mhc_active_game_title').text(displayTitle);
            $('#mhc_active_game_label').show().attr('title', `Active Campaign: ${displayTitle}`);

            if (loadedCampaignOriginChatId && currentChatId) {
                const currentCandidates = getCandidateChatIds(currentChatId);
                const originCandidates = getCandidateChatIds(loadedCampaignOriginChatId);
                if (currentCandidates.some(id => originCandidates.includes(id))) {
                    currentNavMode = 'living-world';
                    const navBtns = $('.mhc-mode-nav-btn');
                    if (typeof navBtns.removeClass === 'function') navBtns.removeClass('active');
                    if (typeof navBtns.css === 'function') navBtns.css({ background: 'transparent', color: '#9ca3af' });
                    const lwBtn = $('.mhc-mode-nav-btn[data-nav-mode="living-world"]');
                    if (typeof lwBtn.addClass === 'function') lwBtn.addClass('active');
                    if (typeof lwBtn.css === 'function') lwBtn.css({ background: 'rgba(59, 130, 246, 0.35)', color: '#93c5fd' });
                    $('#mhc_new_adventure_stepper').hide();
                }
            }
        } else {
            $('.mhc-mode-nav-btn[data-nav-mode="living-world"]').hide();
            $('#mhc_active_game_label').hide();
            if (currentNavMode === 'living-world') {
                currentNavMode = 'new-adventure';
                const navBtns = $('.mhc-mode-nav-btn');
                if (typeof navBtns.removeClass === 'function') navBtns.removeClass('active');
                if (typeof navBtns.css === 'function') navBtns.css({ background: 'transparent', color: '#9ca3af' });
                const naBtn = $('.mhc-mode-nav-btn[data-nav-mode="new-adventure"]');
                if (typeof naBtn.addClass === 'function') naBtn.addClass('active');
                if (typeof naBtn.css === 'function') naBtn.css({ background: 'rgba(59, 130, 246, 0.35)', color: '#93c5fd' });
                $('#mhc_new_adventure_stepper').show();
            }
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
    if (chatId) {
        currentNavMode = 'living-world';
    } else {
        currentNavMode = 'new-adventure';
    }
    if (dossier) {
        activeDossier = dossier;
    }
    if (activeDossier) {
        activeDossier._originChatId = chatId;
        activeDossier._originCampaignTitle = title;
    }
}

/**
 * Switch active tab in the Concierge modal ('cards', 'raw', or 'debug').
 * Strictly scoped to #mhc_concierge_modal and guarantees elements are shown/unhidden.
 *
 * @param {string} [tabId='cards']
 */
export function setConciergeTab(tabId = 'cards') {
    const modal = typeof globalThis.$ === 'function' ? globalThis.$('#mhc_concierge_modal') : null;
    if (!modal || !modal.length) return;

    if (typeof modal.find === 'function') {
        const tabBtns = modal.find('.mhc-dossier-tabs .mhc-tab-btn');
        if (typeof tabBtns?.removeClass === 'function') tabBtns.removeClass('active');
        const activeBtn = modal.find(`.mhc-dossier-tabs .mhc-tab-btn[data-tab="${tabId}"]`);
        if (typeof activeBtn?.addClass === 'function') activeBtn.addClass('active');

        const tabPanels = modal.find('.mhc-dossier-column > .mhc-tab-content');
        if (typeof tabPanels?.removeClass === 'function') tabPanels.removeClass('active');
        if (typeof tabPanels?.hide === 'function') tabPanels.hide();

        const target = modal.find(`#mhc_tab_${tabId}`);
        if (typeof target?.addClass === 'function') target.addClass('active');
        if (typeof target?.show === 'function') target.show();
    }

    if (tabId === 'debug') {
        renderDebugInspectorView();
    } else if (tabId === 'progression') {
        renderProgressionTabView();
    } else if (tabId === 'raw') {
        $('#mhc_raw_markdown_text').val(serializeDossierToMarkdown(activeDossier));
    }
}

/**
 * Renders the polymorphic Progression Codex & Archetype Architect view inside the Progression tab.
 */
export function renderProgressionTabView() {
    const modal = typeof globalThis.$ === 'function' ? globalThis.$('#mhc_concierge_modal') : null;
    if (!modal || !modal.length) return;
    const container = modal.find('#mhc_progression_tab_mount');
    if (!container.length) return;

    renderProgressionArchitect(container, {
        dossier: activeDossier,
        ruleset: activeDossier?.meta?.ruleset,
        onUpdate: (updatedDossier) => {
            activeDossier = updatedDossier;
            saveDraft();
            updateBlueprintDeck();
        },
    });
}

/**
 * Transitions the Concierge between the Active Game Track ('living-world')
 * and the Session Zero Sandbox Track ('new-adventure').
 *
 * @param {'new-adventure'|'living-world'} targetMode
 * @returns {Promise<boolean>} Whether the track transition succeeded
 */
export async function switchToTrack(targetMode) {
    if (targetMode === 'living-world') {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const currentChatId = (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
            || ctx?.getCurrentChatId?.()
            || ctx?.chatId
            || '';
        if (!currentChatId) {
            toastr?.warning('No active chat selected.', 'Living World');
            return false;
        }
        const campaignDossier = await loadActiveCampaignDossier(currentChatId);
        if (!campaignDossier) {
            toastr?.warning('No active campaign dossier found for the current chat.', 'Living World');
            return false;
        }

        // Snapshot current session-zero state before switching to living-world
        if (currentNavMode === 'new-adventure') {
            snapshotCurrentToSessionZeroTrack();
            saveDraft();
        }

        currentNavMode = 'living-world';
        lastActiveConciergeMode = 'living-world';

        $('.mhc-mode-nav-btn').removeClass('active').css({ background: 'transparent', color: '#9ca3af' });
        $('.mhc-mode-nav-btn[data-nav-mode="living-world"]').addClass('active').css({ background: 'rgba(59, 130, 246, 0.35)', color: '#93c5fd' });

        // Hydrate livingWorldTrack
        livingWorldTrack.chatId = currentChatId;
        livingWorldTrack.dossier = healAndNormalizeDossier(campaignDossier);
        livingWorldTrack.dossier.meta = livingWorldTrack.dossier.meta || {};
        livingWorldTrack.dossier.meta.rulesetConfirmed = true;
        livingWorldTrack.campaignTitle = (livingWorldTrack.dossier.meta?.title || '').trim();
        livingWorldTrack.dossier._originChatId = currentChatId;
        livingWorldTrack.dossier._originCampaignTitle = livingWorldTrack.campaignTitle;

        loadedCampaignOriginChatId = currentChatId;
        loadedCampaignOriginTitle = livingWorldTrack.campaignTitle;
        activeDossier = livingWorldTrack.dossier;

        const stagedLivingCanon = livingWorldTrack.dossier.canonLorebookEntries || [];
        setStagedCanonEntries(stagedLivingCanon);

        if (!livingWorldTrack.chatHistory.length) {
            const isFae = activeDossier.meta?.ruleset === 'fae';
            const vitalityTerm = isFae ? 'resource pools' : 'Harm capacity';
            const greet = `📂 Loaded active campaign **"${livingWorldTrack.campaignTitle || 'Active Campaign'}"**! You can adjust campaign calibration dials, scale ${vitalityTerm}, manage supporting NPCs, or evolve the blueprint below. Changes can be synced directly back to your running game with **🔄 Sync to Active Game**, or cloned into a fresh adventure with **🍴 Fork as New Campaign**.`;
            livingWorldTrack.chatHistory = [{ role: 'assistant', content: greet }];
        }
        chatHistory = livingWorldTrack.chatHistory;
        renderChatHistoryFromState();

        $('#mhc_new_adventure_stepper').hide();
        $('.mhc-chat-column').show();
        $('#mhc_tab_progression_btn').show();
        $('#mhc_save_draft_btn').hide();
        $('#mhc_reset_session_btn').hide();
        $('#mhc_launch_campaign_btn').hide();
        $('#mhc_fork_campaign_btn').show();
        $('#mhc_sync_active_campaign_btn').show();

        updateBlueprintDeck();
        setConciergeTab('cards');
        await updateSyncButtonState(currentChatId);
        toastr?.info(`Loaded Living World Dossier for "${livingWorldTrack.campaignTitle || 'Active Campaign'}"`, 'Living World');
        return true;
    } else if (targetMode === 'new-adventure') {
        if (currentNavMode === 'living-world') {
            livingWorldTrack.dossier = activeDossier;
            livingWorldTrack.chatHistory = [...chatHistory];
        }

        currentNavMode = 'new-adventure';
        lastActiveConciergeMode = 'new-adventure';

        $('.mhc-mode-nav-btn').removeClass('active').css({ background: 'transparent', color: '#9ca3af' });
        $('.mhc-mode-nav-btn[data-nav-mode="new-adventure"]').addClass('active').css({ background: 'rgba(59, 130, 246, 0.35)', color: '#93c5fd' });

        restoreSessionZeroTrack();
        loadedCampaignOriginChatId = null;
        loadedCampaignOriginTitle = null;

        renderChatHistoryFromState();

        $('#mhc_new_adventure_stepper').show();
        $('#mhc_save_draft_btn').show();
        $('#mhc_reset_session_btn').show();
        $('#mhc_launch_campaign_btn').show();
        $('#mhc_fork_campaign_btn').hide();
        $('#mhc_sync_active_campaign_btn').hide();

        evaluateStepUnlocks();
        updateBlueprintDeck();
        setConciergeTab('cards');
        return true;
    }
    return false;
}

/**
 * Clones the active Living World campaign into the Session Zero track
 * so the player can branch off or forge an alternate adventure.
 */
export async function forkActiveCampaignToSessionZero() {
    const hasExistingSessionProgress = (Array.isArray(sessionZeroTrack.chatHistory) && sessionZeroTrack.chatHistory.length > 0)
        || !isDossierEmptyOrUntouched(sessionZeroTrack.dossier);

    if (hasExistingSessionProgress) {
        const title = sessionZeroTrack.dossier?.meta?.title || 'Untitled Session Zero';
        const ok = await showConciergeConfirm({
            icon: '🍴',
            title: 'Overwrite Session Zero Draft?',
            message: `An in-progress draft ("${title}") exists in Session Zero Concierge.\n\nForking "${livingWorldTrack.campaignTitle || 'Active Campaign'}" will overwrite this draft with a clone of the active world. Continue?`,
            confirmLabel: '🍴 Fork & Overwrite',
            confirmColor: '#2563eb',
        });
        if (!ok) return false;
    }

    resetConciergeState({ showGreeting: false });

    const sourceDossier = livingWorldTrack.dossier || activeDossier;
    if (!sourceDossier || isDossierEmptyOrUntouched(sourceDossier)) {
        toastr?.warning('No active campaign dossier available to fork.', 'Fork Campaign');
        return false;
    }

    const clone = JSON.parse(JSON.stringify(sourceDossier));
    delete clone._originChatId;
    delete clone._originCampaignTitle;
    if (clone.meta) {
        delete clone.meta.chatId;
        const baseTitle = (clone.meta.title || 'Campaign').trim();
        clone.meta.title = baseTitle.endsWith('(Fork)') ? baseTitle : `${baseTitle} (Fork)`;
        clone.meta.rulesetConfirmed = false;
    }

    sessionZeroTrack.dossier = clone;
    sessionZeroTrack.currentAdventureStep = 'initial';
    sessionZeroTrack.unlockedSteps = {
        initial: true,
        canon: true,
        adventure: true,
        character: true,
    };
    const stagedEntries = Array.isArray(clone.canonLorebookEntries) ? [...clone.canonLorebookEntries] : [];
    sessionZeroTrack.stagedCanonEntries = stagedEntries;
    sessionZeroTrack.attachedSources = [];
    sessionZeroTrack.lastSyncedSnapshots = { framing: null, canon: null, adventure: null };

    const greet = `🍴 **Forked from "${livingWorldTrack.campaignTitle || 'Active Campaign'}"!**\n\nThe series bible, axioms, and world elements have been cloned into Session Zero Concierge. You can refine the framing and premise in Step 1, review canon in Step 2, and confirm or tune your ruleset & dials in Step 3.`;
    sessionZeroTrack.chatHistory = [{ role: 'assistant', content: greet }];
    sessionZeroTrack.stageChatHistories = {
        initial: [...sessionZeroTrack.chatHistory],
        canon: [],
        adventure: [],
        character: [],
    };

    await switchToTrack('new-adventure');
    toastr?.success('Campaign cloned into Session Zero Concierge!', 'Forked as New Campaign');
    return true;
}

/**
 * Bind modal DOM events.
 */
export function bindModalEvents() {
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

            attachCharacterCardToSession(card, null);
            toastr?.success(`Imported character: "${card.name}".`);

            if (card.characterBook) {
                startImportProgress(`${card.name}'s Worldbook`);
                try {
                    const loreRes = await processLorebookForConcierge(
                        `${card.name}'s Lorebook`,
                        card.characterBook,
                        msg => {
                            isImportCommitPending = true;
                            importStatusText = msg;
                            syncImportCommitBoxUI();
                            toastr?.info(msg);
                        },
                        card.name,
                    );
                    await attachLoreSource(`${card.name}'s Lorebook`, loreRes);
                    renderAttachmentTray();
                    toastr?.info(`Imported embedded worldbook for "${card.name}".`);
                } catch (err) {
                    toastr?.error(`Embedded worldbook for "${card.name}" could not be imported: ${err.message}`);
                }
                finally {
                    stopImportProgress(`${card.name}'s Worldbook`);
                }
            }
        } finally {
            stopImportProgress(charLabel);
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

            const loreRes = await processLorebookForConcierge(
                bookName,
                bookData,
                msg => {
                    isImportCommitPending = true;
                    importStatusText = msg;
                    syncImportCommitBoxUI();
                    toastr?.info(msg);
                },
                activeDossier?.protagonist?.name || '',
            );
            await attachLoreSource(bookName, loreRes);
            renderAttachmentTray();
            toastr?.success(`Imported lorebook: "${bookName}" (${loreRes.mode === 'synthesized' ? 'Synthesized' : 'Direct'}).`);
        } catch (err) {
            toastr?.error(`Lorebook import failed: ${err.message}`);
        } finally {
            stopImportProgress(bookName);
        }
    });

    // Inspiration Toolbar: Manual World Lore Import Trigger & Hidden Input
    $('#mhc_import_world_lore_btn').on('click', () => $('#mhc_import_lore_file_input').click());
    $('#mhc_import_lore_file_input').on('change', function () {
        if (this.files && this.files.length) {
            setModeOverride('archivist');
            isImportCommitPending = true;
            syncImportCommitBoxUI();
            handleFilesSelected(this.files);
            this.value = '';
        }
    });

    // Import & Commit Box actions
    $('#mhc_import_add_more_btn').on('click', () => $('#mhc_import_lore_file_input').click());
    $('#mhc_import_commit_btn').on('click', handleCommitImportedLore);
    $('#mhc_import_cancel_btn').on('click', () => {
        if (activeTurn) {
            activeTurn.controller.abort();
            return;
        }
        if (importAbortController) {
            try { importAbortController.abort(); } catch (_) {}
            importAbortController = null;
        }
        activeImports = [];
        isImportCommitPending = false;
        renderAttachmentTray();
    });
    $('#mhc_import_use_vibe_btn').on('click', () => {
        setModeOverride('vibe');
        isImportCommitPending = false;
        renderAttachmentTray();
        toastr?.info('Switched to Quick Vibe mode (chat prompt will use the first 5,000 words).');
    });

    // Send on button or Enter (Shift+Enter for newline)
    $('#mhc_send_btn').on('click', handleUserSend);
    $('#mhc_stop_btn').on('click', () => {
        if (activeTurn) activeTurn.controller.abort();
    });
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
        const currentTitle = isDefaultUntitledCampaignTitle(activeDossier.meta?.title) ? '' : (activeDossier.meta?.title || '');
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

    // 4-Step Stepper bar navigation
    $('#mhc_concierge_modal').on('click', '.mhc-step-btn', async function (e) {
        e.preventDefault();
        const targetStep = $(this).attr('data-step');
        if (!targetStep || !unlockedSteps[targetStep]) return;
        if (targetStep === currentAdventureStep) return;
        await setAdventureStep(targetStep);
    });

    // Canon toggle active/disabled buttons
    $('#mhc_concierge_modal').on('click', '.mhc-canon-toggle-btn', function (e) {
        e.stopPropagation();
        const comment = $(this).attr('data-comment');
        if (!comment) return;
        const all = getStagedCanonEntries();
        const target = all.find(ent => (ent.comment || `[${ent.kind}] ${ent.name}`) === comment || ent.name === comment);
        const newDisabled = !target?.disabled;
        toggleCanonEntryDisabled(comment, newDisabled);
        updateBlueprintDeck();
        saveDraft();
    });

    // Attached source remove buttons
    $('#mhc_concierge_modal').on('click', '.mhc-source-remove-btn', function (e) {
        e.stopPropagation();
        const name = $(this).attr('data-name');
        if (!name) return;
        unstageCanonSource(name);
        attachedSources = attachedSources.filter(s => s.name !== name && s.cardName !== name);
        pendingAttachments = pendingAttachments.filter(a => !(
            a.sourceName === name ||
            a.name === name ||
            `${a.name} (Character Card)` === name
        ));
        renderAttachmentTray();
        evaluateStepUnlocks();
        updateBlueprintDeck();
        saveDraft();
        toastr?.info(`Removed source "${name}".`);
    });

    // Ruleset Switch segmented buttons
    $('#mhc_concierge_modal').on('click', '.mhc-ruleset-btn', async function (e) {
        e.stopPropagation();
        const targetRuleset = $(this).attr('data-ruleset');
        if (!targetRuleset || !systemRegistry.has(targetRuleset)) return;

        if (currentNavMode === 'new-adventure' && currentAdventureStep === 'adventure') {
            const rulesetConfirmed = Boolean(activeDossier?.meta?.rulesetConfirmed);
            if (!rulesetConfirmed) {
                // Case A: First selection in Step 3
                activeDossier.meta.ruleset = targetRuleset;
                activeDossier.meta.rulesetConfirmed = true;
                const adapter = systemRegistry.get(targetRuleset);
                const defaultGenre = adapter.getDefaultGenre();
                activeDossier.meta.systemKey = defaultGenre;
                activeDossier.meta.systemLabel = adapter.getGenre(defaultGenre)?.label || defaultGenre;

                // Re-initialize ruleset-specific protagonist defaults
                adapter.initializeProtagonist(activeDossier.protagonist, activeDossier);

                updateBlueprintDeck();
                evaluateStepUnlocks();
                saveDraft();

                // Reveal chat column and run initial Stage 3 pass
                $('.mhc-chat-column').show();
                stageChatHistories.adventure = [];
                await runStageAutoPass('adventure', 'Please draft our Episode 1 starting crisis, locations, adversaries, and supporting NPCs from our Canon for this ruleset.');
                return;
            } else if (activeDossier.meta?.ruleset !== targetRuleset) {
                // Case B: Switching rulesets after selection
                const curAdapter = systemRegistry.get(activeDossier.meta?.ruleset || 'pbta');
                const nextAdapter = systemRegistry.get(targetRuleset);
                const oldLabel = `${curAdapter.label} (${curAdapter.diceEngine})`;
                const newLabel = `${nextAdapter.label} (${nextAdapter.diceEngine})`;

                const confirmed = await showConciergeConfirm({
                    icon: '🔄',
                    title: 'Switch Ruleset Engine?',
                    message: `Switch from ${oldLabel} to ${newLabel}?\n\n• You will lose: ruleset-specific monster stat blocks, character stats, and progression codex.\n• Preserved: World Canon, Maps, Starting Crisis, Agnostic Dials, and NPC/Adversary names & descriptions.`,
                    confirmLabel: '🔄 Switch & Rebuild',
                    confirmColor: '#2563eb',
                });

                if (!confirmed) return;

                const bones = extractAgnosticAdventureBones(activeDossier);
                const preservedMeta = {
                    title: activeDossier.meta?.title,
                    premise: activeDossier.meta?.premise,
                    focalLens: activeDossier.meta?.focalLens,
                    tone: activeDossier.meta?.tone,
                    framingComplete: true,
                    rulesetConfirmed: true,
                };
                const preservedWorldRules = JSON.parse(JSON.stringify(activeDossier.worldRules || { axioms: [], customModule: null }));

                activeDossier = createEmptyDossier(targetRuleset);
                Object.assign(activeDossier.meta, preservedMeta);
                activeDossier.worldRules = preservedWorldRules;
                if (bones.agnosticConfig) Object.assign(activeDossier.config, bones.agnosticConfig);
                if (bones.theKick) activeDossier.theKick = bones.theKick;
                if (bones.maps) activeDossier.maps = bones.maps;
                if (bones.npcs) activeDossier.npcs = bones.npcs;
                if (bones.monsters) activeDossier.monsters = bones.monsters;

                stageChatHistories.adventure = [];
                stageChatHistories.character = [];
                chatHistory = [];

                updateBlueprintDeck();
                evaluateStepUnlocks();
                saveDraft();

                await runStageAutoPass('adventure', `Please restat and adapt the Episode 1 adventure for ${newLabel}.`, { agnosticBones: bones });
                return;
            }
        }

        switchRulesetMode(targetRuleset);
    });

    // Ruleset Switch interaction on system badge click (cycles through all registered adapters)
    $('#mhc_header_system_badge').on('click', () => {
        const curRuleset = systemRegistry.detectRuleset(activeDossier);
        const list = systemRegistry.list();
        const curIdx = list.findIndex(a => a.id === curRuleset);
        const next = list[(curIdx + 1) % list.length];
        switchRulesetMode(next.id);
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

    $('#mhc_dial_heroic_btn').on('click', () => {
        const isFae = activeDossier.meta?.ruleset === 'fae';
        if (!isFae) return;
        activeDossier.config = activeDossier.config || {};
        activeDossier.config.knobs = activeDossier.config.knobs || activeDossier.knobs || {};
        const curHeroic = Boolean(
            activeDossier.config.heroicTier ??
            activeDossier.config.heroic_tier ??
            activeDossier.config.knobs.heroic_tier
        );
        const nextHeroic = !curHeroic;
        activeDossier.config.heroicTier = nextHeroic;
        activeDossier.config.heroic_tier = nextHeroic;
        activeDossier.config.knobs.heroic_tier = nextHeroic;
        if (activeDossier.knobs) activeDossier.knobs.heroic_tier = nextHeroic;

        if (nextHeroic) {
            const systemKey = activeDossier.meta?.systemKey || 'osr_dungeon';
            const genreObj = FAE_GENRES[systemKey] || FAE_GENRES.osr_dungeon;
            if (!activeDossier.protagonist?.heroicDomain && !activeDossier.character?.heroic_domain) {
                const defaultDomain = genreObj?.defaultHeroicDomain || 'Spellblade [short-range blink and arcane ward-breaking]';
                if (activeDossier.protagonist) activeDossier.protagonist.heroicDomain = defaultDomain;
                if (activeDossier.character) activeDossier.character.heroic_domain = defaultDomain;
            }
        }
        changelog.push(`Toggled Heroic Tier to ${nextHeroic ? 'ON' : 'OFF'}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_tempo_btn').on('click', () => {
        const isFae = activeDossier.meta?.ruleset === 'fae';
        if (!isFae) return;
        activeDossier.config = activeDossier.config || {};
        activeDossier.config.knobs = activeDossier.config.knobs || activeDossier.knobs || {};
        const curTempo = activeDossier.config.actionTempo || activeDossier.config.knobs.action_tempo || 'gritty_default';
        const cycle = {
            'action_serial': 'gritty_default',
            'gritty_default': 'slow_burn',
            'slow_burn': 'slice_of_life',
            'slice_of_life': 'action_serial'
        };
        const nextTempo = cycle[curTempo] || 'gritty_default';
        activeDossier.config.actionTempo = nextTempo;
        activeDossier.config.knobs.action_tempo = nextTempo;
        if (activeDossier.knobs) activeDossier.knobs.action_tempo = nextTempo;

        changelog.push(`Cycled Action Tempo to ${nextTempo}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_harm_btn').on('click', () => {
        const isFae = activeDossier.meta?.ruleset === 'fae';
        if (isFae) {
            activeDossier.config = activeDossier.config || {};
            activeDossier.config.knobs = activeDossier.config.knobs || activeDossier.knobs || {};
            const curShift = activeDossier.config.knobs.base_attrition_shift ?? 0;
            const cycle = { 0: 1, 1: 2, 2: -1, '-1': 0 };
            const nextShift = cycle[curShift] ?? 0;
            activeDossier.config.knobs.base_attrition_shift = nextShift;
            if (activeDossier.knobs) activeDossier.knobs.base_attrition_shift = nextShift;
            changelog.push(`Toggled Base Attrition Shift to ${nextShift >= 0 ? '+' : ''}${nextShift}`);
            updateBlueprintDeck();
            saveDraft();
            return;
        }

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
        const isFae = activeDossier.meta?.ruleset === 'fae';
        if (isFae) {
            activeDossier.config = activeDossier.config || {};
            activeDossier.config.knobs = activeDossier.config.knobs || activeDossier.knobs || {};
            const curFlee = activeDossier.config.knobs.flee_grace_toggle !== false;
            activeDossier.config.knobs.flee_grace_toggle = !curFlee;
            if (activeDossier.knobs) activeDossier.knobs.flee_grace_toggle = !curFlee;
            changelog.push(`Toggled Flee Grace to ${!curFlee ? 'ON' : 'OFF'}`);
            updateBlueprintDeck();
            saveDraft();
            return;
        }

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

    // Tab buttons (strictly scoped to Concierge Modal tabs)
    $('#mhc_concierge_modal').on('click', '.mhc-dossier-tabs .mhc-tab-btn', function (e) {
        e.preventDefault();
        const tab = $(this).attr('data-tab');
        if (tab) {
            setConciergeTab(tab);
        }
    });

    // In-drawer Progression Codex shortcut button on protagonist card
    $('#mhc_concierge_modal').on('click', '#mhc_open_codex_tab_btn', function (e) {
        e.preventDefault();
        setConciergeTab('progression');
    });

    // Header Mode Switcher (.mhc-mode-nav-btn)
    let _isNavigatingMode = false;
    $('#mhc_concierge_modal').on('click', '.mhc-mode-nav-btn', async function (e) {
        e.preventDefault();
        if (_isNavigatingMode) return;
        _isNavigatingMode = true;
        try {
            const mode = $(this).attr('data-nav-mode');
            if (mode === 'character') {
                saveDraft();
                $('#mhc_concierge_modal').fadeOut(150);
                const { launchLevelUpOrRespecDesk } = await import('./index.js');
                await launchLevelUpOrRespecDesk({ isRespec: true });
            } else if (mode === 'living-world' || mode === 'new-adventure') {
                await switchToTrack(mode);
            }
        } finally {
            setTimeout(() => { _isNavigatingMode = false; }, 300);
        }
    });

    // Fork as New Campaign (clones Living World into Session Zero Sandbox)
    $('#mhc_fork_campaign_btn').on('click', async () => {
        await forkActiveCampaignToSessionZero();
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
                const rulesetKey = activeDossier?.meta?.ruleset || 'dnd5e';
                const rulesetLabel = systemRegistry.get(rulesetKey)?.label || (rulesetKey === 'fae' ? 'FAE' : (rulesetKey === 'pbta' ? 'PbtA' : 'D&D 5e'));
                toastr?.success(`${rulesetLabel} Campaign ready! The game is now beginning.`, 'Adventure Launched');
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
            const isFae = activeDossier?.meta?.ruleset === 'fae';
            toastr?.error(`No active ${isFae ? 'FAE' : 'PbtA'} campaign found in this chat to synchronize with.`, 'Sync Blocked');
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
        const refinerApplied = Boolean(tx.refinerPass?.hasMutations);
        if (refinerApplied) {
            modalCritiqueBadge.text(`REFINED (Pass 2 · ${critique.score}/100 ${critique.grade || 'C'})`).css({
                background: 'rgba(168, 85, 247, 0.25)',
                color: '#c084fc',
            });
        } else {
            modalCritiqueBadge.text(`${critique.grade || 'B'} (${critique.score}/100 · ${critique.verdict})`).css({
                background: isRevise ? 'rgba(251, 191, 36, 0.2)' : 'rgba(74, 222, 128, 0.2)',
                color: isRevise ? '#fbbf24' : '#4ade80',
            });
        }
        contempParts.push(`
            <div style="background: rgba(0,0,0,0.28); border: 1px solid rgba(250, 204, 21, 0.25); border-radius: 4px; padding: 6px 8px;">
                <div style="font-weight: 600; color: #fde047; margin-bottom: 3px;">⚖️ ${refinerApplied ? 'Pass 1 Judge Critique' : 'Judge Verdict'}: ${escapeHtml(critique.verdict)} (${critique.score}/100 · ${escapeHtml(critique.grade)})${refinerApplied ? ' <span style="color: #c084fc; font-weight: normal; font-size: 0.9em;">(Resolved in Pass 2)</span>' : ''}</div>
                ${critique.strengths?.length ? `<div style="color: #86efac;"><b>Strengths:</b> ${critique.strengths.map(s => escapeHtml(s)).join(' · ')}</div>` : ''}
                ${critique.weaknesses?.length ? `<div style="color: #fca5a5;"><b>Weaknesses:</b> ${critique.weaknesses.map(w => escapeHtml(w)).join(' · ')}</div>` : ''}
                ${critique.directives?.length ? `<div style="color: #93c5fd;"><b>Directives:</b> ${critique.directives.map(d => escapeHtml(d)).join(' · ')}</div>` : ''}
                ${tx.refinerPass?.hasMutations ? `<div style="color: #c4b5fd; margin-top: 5px; padding-top: 5px; border-top: 1px dashed rgba(168, 85, 247, 0.4);"><b>✅ Pass 2 Refiner Applied (Resolved):</b> ${tx.refinerPass.changes.map(c => escapeHtml(c)).join('; ')}</div>` : ''}
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
            let genderBadge = '';
            if (r.gender === 'F') genderBadge = ' <span style="font-size: 0.8em; padding: 1px 5px; border-radius: 3px; background: rgba(236, 72, 153, 0.2); color: #f472b6; margin-left: 6px;">♀ Female</span>';
            else if (r.gender === 'M') genderBadge = ' <span style="font-size: 0.8em; padding: 1px 5px; border-radius: 3px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; margin-left: 6px;">♂ Male</span>';
            else if (r.gender === 'Dual') genderBadge = ' <span style="font-size: 0.8em; padding: 1px 5px; border-radius: 3px; background: rgba(168, 85, 247, 0.2); color: #c084fc; margin-left: 6px;">⚥ Non-Binary</span>';
            return `
                <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 6px 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <div>
                            <span style="font-weight: 600; color: #facc15;">${escapeHtml(r.placeholder)}</span>
                            ${genderBadge}
                        </div>
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
export async function openConciergeModal({ ruleset = null, genreKey = null, navMode = null } = {}) {
    await ensureModalMounted();
    bindModalEvents();
    updateConnectionDropdowns();
    populateInspirationDropdowns();

    // Check for existing draft or initialize greeting
    const draftResult = ruleset ? loadValidatedDraft(ruleset) : loadValidatedDraft();

    if (draftResult?.corrupted) {
        // Corrupted or incomplete draft in storage: discard and reset cleanly
        resetConciergeState({ showGreeting: true, ruleset, genreKey });
        toastr?.info('Previous uncompleted draft could not be fully loaded and was reset to a fresh Session Zero.', 'Session Zero');
    } else if (draftResult?.draft) {
        // Valid draft found: restore it into sessionZeroTrack
        const { draft } = draftResult;
        sessionZeroTrack.dossier = draft.dossier;
        if (draft.stagedCanonEntries && Array.isArray(draft.stagedCanonEntries)) {
            sessionZeroTrack.stagedCanonEntries = draft.stagedCanonEntries;
        }
        if (draft.currentAdventureStep) sessionZeroTrack.currentAdventureStep = draft.currentAdventureStep;
        if (draft.unlockedSteps) sessionZeroTrack.unlockedSteps = { ...unlockedSteps, ...draft.unlockedSteps };
        if (draft.stageChatHistories) sessionZeroTrack.stageChatHistories = { ...stageChatHistories, ...draft.stageChatHistories };
        if (draft.lastSyncedSnapshots) sessionZeroTrack.lastSyncedSnapshots = { ...lastSyncedSnapshots, ...draft.lastSyncedSnapshots };
        if (draft.attachedSources) sessionZeroTrack.attachedSources = [...draft.attachedSources];
        sessionZeroTrack.chatHistory = draft.chatHistory || [];
        sessionZeroTrack.changelog = draft.changelog || [];

        if (!chatHistory.length) {
            restoreSessionZeroTrack();
            renderChatHistoryFromState();
            evaluateStepUnlocks();
            toastr?.info('Resumed previous Session Zero draft in progress.', 'Session Zero');
        }
    } else {
        // No draft exists in storage
        if (chatHistory.length > 0) {
            resetConciergeState({ showGreeting: true, ruleset, genreKey });
        } else if (!sessionZeroTrack.chatHistory?.length && !$('#mhc_chat_messages').children().length) {
            resetConciergeState({ showGreeting: true, ruleset, genreKey });
        }
    }

    // Refresh active chat context indicators and sync button visibility
    await refreshConciergeActiveContext();

    const targetMode = navMode || (lastActiveConciergeMode === 'living-world' ? 'living-world' : 'new-adventure');
    let switched = false;
    if (targetMode === 'living-world') {
        switched = await switchToTrack('living-world');
    }
    if (!switched) {
        await switchToTrack('new-adventure');
    }

    updateBlueprintDeck();
    renderDebugInspectorView();
    const activeTab = $('#mhc_concierge_modal .mhc-dossier-tabs .mhc-tab-btn.active').attr('data-tab') || 'cards';
    setConciergeTab(activeTab);
    $('#mhc_concierge_modal').fadeIn(200);
}

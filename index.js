/**
 * MultiHog Companion Extension
 *
 * Automatically synchronizes SillyTavern personas and portraits with
 * campaigns managed by Multihog D&D Framework:
 * 1. Persona Sync: Locks the character persona to the current chat.
 * 2. Portrait Sync: Pushes generated/assigned Multihog portraits into the persona avatar.
 */

let extension_settings = globalThis.extension_settings || {};
let eventSource = globalThis.eventSource || { on: () => {}, makeFirst: () => {} };
let event_types = globalThis.event_types || {};
let saveSettingsDebounced = globalThis.saveSettingsDebounced || (() => {});
let SlashCommandParser = globalThis.SlashCommandParser || null;
let SlashCommand = globalThis.SlashCommand || null;

try {
    const ext = await import('../../../extensions.js');
    if (ext?.extension_settings) extension_settings = ext.extension_settings;
} catch (_) {}
try {
    const scr = await import('../../../../script.js');
    if (scr?.eventSource) eventSource = scr.eventSource;
    if (scr?.event_types) event_types = scr.event_types;
    if (scr?.saveSettingsDebounced) saveSettingsDebounced = scr.saveSettingsDebounced;
} catch (_) {}
try {
    const scp = await import('../../../slash-commands/SlashCommandParser.js');
    if (scp?.SlashCommandParser) SlashCommandParser = scp.SlashCommandParser;
} catch (_) {}
try {
    const sc = await import('../../../slash-commands/SlashCommand.js');
    if (sc?.SlashCommand) SlashCommand = sc.SlashCommand;
} catch (_) {}

import {
    PBTA_GENRES,
    buildPbtACartridge,
    buildPbtAQuickStartInstructions,
    buildPbtARngContent,
    executePbtaMoveTool,
} from './pbta-ruleset.js';
import {
    FAE_GENRES,
    FAE_CARTRIDGE_ID,
    buildFaeCartridge,
    buildFaeRngBlock,
    buildFaeRngContent,
    buildFaeRoleContent,
    executeFaeActionTool,
    triggerEventOrRest,
    buildFaeQuickStartInstructions,
} from './fae-ruleset.js';
import {
    parseFaeStateFromMemo,
    reconcileFaeMemoAfterTurn,
    advanceFaeTurnTempo,
    formatFaeCharacterMemoBlock,
    formatInitialFaeMemo,
    stripFaePartyBlockFromMemo,
} from './fae-state-sync.js';
import {
    openConciergeModal,
    refreshConciergeActiveContext,
    renderDebugInspectorView,
    formatDiagnosticTrace,
} from './concierge-ui.js';
import {
    getCampaignLorebookStatus,
    syncCampaignLorebooks,
} from './campaign-lore-sync.js';
import {
    syncLivePbtaMemoVitality,
    normalizePbtaMemo,
    forceRenderTrackerView,
} from './pbta-vitality-sync.js';
export { forceRenderTrackerView };
import {
    discoverNameRagServer,
    testNameRagConnection,
} from './namerag-client.js';
import {
    setupMultiHogRollHooks,
    syncNameRagAdhocSysprompt,
    rollNameRagCandidate,
} from './namerag-hooks.js';
import {
    setupCompanionDocInterceptor,
    detectActiveFaeGenre,
} from './pbta-companion-bridge.js';
import {
    isPbtAActive,
    isPbtaChat,
    isFaeActive,
    isFaeChat,
    formatRulesetBadge,
    persistPbtaChatState,
    isPersistingPbtaChatState,
    clearPersistingPbtaChatState,
    ensureActiveChatRulesetConsistency,
    isLiveSettingsPollutedWithPbtA,
    isLiveSettingsPollutedWithFae,
    cleanseStockDndSettings,
    logRulesetEvent,
    collectRulesetDiagnostics,
    getCompanionActiveCartridge,
    setCompanionActiveCartridge,
    getActiveRulesetId,
} from './pbta-ruleset-persistence.js';
import {
    scanAndInitUnsyncedNpcs,
    checkAndSyncTierCrossovers,
    getRelationshipSyncStatus,
} from './relationship-narrative-sync.js';
import {
    initCyoaSafetyNet,
    registerCyoaSlashCommands,
    regenerateCyoaChoicesForMessage,
    repairOrGenerateChoicesForMessage,
    handleWandCyoaFixOrReroll,
    tryRepairMarkdownChoices,
    applyRepairedMessage,
    repairMixedFooterAndChoicesInChat,
} from './cyoa-safety-net.js';
import {
    markLocationRerollActive,
    clearActiveLocationReroll,
    isLocationRerollActive,
    isLocationPopupVisible,
    getActiveCampaignLocation,
    isSceneGenerationRequest,
    handleLocationRerollClick,
    wrapImagineCommand,
    setActiveImagineChatId,
} from './aspect-ratio-bridge.js';
export {
    markLocationRerollActive,
    clearActiveLocationReroll,
    isLocationRerollActive,
    isLocationPopupVisible,
    getActiveCampaignLocation,
    isSceneGenerationRequest,
    handleLocationRerollClick,
    setActiveImagineChatId,
};
import {
    generateCyoaChoices,
    buildCyoaPrompt,
    extractChoicesMarkup,
    isProtagonistDowned,
    isCyoaGenerating,
    abortCyoaGeneration,
} from './cyoa-generator.js';
import {
    initAdventureChatRenameGuard,
    isAdventureActive,
} from './adventure-chat.js';
import {
    resolveAuthoritativeChatId,
    isSameChatId,
    checkHistoryPersistenceBlocked,
    checkTrackerProjectionIntegrity,
    renderTrackerQuarantineBanner,
    scanAllChatHistories,
    formatHistoryDiagnosticReport,
} from './history-integrity-guard.js';
import {
    isValidCharacterName,
    sanitizeCharacterStockPrompt,
    installMacroSyntaxSanitizer,
    stripMarkdownNameArtifacts,
    sanitizeCharacterHeaderInMemo,
    rectifyMemoCharacterName,
    extractNameFromBio,
} from './character-creator-sanitizer.js';
import {
    isDndSubfooterAlignmentApplied,
    applyDndSubfooterAlignment,
    revertDndSubfooterAlignment,
} from './dnd-fixes.js';
import {
    getNameMatchingVariants,
    findMatchingPersona,
    extractNameFromMemo,
    getCandidateChatIds,
    getMultihogPlayerName,
    getMultihogPlayerPortrait,
} from './persona-matching.js';
export {
    getNameMatchingVariants,
    findMatchingPersona,
    getMultihogPlayerPortrait,
};

// [CATALOG: ADR-MP-01] Immediately install early fetch interceptor on module load
setupCompanionDocInterceptor();

const EXTENSION_NAME = 'multihog_companion';

const EXTENSION_FOLDER = 'scripts/extensions/third-party/MultiHogCompanion';

const DEFAULT_SETTINGS = {
    enablePersonaSync: true,
    enablePortraitSync: true,
    showToasts: true,
    enableDndSubfooterFix: true,
    enableAspectRatioBridge: true,
    aspectRatioPreset: 'sd15',
    sceneWidth: 672,
    sceneHeight: 384,
    portraitWidth: 512,
    portraitHeight: 512,
    enableLorebookSync: true,
    autoSyncOnRename: true,
    deleteOldLorebooksOnSync: true,
    enableNameRag: true,
    nameRagEnhanceMultiHog: true,
    nameRagEnhanceConcierge: true,
    nameRagAdhocSysprompt: true,
    enableRelationshipNarrativeSync: true,
    enableDecoupledCyoa: true,
    enableCyoaAutoRetry: true,
    cyoaMaxRetries: 1,
    enableCyoaMarkdownAutoRepair: true,
    cyoaMaxTokens: 0,
    rulesetEngineMode: 'pbta',
    lastFaeGenre: 'cosmic_horror',
    faeFleeGrace: true,
    faeAttritionShift: 0,
    faeOverflowDefault: 'scar_and_ko',
};

function getSettings() {
    extension_settings[EXTENSION_NAME] = extension_settings[EXTENSION_NAME] || {};
    return Object.assign({}, DEFAULT_SETTINGS, extension_settings[EXTENSION_NAME]);
}

function updateSettings(patch) {
    extension_settings[EXTENSION_NAME] = Object.assign(getSettings(), patch);
    saveSettingsDebounced();
}

/**
 * Display a subtle toast notification if enabled in user preferences.
 */
function showToast(type, message, title = 'MultiHog Companion') {
    if (!getSettings().showToasts) return;
    if (typeof toastr !== 'undefined' && toastr[type]) {
        toastr[type](message, title, {
            timeOut: 3200,
            extendedTimeOut: 1200,
            closeButton: true,
            preventDuplicates: true,
            progressBar: false,
        });
    }
}

/**
 * Trigger MultiHog to re-save settings, recompile its system prompt, and refresh UI.
 * Attempts the runtime-bridge import first; falls back to clicking the DOM apply button.
 */
export async function refreshMultihogRuntime() {
    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.saveSettings === 'function') bridge.saveSettings();
        if (typeof bridge.autoApplySysprompt === 'function') await bridge.autoApplySysprompt(true);
        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
    } catch (_) {
        if (typeof document !== 'undefined') {
            document.getElementById('rpg_tracker_btn_apply_sysprompt')?.click();
        }
    }
    if (typeof globalThis._rpgSyncSettingsUi === 'function') {
        globalThis._rpgSyncSettingsUi();
    }
}

/**
 * Get active chat ID from SillyTavern (authoritative) or Multihog tracker fallback.
 */
function getActiveChatId() {
    return resolveAuthoritativeChatId();
}

/**
 * Get Multihog framework settings.
 */
function getRpgSettings() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    return ctx?.extensionSettings?.rpg_tracker
        || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : (globalThis.extension_settings?.rpg_tracker || null));
}

/**
 * Bind the persona to the active chat and set it active if not already.
 */
export async function syncPersonaToChat(chatId, persona) {
    const ctx = SillyTavern.getContext();
    const currentBound = ctx.chatMetadata?.persona;

    if (currentBound === persona.avatar) {
        return false;
    }

    console.log(`[MultiHog Companion] Locking persona "${persona.name}" (${persona.avatar}) to chat ${chatId}`);

    try {
        const { setUserAvatar, user_avatar } = await import('../../../personas.js');
        if (user_avatar !== persona.avatar) {
            await setUserAvatar(persona.avatar);
        }
    } catch (err) {
        console.warn('[MultiHog Companion] setUserAvatar failed:', err);
    }

    if (ctx.chatMetadata) {
        ctx.chatMetadata.persona = persona.avatar;
        if (typeof ctx.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
        }
    }

    try {
        if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            await ctx.executeSlashCommandsWithOptions('/persona-lock on');
        }
    } catch (err) {
        console.warn('[MultiHog Companion] /persona-lock on failed:', err);
    }

    showToast('info', `Bound persona "${persona.name}" to this chat.`);
    return true;
}

/**
 * Upload the image blob to the persona avatar file on SillyTavern server.
 */
export async function uploadImageToPersona(avatarId, imageSrc) {
    const ctx = SillyTavern.getContext();
    const getRequestHeaders = ctx.getRequestHeaders;

    let blob;
    if (imageSrc.startsWith('data:image/')) {
        const res = await fetch(imageSrc);
        blob = await res.blob();
    } else {
        const url = (imageSrc.startsWith('http://') || imageSrc.startsWith('https://') || imageSrc.startsWith('/'))
            ? imageSrc
            : `/${imageSrc}`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch portrait from ${url}: ${res.statusText}`);
        }
        blob = await res.blob();
    }

    const file = new File([blob], 'avatar.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('overwrite_name', avatarId);

    const uploadResponse = await fetch('/api/avatars/upload', {
        method: 'POST',
        headers: getRequestHeaders ? getRequestHeaders({ omitContentType: true }) : {},
        cache: 'no-cache',
        body: formData,
    });

    if (!uploadResponse.ok) {
        throw new Error(`Persona avatar upload failed: ${uploadResponse.statusText}`);
    }

    try {
        const [{ getUserAvatar, getUserAvatars }, scriptMod] = await Promise.all([
            import('../../../personas.js').catch(() => ({})),
            import('../../../../script.js').catch(() => ({})),
        ]);
        if (typeof getUserAvatar === 'function') {
            await fetch(getUserAvatar(avatarId), { cache: 'reload' }).catch(() => {});
        }
        const thumbUrl = typeof scriptMod?.getThumbnailUrl === 'function'
            ? scriptMod.getThumbnailUrl('persona', avatarId)
            : `/thumbnail?type=persona&file=${encodeURIComponent(avatarId)}`;
        if (thumbUrl) {
            await fetch(thumbUrl, { cache: 'reload' }).catch(() => {});
        }
        if (typeof getUserAvatars === 'function') {
            await getUserAvatars(true, avatarId).catch(() => {});
        }
    } catch (_) {}

    // Force DOM repaint with timestamp cache buster
    try {
        const bust = String(Date.now());
        const updateSrcWithCacheBust = (src) => {
            if (!src) return src;
            try {
                const dummyBase = 'http://st.local';
                const parsed = new URL(src, dummyBase);
                parsed.searchParams.set('t', bust);
                if (src.startsWith('http://') || src.startsWith('https://')) {
                    return parsed.href;
                }
                return parsed.pathname + parsed.search;
            } catch (_) {
                const sep = src.includes('?') ? '&' : '?';
                return `${src}${sep}t=${bust}`;
            }
        };

        // Target ONLY elements belonging to this avatar, avoiding indiscriminate selection of #user_avatar_block
        const safeAvatarId = (avatarId || '').replace(/"/g, '\\"');
        const encodedAvatarId = encodeURIComponent(avatarId || '').replace(/"/g, '\\"');
        const selectors = [
            `.mes[is_user="true"] .avatar img`,
            `#avatar`,
            `#user_avatar_block [data-avatar-id="${safeAvatarId}"] img`,
            `img[src*="${safeAvatarId}"]`,
            `#quickPersonaImg`,
        ];
        if (encodedAvatarId && encodedAvatarId !== safeAvatarId) {
            selectors.push(`img[src*="${encodedAvatarId}"]`);
        }
        const selector = selectors.join(', ');

        if (typeof $ !== 'undefined') {
            $(selector).each(function () {
                const currentSrc = $(this).attr('src') || '';
                $(this).attr('src', updateSrcWithCacheBust(currentSrc));
            });
        } else if (typeof document !== 'undefined') {
            document.querySelectorAll(selector).forEach(el => {
                const currentSrc = el.getAttribute('src') || '';
                el.setAttribute('src', updateSrcWithCacheBust(currentSrc));
            });
        }
    } catch (_) {}

    try {
        if (ctx.eventSource && ctx.eventTypes?.PERSONA_UPDATED) {
            await ctx.eventSource.emit(ctx.eventTypes.PERSONA_UPDATED, avatarId);
        }
    } catch (_) {}

    return true;
}

/**
 * Sync portrait from Multihog into SillyTavern persona.
 * Skips execution if the portrait is already recorded as synced unless opts.force is true.
 */
async function syncPortraitToPersona(chatId, persona, portraitSrc, opts = {}) {
    const ctx = SillyTavern.getContext();
    const meta = ctx.chatMetadata?.multihog_companion || {};

    if (!opts.force && meta.synced_portrait === portraitSrc && meta.synced_persona === persona.avatar) {
        return false;
    }

    console.log(`[MultiHog Companion] Syncing portrait to persona "${persona.name}" (${persona.avatar})`);

    await uploadImageToPersona(persona.avatar, portraitSrc);

    if (ctx.chatMetadata) {
        ctx.chatMetadata.multihog_companion = {
            ...ctx.chatMetadata.multihog_companion,
            synced_portrait: portraitSrc,
            synced_persona: persona.avatar,
            synced_at: Date.now(),
        };
        if (typeof ctx.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
        }
    }

    showToast('success', `Synced portrait for "${persona.name}".`);
    return true;
}

let _isSyncing = false;
let _syncDebounceTimer = null;

/**
 * Attempts to recover a PbtA Campaign Dossier artifact from SillyTavern World Info strictly for this chat.
 * @param {object} ctx
 * @param {string[]} candidateChatIds
 * @returns {Promise<object|null>}
 */
async function tryRecoverDossierFromWorldInfo(ctx, candidateChatIds) {
    if (!ctx) return null;
    let parseMarkdownToDossier = null;
    try {
        const parser = await import('./concierge-parser.js');
        parseMarkdownToDossier = parser.parseMarkdownToDossier;
    } catch (_) {}
    if (!parseMarkdownToDossier) return null;

    const bookCandidates = [
        ctx.chatMetadata?.world_info,
        ...candidateChatIds.map(id => `Campaign_${id}`),
    ].filter(Boolean);

    const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));

    for (const bookName of [...new Set(bookCandidates)]) {
        try {
            const res = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ name: bookName }),
            });
            if (!res.ok) continue;
            const data = await res.json();
            const entries = data?.entries || {};
            for (const entry of Object.values(entries)) {
                if (entry?.comment?.includes('CAMPAIGN_DOSSIER') ||
                    entry?.comment?.includes('PbtA Concierge') ||
                    entry?.key?.includes('campaign_dossier') ||
                    entry?.content?.includes('# 📜 CAMPAIGN DOSSIER:')) {
                    const parsed = parseMarkdownToDossier(entry.content);
                    if (parsed?.protagonist?.name) {
                        console.log(`[MultiHog Companion] Recovered PbtA Campaign Dossier from World Info "${bookName}".`);
                        return parsed;
                    }
                }
            }
        } catch (_) {}
    }
    return null;
}

/**
 * Auto-hydrates the Multihog D&D tracker memo with initial PbtA game state
 * from an existing PbtA Campaign Dossier or Lorebook Player Card if the tracker
 * is currently showing the empty onboarding / "create an adventure" screen.
 *
 * @param {string} [chatId]
 * @returns {Promise<boolean>}
 */
export async function hydratePbtaMemoIfNeeded(chatId) {
    const s = getRpgSettings();
    if (!s) return false;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;

    const integrity = await checkTrackerProjectionIntegrity({ chatId, rpgSettings: s, ctx });
    if (!integrity.healthy) {
        renderTrackerQuarantineBanner(integrity);
        return false;
    }

    const candidateIds = getCandidateChatIds(chatId);
    const uniqueIds = [...new Set(candidateIds)];
    const effectiveChatId = uniqueIds[0] || 'active';

    const liveMemo = String(s.currentMemo || '').trim();
    const hasCharBlock = liveMemo && /\[CHARACTER\]/i.test(liveMemo);
    const owner = String(s.chatStateProjectionOwner || '').trim();
    const isOwnerMatch = !owner || uniqueIds.some(cid => isSameChatId(cid, owner));

    const trackerEl = typeof document !== 'undefined' ? document.getElementById('rpg-tracker-render') : null;
    const isDomEmpty = trackerEl ? (trackerEl.querySelector('.rt-empty') !== null || !trackerEl.children.length) : false;

    // If liveMemo belongs to this chat, has [CHARACTER], and the DOM is NOT empty, nothing to do
    if (isOwnerMatch && hasCharBlock && !isDomEmpty) {
        return false;
    }

    // If liveMemo belongs to this chat and has [CHARACTER] but DOM IS empty, re-poke and force-render (pure DOM render, no persist)!
    if (isOwnerMatch && hasCharBlock && isDomEmpty) {
        return await forceRenderTrackerView(s, effectiveChatId, liveMemo, { persist: false });
    }

    // If the chat partition itself already has a valid currentMemo with [CHARACTER] (e.g. liveMemo was stale),
    // restore it to the view without fabricating a fresh Session Zero memo!
    for (const cid of uniqueIds) {
        const partMemo = String(s.chatStates?.[cid]?.currentMemo || '').trim();
        if (partMemo && /\[CHARACTER\]/i.test(partMemo)) {
            s.currentMemo = partMemo;
            s.chatStateProjectionOwner = cid;
            return await forceRenderTrackerView(s, cid, partMemo, { persist: false });
        }
    }

    let dossier = null;
    let foundChatId = effectiveChatId;

    // 1. Check candidate partitions for pbtaCampaignDossier (strictly for this chat)
    for (const cid of uniqueIds) {
        if (s.chatStates?.[cid]?.pbtaCampaignDossier) {
            dossier = s.chatStates[cid].pbtaCampaignDossier;
            foundChatId = cid;
            break;
        }
    }

    // 2. Try World Info recovery bound strictly to this chat
    if (!dossier) {
        dossier = await tryRecoverDossierFromWorldInfo(ctx, uniqueIds);
    }

    // If NO dossier exists for this specific chat, do NOT fabricate one or leak from other chats!
    if (!dossier) {
        return false;
    }

    const { formatInitialPbtaMemo } = await import('./pbta-ruleset.js');
    const initialMemo = formatInitialPbtaMemo(dossier);
    if (!initialMemo) return false;

    // Apply to live settings and candidate partitions
    s.currentMemo = initialMemo;
    s.chatStateProjectionOwner = effectiveChatId;
    s.chatStates = s.chatStates || {};
    for (const cid of [effectiveChatId, foundChatId, ...uniqueIds]) {
        if (!cid) continue;
        s.chatStates[cid] = s.chatStates[cid] || {};
        s.chatStates[cid].currentMemo = initialMemo;
        s.chatStates[cid].pbtaCampaignDossier = dossier;
    }

    return await forceRenderTrackerView(s, effectiveChatId, initialMemo, { persist: true });
}

const _lastFaeMemoByChat = new Map();
const _pendingFaeToolResolutionByChat = new Map();

export function getPendingFaeToolResolution(chatId) {
    return _pendingFaeToolResolutionByChat.get(chatId) || null;
}

export function clearPendingFaeToolResolution(chatId) {
    _pendingFaeToolResolutionByChat.delete(chatId);
}

/**
 * Main synchronizer function.
 */
export async function runSync(reason = '') {
    const settings = getSettings();

    if (_isSyncing) return false;
    _isSyncing = true;

    try {
        const chatId = getActiveChatId();
        if (!chatId) return false;

        // First: verify that MultiHog's history loader and projection owner are healthy for this chat.
        // If history persistence is blocked or the projection owner is stuck on a departing chat,
        // quarantine the tracker view and abort all cross-chat sync operations immediately.
        const integrity = await checkTrackerProjectionIntegrity({ chatId });
        if (!integrity.healthy) {
            logRulesetEvent('runSync:quarantined', {
                reason,
                chatId,
                projectionOwner: integrity.projectionOwner,
                rpgRuntimeChatId: integrity.rpgRuntimeChatId,
                persistenceBlocked: integrity.persistenceBlocked,
            });
            renderTrackerQuarantineBanner(integrity);
            return false;
        }

        const isManual = reason === 'manual_button' || reason === 'slash_command';

        // If adventure is unstarted or in onboarding screen, skip runtime persona/portrait/vitality sync
        if (!isManual && !isAdventureActive(chatId)) {
            return false;
        }

        let didWork = false;

        // 0. Ensure active chat ruleset consistency (rehydrates cartridge if MultiHog reset to D&D)
        if (reason !== 'CHAT_CHANGED' && reason !== 'INITIAL_LOAD' && reason !== 'SETTINGS_UPDATED') {
            const rulesetChanged = await ensureActiveChatRulesetConsistency(chatId);
            if (rulesetChanged) didWork = true;
        }

        // 1. Auto-hydrate PbtA game state memo if needed (when not FAE)
        if (!isFaeActive(chatId)) {
            const memoHydrated = await hydratePbtaMemoIfNeeded(chatId);
            if (memoHydrated) didWork = true;
        }

        // 2. Synchronize active ruleset memo vitality / state reconciliation
        const rpgSettings = getRpgSettings();
        if (rpgSettings) {
            if (isFaeActive(chatId)) {
                const rawMemo = rpgSettings.currentMemo || rpgSettings.chatStates?.[chatId]?.currentMemo || '';
                if (rawMemo) {
                    const genreKey = detectActiveFaeGenre({ chatId, rpgSettings, currentMemo: rawMemo });
                    const prevMemo = _lastFaeMemoByChat.get(chatId) || null;
                    let memoToReconcile = rawMemo;
                    if (reason === 'CHARACTER_MESSAGE_RENDERED') {
                        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
                        const lastMsg = ctx?.chat?.[ctx.chat.length - 1];
                        const lastText = lastMsg && !lastMsg.is_user ? (lastMsg.mes || '') : '';
                        if (lastText) {
                            const tempoAdv = advanceFaeTurnTempo(rawMemo, lastText, genreKey);
                            memoToReconcile = tempoAdv.memo;
                        }
                    }
                    const pendingTool = _pendingFaeToolResolutionByChat.get(chatId) || null;
                    const reconciled = reconcileFaeMemoAfterTurn(prevMemo, memoToReconcile, genreKey, pendingTool?.state || null);
                    if (reconciled.changed) {
                        rpgSettings.currentMemo = reconciled.memo;
                        if (rpgSettings.chatStates?.[chatId]) {
                            rpgSettings.chatStates[chatId].currentMemo = reconciled.memo;
                        }
                        didWork = true;
                        saveSettingsDebounced();
                        try {
                            const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
                            if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
                        } catch (_) {}
                    }
                    _lastFaeMemoByChat.set(chatId, rpgSettings.currentMemo || memoToReconcile);
                    if (reason === 'SETTINGS_UPDATED' && pendingTool) {
                        _pendingFaeToolResolutionByChat.delete(chatId);
                    }
                }
            } else {
                const vitalityUpdated = syncLivePbtaMemoVitality(rpgSettings, chatId);
                if (vitalityUpdated) {
                    didWork = true;
                    try {
                        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
                        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
                    } catch (_) {}
                }
            }
        }

        if (!settings.enablePersonaSync && !settings.enablePortraitSync) return didWork;

        const charName = getMultihogPlayerName(chatId);
        if (!charName) return didWork;

        let persona = await findMatchingPersona(charName);
        const personaMatched = !!persona;

        if (!persona && settings.enablePortraitSync) {
            const ctx = SillyTavern.getContext();
            let powerUser = ctx.powerUser || ctx.power_user || (typeof window !== 'undefined' ? window.power_user : null);
            if (!powerUser) {
                try {
                    const pu = await import('../../../power-user.js');
                    powerUser = pu.power_user;
                } catch (_) {}
            }
            const activeAvatar = ctx.chatMetadata?.persona || ctx.user_avatar;
            if (activeAvatar) {
                const activeName = (powerUser?.personas && powerUser.personas[activeAvatar]) || charName;
                persona = { avatar: activeAvatar, name: activeName };
            }
        }

        if (!persona) return didWork;

        if (settings.enablePersonaSync && personaMatched) {
            const personaChanged = await syncPersonaToChat(chatId, persona);
            if (personaChanged) didWork = true;
        }

        if (settings.enablePortraitSync) {
            const portraitSrc = getMultihogPlayerPortrait(chatId, charName);
            if (portraitSrc) {
                const isManual = reason === 'manual_button' || reason === 'slash_command';
                const portraitChanged = await syncPortraitToPersona(chatId, persona, portraitSrc, { force: isManual });
                if (portraitChanged) didWork = true;
            }
        }

        return didWork;
    } catch (err) {
        console.error('[MultiHog Companion] Error during sync:', err);
        return false;
    } finally {
        _isSyncing = false;
    }
}

function scheduleSync(reason = '', delay = 350) {
    if (_syncDebounceTimer) clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(() => {
        _syncDebounceTimer = null;
        runSync(reason);
    }, delay);
}


/**
 * Applies the PbtA Game Cartridge to MultiHog settings, optionally accepting dynamic overrides.
 * @param {string} genreKey
 * @param {object} [overrides={}]
 * @returns {Promise<boolean>}
 */
export async function applyPbtACartridge(genreKey = 'fantasy', overrides = {}) {
    const ctx = SillyTavern.getContext();
    const s = ctx.extensionSettings?.rpg_tracker;
    if (!s) {
        showToast('error', 'Multihog D&D Framework not detected.', 'MultiHog Companion');
        return false;
    }

    const cartridge = buildPbtACartridge(genreKey, overrides);
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;

    // 1. Ensure cartridge exists in MultiHog's cartridge database
    if (!s.gameCartridges) s.gameCartridges = [];
    const idx = s.gameCartridges.findIndex(c => c.id === cartridge.id);
    if (idx >= 0) {
        s.gameCartridges[idx] = cartridge;
    } else {
        s.gameCartridges.push(cartridge);
    }

    // 2. Install unlocked base overrides into customSyspromptLibrary
    if (!s.customSyspromptLibrary) s.customSyspromptLibrary = [];
    s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !p.id.startsWith('pbta_') && !p.id.startsWith('fae_'));
    const pbtaSnippets = cartridge.payload.customSyspromptLibrary.map(item => ({
        ...item,
        enabled: true,
        scope: 'chat',
        _chatSetupMember: true,
    }));
    s.customSyspromptLibrary.push(...pbtaSnippets);

    // 2b. Synchronize MultiHog's global snippet catalog
    if (!s.syspromptSnippetDatabase) s.syspromptSnippetDatabase = [];
    for (const sn of pbtaSnippets) {
        const catIdx = s.syspromptSnippetDatabase.findIndex(p => p.id === sn.id);
        if (catIdx >= 0) s.syspromptSnippetDatabase[catIdx] = { ...sn };
        else s.syspromptSnippetDatabase.push({ ...sn });
    }

    // 3. Update sysprompt modules (deactivate base sections replaced by overrides or not used)
    s.syspromptModules = s.syspromptModules || {};
    Object.assign(s.syspromptModules, cartridge.payload.syspromptModules);

    // 4. Update stock prompts (character, party, combat)
    s.stockPrompts = s.stockPrompts || {};
    Object.assign(s.stockPrompts, cartridge.payload.stockPrompts);
    sanitizeCharacterStockPrompt(s.stockPrompts, overrides?.charName || overrides?.character?.name || '');

    // 4b. Update CYOA config if defined in cartridge payload
    if (cartridge.payload.cyoaConfig) {
        s.cyoaConfig = s.cyoaConfig || {};
        Object.assign(s.cyoaConfig, cartridge.payload.cyoaConfig);
    }

    // 5. Update RNG settings
    const useToolMode = Boolean(overrides.diceFunctionTool ?? overrides.config?.diceFunctionTool ?? s.diceFunctionTool ?? false);
    s.rngEnabled = true;
    s.rngQueueD20 = true;
    s.rngQueueD100 = false;
    s.diceFunctionTool = useToolMode;
    s.rngToolD20 = false;
    s.rngToolD100 = false;
    s.diceD100Mode = false;

    // 6. Update block order
    s.blockOrder = [...cartridge.payload.blockOrder];
    if (s.modules) {
        Object.assign(s.modules, cartridge.payload.modules);
    }

    // 7. Save settings
    saveSettingsDebounced();

    // 7b. Persist PbtA setup snapshot so MultiHog's Chat Setup Link & F5 reloads preserve PbtA
    const activeChatId = getActiveChatId();
    if (activeChatId) {
        await persistPbtaChatState(activeChatId);
    }

    // 8. Re-apply sysprompt via MultiHog runtime bridge
    await refreshMultihogRuntime();
    syncCompanionDiceFunctionTools();

    // Persist active genre in Companion settings
    const compSettings = getSettings();
    compSettings.lastGenre = genreKey;
    saveSettingsDebounced();

    const activeLabel = overrides.systemLabel || overrides.name || genre.label;
    const activeDossierSnapshot = overrides.dossier || s.chatStates?.[activeChatId]?.pbtaCampaignDossier || null;
    if (activeChatId) {
        await setCompanionActiveCartridge(activeChatId, {
            cartridgeId: 'pbta',
            genre: genreKey,
            systemLabel: activeLabel,
            title: overrides.campaignTitle || overrides.name || null,
            ...(activeDossierSnapshot ? { dossier: JSON.parse(JSON.stringify(activeDossierSnapshot)) } : {}),
        });
    }
    logRulesetEvent('applyPbtACartridge', {
        genreKey,
        activeChatId,
        hasOverrides: Object.keys(overrides || {}).length > 0,
    });
    showToast('success', `PbtA ruleset (${activeLabel}) applied to this chat! 🎲`, 'PbtA Engine Active');
    updateRulesetBadge();
    return true;
}

/**
 * Applies the Freeform Attrition Engine (FAE) Game Cartridge to MultiHog settings.
 * @param {string} genreKey
 * @param {object} [overrides={}]
 * @returns {Promise<boolean>}
 */
export async function applyFaeCartridge(genreKey = 'cosmic_horror', overrides = {}) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const s = ctx?.extensionSettings?.rpg_tracker
        || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : (globalThis.extension_settings?.rpg_tracker || null));
    if (!s) {
        showToast('error', 'Multihog D&D Framework not detected.', 'MultiHog Companion');
        return false;
    }

    const cartridge = buildFaeCartridge(genreKey, overrides);
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;

    // 1. Ensure cartridge exists in MultiHog's cartridge database
    if (!s.gameCartridges) s.gameCartridges = [];
    const idx = s.gameCartridges.findIndex(c => c.id === cartridge.id);
    if (idx >= 0) {
        s.gameCartridges[idx] = cartridge;
    } else {
        s.gameCartridges.push(cartridge);
    }

    // 2. Install unlocked base overrides into customSyspromptLibrary
    if (!s.customSyspromptLibrary) s.customSyspromptLibrary = [];
    s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !p.id.startsWith('pbta_') && !p.id.startsWith('fae_'));
    const faeSnippets = cartridge.payload.customSyspromptLibrary.map(item => ({
        ...item,
        enabled: true,
        scope: 'chat',
        _chatSetupMember: true,
    }));
    s.customSyspromptLibrary.push(...faeSnippets);

    // 2b. Synchronize MultiHog's global snippet catalog
    if (!s.syspromptSnippetDatabase) s.syspromptSnippetDatabase = [];
    for (const sn of faeSnippets) {
        const catIdx = s.syspromptSnippetDatabase.findIndex(p => p.id === sn.id);
        if (catIdx >= 0) s.syspromptSnippetDatabase[catIdx] = { ...sn };
        else s.syspromptSnippetDatabase.push({ ...sn });
    }

    // 3. Update sysprompt modules (deactivate base sections replaced by overrides or not used)
    s.syspromptModules = s.syspromptModules || {};
    Object.assign(s.syspromptModules, cartridge.payload.syspromptModules);

    // 4. Update stock prompts (character, party, combat)
    s.stockPrompts = s.stockPrompts || {};
    Object.assign(s.stockPrompts, cartridge.payload.stockPrompts);
    sanitizeCharacterStockPrompt(s.stockPrompts, overrides?.charName || overrides?.character?.name || '');

    // 4b. Update CYOA config if defined in cartridge payload
    if (cartridge.payload.cyoaConfig) {
        s.cyoaConfig = s.cyoaConfig || {};
        Object.assign(s.cyoaConfig, cartridge.payload.cyoaConfig);
    }

    // 5. Update RNG settings
    const useToolMode = Boolean(overrides.diceFunctionTool ?? overrides.config?.diceFunctionTool ?? s.diceFunctionTool ?? false);
    s.rngEnabled = true;
    s.rngQueueD20 = true;
    s.rngQueueD100 = false;
    s.diceFunctionTool = useToolMode;
    s.rngToolD20 = false;
    s.rngToolD100 = false;
    s.diceD100Mode = false;

    // 6. Update block order
    s.blockOrder = [...cartridge.payload.blockOrder];
    if (s.modules) {
        Object.assign(s.modules, cartridge.payload.modules);
    }

    // 7. Persist active genre in Companion settings and active cartridge record first
    const compSettings = getSettings();
    compSettings.lastFaeGenre = genreKey;
    const activeChatId = getActiveChatId();
    const activeLabel = overrides.systemLabel || overrides.name || genre.label;
    const activeDossierSnapshot = overrides.dossier || s.chatStates?.[activeChatId]?.faeCampaignDossier || s.chatStates?.[activeChatId]?.pbtaCampaignDossier || null;
    if (activeChatId) {
        await setCompanionActiveCartridge(activeChatId, {
            cartridgeId: 'fae',
            genre: genreKey,
            systemLabel: activeLabel,
            title: overrides.campaignTitle || overrides.name || null,
            ...(activeDossierSnapshot ? { dossier: JSON.parse(JSON.stringify(activeDossierSnapshot)) } : {}),
        });
    }
    saveSettingsDebounced();

    // 7b. Persist FAE setup snapshot so MultiHog's Chat Setup Link & F5 reloads preserve FAE
    if (activeChatId) {
        await persistPbtaChatState(activeChatId);
    }

    // 8. Re-apply sysprompt via MultiHog runtime bridge
    await refreshMultihogRuntime();
    syncCompanionDiceFunctionTools();
    logRulesetEvent('applyFaeCartridge', {
        genreKey,
        activeChatId,
        hasOverrides: Object.keys(overrides || {}).length > 0,
    });
    showToast('success', `🕯️ FAE ruleset (${activeLabel}) applied to this chat!`, 'FAE Engine Active');
    updateRulesetBadge();
    return true;
}

/**
 * Restores MultiHog to factory D&D 5e settings.
 * Pulls actual factory defaults from MultiHog's defaults.js when available;
 * falls back to hardcoded values if the import fails (e.g. folder renamed).
 * @returns {Promise<boolean>}
 */
export async function restoreStockDnd() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const s = ctx?.extensionSettings?.rpg_tracker
        || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : (globalThis.extension_settings?.rpg_tracker || null));
    if (!s) return false;

    const activeChatId = getActiveChatId();
    await cleanseStockDndSettings(s, { chatId: activeChatId, syncSetup: true });

    if (activeChatId && s.chatStates?.[activeChatId]) {
        delete s.chatStates[activeChatId].pbtaCampaignDossier;
        delete s.chatStates[activeChatId].faeCampaignDossier;
    }

    if (activeChatId) {
        await setCompanionActiveCartridge(activeChatId, {
            cartridgeId: 'dnd5e',
        });
    }

    logRulesetEvent('restoreStockDnd', {
        activeChatId,
    });
    showToast('info', 'Restored this chat to factory D&D 5e ruleset. 📦', 'Ruleset Restored');
    updateRulesetBadge();
    return true;
}

/**
 * Rectifies corrupted character headers, player character state, and SillyTavern persona names
 * following an upstream quick start generation pass.
 * @param {string} [fallbackCharName='']
 * @param {object|null} [providedSettings=null]
 * @returns {Promise<string>} Clean character name
 */
export async function rectifyPostQuickStartState(fallbackCharName = '', providedSettings = null) {
    let rpgSettings = providedSettings;
    if (!rpgSettings) {
        if (typeof globalThis._rpgSettings !== 'undefined') {
            rpgSettings = globalThis._rpgSettings;
        } else {
            try {
                const sm = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
                rpgSettings = sm?.getSettings?.();
            } catch (_) {}
        }
    }
    if (!rpgSettings) {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        rpgSettings = ctx?.extensionSettings?.rpg_tracker;
    }

    const cleanFallback = stripMarkdownNameArtifacts(fallbackCharName);
    const isFallbackValid = isValidCharacterName(cleanFallback);

    let memoName = rpgSettings?.currentMemo ? extractNameFromMemo(rpgSettings.currentMemo) : null;
    if (memoName && !isValidCharacterName(memoName)) {
        memoName = null;
    }

    // If the user explicitly provided a valid fallback name (e.g. "Lou"), it is authoritative!
    const cleanName = isFallbackValid ? cleanFallback : (memoName || cleanFallback);

    if (rpgSettings?.currentMemo) {
        if (isFallbackValid) {
            if (!memoName || memoName !== cleanFallback) {
                rpgSettings.currentMemo = rectifyMemoCharacterName(rpgSettings.currentMemo, cleanFallback);
                if (memoName && memoName !== cleanFallback) {
                    rpgSettings.currentMemo = rpgSettings.currentMemo.replace(
                        new RegExp(`(\\[CHARACTER\\][\\s\\S]*?)\\b${memoName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(\\s*[\\(:])`, 'i'),
                        `$1${cleanFallback}$2`
                    );
                }
            } else {
                rpgSettings.currentMemo = sanitizeCharacterHeaderInMemo(rpgSettings.currentMemo, cleanFallback);
            }
        } else {
            rpgSettings.currentMemo = sanitizeCharacterHeaderInMemo(rpgSettings.currentMemo);
        }
        if (isFaeActive()) {
            rpgSettings.currentMemo = stripFaePartyBlockFromMemo(rpgSettings.currentMemo);
        }
    }

    if (cleanName) {
        if (rpgSettings?.playerCharacter) {
            if (rpgSettings.playerCharacter.name !== cleanName) {
                rpgSettings.playerCharacter.name = cleanName;
            }
            if (typeof rpgSettings.playerCharacter.bio === 'string' && rpgSettings.playerCharacter.bio) {
                let bio = rpgSettings.playerCharacter.bio;
                const bioName = extractNameFromBio(bio);
                if (bioName && bioName !== cleanName && (!isValidCharacterName(bioName) || (isFallbackValid && cleanFallback === cleanName))) {
                    bio = bio.replaceAll(bioName, cleanName);
                }
                bio = bio.replace(/\{\{user\}\}|\{user\}/gi, cleanName);
                rpgSettings.playerCharacter.bio = bio;
            }
        }

        const candidateIds = getCandidateChatIds();
        if (rpgSettings?.chatStates && candidateIds.length > 0) {
            for (const cid of candidateIds) {
                const cs = rpgSettings.chatStates[cid];
                if (cs) {
                    if (cs.playerCharacter) {
                        if (cs.playerCharacter.name !== cleanName) {
                            cs.playerCharacter.name = cleanName;
                        }
                        if (typeof cs.playerCharacter.bio === 'string' && cs.playerCharacter.bio) {
                            let bio = cs.playerCharacter.bio;
                            const bioName = extractNameFromBio(bio);
                            if (bioName && bioName !== cleanName && (!isValidCharacterName(bioName) || (isFallbackValid && cleanFallback === cleanName))) {
                                bio = bio.replaceAll(bioName, cleanName);
                            }
                            bio = bio.replace(/\{\{user\}\}|\{user\}/gi, cleanName);
                            cs.playerCharacter.bio = bio;
                        }
                    }
                    if (cs.currentMemo) {
                        if (isFallbackValid) {
                            const csMemoName = extractNameFromMemo(cs.currentMemo);
                            if (!csMemoName || csMemoName !== cleanFallback) {
                                cs.currentMemo = rectifyMemoCharacterName(cs.currentMemo, cleanFallback);
                                if (csMemoName && csMemoName !== cleanFallback) {
                                    cs.currentMemo = cs.currentMemo.replace(
                                        new RegExp(`(\\[CHARACTER\\][\\s\\S]*?)\\b${csMemoName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(\\s*[\\(:])`, 'i'),
                                        `$1${cleanFallback}$2`
                                    );
                                }
                            } else {
                                cs.currentMemo = sanitizeCharacterHeaderInMemo(cs.currentMemo, cleanFallback);
                            }
                        } else {
                            cs.currentMemo = sanitizeCharacterHeaderInMemo(cs.currentMemo, cleanName);
                        }
                        if (isFaeActive(cid)) {
                            cs.currentMemo = stripFaePartyBlockFromMemo(cs.currentMemo);
                        }
                    }
                }
            }
        }

        // SillyTavern context and power_user sync
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        let powerUser = ctx?.powerUser || ctx?.power_user || (typeof window !== 'undefined' ? window.power_user : null);
        if (!powerUser) {
            try {
                const pu = await import('../../../power-user.js');
                powerUser = pu.power_user;
            } catch (_) {}
        }

        if (powerUser?.personas && typeof powerUser.personas === 'object') {
            for (const [avatarKey, personaVal] of Object.entries(powerUser.personas)) {
                if (typeof personaVal === 'string') {
                    const hasArtifacts = (personaVal.startsWith('*') || personaVal.endsWith('*') || /[*`]/.test(personaVal)) && stripMarkdownNameArtifacts(personaVal) === cleanName;
                    const isInvalid = !isValidCharacterName(personaVal);
                    if (hasArtifacts || isInvalid) {
                        powerUser.personas[avatarKey] = cleanName;
                        if (powerUser.persona_descriptions && powerUser.persona_descriptions[personaVal]) {
                            powerUser.persona_descriptions[cleanName] = powerUser.persona_descriptions[personaVal];
                        }
                    }
                }
            }
        }

        let personaNeedsActivation = false;

        if (ctx && typeof ctx.name1 === 'string') {
            const hasArtifacts = stripMarkdownNameArtifacts(ctx.name1) === cleanName;
            const isInvalid = !isValidCharacterName(ctx.name1);
            if ((hasArtifacts || isInvalid) && ctx.name1 !== cleanName) {
                ctx.name1 = cleanName;
                personaNeedsActivation = true;
            }
        }

        if (powerUser && typeof powerUser.default_persona === 'string') {
            const hasArtifacts = stripMarkdownNameArtifacts(powerUser.default_persona) === cleanName;
            const isInvalid = !isValidCharacterName(powerUser.default_persona);
            if ((hasArtifacts || isInvalid) && powerUser.default_persona !== cleanName) {
                powerUser.default_persona = cleanName;
                personaNeedsActivation = true;
            }
        }

        if (typeof document !== 'undefined') {
            const yourNameInput = /** @type {HTMLInputElement|null} */ (document.getElementById('your_name'));
            if (yourNameInput) {
                const hasArtifacts = stripMarkdownNameArtifacts(yourNameInput.value) === cleanName;
                const isInvalid = !isValidCharacterName(yourNameInput.value);
                if ((hasArtifacts || isInvalid) && yourNameInput.value !== cleanName) {
                    yourNameInput.value = cleanName;
                    yourNameInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }

        // If persona was invalid or not set to cleanName, re-activate persona in SillyTavern
        if (personaNeedsActivation || (ctx && ctx.name1 !== cleanName)) {
            try {
                const cc = await import('../SillyTavern-MultihogDnDFramework/character-creator.js');
                if (typeof cc?.activateSillyTavernPersona === 'function') {
                    await cc.activateSillyTavernPersona(cleanName);
                }
            } catch (_) {}
        }
    }

    return cleanName;
}

/**
 * Triggers Quick Start for a PbtA adventure.
 * @param {string} genreKey
 * @param {string} charName
 * @returns {Promise<void>}
 */
export async function quickStartPbtA(genreKey = 'fantasy', charName = '', scenarioDesc = '') {
    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;
    const cleanCharName = (charName || '').trim();

    // ── 0. Ensure Clean Chat & Auto-Rename ──────────────────────────────────
    try {
        const { ensureCleanAdventureChat } = await import('./adventure-chat.js');
        const defaultTitle = cleanCharName
            ? `${cleanCharName} - PbtA ${genre.label}`
            : `PbtA ${genre.label} Adventure`;
        await ensureCleanAdventureChat({
            adventureTitle: defaultTitle,
            fallbackLabel: `PbtA ${genre.label} Adventure`,
        });
    } catch (chatErr) {
        console.warn('[MultiHog Companion] Auto-chat preparation failed, proceeding:', chatErr);
    }

    const ok = await applyPbtACartridge(genreKey, { charName: cleanCharName });
    if (!ok) return;

    const instructions = buildPbtAQuickStartInstructions(genreKey, cleanCharName, scenarioDesc);

    try {
        const qs = await import('../SillyTavern-MultihogDnDFramework/quickstart.js');
        if (typeof qs.runQuickStart === 'function') {
            showToast('info', `Starting ${genre.label} adventure...`, 'Quick Start');

            // Temporarily suppress upstream's starter message so upstream does not dump
            // the mechanical instruction block into chat as a user message, and set onboardingLevel
            // to 'none' so upstream does not generate D&D levels or [XP] blocks.
            let originalSendStarter = true;
            let originalLevel = null;
            let rpgSettings = null;
            try {
                const sm = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
                rpgSettings = sm?.getSettings?.();
                if (rpgSettings) {
                    originalSendStarter = rpgSettings.onboardingSendStarterMessage;
                    rpgSettings.onboardingSendStarterMessage = false;
                    originalLevel = rpgSettings.onboardingLevel;
                    rpgSettings.onboardingLevel = 'none';
                }
            } catch (_) {}

            try {
                if (rpgSettings?.stockPrompts) {
                    sanitizeCharacterStockPrompt(rpgSettings.stockPrompts, cleanCharName);
                }
                await qs.runQuickStart(genre.multihogGenre, null, cleanCharName, instructions);
            } finally {
                if (rpgSettings) {
                    rpgSettings.onboardingSendStarterMessage = originalSendStarter;
                    if (originalLevel !== null) {
                        rpgSettings.onboardingLevel = originalLevel;
                    }
                }
            }

            await rectifyPostQuickStartState(cleanCharName || charName, rpgSettings);

            // Send clean narrative opening message
            const starterText = scenarioDesc
                ? `Begin the adventure.\n\n${scenarioDesc}`
                : 'Begin the adventure.';
            const textarea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('send_textarea'));
            const sendBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('send_but'));
            if (textarea && sendBtn) {
                textarea.value = starterText;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                sendBtn.click();
            }
        } else {
            showToast('warning', 'Quick Start function not available. PbtA ruleset is active — type your first message!', 'MultiHog Companion');
        }
    } catch (err) {
        console.error('[MultiHog Companion] Quick Start failed:', err);
        showToast('error', `Quick Start failed: ${err.message}`, 'MultiHog Companion');
    }
}

/**
 * Triggers Quick Start for a Freeform Attrition Engine (FAE) adventure.
 * @param {string} genreKey
 * @param {string} charName
 * @param {string} scenarioDesc
 * @param {object|null} [customKnobs=null]
 * @returns {Promise<void>}
 */
export async function quickStartFae(genreKey = 'cosmic_horror', charName = '', scenarioDesc = '', customKnobs = null) {
    const genre = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;
    const cleanCharName = (charName || '').trim();

    // ── 0. Ensure Clean Chat & Auto-Rename ──────────────────────────────────
    try {
        const { ensureCleanAdventureChat } = await import('./adventure-chat.js');
        const defaultTitle = cleanCharName
            ? `${cleanCharName} - FAE ${genre.label}`
            : `FAE ${genre.label} Adventure`;
        await ensureCleanAdventureChat({
            adventureTitle: defaultTitle,
            fallbackLabel: `FAE ${genre.label} Adventure`,
        });
    } catch (chatErr) {
        console.warn('[MultiHog Companion] Auto-chat preparation failed, proceeding:', chatErr);
    }

    const ok = await applyFaeCartridge(genreKey, {
        charName: cleanCharName,
        ...(customKnobs ? { knobs: customKnobs } : {}),
    });
    if (!ok) return;

    const instructions = buildFaeQuickStartInstructions(genreKey, cleanCharName, scenarioDesc, customKnobs);

    try {
        const qs = await import('../SillyTavern-MultihogDnDFramework/quickstart.js');
        if (typeof qs.runQuickStart === 'function') {
            showToast('info', `Starting ${genre.label} adventure...`, 'Quick Start');

            // Temporarily suppress upstream's starter message so upstream does not dump
            // the mechanical instruction block into chat as a user message, and set onboardingLevel
            // to 'none' so upstream does not generate D&D levels or [XP] blocks.
            let originalSendStarter = true;
            let originalLevel = null;
            let rpgSettings = null;
            try {
                const sm = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
                rpgSettings = sm?.getSettings?.();
                if (rpgSettings) {
                    originalSendStarter = rpgSettings.onboardingSendStarterMessage;
                    rpgSettings.onboardingSendStarterMessage = false;
                    originalLevel = rpgSettings.onboardingLevel;
                    rpgSettings.onboardingLevel = 'none';
                }
            } catch (_) {}

            try {
                if (rpgSettings?.stockPrompts) {
                    sanitizeCharacterStockPrompt(rpgSettings.stockPrompts, cleanCharName);
                }
                await qs.runQuickStart(genre.multihogGenre, null, cleanCharName, instructions);
            } finally {
                if (rpgSettings) {
                    rpgSettings.onboardingSendStarterMessage = originalSendStarter;
                    if (originalLevel !== null) {
                        rpgSettings.onboardingLevel = originalLevel;
                    }
                }
            }

            await rectifyPostQuickStartState(cleanCharName || charName, rpgSettings);

            // Send clean narrative opening message
            const starterText = scenarioDesc
                ? `Begin the adventure.\n\n${scenarioDesc}`
                : 'Begin the adventure.';
            const textarea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('send_textarea'));
            const sendBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('send_but'));
            if (textarea && sendBtn) {
                textarea.value = starterText;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                sendBtn.click();
            }
        } else {
            showToast('warning', 'Quick Start function not available. FAE ruleset is active — type your first message!', 'MultiHog Companion');
        }
    } catch (err) {
        console.error('[MultiHog Companion] Quick Start failed:', err);
        showToast('error', `Quick Start failed: ${err.message}`, 'MultiHog Companion');
    }
}

/**
 * Setup interceptor for SillyTavern's /imagine slash command to dynamically inject
 * optimized aspect ratios for MultiHog scene and portrait generation.
 */
export function setupImagineInterceptor() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const parser = ctx?.SlashCommandParser || SlashCommandParser;
    const imagineCmd = parser?.commands?.['imagine'];

    if (imagineCmd && typeof imagineCmd.callback === 'function') {
        if (imagineCmd._mhcIntercepted) return;

        // [CATALOG: ADR-MP-02] See MONKEYPATCHES.md — /imagine Slash Command Callback Wrapping
        wrapImagineCommand(imagineCmd, getSettings, ctx);

        imagineCmd._mhcIntercepted = true;
        console.log('[MultiHog Companion] Smart Aspect-Ratio & Crop Bridge: /imagine interceptor registered.');
    }
}

/**
 * Choose a random character name appropriate for a genre.
 * Dynamically imports MultiHog's name generator if available.
 * @param {string} genre
 * @returns {Promise<string>}
 */
async function getRandomCharacterName(genre = 'fantasy') {
    const s = getSettings();
    if (s.enableNameRag !== false && s.nameRagEnhanceMultiHog !== false) {
        try {
            const candidate = await rollNameRagCandidate(genre);
            if (candidate?.name) return candidate.name;
        } catch (_) {}
    }
    try {
        const mod = await import('../SillyTavern-MultihogDnDFramework/src/state/character-names.js');
        if (typeof mod?.pickGenreCharacterName === 'function') {
            return mod.pickGenreCharacterName(genre);
        }
    } catch (e) {
        console.warn('[MultiHog Companion] Could not import pickGenreCharacterName, using fallback:', e);
    }
    const fallbackNames = ['Rowan Vance', 'Lyra Thorne', 'Kaelen Drake', 'Mara Jade', 'Silas Croft'];
    return fallbackNames[Math.floor(Math.random() * fallbackNames.length)];
}

/**
 * Refreshes the Campaign Lorebook Sync section in the settings drawer.
 */
export async function updateLorebookSyncUI() {
    try {
        const status = await getCampaignLorebookStatus();
        const s = getSettings();

        const badge = $('#mhc_lorebook_prefix_badge');
        const chatDisplay = $('#mhc_lorebook_chat_display');
        const targetPrefixDisplay = $('#mhc_lorebook_target_prefix');
        const currentPrefixDisplay = $('#mhc_lorebook_current_prefix');
        const detectedCountDisplay = $('#mhc_lorebook_detected_count');

        if (!s.enableLorebookSync) {
            badge.text('Disabled').attr('title', 'Lorebook Auto-Sync is disabled').css({
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.4)',
                borderColor: 'rgba(255,255,255,0.1)',
            });
        } else if (status.inSync) {
            const prefix = status.targetPrefix || '—';
            badge.text(`Prefix: ${prefix}`).attr('title', `Campaign Prefix: ${prefix}`).css({
                background: 'rgba(80,180,120,0.2)',
                color: '#88ffbb',
                borderColor: 'rgba(80,180,120,0.35)',
            });
        } else {
            const shortOld = status.currentPrefix
                ? (status.currentPrefix.length > 14 ? status.currentPrefix.slice(0, 14) + '…' : status.currentPrefix)
                : 'none';
            badge.text(`⚠️ Out of Sync (${shortOld})`).attr('title', `Out of Sync — Current: ${status.currentPrefix || 'none'}, Target: ${status.targetPrefix || 'none'}`).css({
                background: 'rgba(255,180,60,0.2)',
                color: '#ffcc88',
                borderColor: 'rgba(255,180,60,0.4)',
            });
        }

        if (chatDisplay.length) {
            chatDisplay.text(status.chatTitle || '(none)').attr('title', status.chatTitle || '(none)');
        }
        if (targetPrefixDisplay.length) {
            targetPrefixDisplay.text(status.targetPrefix || '—').attr('title', status.targetPrefix || '—');
        }
        if (currentPrefixDisplay.length) {
            currentPrefixDisplay.text(status.currentPrefix || '—').attr('title', status.currentPrefix || '—');
        }
        if (detectedCountDisplay.length) {
            detectedCountDisplay.text(`${status.matchingBooks.length} book(s) found`);
        }
    } catch (err) {
        console.warn('[MultiHog Companion] Could not update lorebook sync UI:', err);
    }
}

/**
 * Update the status badge and live NPC list in the Relationship Narrative Sync section.
 */
export function updateRelationshipSyncUI() {
    try {
        const status = getRelationshipSyncStatus();
        const badge = $('#mhc_rel_sync_badge');
        const mhStatus = $('#mhc_multihog_rel_status');
        const countLabel = $('#mhc_rel_sync_count');
        const listEl = $('#mhc_rel_sync_list');

        if (!status.barsEnabled) {
            mhStatus.html('<span style="color: #ff8888;">○ Disabled in MultiHog</span>');
            badge.text('MultiHog Bars Off').css({
                background: 'rgba(150,150,150,0.2)',
                color: '#aaa',
                borderColor: 'rgba(255,255,255,0.15)',
            });
        } else {
            mhStatus.html('<span style="color: #88ffbb;">● Active in MultiHog</span>');
            if (status.syncEnabled) {
                badge.text(`🟢 Sync: Active (${status.trackedCount})`).css({
                    background: 'rgba(80,180,120,0.2)',
                    color: '#88ffbb',
                    borderColor: 'rgba(80,180,120,0.35)',
                });
            } else {
                badge.text('⏸️ Sync: Paused').css({
                    background: 'rgba(255,180,60,0.2)',
                    color: '#ffcc88',
                    borderColor: 'rgba(255,180,60,0.4)',
                });
            }
        }

        countLabel.text(`${status.trackedCount} NPC${status.trackedCount === 1 ? '' : 's'}`);

        if (status.items.length === 0) {
            listEl.html('<span style="opacity: 0.6;">(No tracked NPCs in active chat)</span>');
        } else {
            const escapeHtml = (str) => String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
            const html = status.items.map(item => {
                const name = item.uid || item.fullId.split('::')[1] || item.fullId;
                const fSign = item.friendship >= 0 ? '+' : '';
                const aSign = item.affection >= 0 ? '+' : '';
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                        <span style="font-weight: bold; color: #88ccff;">${escapeHtml(name)}</span>
                        <div style="display: flex; gap: 8px; font-size: 0.9em;">
                            <span style="color: #4ade80;" title="Friendship: ${escapeHtml(item.friendshipTier)}">🤝 ${fSign}${item.friendship} <span style="opacity: 0.7; font-size: 0.85em;">(${escapeHtml(item.friendshipTier)})</span></span>
                            <span style="color: #f472b6;" title="Affection: ${escapeHtml(item.affectionTier)}">💗 ${aSign}${item.affection} <span style="opacity: 0.7; font-size: 0.85em;">(${escapeHtml(item.affectionTier)})</span></span>
                        </div>
                    </div>
                `;
            }).join('');
            listEl.html(html);
        }
    } catch (_) {}
}

/**
 * Update the status badge in the sync section header.
 */
function updateSyncBadge() {
    const badge = $('#mhc_sync_badge');
    if (!badge.length) return;

    const personaOn = $('#mhc_persona_sync').is(':checked');
    const portraitOn = $('#mhc_portrait_sync').is(':checked');

    if (personaOn && portraitOn) {
        badge.text('Persona & Portrait: ON');
        badge.css({
            background: 'rgba(80,180,120,0.2)',
            color: '#88ffbb',
            borderColor: 'rgba(80,180,120,0.35)',
        });
    } else if (personaOn) {
        badge.text('Persona only');
        badge.css({
            background: 'rgba(90,160,250,0.2)',
            color: '#88ccff',
            borderColor: 'rgba(90,160,250,0.35)',
        });
    } else if (portraitOn) {
        badge.text('Portrait only');
        badge.css({
            background: 'rgba(90,160,250,0.2)',
            color: '#88ccff',
            borderColor: 'rgba(90,160,250,0.35)',
        });
    } else {
        badge.text('Disabled');
        badge.css({
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.45)',
            borderColor: 'rgba(255,255,255,0.1)',
        });
    }
}

/**
 * Initialize extension settings UI and bind events.
 */
async function initUI() {
    try {
        const settingsHtml = await $.get(`${EXTENSION_FOLDER}/settings.html`);
        $('#extensions_settings').append(settingsHtml);

        // ── Settings Sub-Tabs Navigation (strictly scoped to Settings panel) ──
        function setActiveTab(tabId) {
            const settingsRoot = $('#extensions_settings');
            const tabBar = settingsRoot.find('.mhc-tab-bar');
            tabBar.find('.mhc-tab-btn').removeClass('active');
            tabBar.find(`.mhc-tab-btn[data-tab="${tabId}"]`).addClass('active');
            settingsRoot.find('.multihog-companion-settings > .mhc-tab-content, #mhc_tab_ruleset, #mhc_tab_story, #mhc_tab_media').removeClass('active').hide();
            settingsRoot.find(`#mhc_tab_${tabId}`).addClass('active').show();
            try {
                localStorage.setItem('mhc_active_tab', tabId);
            } catch (_) {}
        }

        $('#extensions_settings').on('click', '.mhc-tab-bar .mhc-tab-btn', function (e) {
            e.preventDefault();
            const tabId = $(this).data('tab');
            if (tabId) setActiveTab(tabId);
        });

        let savedTab = 'ruleset';
        try {
            savedTab = localStorage.getItem('mhc_active_tab') || 'ruleset';
        } catch (_) {}
        if ($(`#mhc_tab_${savedTab}`).length) {
            setActiveTab(savedTab);
        } else {
            setActiveTab('ruleset');
        }

        const personaCb = $('#mhc_persona_sync');
        const portraitCb = $('#mhc_portrait_sync');
        const toastCb = $('#mhc_show_toasts');
        const syncBtn = $('#mhc_sync_now');
        const statusSpan = $('#mhc_status');

        const current = getSettings();
        personaCb.prop('checked', current.enablePersonaSync);
        portraitCb.prop('checked', current.enablePortraitSync);
        toastCb.prop('checked', current.showToasts);
        updateSyncBadge();

        personaCb.on('change', function () {
            updateSettings({ enablePersonaSync: $(this).is(':checked') });
            updateSyncBadge();
        });

        portraitCb.on('change', function () {
            updateSettings({ enablePortraitSync: $(this).is(':checked') });
            updateSyncBadge();
        });

        toastCb.on('change', function () {
            updateSettings({ showToasts: $(this).is(':checked') });
        });

        syncBtn.on('click', async function () {
            syncBtn.prop('disabled', true);
            statusSpan.html('<i class="fa-solid fa-spinner fa-spin" style="margin-right: 4px;"></i>Syncing...');
            try {
                const didWork = await runSync('manual_button');
                statusSpan.html(`<i class="fa-solid fa-circle-check" style="color: #68d391; margin-right: 4px;"></i>${didWork ? 'Synced!' : 'Up to date'}`);
                setTimeout(() => statusSpan.html('<i class="fa-solid fa-circle-check" style="color: #68d391; margin-right: 4px;"></i>Ready'), 2500);
            } catch (_) {
                statusSpan.html('<i class="fa-solid fa-triangle-exclamation" style="color: #fc8181; margin-right: 4px;"></i>Sync failed');
            } finally {
                syncBtn.prop('disabled', false);
            }
        });

        // Prevent clicking aspect checkbox/label from toggling the resolution drawer
        $('#mhc_aspect_ratio_bridge').closest('label').on('click', function (e) {
            e.stopPropagation();
        });

        // ── Smart Aspect-Ratio & Crop Bridge Controls ──
        const aspectCb = $('#mhc_aspect_ratio_bridge');
        const aspectPresetSelect = $('#mhc_aspect_ratio_preset');
        const sceneW = $('#mhc_scene_width');
        const sceneH = $('#mhc_scene_height');
        const portraitW = $('#mhc_portrait_width');
        const portraitH = $('#mhc_portrait_height');
        const scenePixelLabel = $('#mhc_scene_pixel_label');
        const portraitPixelLabel = $('#mhc_portrait_pixel_label');
        const resetResolutionsBtn = $('#mhc_aspect_ratio_reset');

        const ASPECT_PRESETS = {
            sd15: { sceneW: 672, sceneH: 384, portraitW: 512, portraitH: 512 },
            sdxl: { sceneW: 1344, sceneH: 768, portraitW: 1024, portraitH: 1024 },
        };

        function formatPixelCount(w, h) {
            const px = w * h;
            if (px >= 1000000) return `~${(px / 1000000).toFixed(2)}M px`;
            return `~${Math.round(px / 1000)}k px`;
        }

        function updatePixelLabels() {
            const sw = parseInt(sceneW.val(), 10) || 672;
            const sh = parseInt(sceneH.val(), 10) || 384;
            const pw = parseInt(portraitW.val(), 10) || 512;
            const ph = parseInt(portraitH.val(), 10) || 512;
            scenePixelLabel.text(formatPixelCount(sw, sh));
            portraitPixelLabel.text(formatPixelCount(pw, ph));
        }

        function detectPreset(sw, sh, pw, ph) {
            if (sw === 672 && sh === 384 && pw === 512 && ph === 512) return 'sd15';
            if (sw === 1344 && sh === 768 && pw === 1024 && ph === 1024) return 'sdxl';
            return 'custom';
        }

        aspectCb.prop('checked', current.enableAspectRatioBridge);
        sceneW.val(current.sceneWidth);
        sceneH.val(current.sceneHeight);
        portraitW.val(current.portraitWidth);
        portraitH.val(current.portraitHeight);

        const initialPreset = detectPreset(current.sceneWidth, current.sceneHeight, current.portraitWidth, current.portraitHeight);
        aspectPresetSelect.val(initialPreset);
        updatePixelLabels();

        aspectCb.on('change', function () {
            updateSettings({ enableAspectRatioBridge: $(this).is(':checked') });
        });

        aspectPresetSelect.on('change', function () {
            const chosen = $(this).val();
            if (ASPECT_PRESETS[chosen]) {
                const p = ASPECT_PRESETS[chosen];
                sceneW.val(p.sceneW);
                sceneH.val(p.sceneH);
                portraitW.val(p.portraitW);
                portraitH.val(p.portraitH);
                updateSettings({
                    aspectRatioPreset: chosen,
                    sceneWidth: p.sceneW,
                    sceneHeight: p.sceneH,
                    portraitWidth: p.portraitW,
                    portraitHeight: p.portraitH,
                });
                updatePixelLabels();
                showToast('info', `Applied ${chosen === 'sdxl' ? 'SDXL / Flux (1024²)' : 'SD 1.5 (512²)'} resolution preset.`, 'MultiHog Companion');
            } else {
                updateSettings({ aspectRatioPreset: 'custom' });
            }
        });

        function handleDimensionChange() {
            const sw = parseInt(sceneW.val(), 10) || 672;
            const sh = parseInt(sceneH.val(), 10) || 384;
            const pw = parseInt(portraitW.val(), 10) || 512;
            const ph = parseInt(portraitH.val(), 10) || 512;
            const detected = detectPreset(sw, sh, pw, ph);
            aspectPresetSelect.val(detected);
            updateSettings({
                aspectRatioPreset: detected,
                sceneWidth: sw,
                sceneHeight: sh,
                portraitWidth: pw,
                portraitHeight: ph,
            });
            updatePixelLabels();
        }

        sceneW.on('change', handleDimensionChange);
        sceneH.on('change', handleDimensionChange);
        portraitW.on('change', handleDimensionChange);
        portraitH.on('change', handleDimensionChange);

        resetResolutionsBtn.on('click', function () {
            sceneW.val(DEFAULT_SETTINGS.sceneWidth);
            sceneH.val(DEFAULT_SETTINGS.sceneHeight);
            portraitW.val(DEFAULT_SETTINGS.portraitWidth);
            portraitH.val(DEFAULT_SETTINGS.portraitHeight);
            aspectPresetSelect.val('sd15');
            updateSettings({
                aspectRatioPreset: 'sd15',
                sceneWidth: DEFAULT_SETTINGS.sceneWidth,
                sceneHeight: DEFAULT_SETTINGS.sceneHeight,
                portraitWidth: DEFAULT_SETTINGS.portraitWidth,
                portraitHeight: DEFAULT_SETTINGS.portraitHeight,
            });
            updatePixelLabels();
            showToast('info', 'Resolutions reset to recommended defaults (672x384 & 512x512).', 'MultiHog Companion');
        });

        // ── Campaign Lorebooks Sync Controls ──
        $('#mhc_lorebook_sync_enable').closest('label').on('click', function (e) {
            e.stopPropagation();
        });

        const loreSyncCb = $('#mhc_lorebook_sync_enable');
        const loreAutoRenameCb = $('#mhc_lorebook_auto_rename');
        const loreDeleteOldCb = $('#mhc_lorebook_delete_old');
        const loreSyncNowBtn = $('#mhc_lorebook_sync_now');

        loreSyncCb.prop('checked', current.enableLorebookSync !== false);
        loreAutoRenameCb.prop('checked', current.autoSyncOnRename !== false);
        loreDeleteOldCb.prop('checked', current.deleteOldLorebooksOnSync !== false);

        loreSyncCb.on('change', function () {
            updateSettings({ enableLorebookSync: $(this).is(':checked') });
            updateLorebookSyncUI();
        });

        loreAutoRenameCb.on('change', function () {
            updateSettings({ autoSyncOnRename: $(this).is(':checked') });
        });

        loreDeleteOldCb.on('change', function () {
            updateSettings({ deleteOldLorebooksOnSync: $(this).is(':checked') });
        });

        loreSyncNowBtn.on('click', async function () {
            loreSyncNowBtn.prop('disabled', true);
            const msgSpan = $('#mhc_lorebook_sync_msg');
            msgSpan.html('<i class="fa-solid fa-spinner fa-spin"></i> Syncing...');
            try {
                const res = await syncCampaignLorebooks({ force: true });
                if (res.ok) {
                    msgSpan.html('<i class="fa-solid fa-circle-check" style="color: #68d391;"></i> ' + (res.changed ? 'Synced!' : 'In sync'));
                } else {
                    msgSpan.html('<i class="fa-solid fa-triangle-exclamation" style="color: #fc8181;"></i> Failed');
                }
            } finally {
                loreSyncNowBtn.prop('disabled', false);
                await updateLorebookSyncUI();
                setTimeout(() => msgSpan.text(''), 3000);
            }
        });

        await updateLorebookSyncUI();

        // ── PbtA & FAE Concierge Session Zero ──
        $('#mhc_open_concierge_btn').on('click', function (e) {
            e.preventDefault();
            const mode = $('#mhc_ruleset_mode_select').val() || (isFaeActive() ? 'fae' : 'pbta');
            const genre = mode === 'fae' ? $('#mhc_fae_genre').val() : $('#mhc_pbta_genre').val();
            openConciergeModal({ ruleset: mode, genreKey: genre });
        });

        // ── Ruleset Mode Toggle (PbtA vs FAE) ──
        const rulesetModeSelect = $('#mhc_ruleset_mode_select');
        const pbtaControlsGroup = $('#mhc_pbta_controls_group');
        const faeControlsGroup = $('#mhc_fae_controls_group');
        const pbtaActionsGroup = $('#mhc_pbta_actions_group');
        const faeActionsGroup = $('#mhc_fae_actions_group');

        function updateRulesetModeUI(mode) {
            if (mode === 'fae') {
                pbtaControlsGroup.hide();
                pbtaActionsGroup.hide();
                faeControlsGroup.show();
                faeActionsGroup.show();
            } else {
                faeControlsGroup.hide();
                faeActionsGroup.hide();
                pbtaControlsGroup.show();
                pbtaActionsGroup.show();
            }
        }

        const initialMode = current.rulesetEngineMode || (isFaeActive() ? 'fae' : 'pbta');
        if (rulesetModeSelect.length) {
            rulesetModeSelect.val(initialMode);
            updateRulesetModeUI(initialMode);
            rulesetModeSelect.on('change', function () {
                const mode = $(this).val();
                updateRulesetModeUI(mode);
                updateSettings({ rulesetEngineMode: mode });
            });
        }

        // ── PbtA Ruleset Controls ──
        const genreSelect = $('#mhc_pbta_genre');
        const statsPreview = $('#mhc_pbta_stats_preview');
        const movesPreview = $('#mhc_pbta_moves_preview');

        function updateGenrePreview(key) {
            const g = PBTA_GENRES[key] || PBTA_GENRES.fantasy;
            if (statsPreview.length) statsPreview.text(`Stats: ${g.stats.join(', ')}`);
            if (movesPreview.length) movesPreview.text(`Key Moves: ${g.moves.slice(0, 4).map(m => m.split(' — ')[0]).join(', ')}`);
        }

        // Restore saved genre selection
        const savedGenre = current.lastGenre || 'fantasy';
        if (PBTA_GENRES[savedGenre]) {
            genreSelect.val(savedGenre);
        }

        genreSelect.on('change', function () {
            const key = $(this).val();
            updateGenrePreview(key);
            updateSettings({ lastGenre: key });
        });
        updateGenrePreview(genreSelect.val() || 'fantasy');

        // ── FAE Ruleset Controls ──
        const faeGenreSelect = $('#mhc_fae_genre');
        const faePoolsPreview = $('#mhc_fae_pools_preview');
        const faeKnobsPreview = $('#mhc_fae_knobs_preview');
        const faeFleeGraceCb = $('#mhc_fae_flee_grace');
        const faeShiftSelect = $('#mhc_fae_attrition_shift');
        const faeOverflowSelect = $('#mhc_fae_overflow_default');

        function updateFaeGenrePreview(key) {
            const g = FAE_GENRES[key] || FAE_GENRES.cosmic_horror;
            if (faePoolsPreview.length) {
                const poolsStr = Object.values(g.pools).map(p => `${p.label} (${p.current}/${p.max})`).join(', ');
                faePoolsPreview.text(`Resource Pools: ${poolsStr}`);
            }
            if (faeKnobsPreview.length) {
                const shift = g.knobs.base_attrition_shift >= 0 ? `+${g.knobs.base_attrition_shift}` : g.knobs.base_attrition_shift;
                faeKnobsPreview.text(`Knobs: Flee Grace (${g.knobs.flee_grace_toggle ? 'ON' : 'OFF'}) | Shift: ${shift} | Overflow: ${g.knobs.overflow_default}`);
            }
        }

        const savedFaeGenre = current.lastFaeGenre || 'cosmic_horror';
        if (FAE_GENRES[savedFaeGenre]) {
            faeGenreSelect.val(savedFaeGenre);
        }
        updateFaeGenrePreview(faeGenreSelect.val() || 'cosmic_horror');

        faeFleeGraceCb.prop('checked', current.faeFleeGrace !== false);
        if (current.faeAttritionShift !== undefined) {
            faeShiftSelect.val(String(current.faeAttritionShift));
        }
        if (current.faeOverflowDefault) {
            faeOverflowSelect.val(current.faeOverflowDefault);
        }

        faeGenreSelect.on('change', function () {
            const key = $(this).val();
            updateFaeGenrePreview(key);
            const g = FAE_GENRES[key];
            if (g) {
                faeFleeGraceCb.prop('checked', g.knobs.flee_grace_toggle);
                faeShiftSelect.val(String(g.knobs.base_attrition_shift));
                faeOverflowSelect.val(g.knobs.overflow_default);
                updateSettings({
                    lastFaeGenre: key,
                    faeFleeGrace: g.knobs.flee_grace_toggle,
                    faeAttritionShift: g.knobs.base_attrition_shift,
                    faeOverflowDefault: g.knobs.overflow_default,
                });
            } else {
                updateSettings({ lastFaeGenre: key });
            }
        });

        faeFleeGraceCb.on('change', function () {
            updateSettings({ faeFleeGrace: $(this).is(':checked') });
        });
        faeShiftSelect.on('change', function () {
            updateSettings({ faeAttritionShift: parseInt($(this).val(), 10) || 0 });
        });
        faeOverflowSelect.on('change', function () {
            updateSettings({ faeOverflowDefault: $(this).val() });
        });

        function getFaeCustomKnobs() {
            return {
                flee_grace_toggle: faeFleeGraceCb.is(':checked'),
                base_attrition_shift: parseInt(faeShiftSelect.val(), 10) || 0,
                overflow_default: faeOverflowSelect.val() || 'scar_and_ko',
            };
        }

        $('#mhc_fae_load_cartridge').on('click', async function () {
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                await applyFaeCartridge(faeGenreSelect.val(), { knobs: getFaeCustomKnobs() });
            } finally {
                btn.prop('disabled', false);
            }
        });

        $('#mhc_fae_quickstart').on('click', async function () {
            const btn = $(this);
            const charName = ($('#mhc_pbta_char_name').val() || '').trim();
            const scenarioDesc = ($('#mhc_pbta_scenario_desc').val() || '').trim();
            btn.prop('disabled', true);
            try {
                await quickStartFae(faeGenreSelect.val(), charName, scenarioDesc, getFaeCustomKnobs());
            } finally {
                btn.prop('disabled', false);
            }
        });

        $('#mhc_pbta_load_cartridge').on('click', async function () {
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                if (rulesetModeSelect.val() === 'fae') {
                    await applyFaeCartridge(faeGenreSelect.val(), { knobs: getFaeCustomKnobs() });
                } else {
                    await applyPbtACartridge(genreSelect.val());
                }
            } finally {
                btn.prop('disabled', false);
            }
        });

        $('#mhc_pbta_roll_name').on('click', async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const isFae = rulesetModeSelect.val() === 'fae';
            let multihogGenre = 'fantasy';
            if (isFae) {
                const g = FAE_GENRES[faeGenreSelect.val()] || FAE_GENRES.cosmic_horror;
                multihogGenre = g.multihogGenre || 'horror';
            } else {
                const g = PBTA_GENRES[genreSelect.val()] || PBTA_GENRES.fantasy;
                multihogGenre = g.multihogGenre || 'fantasy';
            }
            const name = await getRandomCharacterName(multihogGenre);
            $('#mhc_pbta_char_name').val(name);
        });

        $('#mhc_pbta_quickstart').on('click', async function () {
            const btn = $(this);
            const charName = ($('#mhc_pbta_char_name').val() || '').trim();
            const scenarioDesc = ($('#mhc_pbta_scenario_desc').val() || '').trim();
            btn.prop('disabled', true);
            try {
                if (rulesetModeSelect.val() === 'fae') {
                    await quickStartFae(faeGenreSelect.val(), charName, scenarioDesc, getFaeCustomKnobs());
                } else {
                    await quickStartPbtA(genreSelect.val(), charName, scenarioDesc);
                }
            } finally {
                btn.prop('disabled', false);
            }
        });

        $('#mhc_restore_dnd').on('click', async function () {
            if (!confirm('Revert MultiHog prompts and modules back to factory default D&D 5e?')) return;
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                await restoreStockDnd();
            } finally {
                btn.prop('disabled', false);
            }
        });

        // ── D&D 5e Fixes: Subfooter Alignment Controls ──
        $('#mhc_dnd_subfooter_fix_enable').closest('label').on('click', function (e) {
            e.stopPropagation();
        });

        const dndFixCb = $('#mhc_dnd_subfooter_fix_enable');
        dndFixCb.prop('checked', current.enableDndSubfooterFix !== false);

        dndFixCb.on('change', async function () {
            const enabled = $(this).is(':checked');
            updateSettings({ enableDndSubfooterFix: enabled });
            if (enabled) {
                if (!isPbtAActive()) {
                    await applyDndSubfooterAlignment();
                    showToast('success', 'D&D 5e Subfooter Alignment applied! ⚔️', 'D&D Fixes');
                }
            } else {
                await revertDndSubfooterAlignment();
                showToast('info', 'Reverted D&D prompts to stock factory defaults.', 'D&D Fixes');
            }
            updateDndSubfooterFixUI();
        });

        $('#mhc_dnd_reapply_fixes_btn').on('click', async function () {
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                await applyDndSubfooterAlignment();
                showToast('success', 'Reapplied D&D 5e Subfooter Alignment! ⚔️', 'D&D Fixes');
                updateDndSubfooterFixUI();
            } finally {
                btn.prop('disabled', false);
            }
        });

        $('#mhc_dnd_revert_stock_btn').on('click', async function () {
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                await revertDndSubfooterAlignment();
                showToast('info', 'Reverted D&D prompts to stock factory defaults.', 'D&D Fixes');
                updateDndSubfooterFixUI();
            } finally {
                btn.prop('disabled', false);
            }
        });

        // ── 5. Name Diversity Engine (NameRAG) Controls ──
        async function initNameRagUI() {
            try {
                const discovery = await discoverNameRagServer();
                const section = $('#mhc_namerag_section');
                if (!discovery.available) {
                    section.hide();
                    return;
                }

                section.show();
                const badge = $('#mhc_namerag_status_badge');
                const serverNameLabel = $('#mhc_namerag_server_name');
                serverNameLabel.text(`MCP: ${discovery.serverName}`);

                if (discovery.isRunning) {
                    badge.text(`🟢 Connected (${discovery.serverName})`).css({
                        background: 'rgba(80,180,120,0.2)',
                        color: '#88ffbb',
                        borderColor: 'rgba(80,180,120,0.35)',
                    });
                } else {
                    badge.text(`🟡 Ready (${discovery.serverName})`).css({
                        background: 'rgba(255,180,60,0.2)',
                        color: '#ffcc88',
                        borderColor: 'rgba(255,180,60,0.4)',
                    });
                }

                const enableCb = $('#mhc_namerag_enable');
                const multiHogCb = $('#mhc_namerag_enhance_multihog');
                const conciergeCb = $('#mhc_namerag_enhance_concierge');
                const adhocCb = $('#mhc_namerag_adhoc_sysprompt');

                enableCb.prop('checked', current.enableNameRag !== false);
                multiHogCb.prop('checked', current.nameRagEnhanceMultiHog !== false);
                conciergeCb.prop('checked', current.nameRagEnhanceConcierge !== false);
                adhocCb.prop('checked', current.nameRagAdhocSysprompt !== false);

                enableCb.on('change', async function () {
                    const val = $(this).is(':checked');
                    updateSettings({ enableNameRag: val });
                    await syncNameRagAdhocSysprompt(val && adhocCb.is(':checked'), refreshMultihogRuntime);
                });

                multiHogCb.on('change', function () {
                    updateSettings({ nameRagEnhanceMultiHog: $(this).is(':checked') });
                });

                conciergeCb.on('change', function () {
                    updateSettings({ nameRagEnhanceConcierge: $(this).is(':checked') });
                });

                adhocCb.on('change', async function () {
                    const val = $(this).is(':checked');
                    updateSettings({ nameRagAdhocSysprompt: val });
                    await syncNameRagAdhocSysprompt(enableCb.is(':checked') && val, refreshMultihogRuntime);
                });

                if (current.enableNameRag !== false && current.nameRagAdhocSysprompt !== false) {
                    await syncNameRagAdhocSysprompt(true);
                }

                const escapeSimple = (str) => String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);

                $('#mhc_namerag_test_btn').on('click', async function () {
                    const btn = $(this);
                    const origHtml = btn.html();
                    const query = $('#mhc_namerag_test_query').val().trim() || 'robed wizard';
                    const resultEl = $('#mhc_namerag_test_result');

                    btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');
                    resultEl.show().html('<span style="opacity: 0.6;">Querying NameRAG...</span>');

                    try {
                        const res = await testNameRagConnection(query);
                        if (res.ok && res.sample) {
                            const s = res.sample;
                            resultEl.html(`<b>✨ ${escapeSimple(s.name)}</b> <span style="opacity: 0.7;">(${escapeSimple(s.gender || 'Dual')}${s.origin ? ' | ' + escapeSimple(s.origin) : ''})</span><br><span style="opacity: 0.85; font-style: italic;">${escapeSimple(s.vibe || s.meaning || 'No description')}</span>`);
                        } else {
                            resultEl.html(`<span style="color: #fc8181;"><i class="fa-solid fa-circle-exclamation"></i> ${escapeSimple(res.error || 'Failed to get name')}</span>`);
                        }
                    } catch (err) {
                        resultEl.html(`<span style="color: #fc8181;"><i class="fa-solid fa-circle-exclamation"></i> ${escapeSimple(err.message)}</span>`);
                    } finally {
                        btn.prop('disabled', false).html(origHtml);
                    }
                });
            } catch (err) {
                console.warn('[MultiHog Companion] Error initializing NameRAG UI:', err);
                $('#mhc_namerag_section').hide();
            }
        }

        await initNameRagUI();

        // ── 6. Relationship Narrative Sync Controls ──
        async function initRelationshipSyncUI() {
            try {
                const syncCb = $('#mhc_rel_narrative_sync');
                syncCb.prop('checked', current.enableRelationshipNarrativeSync !== false);

                syncCb.on('change', function () {
                    const val = $(this).is(':checked');
                    updateSettings({ enableRelationshipNarrativeSync: val });
                    updateRelationshipSyncUI();
                });

                $('#mhc_scan_unsynced_npcs_btn').on('click', async function () {
                    const btn = $(this);
                    btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Scanning...');
                    try {
                        const res = await scanAndInitUnsyncedNpcs({ forceAll: false, allowLlmScan: true });
                        showToast('success', `Scanned ${res.scanned} NPCs: initialized ${res.initialized}, skipped ${res.skipped}.`, 'Relationship Narrative Sync');
                        updateRelationshipSyncUI();
                    } catch (err) {
                        showToast('error', `Scan failed: ${err.message}`, 'Relationship Narrative Sync');
                    } finally {
                        btn.prop('disabled', false).html('<i class="fa-solid fa-magnifying-glass"></i> <span>Scan &amp; Init Unsynced NPCs</span>');
                    }
                });

                updateRelationshipSyncUI();
            } catch (err) {
                console.warn('[MultiHog Companion] Error initializing Relationship Sync UI:', err);
            }
        }

        await initRelationshipSyncUI();

        // ── 7. Wand Menu Integration (On-Demand CYOA Choice Fix/Reroll) ──
        initWandMenu();
    } catch (err) {
        console.error('[MultiHog Companion] Failed to load UI template:', err);
    }
}

/**
 * Injects the MultiHog Companion CYOA Fix / Reroll and Level-Up / Respec buttons into SillyTavern's Wand menu.
 */
export function initWandMenu() {
    if (typeof document === 'undefined') return;
    const wandContainer = document.getElementById('extensionsMenu');
    if (!wandContainer) return;

    if (!document.getElementById('mhc_wand_cyoa_fix_reroll')) {
        const btn = document.createElement('div');
        btn.id = 'mhc_wand_cyoa_fix_reroll';
        btn.classList.add('list-group-item', 'flex-container', 'flexGap5');
        btn.title = 'Convert markdown choices to buttons or reroll fresh CYOA choices';
        btn.innerHTML = `
            <div class="fa-solid fa-compass extensionsMenuExtensionButton"></div>
            <span>Fix / Reroll CYOA Choices</span>
        `;
        wandContainer.appendChild(btn);
    }

    // [CATALOG: FEAT-10] Dynamic Level-Up / Respec / Concierge Wand item
    let levelUpBtn = document.getElementById('mhc_wand_level_up_respec');
    if (!levelUpBtn) {
        levelUpBtn = document.createElement('div');
        levelUpBtn.id = 'mhc_wand_level_up_respec';
        levelUpBtn.classList.add('list-group-item', 'flex-container', 'flexGap5');
        wandContainer.appendChild(levelUpBtn);
    }

    levelUpBtn.title = 'Open MultiHog Concierge: Character & Leveling Desk, Living World Dossier, or New Adventure';
    levelUpBtn.setAttribute('data-is-level-up', 'false');
    levelUpBtn.innerHTML = `
        <div class="fa-solid fa-wand-magic-sparkles extensionsMenuExtensionButton" style="color: #c084fc;"></div>
        <span>🧙‍♂️ Concierge</span>
    `;

    // Inspect active eligibility to determine label & icon
    try {
        const rpgSettings = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
            || globalThis.extension_settings?.rpg_tracker
            || {};
        const curMemo = rpgSettings.currentMemo
            || (typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo')?.value : null)
            || '';
        import('./level-up-runner.js').then(({ evaluateLevelUpEligibility }) => {
            const s = getSettings();
            const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
            const chatId = ctx?.getCurrentChatId?.() || ctx?.chatId || s.currentChatId || 'default';
            const faeActive = isFaeChat(chatId, rpgSettings, s) || isFaeActive(chatId, rpgSettings, s);
            const pbtaActive = !faeActive && (isPbtaChat(chatId, rpgSettings, s) || isPbtAActive(chatId, rpgSettings, s));
            const pacingXp = s.pbtaCampaignDossier?.[chatId]?.config?.pacingXp
                || s.companionDossier?.[chatId]?.config?.pacingXp;
            const status = evaluateLevelUpEligibility(curMemo, faeActive ? 'fae' : (pbtaActive ? 'pbta' : null), { pacingXp });
            if (status.eligible) {
                levelUpBtn.title = 'Milestone reached! Open Level-Up Desk to advance character';
                levelUpBtn.setAttribute('data-is-level-up', 'true');
                const labelText = status.ruleset === 'fae'
                    ? '🏆 FAE Milestone Available'
                    : (status.ruleset === 'pbta'
                        ? '⚡ Playbook Advance Available'
                        : `⬆ Level Up Available (Lvl ${status.currentLevel} → ${status.nextLevel})`);
                levelUpBtn.innerHTML = `
                    <div class="fa-solid fa-circle-arrow-up extensionsMenuExtensionButton" style="color: #fbbf24;"></div>
                    <span>${labelText}</span>
                `;
            } else {
                levelUpBtn.title = 'Open MultiHog Concierge: Character & Leveling Desk, Living World Dossier, or New Adventure';
                levelUpBtn.setAttribute('data-is-level-up', 'false');
                levelUpBtn.innerHTML = `
                    <div class="fa-solid fa-wand-magic-sparkles extensionsMenuExtensionButton" style="color: #c084fc;"></div>
                    <span>🧙‍♂️ Concierge</span>
                `;
            }
        }).catch(() => {});
    } catch (_) {}
}

/**
 * Launches the autonomous Level-Up / Respec Concierge modal.
 *
 * @param {object} [options={}]
 * @param {boolean} [options.isRespec=false] Whether to run in respec mode.
 */
export async function launchLevelUpOrRespecDesk({ isRespec = false } = {}) {
    const s = getSettings();
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const chatId = ctx?.getCurrentChatId?.() || ctx?.chatId || s.currentChatId || 'default';
    
    // Upstream MultiHog DnD Framework stores its active memo & partitions in extension_settings.rpg_tracker
    const rpgSettings = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
        || globalThis.extension_settings?.rpg_tracker
        || ctx?.extensionSettings?.rpg_tracker
        || {};
    const currentMemo = rpgSettings.currentMemo
        || (typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo')?.value : null)
        || s.currentMemo
        || '';

    const { ensureChatDossier, persistCompanionDossier, syncDossierToWorldInfoBook, isDossierPbta } = await import('./level-up-scaffold.js');
    const { getCanonicalDndProgression, hasProgressionBlueprint, generateProgressionBlueprintViaConcierge, blueprintMatchesClass } = await import('./level-up-blueprint.js');
    const { evaluateLevelUpEligibility, decorateXpBarsForLevelUp } = await import('./level-up-runner.js');
    const { openLevelUpModal } = await import('./level-up-ui.js');

    const dossier = ensureChatDossier(chatId, s, { memo: currentMemo });
    const isFae = isFaeChat(chatId, rpgSettings, s)
        || isFaeActive(chatId, rpgSettings, s)
        || dossier?.meta?.ruleset === 'fae';
    const isPbta = !isFae && (isPbtaChat(chatId, rpgSettings, s)
        || isPbtAActive(chatId, rpgSettings, s)
        || isDossierPbta(dossier));

    const rulesetKey = isFae ? 'fae' : (isPbta ? 'pbta' : (dossier.meta?.systemKey || 'dnd5e'));
    const eligibility = evaluateLevelUpEligibility(
        currentMemo,
        rulesetKey,
        { pacingXp: dossier.config?.pacingXp },
    );

    let blueprintPromise = null;

    // If FAE or PbtA, bypass 1–20 D&D progression blueprint generation
    if (isFae) {
        dossier.progressionBlueprint = null;
        if (dossier.meta) {
            dossier.meta.systemKey = 'fae';
            dossier.meta.ruleset = 'fae';
            if (!dossier.meta.systemLabel || dossier.meta.systemLabel.includes('5e')) {
                dossier.meta.systemLabel = 'FAE Freeform Attrition Engine';
            }
        }
    } else if (isPbta) {
        dossier.progressionBlueprint = null;
        if (dossier.meta) {
            const existingSysKey = (dossier.meta.systemKey || '').toLowerCase();
            if (!existingSysKey || existingSysKey === 'dnd5e') {
                dossier.meta.systemKey = 'pbta';
            }
            if (!dossier.meta.systemLabel || dossier.meta.systemLabel.includes('5e')) {
                dossier.meta.systemLabel = 'PbtA Narrative Engine';
            }
        }
    } else {
        // A stored blueprint for a different class (re-class / stale data) must not be reused
        if (hasProgressionBlueprint(dossier) && !blueprintMatchesClass(dossier.progressionBlueprint, dossier.protagonist?.class)) {
            console.warn(`[MultiHog Companion] Progression blueprint class "${dossier.progressionBlueprint.className}" no longer matches "${dossier.protagonist?.class}"; regenerating.`);
            dossier.progressionBlueprint = null;
        }
    }
    if (!isPbta && !isFae && !hasProgressionBlueprint(dossier)) {
        const canonical = getCanonicalDndProgression(dossier.protagonist?.class);
        if (canonical) {
            dossier.progressionBlueprint = canonical;
            persistCompanionDossier(chatId, dossier);
        } else {
            // Kick off async Concierge generation without blocking modal display
            blueprintPromise = generateProgressionBlueprintViaConcierge({
                character: dossier.protagonist,
                genre: dossier.meta?.genre || 'fantasy',
                worldRules: dossier.meta?.systemLabel || '',
            }).then(bp => {
                if (bp) {
                    dossier.progressionBlueprint = bp;
                    persistCompanionDossier(chatId, dossier);
                }
                return bp;
            });
        }
    }

    // Ensure Campaign_<ChatTitle> World Info Lorebook is synced
    syncDossierToWorldInfoBook(chatId, dossier).catch(() => {});

    // If character does not have sufficient XP to level up, enforce Respec mode
    const effectiveIsRespec = isRespec || !eligibility.eligible;

    const targetLevel = (isPbta || isFae)
        ? null
        : (effectiveIsRespec
            ? (dossier.protagonist?.level || eligibility.currentLevel || 1)
            : (eligibility.nextLevel || eligibility.currentLevel + 1 || 2));

    // Two-Stage Progression Flow:
    // Stage 1 (Class Definition) is presented if an invented/homebrew D&D class does not yet have a progression codex.
    // Once the codex exists (or for canonical classes), it goes straight to Stage 2 (Level Up / Respec).
    const canonicalProg = getCanonicalDndProgression(dossier.protagonist?.class);
    const hasBlueprintAlready = hasProgressionBlueprint(dossier) || !!canonicalProg;
    const initialStage = (!isPbta && !isFae && !hasBlueprintAlready) ? 1 : 2;

    openLevelUpModal({
        chatId,
        dossier,
        blueprint: dossier.progressionBlueprint,
        blueprintPromise,
        targetLevel,
        isRespec: effectiveIsRespec,
        initialStage,
        rpgSettings,
        onComplete: () => {
            decorateXpBarsForLevelUp(isPbta || isFae);
            initWandMenu();
        },
    });
}



// ── Ruleset Detection & State Recovery ──────────────────────────────────────────────
export {
    isPbtAActive,
    isPbtaChat,
    isFaeActive,
    isFaeChat,
    formatRulesetBadge,
    persistPbtaChatState,
    ensureActiveChatRulesetConsistency,
    isLiveSettingsPollutedWithPbtA,
    isLiveSettingsPollutedWithFae,
    cleanseStockDndSettings,
    logRulesetEvent,
    collectRulesetDiagnostics,
    getCompanionActiveCartridge,
    setCompanionActiveCartridge,
    getActiveRulesetId,
};

// ── 2d6 RNG Queue Interceptor ───────────────────────────────────────────────────

/**
 * Roll a single d6 using the same cryptographic rejection sampling MultiHog uses.
 */
function rollD6() {
    const buf = new Uint32Array(1);
    const limit = Math.floor(4294967296 / 6) * 6;
    let roll;
    do { crypto.getRandomValues(buf); roll = buf[0]; } while (roll >= limit);
    return (roll % 6) + 1;
}

/**
 * Build a clean PbtA 2d6 RNG block.  Each line is one pre-paired 2d6 roll:
 *   1: 2d6 → 3 + 5 = 8
 * This replaces MultiHog's polyhedral queue (d20/d4/d6/d8/d10/d12 per line)
 * which wastes tokens and forces the LLM to consume 2 lines per PbtA roll.
 */
function buildPbtA2d6Block(lineCount = 1) {
    const turnId = Date.now();
    const count = Math.max(1, lineCount);
    const lines = [];
    for (let i = 0; i < count; i++) {
        const a = rollD6(), b = rollD6();
        lines.push(`${i + 1}: 2d6 → ${a} + ${b} = ${a + b}`);
    }
    return `[RNG_QUEUE v7.0 — PbtA 2d6]\nturn_id=${turnId}\nscope=this_response\n${lines.join('\n')}\n[/RNG_QUEUE]\n\n`;
}

/**
 * Synchronizes SillyTavern function tool registrations for Companion rulesets.
 * Registers resolve_fae_action when FAE is active and diceFunctionTool is true.
 * Registers roll_pbta_move when PbtA is active and diceFunctionTool is true.
 * Unregisters them and restores MultiHog's native RollTheDice tools when in D&D 5e or queue mode.
 */
export function syncCompanionDiceFunctionTools() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (!ctx || typeof ctx.registerFunctionTool !== 'function') {
        return;
    }

    try { ctx.unregisterFunctionTool?.('resolve_fae_action'); } catch (_) {}
    try { ctx.unregisterFunctionTool?.('roll_pbta_move'); } catch (_) {}

    const rpgSettings = getRpgSettings();
    const activeChatId = getActiveChatId();

    const isFae = isFaeActive(activeChatId);
    const isPbta = !isFae && isPbtAActive(activeChatId);
    const rngEnabled = rpgSettings?.rngEnabled !== false;
    const toolMode = Boolean(rpgSettings?.diceFunctionTool);

    if (isFae && rngEnabled && toolMode) {
        try { ctx.unregisterFunctionTool?.('RollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('RollTheDiceD100'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('FatbodyRollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('MultihogRollTheDice'); } catch (_) {}

        ctx.registerFunctionTool({
            name: 'resolve_fae_action',
            displayName: 'Resolve FAE Action',
            description: 'Deterministically resolves an FAE 4dF resource pool test for a Threat 1–4 action, computing attrition, outcome tier, and pool updates.',
            parameters: {
                type: 'object',
                properties: {
                    pool_at_risk: {
                        type: 'string',
                        description: 'The resource pool placed at risk (e.g. Health, Sanity, Resolve, Supplies).',
                    },
                    threat_level: {
                        type: 'integer',
                        description: 'Threat level of the encounter/obstacle (1 to 4).',
                        minimum: 1,
                        maximum: 4,
                    },
                    progress_scale: {
                        type: 'string',
                        enum: ['full', 'stepping_stone', 'pivot'],
                        description: 'Outcome scale: full (complete resolution), stepping_stone (-1 encounter layer, grants advantage), or pivot (+1 threat, reveals new angle).',
                    },
                    matched_positive_tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Up to 2 matching positive personal, gear, or companion tags from [CHARACTER] that mitigate attrition.',
                    },
                    matched_negative_tags: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Any active Scars or Debuffs hindering this action that increase attrition.',
                    },
                    is_retreating: {
                        type: 'boolean',
                        description: 'True if the protagonist is fleeing or escaping the danger.',
                    },
                    grant_advantage_name: {
                        type: 'string',
                        description: 'Optional name for the advantage tag granted if progress_scale is stepping_stone (defaults to Tactical Opening).',
                    },
                },
                required: ['pool_at_risk', 'threat_level'],
            },
            formatMessage: () => '',
            action: async (args) => {
                const curSettings = getRpgSettings();
                const curChatId = getActiveChatId();
                const memo = curSettings?.currentMemo || curSettings?.chatStates?.[curChatId]?.currentMemo || '';
                const genreKey = detectActiveFaeGenre({ chatId: curChatId, rpgSettings: curSettings, currentMemo: memo });
                const state = parseFaeStateFromMemo(memo, genreKey);
                const out = executeFaeActionTool(state, args);
                _pendingFaeToolResolutionByChat.set(curChatId, {
                    state: out.updatedState,
                    result: out.result,
                    timestamp: Date.now(),
                });
                return out.toolResponseText;
            },
        });
    } else if (isPbta && rngEnabled && toolMode) {
        try { ctx.unregisterFunctionTool?.('RollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('RollTheDiceD100'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('FatbodyRollTheDice'); } catch (_) {}
        try { ctx.unregisterFunctionTool?.('MultihogRollTheDice'); } catch (_) {}

        ctx.registerFunctionTool({
            name: 'roll_pbta_move',
            displayName: 'Roll PbtA Move',
            description: 'Rolls 2d6 + Stat modifier (+ forward) for a triggered PbtA Move and determines the outcome tier (Strong Hit, Weak Hit, or Miss).',
            parameters: {
                type: 'object',
                properties: {
                    move_name: {
                        type: 'string',
                        description: 'The name of the triggered Move (e.g. Hack & Slash, Act Under Fire, Defy Danger).',
                    },
                    stat_name: {
                        type: 'string',
                        description: 'The character stat governing this Move (e.g. Cool, Hard, Might, Agility).',
                    },
                    stat_mod: {
                        type: 'integer',
                        description: 'The stat modifier from the character sheet (-1 to +3).',
                    },
                    forward_bonus: {
                        type: 'integer',
                        description: 'Any situational forward or hold bonus applied to this roll (default 0).',
                    },
                },
                required: ['move_name', 'stat_name'],
            },
            formatMessage: () => '',
            action: async (args) => {
                const out = executePbtaMoveTool(args);
                return out.toolResponseText;
            },
        });
    } else if (!isFae && !isPbta) {
        try {
            import('../SillyTavern-MultihogDnDFramework/narrative-hooks.js')
                .then(nh => nh.registerDiceFunctionTool?.())
                .catch(() => {});
        } catch (_) {}
    }
}

/**
 * Synchronizes the active ruleset's sysprompts and tools with MultiHog's native diceFunctionTool toggle.
 *
 * @param {object|null} [rpgSettings=null]
 */
export function syncActiveRulesetRngMode(rpgSettings = null) {
    const s = rpgSettings || getRpgSettings();
    if (!s) return;
    const activeChatId = getActiveChatId();
    const fae = isFaeActive(activeChatId);
    const pbta = !fae && isPbtAActive(activeChatId);
    const toolMode = Boolean(s.diceFunctionTool);
    let changed = false;

    if (fae) {
        const memo = s.currentMemo || s.chatStates?.[activeChatId]?.currentMemo || '';
        const genreKey = detectActiveFaeGenre({ chatId: activeChatId, rpgSettings: s, currentMemo: memo });
        const faeState = parseFaeStateFromMemo(memo, genreKey);
        const isHeroic = Boolean(faeState.knobs?.heroic_tier);
        const desiredRng = buildFaeRngContent({ toolMode });
        const desiredRole = buildFaeRoleContent(false, { heroicTier: isHeroic, toolMode });

        if (Array.isArray(s.customSyspromptLibrary)) {
            const rngItem = s.customSyspromptLibrary.find(p => p.id === 'fae_base_override_rng');
            if (rngItem && rngItem.content !== desiredRng) {
                rngItem.content = desiredRng;
                changed = true;
            }
            const roleItem = s.customSyspromptLibrary.find(p => p.id === 'fae_base_override_role');
            if (roleItem && roleItem.content !== desiredRole) {
                roleItem.content = desiredRole;
                changed = true;
            }
        }
        if (Array.isArray(s.syspromptSnippetDatabase)) {
            const rngDb = s.syspromptSnippetDatabase.find(p => p.id === 'fae_base_override_rng');
            if (rngDb && rngDb.content !== desiredRng) {
                rngDb.content = desiredRng;
                changed = true;
            }
            const roleDb = s.syspromptSnippetDatabase.find(p => p.id === 'fae_base_override_role');
            if (roleDb && roleDb.content !== desiredRole) {
                roleDb.content = desiredRole;
                changed = true;
            }
        }
    } else if (pbta) {
        const desiredRng = buildPbtARngContent({ toolMode });
        if (Array.isArray(s.customSyspromptLibrary)) {
            const rngItem = s.customSyspromptLibrary.find(p => p.id === 'pbta_base_override_rng');
            if (rngItem && rngItem.content !== desiredRng) {
                rngItem.content = desiredRng;
                changed = true;
            }
        }
        if (Array.isArray(s.syspromptSnippetDatabase)) {
            const rngDb = s.syspromptSnippetDatabase.find(p => p.id === 'pbta_base_override_rng');
            if (rngDb && rngDb.content !== desiredRng) {
                rngDb.content = desiredRng;
                changed = true;
            }
        }
    }

    if (changed) {
        saveSettingsDebounced();
    }

    syncCompanionDiceFunctionTools();
}

function getMsgRawText(msg) {
    if (!msg) return '';
    if (typeof msg.mes === 'string') return msg.mes;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        return msg.content
            .filter(p => p?.type === 'text' && typeof p.text === 'string')
            .map(p => p.text)
            .join('\n');
    }
    return '';
}

function isUserChatMessage(msg) {
    if (!msg) return false;
    if (msg.is_user === true || msg.role === 'user' || msg.role === 'human' || msg.role === 'player') return true;
    const txt = getMsgRawText(msg);
    if (txt.includes('[RNG_QUEUE')) return true;
    return false;
}

function isAssistantNarrativeMessage(msg) {
    if (!msg) return false;
    if (msg.is_user === true || msg.role === 'user' || msg.role === 'human' || msg.role === 'player') return false;
    if (msg.is_system === true || msg.role === 'system') return false;
    if (msg.extra?.isSmallSys) return false;
    const txt = getMsgRawText(msg).trim();
    return txt.length > 0;
}

/**
 * SillyTavern generate_interceptor — runs AFTER MultiHog's interceptor
 * (loading_order 30 > 20). When PbtA or FAE is active for the current chat,
 * replaces MultiHog's polyhedral RNG queue with a clean 2d6 or 4dF block.
 *
 * Registered on globalThis via the manifest's generate_interceptor field.
 */
function mhcGenerationInterceptor(chat, _contextSize, _abort, _type) {
    const activeChatId = getActiveChatId();
    if (activeChatId) {
        _pendingFaeToolResolutionByChat.delete(activeChatId);
    }

    const rpgSettings = getRpgSettings();
    syncActiveRulesetRngMode(rpgSettings);

    const faeActive = isFaeActive(activeChatId);
    const pbtaActive = !faeActive && isPbtAActive(activeChatId);
    if (!Array.isArray(chat) || (!pbtaActive && !faeActive)) return;

    // MultiHog prepends its RNG block into the last user message's content.
    // Find it and replace with our clean 2d6 or 4dF block.
    const rngPattern = /\[RNG_QUEUE[\s\S]*?\[\/RNG_QUEUE\]\s*/g;

    let latestUserIdx = -1;
    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg) continue;
        const txt = getMsgRawText(msg);
        if (txt.includes('[RNG_QUEUE')) {
            latestUserIdx = i;
            break;
        }
    }
    if (latestUserIdx === -1) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (isUserChatMessage(chat[i])) {
                latestUserIdx = i;
                break;
            }
        }
    }

    if (faeActive) {
        let isOpeningTurn = false;
        if (latestUserIdx !== -1) {
            const rawUserText = getMsgRawText(chat[latestUserIdx]);
            const strippedText = rawUserText.replace(/\[RNG_QUEUE[\s\S]*?\[\/RNG_QUEUE\]\s*/gi, '').trim();
            const isBeginAdventure = /^\s*Begin the adventure\b/i.test(strippedText);

            let firstUserIdx = -1;
            for (let i = 0; i < chat.length; i++) {
                if (isUserChatMessage(chat[i])) {
                    firstUserIdx = i;
                    break;
                }
            }

            let hasPriorAssistantTurn = false;
            if (firstUserIdx !== -1 && latestUserIdx > firstUserIdx) {
                for (let i = firstUserIdx + 1; i < latestUserIdx; i++) {
                    if (isAssistantNarrativeMessage(chat[i])) {
                        hasPriorAssistantTurn = true;
                        break;
                    }
                }
            }

            isOpeningTurn = isBeginAdventure || !hasPriorAssistantTurn;
        }

        const memo = rpgSettings?.currentMemo || rpgSettings?.chatStates?.[activeChatId]?.currentMemo || '';
        const genreKey = detectActiveFaeGenre({ chatId: activeChatId, rpgSettings, currentMemo: memo });
        const faeState = parseFaeStateFromMemo(memo, genreKey);
        const combatMatch = memo.match(/\[COMBAT\]([\s\S]*?)\[\/COMBAT\]/i);
        const hasActiveEncounter = Boolean(combatMatch && /[1-9]\d*\s*\/\s*[1-9]\d*\s*HP/i.test(combatMatch[1]));
        const toolMode = Boolean(rpgSettings?.diceFunctionTool);

        let replacementBlock = buildFaeRngBlock({
            state: faeState,
            genreKey: faeState.genreKey || genreKey,
            activeEncounter: hasActiveEncounter,
            isOpeningTurn,
            toolMode,
        });
        if (!replacementBlock.endsWith('\n\n')) {
            replacementBlock = `${replacementBlock}\n\n`;
        }

        let replaced = false;
        const startIndex = Math.max(0, chat.length - 3);
        for (let i = chat.length - 1; i >= startIndex; i--) {
            const msg = chat[i];
            if (!msg) continue;
            const raw = getMsgRawText(msg);
            if (raw.includes('[RNG_QUEUE')) {
                if (typeof msg.mes === 'string') {
                    msg.mes = msg.mes.replace(rngPattern, replacementBlock);
                }
                if (typeof msg.content === 'string') {
                    msg.content = msg.content.replace(rngPattern, replacementBlock);
                }
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part?.type === 'text' && typeof part.text === 'string' && part.text.includes('[RNG_QUEUE')) {
                            part.text = part.text.replace(rngPattern, replacementBlock);
                        }
                    }
                }
                replaced = true;
                console.log('[MultiHog Companion] Replaced polyhedral RNG queue with FAE 4dF block.');
                break;
            }
        }

        if (!replaced && latestUserIdx !== -1) {
            const userMsg = chat[latestUserIdx];
            if (typeof userMsg.mes === 'string') {
                userMsg.mes = `${replacementBlock}${userMsg.mes}`;
            } else if (typeof userMsg.content === 'string') {
                userMsg.content = `${replacementBlock}${userMsg.content}`;
            } else if (Array.isArray(userMsg.content)) {
                const textPart = userMsg.content.find(p => p?.type === 'text');
                if (textPart) {
                    textPart.text = `${replacementBlock}${textPart.text}`;
                } else {
                    userMsg.content.unshift({ type: 'text', text: replacementBlock });
                }
            }
            console.log('[MultiHog Companion] Prepended FAE 4dF block onto latest user message (toolMode outside combat).');
        }
    } else {
        const toolMode = Boolean(rpgSettings?.diceFunctionTool);
        const replacementBlock = toolMode ? '' : buildPbtA2d6Block(1);
        const startIndex = Math.max(0, chat.length - 3);
        for (let i = chat.length - 1; i >= startIndex; i--) {
            const msg = chat[i];
            if (!msg) continue;
            const raw = getMsgRawText(msg);
            if (raw.includes('[RNG_QUEUE')) {
                if (typeof msg.mes === 'string') {
                    msg.mes = msg.mes.replace(rngPattern, replacementBlock);
                }
                if (typeof msg.content === 'string') {
                    msg.content = msg.content.replace(rngPattern, replacementBlock);
                }
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part?.type === 'text' && typeof part.text === 'string' && part.text.includes('[RNG_QUEUE')) {
                            part.text = part.text.replace(rngPattern, replacementBlock);
                        }
                    }
                }
                console.log(toolMode
                    ? '[MultiHog Companion] Stripped RNG queue for PbtA Function Tool Call mode.'
                    : '[MultiHog Companion] Replaced polyhedral RNG queue with single PbtA 2d6 roll.');
                break;
            }
        }
    }
}

// [CATALOG: ADR-MP-03] See MONKEYPATCHES.md — SillyTavern Pipeline Generation Interceptor (PbtA 2d6 RNG Injection)
// Register the interceptor on globalThis so SillyTavern can call it.
globalThis.mhcGenerationInterceptor = mhcGenerationInterceptor;
export { mhcGenerationInterceptor, buildPbtA2d6Block };

// ── Ruleset Status Badge ────────────────────────────────────────────────────────

/**
 * Updates the D&D 5e Subfooter Alignment UI status badge.
 */
function updateDndSubfooterFixUI() {
    const badge = $('#mhc_dnd_subfooter_fix_status');
    if (!badge.length) return;

    const rpgSettings = getRpgSettings();
    const applied = isDndSubfooterAlignmentApplied(rpgSettings);

    if (applied) {
        badge.text('● Applied');
        badge.css({
            background: 'rgba(80,180,120,0.2)',
            color: '#88ffbb',
            borderColor: 'rgba(80,180,120,0.35)',
        });
    } else {
        badge.text('○ Stock Default');
        badge.css({
            background: 'rgba(255,255,255,0.06)',
            color: '#cccccc',
            borderColor: 'rgba(255,255,255,0.15)',
        });
    }
}

/**
 * Update the status badge in the settings panel to show the active ruleset.
 */
function updateRulesetBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('mhc_ruleset_status');
    const summary = document.getElementById('mhc_pbta_summary_line');
    updateDndSubfooterFixUI();
    if (!badge) return;

    const current = getSettings();
    const formatted = formatRulesetBadge(getActiveChatId(), getRpgSettings(), current.lastGenre || 'fantasy');

    badge.textContent = formatted.badgeText;
    badge.style.background = formatted.badgeStyle.background;
    badge.style.borderColor = formatted.badgeStyle.borderColor;
    badge.style.color = formatted.badgeStyle.color;

    if (summary) {
        summary.innerHTML = formatted.summaryHtml;
    }
}

let _chatChangedTimer = null;
let _activeChatChangedToken = 0;
let _isSettingsSyncActive = false;
let _pendingSettingsUpdatedSync = false;
let _settingsUpdatedTimer = null;

/**
 * Sequential coordinator for CHAT_CHANGED.
 * Replaces the arbitrary staggered setTimeout ladder with a deterministic async lifecycle.
 *
 * @param {string} targetChatId
 * @param {number} token
 */
async function runChatChangedCoordinator(targetChatId, token) {
    try {
        // 1. Check projection integrity (quarantine damaged partitions if any)
        const integrity = await checkTrackerProjectionIntegrity();
        if (token !== _activeChatChangedToken) return;

        if (!integrity.healthy) {
            renderTrackerQuarantineBanner(integrity);
            updateRulesetBadge();
            return;
        }

        // 2. Ensure ruleset consistency (cleansing D&D stockPrompts vs hydrating PbtA)
        await ensureActiveChatRulesetConsistency();
        if (token !== _activeChatChangedToken) return;

        // 3. Synchronize live persona and portrait to current chat
        await runSync('CHAT_CHANGED');
        if (token !== _activeChatChangedToken) return;

        // 4. Synchronize UI badges & Lorebook status
        if (!isPbtAActive(targetChatId) && !isFaeActive(targetChatId) && getSettings().enableDndSubfooterFix !== false) {
            const rpgSettings = getRpgSettings();
            if (rpgSettings && !isDndSubfooterAlignmentApplied(rpgSettings)) {
                await applyDndSubfooterAlignment({ rpgSettings });
            }
        }
        updateRulesetBadge();
        updateLorebookSyncUI();

        // 4b. Normalize CYOA footer separation for loaded messages (WRK-08)
        repairMixedFooterAndChoicesInChat();

        // 5. Persistence check & background syncs
        if (await checkHistoryPersistenceBlocked()) {
            updateRelationshipSyncUI();
            return;
        }
        if (token !== _activeChatChangedToken) return;

        const s = getSettings();
        const adhocActive = s.enableNameRag !== false && s.nameRagAdhocSysprompt !== false;
        await syncNameRagAdhocSysprompt(adhocActive);
        if (token !== _activeChatChangedToken) return;

        updateRelationshipSyncUI();
        if (isAdventureActive() && s.enableRelationshipNarrativeSync !== false) {
            scanAndInitUnsyncedNpcs({ allowLlmScan: false }).then(() => {
                if (token === _activeChatChangedToken) {
                    updateRelationshipSyncUI();
                }
            });
        }
    } catch (err) {
        console.error('[MultiHog Companion] Error during chat changed coordinator:', err);
    }
}

/**
 * Sequential coordinator for SETTINGS_UPDATED.
 * Protects against infinite re-entrancy loops while ensuring trailing portrait/persona syncs are not dropped.
 */
async function runSettingsUpdatedCoordinator() {
    if (_isSettingsSyncActive) {
        _pendingSettingsUpdatedSync = true;
        return;
    }
    _isSettingsSyncActive = true;
    try {
        await ensureActiveChatRulesetConsistency();
        syncActiveRulesetRngMode();
        updateRulesetBadge();
        updateLorebookSyncUI();
        updateRelationshipSyncUI();
        await runSync('SETTINGS_UPDATED');
    } catch (err) {
        console.error('[MultiHog Companion] Error during settings updated coordinator:', err);
    } finally {
        _isSettingsSyncActive = false;
        if (_pendingSettingsUpdatedSync) {
            _pendingSettingsUpdatedSync = false;
            scheduleSync('SETTINGS_UPDATED', 350);
        }
    }
}

/**
 * Consolidated startup routine for INITIAL_LOAD.
 * Replaces the initial 1000ms-1400ms startup ladder with a single deterministic sequence.
 */
async function runInitialLoadCoordinator() {
    const activeChatId = getActiveChatId();
    logRulesetEvent('INITIAL_LOAD', {
        activeChatId,
        isPbta: isPbtAActive(activeChatId),
    });

    try {
        const s = getSettings();
        const adhocActive = s.enableNameRag !== false && s.nameRagAdhocSysprompt !== false;
        await syncNameRagAdhocSysprompt(adhocActive);
        await ensureActiveChatRulesetConsistency();
        syncActiveRulesetRngMode();
        updateRulesetBadge();
        updateLorebookSyncUI();
        updateRelationshipSyncUI();
        repairMixedFooterAndChoicesInChat();
        await runSync('INITIAL_LOAD');
    } catch (err) {
        console.error('[MultiHog Companion] Error during initial load coordinator:', err);
    }
}

/**
 * Waits for MultiHog Lorebook Agent completion if actively running.
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<void>}
 */
export async function waitForLoreAgentCompletion(timeoutMs = 30000) {
    let isRunning = false;
    try {
        const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
        isRunning = typeof router.isRouterRunning === 'function' && router.isRouterRunning();
    } catch (_) {}

    if (!isRunning) return;
    if (typeof document === 'undefined') return;

    return new Promise(resolve => {
        let timer = null;
        const handler = e => {
            const detail = e.detail;
            if (detail?.metadata?.source === 'lorebook_agent' && (detail.type === 'finish' || detail.type === 'error')) {
                cleanup();
                resolve();
            }
        };

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            try {
                document.removeEventListener('rt_lore_agent_step', handler);
            } catch (_) {}
        };

        timer = setTimeout(() => {
            cleanup();
            resolve();
        }, timeoutMs);

        document.addEventListener('rt_lore_agent_step', handler);
    });
}

/**
 * Deterministic turn coordinator: waits for Lorebook Agent if running,
 * then executes tier crossover evaluation and refreshes UI.
 */
export async function coordinateTierSyncAfterTurn() {
    if (!isAdventureActive()) return;
    await waitForLoreAgentCompletion(30000);
    await checkAndSyncTierCrossovers();
    updateRelationshipSyncUI();
}

/**
 * Extension entry point.
 */
if (typeof jQuery !== 'undefined') {
    jQuery(async () => {
        // 1. Initialize UI
        await initUI();

        // 2. Setup Smart Aspect-Ratio & Crop Bridge (/imagine interceptor)
        setupImagineInterceptor();

        // 2b. Setup Adventure Companion PbtA Documentation Bridge (Strategy 1)
        setupCompanionDocInterceptor();

        // 3. Register Slash Commands
    if (SlashCommandParser && SlashCommand) {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-sync',
            callback: async () => {
                const didWork = await runSync('slash_command');
                return didWork ? 'MultiHog Companion sync completed.' : 'Already up to date.';
            },
            helpString: '<div>Manually synchronizes Multihog persona and portrait to the current chat.</div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-pbta',
            callback: async (args) => {
                const genre = (args?.genre || args?._unnamed || 'fantasy').toString().trim().toLowerCase();
                if (!PBTA_GENRES[genre]) {
                    const available = Object.keys(PBTA_GENRES).join(', ');
                    return `Unknown genre "${genre}". Available: ${available}`;
                }
                const ok = await applyPbtACartridge(genre);
                return ok ? `PbtA ruleset (${genre}) loaded into this chat.` : 'Failed to load PbtA ruleset.';
            },
            helpString: '<div>Loads the PbtA (Powered by the Apocalypse) 2d6 ruleset cartridge into MultiHog. Usage: <code>/mhc-pbta [fantasy|scifi|anime|horror]</code></div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-fae',
            callback: async (args) => {
                const genre = (args?.genre || args?._unnamed || 'cosmic_horror').toString().trim().toLowerCase();
                if (!FAE_GENRES[genre]) {
                    const available = Object.keys(FAE_GENRES).join(', ');
                    return `Unknown FAE genre "${genre}". Available: ${available}`;
                }
                const ok = await applyFaeCartridge(genre);
                return ok ? `FAE ruleset (${genre}) loaded into this chat.` : 'Failed to load FAE ruleset.';
            },
            helpString: '<div>Loads the Freeform Attrition Engine (FAE) 4dF ruleset cartridge into MultiHog. Usage: <code>/mhc-fae [cosmic_horror|osr_dungeon|survival_horror|post_apocalyptic|cyberpunk_noir|deep_space|weird_west]</code></div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-fae-rest',
            callback: async (args) => {
                const eventType = (args?.type || args?._unnamed || 'camp_or_sleep').toString().trim().toLowerCase();
                const validEvents = ['scene_breather', 'camp_or_sleep', 'haven_or_specialist', 'day_pass', 'scene_transition'];
                if (!validEvents.includes(eventType)) {
                    return `Unknown rest/event type "${eventType}". Available: ${validEvents.join(', ')}`;
                }
                const rpgSettings = getRpgSettings();
                const currentMemo = rpgSettings?.currentMemo || '';
                const chatId = getActiveChatId();
                const genreKey = detectActiveFaeGenre({ chatId, rpgSettings, currentMemo });
                const state = parseFaeStateFromMemo(currentMemo, genreKey);
                const restRes = triggerEventOrRest(state, eventType);

                const charBlockRegex = /\[CHARACTER\][\s\S]*?\[\/CHARACTER\]/i;
                const newCharBlock = formatFaeCharacterMemoBlock(state);
                let newMemo = currentMemo;
                if (charBlockRegex.test(newMemo)) {
                    newMemo = newMemo.replace(charBlockRegex, newCharBlock);
                } else if (newMemo.trim()) {
                    newMemo = newCharBlock + '\n\n' + newMemo;
                } else {
                    newMemo = formatInitialFaeMemo(state);
                }

                if (rpgSettings) {
                    rpgSettings.currentMemo = newMemo;
                    if (chatId && rpgSettings.chatStates?.[chatId]) {
                        rpgSettings.chatStates[chatId].currentMemo = newMemo;
                    }
                    saveSettingsDebounced();
                }

                if (chatId) {
                    await forceRenderTrackerView(rpgSettings, chatId, newMemo, { persist: true });
                }

                showToast('success', `FAE Rest (${eventType}) applied! ${restRes.summary}`, 'FAE Rest');
                return `FAE Rest (${eventType}): ${restRes.summary || 'Rest completed with no pool changes.'}`;
            },
            helpString: '<div>Triggers an FAE rest or passive drain event and updates the character sheet. Usage: <code>/mhc-fae-rest [scene_breather|camp_or_sleep|haven_or_specialist|day_pass|scene_transition]</code></div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-dnd',
            callback: async () => {
                const ok = await restoreStockDnd();
                return ok ? 'This chat restored to factory D&D 5e ruleset.' : 'Failed to restore D&D ruleset.';
            },
            helpString: '<div>Restores MultiHog back to factory default D&D 5e ruleset.</div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-concierge',
            callback: async () => {
                await openConciergeModal();
                return 'PbtA Concierge Session Zero opened.';
            },
            helpString: '<div>Opens the interactive PbtA Concierge Session Zero worldbuilder.</div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-pbta-sync',
            aliases: ['pbta-sync'],
            callback: async () => {
                const hydrated = await hydratePbtaMemoIfNeeded();
                if (hydrated) {
                    showToast('success', 'PbtA game state memo synchronized! Multihog tracker updated. 🎲', 'PbtA Sync');
                    return 'PbtA game state memo hydrated and Multihog panel updated.';
                } else {
                    showToast('info', 'PbtA tracker is already up to date.', 'PbtA Sync');
                    return 'PbtA panel is already up to date.';
                }
            },
            helpString: '<div>Synchronizes the Multihog D&D Framework panel with the active PbtA Campaign Dossier.</div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-lore-sync',
            aliases: ['lore-sync'],
            callback: async () => {
                const res = await syncCampaignLorebooks({ force: true });
                await updateLorebookSyncUI();
                return res.message;
            },
            helpString: '<div>Synchronizes MultiHog campaign lorebooks with the active adventure chat name.</div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-rel-sync',
            aliases: ['rel-sync'],
            callback: async () => {
                const initRes = await scanAndInitUnsyncedNpcs({ forceAll: false, allowLlmScan: true });
                const tierRes = await checkAndSyncTierCrossovers();
                updateRelationshipSyncUI();
                return `Relationship Sync: scanned ${initRes.scanned} (initialized ${initRes.initialized}), checked ${tierRes.checked} (tier evolved ${tierRes.updated}).`;
            },
            helpString: '<div>Synchronizes MultiHog NPC relationships and campaign lorebooks.</div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-history-check',
            aliases: ['history-check'],
            callback: async () => {
                const scan = await scanAllChatHistories();
                const report = formatHistoryDiagnosticReport(scan);
                console.log('[MultiHog Companion] /mhc-history-check Report:\n' + report);
                if (scan.brokenCount > 0 || !scan.integrity.healthy) {
                    showToast(
                        'warning',
                        `Found ${scan.brokenCount} broken history file(s)${scan.integrity.persistenceBlocked ? ' (Persistence LOCKED)' : ''}. Full report logged to console (F12).`,
                        'History Diagnostic'
                    );
                } else {
                    showToast(
                        'success',
                        `All ${scan.fileBackedCount} file-backed chat history pointer(s) verified OK!`,
                        'History Diagnostic'
                    );
                }
                return report;
            },
            helpString: '<div>Scans all MultiHog chat partitions, verifies offloaded <code>multihog_history_*.json.gz</code> files and SHA-256 checksums, and reports any broken pointers or projection locks.</div>',
        }));

        registerCyoaSlashCommands(SlashCommandParser, SlashCommand, { getSettings, isPbtaActive: isPbtAActive, showToast });
    }

    // 4. Register Event Listeners & Runtime API Sanitizers
    initAdventureChatRenameGuard();
    initCyoaSafetyNet({ getSettings, isPbtaActive: isPbtAActive, showToast, eventSource, event_types });
    installMacroSyntaxSanitizer();

    // [CATALOG: EVT-01]
    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, setupImagineInterceptor);
    }
    setupMultiHogRollHooks(() => {
        const s = getSettings();
        return s.enableNameRag !== false && s.nameRagEnhanceMultiHog !== false;
    }, { showToast });

    // Pre-flight sanitizer for MultiHog Character Creation and Instant Action
    let _isSanitizingQuickStart = false;
    const runPreflightSanitizer = async function (e) {
        if (e?._mhcSanitized) return;

        const activeChatId = getActiveChatId();
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        const s = ctx?.extensionSettings?.rpg_tracker;
        const targetEl = this;

        if (!isPbtAActive(activeChatId) && !isFaeActive(activeChatId) && s && (isLiveSettingsPollutedWithPbtA(s) || isLiveSettingsPollutedWithFae(s))) {
            // Halt upstream runQuickStart until cleansing completes
            if (e && typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
            if (_isSanitizingQuickStart) return;
            _isSanitizingQuickStart = true;
            try {
                console.log('[MultiHog Companion] Sanitizing stale PbtA/FAE stock prompts before character generation...');
                await cleanseStockDndSettings(s, { chatId: activeChatId, syncSetup: true });
                if (s?.stockPrompts) {
                    const inputVal = (typeof $ !== 'undefined'
                        ? ($('#rt-quickstart-name').val()?.trim() || $('#rt-cr-name').val()?.trim() || '')
                        : '') || s?.characterCreatorDraft?.name || '';
                    sanitizeCharacterStockPrompt(s.stockPrompts, inputVal);
                }
            } catch (err) {
                console.warn('[MultiHog Companion] Preflight sanitizer error:', err);
            } finally {
                _isSanitizingQuickStart = false;
            }

            // Re-trigger click now that settings and catalogs are 100% clean D&D
            if (targetEl) {
                const reEvent = $.Event('click');
                reEvent._mhcSanitized = true;
                $(targetEl).trigger(reEvent);
            }
            return;
        }

        if (s?.stockPrompts) {
            const inputVal = (typeof $ !== 'undefined'
                ? ($('#rt-quickstart-name').val()?.trim() || $('#rt-cr-name').val()?.trim() || '')
                : '') || s?.characterCreatorDraft?.name || '';
            sanitizeCharacterStockPrompt(s.stockPrompts, inputVal);
        }
    };

    $(document).off('click.mhc_quickstart_sanitizer', '#rt-quickstart-begin, #rt-cr-generate-btn, .rt-quickstart-genre-btn');
    // [CATALOG: DOM-01a]
    $(document).on('click.mhc_quickstart_sanitizer', '#rt-quickstart-begin, #rt-cr-generate-btn, .rt-quickstart-genre-btn', runPreflightSanitizer);

    // Support keyboard submission (Enter key) on name input fields
    $(document).off('keydown.mhc_quickstart_sanitizer', '#rt-quickstart-name, #rt-cr-name');
    // [CATALOG: DOM-01b]
    $(document).on('keydown.mhc_quickstart_sanitizer', '#rt-quickstart-name, #rt-cr-name', function (e) {
        if (e.key === 'Enter') {
            void runPreflightSanitizer.call(this, e);
        }
    });

    // Wand menu initialization & click delegation
    initWandMenu();
    $(document).off('click.mhc_wand_cyoa', '#mhc_wand_cyoa_fix_reroll, #extensionsMenuButton');
    // [CATALOG: DOM-07] See LISTENERS.md — Wand Menu CYOA Fix/Reroll Trigger
    $(document).on('click.mhc_wand_cyoa', '#mhc_wand_cyoa_fix_reroll, #extensionsMenuButton', async function (e) {
        if (this.id === 'extensionsMenuButton') {
            initWandMenu();
            return;
        }
        await handleWandCyoaFixOrReroll({
            getSettings,
            isPbtaActive: isPbtAActive,
            showToast,
        });
    });

    $(document).off('click.mhc_level_up_xp', '.mhc-xp-level-up-ready');
    // [CATALOG: DOM-08] See LISTENERS.md — XP Bar Level-Up Trigger
    $(document).on('click.mhc_level_up_xp', '.mhc-xp-level-up-ready', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        await launchLevelUpOrRespecDesk({ isRespec: false });
    });

    $(document).off('click.mhc_wand_level_up', '#mhc_wand_level_up_respec');
    // [CATALOG: DOM-09] See LISTENERS.md — Wand Menu Level-Up / Respec Trigger
    $(document).on('click.mhc_wand_level_up', '#mhc_wand_level_up_respec', async function (e) {
        e.preventDefault();
        const isLevelUp = this.getAttribute('data-is-level-up') === 'true';
        if (isLevelUp) {
            await launchLevelUpOrRespecDesk({ isRespec: false });
        } else {
            let lastDesk = null;
            try {
                if (typeof sessionStorage !== 'undefined') {
                    lastDesk = sessionStorage.getItem('mhc_last_concierge_desk');
                }
            } catch (_) {}

            if (lastDesk === 'new-adventure') {
                const { openConciergeModal } = await import('./concierge-ui.js');
                await openConciergeModal({ navMode: 'new-adventure' });
                return;
            }
            if (lastDesk === 'living-world') {
                const { openConciergeModal } = await import('./concierge-ui.js');
                await openConciergeModal({ navMode: 'living-world' });
                return;
            }

            const rpgSettings = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
                || globalThis.extension_settings?.rpg_tracker
                || {};
            const curMemo = rpgSettings.currentMemo
                || (typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo')?.value : null)
                || '';
            if (curMemo && curMemo.trim().length > 0) {
                await launchLevelUpOrRespecDesk({ isRespec: true });
            } else {
                const { openConciergeModal } = await import('./concierge-ui.js');
                await openConciergeModal();
            }
        }
    });

    $(document).off('click.mhc_loc_reroll', '.menu_button, button, [id*="rt-loc-image"]');
    // [CATALOG: DOM-10] See LISTENERS.md — Location Image Reroll Interception & Aspect Ratio Bridge
    $(document).on('click.mhc_loc_reroll', '.menu_button, button, [id*="rt-loc-image"]', function (e) {
        handleLocationRerollClick(this);
    });

    $(document).off('click.mhc_manage_campaign_sets', '#mhc_lorebook_manage_sets');
    // [CATALOG: DOM-11] See LISTENERS.md — Open Campaign Set Manager modal
    $(document).on('click.mhc_manage_campaign_sets', '#mhc_lorebook_manage_sets', async function (e) {
        e.preventDefault();
        const { openCampaignSetManagerModal } = await import('./campaign-set-manager.js');
        await openCampaignSetManagerModal(SillyTavern?.getContext?.());
    });


    let _chatRenamedTimer = null;
    // [CATALOG: EVT-03]
    if (event_types.CHAT_RENAMED) {
        eventSource.on(event_types.CHAT_RENAMED, (detail) => {
            const s = getSettings();
            if (s.enableLorebookSync && s.autoSyncOnRename) {
                if (_chatRenamedTimer) clearTimeout(_chatRenamedTimer);
                const targetChatId = detail?.newFileName
                    ? String(detail.newFileName).replace(/\.jsonl$/i, '').trim()
                    : undefined;
                _chatRenamedTimer = setTimeout(async () => {
                    _chatRenamedTimer = null;
                    await syncCampaignLorebooks({ isAuto: true, chatId: targetChatId });
                    await updateLorebookSyncUI();
                }, 150);
            }
        });
    }

    // [CATALOG: EVT-13] See LISTENERS.md — Adventure Deletion & Orphaned Dossier Cleanup
    if (event_types.CHAT_DELETED) {
        eventSource.on(event_types.CHAT_DELETED, async (deletedChatId) => {
            try {
                if (!deletedChatId) return;
                const cleanId = String(deletedChatId).trim();
                const { deleteOldLorebooks, listAllWorldNames } = await import('./campaign-lore-sync.js');
                const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
                const allNames = await listAllWorldNames(ctx);

                // Candidates for this adventure's campaign dossier
                const candidateDossiers = new Set([
                    `Campaign_${cleanId}`,
                    `Campaign_${cleanId.replace(/\s+/g, '_')}`,
                    `Campaign_${cleanId.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
                ]);

                // Check other active chats in settings to ensure dossier isn't claimed elsewhere
                const s = typeof getSettings === 'function' ? getSettings() : null;
                const otherStates = Object.entries(s?.chatStates || {}).filter(([id]) => id !== cleanId);

                const toDelete = [];
                for (const book of allNames) {
                    if (candidateDossiers.has(book)) {
                        const isClaimedByOther = otherStates.some(([_, state]) =>
                            state?.campaignDossier?.meta?.title === cleanId ||
                            state?.companionDossier?.meta?.title === cleanId ||
                            state?.boundDossier === book
                        );
                        if (!isClaimedByOther) {
                            toDelete.push(book);
                        }
                    }
                }

                if (toDelete.length > 0) {
                    await deleteOldLorebooks(toDelete, ctx);
                    console.log('[MultiHog Companion] Cleaned orphaned campaign dossier(s):', toDelete);
                }
            } catch (err) {
                console.warn('[MultiHog Companion] Dossier cleanup on chat deletion skipped:', err);
            }
        });
    }
    // [CATALOG: EVT-04]
    eventSource.on(event_types.CHAT_CHANGED, (chatId) => {
        const activeChatId = (chatId && typeof chatId === 'string') ? chatId : getActiveChatId();
        setActiveImagineChatId(activeChatId);
        clearActiveLocationReroll();
        logRulesetEvent('CHAT_CHANGED', { activeChatId });
        if (typeof refreshConciergeActiveContext === 'function') {
            void refreshConciergeActiveContext().catch(() => {});
        }

        const token = ++_activeChatChangedToken;
        if (_chatChangedTimer) clearTimeout(_chatChangedTimer);
        _chatChangedTimer = setTimeout(() => {
            _chatChangedTimer = null;
            void runChatChangedCoordinator(activeChatId, token);
        }, 500);
    });

    // [CATALOG: EVT-07]
    // Canonical assistant turn listener: executes once the message is committed to DOM
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId, type) => {
        if (type === 'first_message') return;
        if (!isAdventureActive()) return;
        repairMixedFooterAndChoicesInChat();
        scheduleSync('CHARACTER_MESSAGE_RENDERED', 400);
        void coordinateTierSyncAfterTurn();
    });
    // [CATALOG: EVT-08]
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        if (isPersistingPbtaChatState()) {
            clearPersistingPbtaChatState();
            scheduleSync('SETTINGS_UPDATED', 600);
            return;
        }
        if (_isSettingsSyncActive) {
            _pendingSettingsUpdatedSync = true;
            return;
        }

        logRulesetEvent('SETTINGS_UPDATED', { activeChatId: getActiveChatId() });

        if (_settingsUpdatedTimer) clearTimeout(_settingsUpdatedTimer);
        _settingsUpdatedTimer = setTimeout(() => {
            _settingsUpdatedTimer = null;
            void runSettingsUpdatedCoordinator();
        }, 600);
    });

    // Initial check on load: single coordinated sequence after initial UI settle
    setTimeout(() => {
        void runInitialLoadCoordinator();
    }, 800);

    console.log('[MultiHog Companion] Extension loaded successfully.');
});
}

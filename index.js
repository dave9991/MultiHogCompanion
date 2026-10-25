/**
 * MultiHog Companion Extension
 *
 * Automatically synchronizes SillyTavern personas and portraits with
 * campaigns managed by Multihog D&D Framework:
 * 1. Persona Sync: Locks the character persona to the current chat.
 * 2. Portrait Sync: Pushes generated/assigned Multihog portraits into the persona avatar.
 */

import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import {
    PBTA_GENRES,
    buildPbtACartridge,
    buildPbtAQuickStartInstructions,
} from './pbta-ruleset.js';
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
} from './pbta-companion-bridge.js';
import {
    isPbtAActive,
    isPbtaChat,
    formatRulesetBadge,
    persistPbtaChatState,
    isPersistingPbtaChatState,
    clearPersistingPbtaChatState,
    ensureActiveChatRulesetConsistency,
    isLiveSettingsPollutedWithPbtA,
    cleanseStockDndSettings,
    logRulesetEvent,
    collectRulesetDiagnostics,
    getCompanionActiveCartridge,
    setCompanionActiveCartridge,
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
} from './cyoa-safety-net.js';
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
} from './character-creator-sanitizer.js';
import {
    isDndSubfooterAlignmentApplied,
    applyDndSubfooterAlignment,
    revertDndSubfooterAlignment,
} from './dnd-fixes.js';

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
async function refreshMultihogRuntime() {
    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.saveSettings === 'function') bridge.saveSettings();
        if (typeof bridge.autoApplySysprompt === 'function') await bridge.autoApplySysprompt(true);
        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
    } catch (_) {
        document.getElementById('rpg_tracker_btn_apply_sysprompt')?.click();
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
    const ctx = SillyTavern.getContext();
    return ctx.extensionSettings?.rpg_tracker || null;
}

/**
 * Helper to extract character name from a memo string.
 */
function extractNameFromMemo(memo) {
    if (!memo || typeof memo !== 'string') return null;
    const charBlock = memo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
    if (charBlock) {
        let firstLine = charBlock[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim();
        // Decode common HTML entities
        firstLine = firstLine
            .replace(/&quot;/g, '"')
            .replace(/&#34;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/^[-*•–—]\s*/, '')
            .trim();
        const m = firstLine.match(/^([^(:\[\n]{2,50}?)(?:\s*\(|\s*:)/);
        if (m) {
            const candidate = m[1].trim();
            if (isValidCharacterName(candidate)) return candidate;
            return null;
        }
        if (firstLine && isValidCharacterName(firstLine) && firstLine.length <= 50) {
            return firstLine;
        }
    }
    const nameField = memo.match(/(?:^|\n)\s*(?:Name|Character Name)\s*[:\|]\s*([^\n\|\[<]{2,60})/im);
    if (nameField) {
        const candidate = nameField[1].replace(/<[^>]+>/g, '').trim();
        if (isValidCharacterName(candidate)) return candidate;
    }
    return null;
}

/**
 * Helper to gather candidate chat IDs across SillyTavern and MultiHog context.
 */
function getCandidateChatIds(chatId) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    let raw = [];
    if (chatId) {
        raw = [chatId];
    } else {
        const stChatId = ctx?.getCurrentChatId?.() || ctx?.chatId || ctx?.chatMetadata?.chat_id || null;
        if (stChatId) {
            raw = [
                ctx?.getCurrentChatId?.(),
                ctx?.chatId,
                ctx?.chatMetadata?.chat_id,
            ];
        } else {
            raw = [
                (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null),
            ];
        }
    }
    const filtered = raw.filter(Boolean).map(String);
    const expanded = [];
    for (const id of filtered) {
        expanded.push(id);
        if (id.endsWith('.jsonl')) {
            expanded.push(id.slice(0, -6));
        } else {
            expanded.push(`${id}.jsonl`);
        }
    }
    return [...new Set(expanded)];
}

/**
 * Extract player character name from Multihog settings/memo strictly for this chat.
 */
function getMultihogPlayerName(chatId) {
    const s = getRpgSettings();
    if (!s) return null;

    const candidateIds = getCandidateChatIds(chatId);

    // 1. Chat partition playerCharacter or pbtaCampaignDossier
    for (const cid of candidateIds) {
        const pcName = s.chatStates?.[cid]?.playerCharacter?.name;
        if (pcName && isValidCharacterName(pcName)) {
            return pcName.trim();
        }
        const protoName = s.chatStates?.[cid]?.pbtaCampaignDossier?.protagonist?.name;
        if (protoName && isValidCharacterName(protoName)) {
            return protoName.trim();
        }
    }

    // 2. Chat partition currentMemo
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]?.currentMemo) {
            const name = extractNameFromMemo(s.chatStates[cid].currentMemo);
            if (name && isValidCharacterName(name)) return name;
        }
    }

    // 3. Current RPG memo [CHARACTER] block
    // Accept if projection owner matches candidate IDs OR is unset/empty (e.g. boot/reload, chat link disabled, or turn 0)
    const owner = String(s.chatStateProjectionOwner || '').trim();
    const isOwnerMatch = owner && candidateIds.some(cid => cid === owner);
    const isOwnerUnset = !owner;

    if ((isOwnerMatch || isOwnerUnset) && s.currentMemo) {
        const name = extractNameFromMemo(s.currentMemo);
        if (name && isValidCharacterName(name)) return name;
    }

    // 4. Top-level playerCharacter (if live and belongs to this chat)
    if ((isOwnerMatch || isOwnerUnset) && s.playerCharacter?.name) {
        const topName = s.playerCharacter.name.trim();
        if (isValidCharacterName(topName)) return topName;
    }

    return null;
}


/**
 * Generates normalized lookup keys/variants for a character or persona name.
 * Handles quoted nicknames (e.g., John "The axe" Smith), smart quotes, HTML entities,
 * parenthetical descriptors, and quote stripping (as done upstream by MultiHog DnD).
 * @param {string} rawName
 * @returns {string[]}
 */
export function getNameMatchingVariants(rawName) {
    if (!rawName || typeof rawName !== 'string') return [];
    // Decode HTML entities
    let str = rawName
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .trim();
    // Normalize unicode/curly quotes to standard straight quotes
    str = str.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

    const lower = str.toLowerCase();
    // 1. Without parentheses (e.g. "Bob (the Barbarian)" -> "Bob")
    const noParens = lower.replace(/\s*\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    // 2. Without quote characters (e.g. 'john "the axe" smith' -> 'john the axe smith')
    // MultiHog's buildNameOnlyPersonaIdentity strips quotes with replace(/['"\\]/g, '')
    const noQuotes = lower.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim();
    const noParensNoQuotes = noParens.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim();
    // 3. Without the quoted nickname altogether (e.g. 'john "the axe" smith' -> 'john smith')
    const noNickname = lower
        .replace(/\s*\(.*?\)/g, '')
        .replace(/\s*["'][^"']*["']/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return [...new Set([
        lower,
        noQuotes,
        noParens,
        noParensNoQuotes,
        noNickname,
    ])].filter(Boolean);
}

/**
 * Locate matching SillyTavern persona for the given character name.
 */
export async function findMatchingPersona(charName) {
    if (!charName) return null;
    const ctx = SillyTavern.getContext();
    let powerUser = ctx.power_user || window.power_user;
    if (!powerUser?.personas) {
        try {
            const pu = await import('../../../power-user.js');
            powerUser = pu.power_user;
        } catch (_) {}
    }
    if (!powerUser?.personas) return null;

    const charVariants = getNameMatchingVariants(charName);
    if (!charVariants.length) return null;

    // 1. Exact match across normalized variants
    // Catches:
    // - Exact raw match ("John \"The axe\" Smith" == "John \"The axe\" Smith")
    // - Upstream quote-stripped persona ("John \"The axe\" Smith" matching "John The axe Smith")
    // - Base-name persona without nickname ("John \"The axe\" Smith" matching "John Smith")
    // - Smart quotes vs straight quotes
    for (const [avatarId, personaName] of Object.entries(powerUser.personas)) {
        if (!personaName) continue;
        const personaVariants = getNameMatchingVariants(personaName);
        const hasVariantMatch = charVariants.some(cv => personaVariants.includes(cv));
        if (hasVariantMatch) {
            return { avatar: avatarId, name: personaName };
        }
    }

    // 2. Prefix / substring match for titled names (e.g. "Bob" matching "Bob the Barbarian")
    for (const [avatarId, personaName] of Object.entries(powerUser.personas)) {
        if (!personaName) continue;
        const personaVariants = getNameMatchingVariants(personaName);
        for (const cv of charVariants) {
            if (cv.length < 2) continue;
            for (const pv of personaVariants) {
                if (pv.length < 2) continue;
                if (cv.startsWith(pv) || pv.startsWith(cv)) {
                    return { avatar: avatarId, name: personaName };
                }
            }
        }
    }

    return null;
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
 * Retrieve player character portrait src from Multihog settings.
 * Prioritizes customPortraits (where manual uploads, replacements, and newly assigned portraits reside),
 * matching upstream MultiHog's resolvePortraitSrcForPlayerCharacter lookup sequence,
 * then falls back to pbtaCampaignDossier or playerCharacter objects.
 */
export function getMultihogPlayerPortrait(chatId, charName) {
    const s = getRpgSettings();
    if (!s) return null;

    const candidateIds = getCandidateChatIds(chatId);
    const candidateNames = [];
    if (charName) candidateNames.push(charName);

    // Also collect names from character blocks or playerCharacter across candidate partitions
    for (const cid of candidateIds) {
        const pcName = s.chatStates?.[cid]?.playerCharacter?.name;
        if (pcName && !candidateNames.includes(pcName)) candidateNames.push(pcName);
        const protoName = s.chatStates?.[cid]?.pbtaCampaignDossier?.protagonist?.name;
        if (protoName && !candidateNames.includes(protoName)) candidateNames.push(protoName);
    }
    const owner = String(s.chatStateProjectionOwner || '').trim();
    const isOwnerMatch = !owner || candidateIds.some(cid => cid === owner);
    if (isOwnerMatch && s.playerCharacter?.name && !candidateNames.includes(s.playerCharacter.name)) {
        candidateNames.push(s.playerCharacter.name);
    }

    const charVariants = [...new Set(candidateNames.flatMap(n => getNameMatchingVariants(n)))];

    const lookupInMap = (map, { allowGenericFallback = false } = {}) => {
        if (!map || typeof map !== 'object') return null;

        // 1. Exact match on candidate character names
        for (const name of candidateNames) {
            if (map[name]) return map[name];
        }

        // 2. Case-insensitive / normalized search across name variants
        const keys = Object.keys(map);
        for (const k of keys) {
            const keyVariants = getNameMatchingVariants(k);
            if (charVariants.some(cv => keyVariants.includes(cv))) {
                return map[k];
            }
        }

        // 3. Fallback for generic PC keys ONLY when explicitly allowed (e.g. partition scope)
        if (allowGenericFallback) {
            if (map['CHARACTER']) return map['CHARACTER'];
            if (map['PC']) return map['PC'];
        }

        return null;
    };

    // 1. Check chat partition customPortraits FIRST (holds user manual uploads and replaced portraits)
    for (const cid of candidateIds) {
        const part = s.chatStates?.[cid]?.customPortraits;
        const res = lookupInMap(part, { allowGenericFallback: true });
        if (res) return res;
    }

    // 2. Check live customPortraits (exact/variant match ONLY, no generic CHARACTER/PC fallback to prevent cross-chat bleed)
    const live = lookupInMap(s.customPortraits, { allowGenericFallback: false });
    if (live) return live;

    // 3. Check pbtaCampaignDossier or playerCharacter portraitSrc across candidate partitions
    for (const cid of candidateIds) {
        const dossierPortrait = s.chatStates?.[cid]?.pbtaCampaignDossier?.protagonist?.portraitSrc;
        if (dossierPortrait) return dossierPortrait;
        const pcPortrait = s.chatStates?.[cid]?.playerCharacter?.portraitSrc;
        if (pcPortrait) return pcPortrait;
    }

    // 4. Check live playerCharacter portrait if projection owner matches or unset
    if (isOwnerMatch && s.playerCharacter?.portraitSrc) {
        return s.playerCharacter.portraitSrc;
    }

    return null;
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
        const { getUserAvatar, getThumbnailUrl, getUserAvatars } = await import('../../../personas.js');
        if (typeof getUserAvatar === 'function') {
            await fetch(getUserAvatar(avatarId), { cache: 'reload' }).catch(() => {});
        }
        if (typeof getThumbnailUrl === 'function') {
            await fetch(getThumbnailUrl('persona', avatarId), { cache: 'reload' }).catch(() => {});
        }
        if (typeof getUserAvatars === 'function') {
            await getUserAvatars(true, avatarId).catch(() => {});
        }
    } catch (_) {}

    // Force DOM repaint with timestamp cache buster
    try {
        const updateSrcWithCacheBust = (src) => {
            if (!src) return src;
            try {
                const dummyBase = 'http://st.local';
                const parsed = new URL(src, dummyBase);
                parsed.searchParams.set('t', String(Date.now()));
                if (src.startsWith('http://') || src.startsWith('https://')) {
                    return parsed.href;
                }
                return parsed.pathname + parsed.search;
            } catch (_) {
                const sep = src.includes('?') ? '&' : '?';
                return `${src}${sep}t=${Date.now()}`;
            }
        };

        // Target ONLY elements belonging to this avatar, avoiding indiscriminate selection of #user_avatar_block
        const safeAvatarId = (avatarId || '').replace(/"/g, '\\"');
        const selector = [
            `.mes[is_user="true"] .avatar img`,
            `#avatar`,
            `#user_avatar_block [data-avatar-id="${safeAvatarId}"] img`,
            `img[src*="${safeAvatarId}"]`,
            `#quickPersonaImg`,
        ].join(', ');

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

        // If adventure is unstarted or in onboarding screen, skip runtime persona/portrait/vitality sync
        if (!isAdventureActive(chatId)) {
            return false;
        }


        let didWork = false;

        // 0. Ensure active chat ruleset consistency (rehydrates cartridge if MultiHog reset to D&D)
        const rulesetChanged = await ensureActiveChatRulesetConsistency(chatId);
        if (rulesetChanged) didWork = true;

        // 1. Auto-hydrate PbtA game state memo if needed
        const memoHydrated = await hydratePbtaMemoIfNeeded(chatId);
        if (memoHydrated) didWork = true;

        // 2. Synchronize PbtA Harm with descending tandem HP in live memo
        const rpgSettings = getRpgSettings();
        if (rpgSettings) {
            const vitalityUpdated = syncLivePbtaMemoVitality(rpgSettings, chatId);
            if (vitalityUpdated) {
                didWork = true;
                try {
                    const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
                    if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
                } catch (_) {}
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
    s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !p.id.startsWith('pbta_'));
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

    // 4b. Update CYOA config if defined in cartridge payload
    if (cartridge.payload.cyoaConfig) {
        s.cyoaConfig = s.cyoaConfig || {};
        Object.assign(s.cyoaConfig, cartridge.payload.cyoaConfig);
    }

    // 5. Update RNG settings to pure queue mode (d6 pairs, zero player interruption)
    s.rngEnabled = true;
    s.rngQueueD20 = true;
    s.rngQueueD100 = false;
    s.diceFunctionTool = false;
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
 * Restores MultiHog to factory D&D 5e settings.
 * Pulls actual factory defaults from MultiHog's defaults.js when available;
 * falls back to hardcoded values if the import fails (e.g. folder renamed).
 * @returns {Promise<boolean>}
 */
export async function restoreStockDnd() {
    const ctx = SillyTavern.getContext();
    const s = ctx.extensionSettings?.rpg_tracker;
    if (!s) return false;

    const activeChatId = getActiveChatId();
    await cleanseStockDndSettings(s, { chatId: activeChatId, syncSetup: true });

    if (activeChatId && s.chatStates?.[activeChatId]) {
        delete s.chatStates[activeChatId].pbtaCampaignDossier;
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

    const ok = await applyPbtACartridge(genreKey);
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
                await qs.runQuickStart(genre.multihogGenre, null, cleanCharName, instructions);
            } finally {
                if (rpgSettings) {
                    rpgSettings.onboardingSendStarterMessage = originalSendStarter;
                    if (originalLevel !== null) {
                        rpgSettings.onboardingLevel = originalLevel;
                    }
                }
            }

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
        const originalCallback = imagineCmd.callback;

        imagineCmd.callback = async function (args, trigger) {
            const settings = getSettings();

            if (settings.enableAspectRatioBridge) {
                // MultiHog's signature: quiet=true, gallery=false, extend=false
                const isQuiet = String(args?.quiet).toLowerCase() === 'true';
                const isNoGallery = String(args?.gallery).toLowerCase() === 'false';
                const isNoExtend = String(args?.extend).toLowerCase() === 'false';
                const isMultiHog = isQuiet && isNoGallery && isNoExtend;

                // Intervene only if MultiHog didn't provide width/height
                if (isMultiHog && args.width === undefined && args.height === undefined) {
                    const promptText = String(trigger || args?._unnamed || '');
                    // MultiHog scene system prompts always include keywords like 'wide shot', 'landscape', or 'scene'
                    const isScene = /wide shot|cinematic wide|landscape|establishing shot/i.test(promptText);

                    if (isScene) {
                        // 16:9 widescreen for scenes (matches ~512x512 pixel budget to prevent VRAM spill)
                        args.width = Number(settings.sceneWidth) || 672;
                        args.height = Number(settings.sceneHeight) || 384;
                    } else {
                        // 1:1 square for character/NPC portraits
                        args.width = Number(settings.portraitWidth) || 512;
                        args.height = Number(settings.portraitHeight) || 512;
                    }
                }
            }

            return await originalCallback(args, trigger);
        };

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
            badge.text('Disabled').css({
                background: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.4)',
                borderColor: 'rgba(255,255,255,0.1)',
            });
        } else if (status.inSync) {
            badge.text(`Prefix: ${status.targetPrefix || '—'}`).css({
                background: 'rgba(80,180,120,0.2)',
                color: '#88ffbb',
                borderColor: 'rgba(80,180,120,0.35)',
            });
        } else {
            const shortOld = status.currentPrefix
                ? (status.currentPrefix.length > 14 ? status.currentPrefix.slice(0, 14) + '…' : status.currentPrefix)
                : 'none';
            badge.text(`⚠️ Out of Sync (${shortOld})`).css({
                background: 'rgba(255,180,60,0.2)',
                color: '#ffcc88',
                borderColor: 'rgba(255,180,60,0.4)',
            });
        }

        if (chatDisplay.length) chatDisplay.text(status.chatTitle || '(none)');
        if (targetPrefixDisplay.length) targetPrefixDisplay.text(status.targetPrefix || '—');
        if (currentPrefixDisplay.length) currentPrefixDisplay.text(status.currentPrefix || '—');
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

        // ── Settings Sub-Tabs Navigation ──
        function setActiveTab(tabId) {
            $('.mhc-tab-btn').removeClass('active');
            $(`.mhc-tab-btn[data-tab="${tabId}"]`).addClass('active');
            $('.mhc-tab-content').removeClass('active').hide();
            $(`#mhc_tab_${tabId}`).addClass('active').show();
            try {
                localStorage.setItem('mhc_active_tab', tabId);
            } catch (_) {}
        }

        $('.mhc-tab-btn').on('click', function (e) {
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

        // ── PbtA Concierge Session Zero ──
        $('#mhc_open_concierge_btn').on('click', function (e) {
            e.preventDefault();
            openConciergeModal();
        });

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

        $('#mhc_pbta_load_cartridge').on('click', async function () {
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                await applyPbtACartridge(genreSelect.val());
            } finally {
                btn.prop('disabled', false);
            }
        });

        $('#mhc_pbta_roll_name').on('click', async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const genreKey = genreSelect.val();
            const genreObj = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;
            const name = await getRandomCharacterName(genreObj.multihogGenre || 'fantasy');
            $('#mhc_pbta_char_name').val(name);
        });

        $('#mhc_pbta_quickstart').on('click', async function () {
            const btn = $(this);
            const charName = ($('#mhc_pbta_char_name').val() || '').trim();
            const scenarioDesc = ($('#mhc_pbta_scenario_desc').val() || '').trim();
            btn.prop('disabled', true);
            try {
                await quickStartPbtA(genreSelect.val(), charName, scenarioDesc);
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

    // [CATALOG: FEAT-10] Dynamic Level-Up / Respec Wand item
    let levelUpBtn = document.getElementById('mhc_wand_level_up_respec');
    if (!levelUpBtn) {
        levelUpBtn = document.createElement('div');
        levelUpBtn.id = 'mhc_wand_level_up_respec';
        levelUpBtn.classList.add('list-group-item', 'flex-container', 'flexGap5');
        wandContainer.appendChild(levelUpBtn);
    }

    // Inspect active eligibility to determine label & icon
    try {
        const rpgSettings = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
            || globalThis.extension_settings?.rpg_tracker
            || {};
        const curMemo = rpgSettings.currentMemo
            || (typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo')?.value : null)
            || '';
        import('./level-up-runner.js').then(({ evaluateLevelUpEligibility }) => {
            const status = evaluateLevelUpEligibility(curMemo);
            if (status.eligible) {
                levelUpBtn.title = 'Milestone reached! Open Level-Up Desk to advance character';
                levelUpBtn.setAttribute('data-is-level-up', 'true');
                levelUpBtn.innerHTML = `
                    <div class="fa-solid fa-circle-arrow-up extensionsMenuExtensionButton" style="color: #fbbf24;"></div>
                    <span>⬆ Level Up Available (Lvl ${status.currentLevel} → ${status.nextLevel})</span>
                `;
            } else {
                levelUpBtn.title = 'Review build, tweak feats, or adjust stats with the Leveling Concierge';
                levelUpBtn.setAttribute('data-is-level-up', 'false');
                levelUpBtn.innerHTML = `
                    <div class="fa-solid fa-arrows-rotate extensionsMenuExtensionButton"></div>
                    <span>Respec / Edit Character Sheet</span>
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
    const chatId = ctx?.chatId || s.currentChatId || 'default';
    
    // Upstream MultiHog DnD Framework stores its active memo & partitions in extension_settings.rpg_tracker
    const rpgSettings = (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : null)
        || globalThis.extension_settings?.rpg_tracker
        || ctx?.extensionSettings?.rpg_tracker
        || {};
    const currentMemo = rpgSettings.currentMemo
        || (typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo')?.value : null)
        || s.currentMemo
        || '';

    const { ensureChatDossier, syncDossierToWorldInfoBook } = await import('./level-up-scaffold.js');
    const { getCanonicalDndProgression, hasProgressionBlueprint, generateProgressionBlueprintViaConcierge } = await import('./level-up-blueprint.js');
    const { evaluateLevelUpEligibility, decorateXpBarsForLevelUp } = await import('./level-up-runner.js');
    const { openLevelUpModal } = await import('./level-up-ui.js');

    const dossier = ensureChatDossier(chatId, s, { memo: currentMemo });
    const isPbta = isPbtaChat(chatId, rpgSettings, s)
        || isPbtAActive(chatId, rpgSettings, s)
        || dossier.meta?.systemKey === 'pbta'
        || !!dossier.protagonist?.isPbta
        || !!dossier.protagonist?.playbook;

    const eligibility = evaluateLevelUpEligibility(currentMemo, isPbta ? 'pbta' : dossier.meta?.systemKey);

    let blueprintPromise = null;

    // If PbtA, bypass 1–20 D&D progression blueprint generation
    if (isPbta) {
        dossier.progressionBlueprint = null;
        if (dossier.meta) {
            dossier.meta.systemKey = 'pbta';
            if (!dossier.meta.systemLabel || dossier.meta.systemLabel.includes('5e')) {
                dossier.meta.systemLabel = 'PbtA Narrative Engine';
            }
        }
    } else if (!hasProgressionBlueprint(dossier)) {
        const canonical = getCanonicalDndProgression(dossier.protagonist?.class);
        if (canonical) {
            dossier.progressionBlueprint = canonical;
        } else {
            // Kick off async Concierge generation without blocking modal display
            blueprintPromise = generateProgressionBlueprintViaConcierge({
                character: dossier.protagonist,
                genre: dossier.meta?.genre || 'fantasy',
                worldRules: dossier.meta?.systemLabel || '',
            }).then(bp => {
                if (bp) {
                    dossier.progressionBlueprint = bp;
                    if (s.chatStates && chatId) {
                        s.chatStates[chatId] = s.chatStates[chatId] || {};
                        s.chatStates[chatId].companionDossier = dossier;
                    }
                    if (ctx?.chat_metadata) {
                        ctx.chat_metadata.mhc_dossier = dossier;
                        if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
                    }
                    if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext?.()?.saveSettingsDebounced === 'function') {
                        SillyTavern.getContext().saveSettingsDebounced();
                    }
                }
                return bp;
            });
        }
    }

    // Ensure Campaign_<ChatTitle> World Info Lorebook is synced
    syncDossierToWorldInfoBook(chatId, dossier).catch(() => {});

    // If character does not have sufficient XP to level up, enforce Respec mode
    const effectiveIsRespec = isRespec || !eligibility.eligible;

    const targetLevel = isPbta
        ? null
        : (effectiveIsRespec
            ? (dossier.protagonist?.level || eligibility.currentLevel || 1)
            : (eligibility.nextLevel || eligibility.currentLevel + 1 || 2));

    // Two-Stage Progression Flow:
    // Stage 1 (Class Definition) is presented if an invented/homebrew D&D class does not yet have a progression codex.
    // Once the codex exists (or for canonical classes), it goes straight to Stage 2 (Level Up / Respec).
    const canonicalProg = getCanonicalDndProgression(dossier.protagonist?.class);
    const hasBlueprintAlready = hasProgressionBlueprint(dossier) || !!canonicalProg;
    const initialStage = (!isPbta && !hasBlueprintAlready) ? 1 : 2;

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
            decorateXpBarsForLevelUp(isPbta);
            initWandMenu();
        },
    });
}



// ── PbtA Detection & State Recovery ──────────────────────────────────────────────
export {
    isPbtAActive,
    isPbtaChat,
    formatRulesetBadge,
    persistPbtaChatState,
    ensureActiveChatRulesetConsistency,
    isLiveSettingsPollutedWithPbtA,
    cleanseStockDndSettings,
    logRulesetEvent,
    collectRulesetDiagnostics,
    getCompanionActiveCartridge,
    setCompanionActiveCartridge,
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
function buildPbtA2d6Block(lineCount = 12) {
    const turnId = Date.now();
    const lines = [];
    for (let i = 0; i < lineCount; i++) {
        const a = rollD6(), b = rollD6();
        lines.push(`${i + 1}: 2d6 → ${a} + ${b} = ${a + b}`);
    }
    return `[RNG_QUEUE v7.0 — PbtA 2d6]\nturn_id=${turnId}\nscope=this_response\n${lines.join('\n')}\n[/RNG_QUEUE]\n\n`;
}

/**
 * SillyTavern generate_interceptor — runs AFTER MultiHog's interceptor
 * (loading_order 30 > 20). When PbtA is active for the current chat,
 * replaces MultiHog's polyhedral RNG queue with a clean 2d6-only format.
 *
 * Registered on globalThis via the manifest's generate_interceptor field.
 */
function mhcGenerationInterceptor(chat, _contextSize, _abort, _type) {
    if (!Array.isArray(chat) || !isPbtAActive()) return;

    // MultiHog prepends its RNG block into the last user message's content.
    // Find it and replace with our clean 2d6 block.
    const rngPattern = /\[RNG_QUEUE\s+v[\d.]+\][\s\S]*?\[\/RNG_QUEUE\]\s*/g;

    for (let i = chat.length - 1; i >= Math.max(0, chat.length - 3); i--) {
        const msg = chat[i];
        if (!msg) continue;

        if (typeof msg.mes === 'string' && rngPattern.test(msg.mes)) {
            rngPattern.lastIndex = 0;
            msg.mes = msg.mes.replace(rngPattern, buildPbtA2d6Block());
            console.log('[MultiHog Companion] Replaced polyhedral RNG queue with PbtA 2d6 block.');
            return;
        }

        if (typeof msg.content === 'string' && rngPattern.test(msg.content)) {
            rngPattern.lastIndex = 0;
            msg.content = msg.content.replace(rngPattern, buildPbtA2d6Block());
            console.log('[MultiHog Companion] Replaced polyhedral RNG queue with PbtA 2d6 block.');
            return;
        }

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part?.type === 'text' && typeof part.text === 'string' && rngPattern.test(part.text)) {
                    rngPattern.lastIndex = 0;
                    part.text = part.text.replace(rngPattern, buildPbtA2d6Block());
                    console.log('[MultiHog Companion] Replaced polyhedral RNG queue with PbtA 2d6 block.');
                    return;
                }
            }
        }
    }
}

// [CATALOG: ADR-MP-03] See MONKEYPATCHES.md — SillyTavern Pipeline Generation Interceptor (PbtA 2d6 RNG Injection)
// Register the interceptor on globalThis so SillyTavern can call it.
globalThis.mhcGenerationInterceptor = mhcGenerationInterceptor;

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
        if (!isPbtAActive(targetChatId) && getSettings().enableDndSubfooterFix !== false) {
            const rpgSettings = getRpgSettings();
            if (rpgSettings && !isDndSubfooterAlignmentApplied(rpgSettings)) {
                await applyDndSubfooterAlignment({ rpgSettings });
            }
        }
        updateRulesetBadge();
        updateLorebookSyncUI();

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
 * Protects against infinite re-entrancy loops.
 */
async function runSettingsUpdatedCoordinator() {
    if (_isSettingsSyncActive) return;
    _isSettingsSyncActive = true;
    try {
        await ensureActiveChatRulesetConsistency();
        updateRulesetBadge();
        updateLorebookSyncUI();
        updateRelationshipSyncUI();
    } catch (err) {
        console.error('[MultiHog Companion] Error during settings updated coordinator:', err);
    } finally {
        _isSettingsSyncActive = false;
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
        updateRulesetBadge();
        updateLorebookSyncUI();
        updateRelationshipSyncUI();
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

        if (!isPbtAActive(activeChatId) && s && isLiveSettingsPollutedWithPbtA(s)) {
            // Halt upstream runQuickStart until cleansing completes
            if (e && typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
            if (_isSanitizingQuickStart) return;
            _isSanitizingQuickStart = true;
            try {
                console.log('[MultiHog Companion] Sanitizing stale PbtA stock prompts before character generation...');
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
        await launchLevelUpOrRespecDesk({ isRespec: !isLevelUp });
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
    // [CATALOG: EVT-04]
    eventSource.on(event_types.CHAT_CHANGED, (chatId) => {
        const activeChatId = (chatId && typeof chatId === 'string') ? chatId : getActiveChatId();
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
        scheduleSync('CHARACTER_MESSAGE_RENDERED', 400);
        void coordinateTierSyncAfterTurn();
    });
    // [CATALOG: EVT-08]
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        if (isPersistingPbtaChatState()) {
            clearPersistingPbtaChatState();
            return;
        }
        if (_isSettingsSyncActive) return;

        logRulesetEvent('SETTINGS_UPDATED', { activeChatId: getActiveChatId() });
        scheduleSync('SETTINGS_UPDATED', 600);

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

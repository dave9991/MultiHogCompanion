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
} from './pbta-vitality-sync.js';
import {
    discoverNameRagServer,
    testNameRagConnection,
} from './namerag-client.js';
import {
    setupMultiHogRollHooks,
    syncNameRagAdhocSysprompt,
    rollNameRagCandidate,
} from './namerag-hooks.js';

const EXTENSION_NAME = 'multihog_companion';
const EXTENSION_FOLDER = 'scripts/extensions/third-party/MultiHogCompanion';

const DEFAULT_SETTINGS = {
    enablePersonaSync: true,
    enablePortraitSync: true,
    showToasts: true,
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
    conciergeDebugMode: false,
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
 * Get active chat ID from SillyTavern or Multihog tracker.
 */
function getActiveChatId() {
    const ctx = SillyTavern.getContext();
    if (typeof globalThis._rpgCurrentChatId === 'function') {
        const id = globalThis._rpgCurrentChatId();
        if (id) return String(id);
    }
    return ctx.getCurrentChatId?.() || ctx.chatId || null;
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
            if (candidate && !/^(character|unknown|user|name)$/i.test(candidate)) return candidate;
        }
        if (firstLine && !/^(character|unknown|user|name)$/i.test(firstLine) && firstLine.length <= 50) {
            return firstLine;
        }
    }
    const nameField = memo.match(/(?:^|\n)\s*(?:Name|Character Name)\s*[:\|]\s*([^\n\|\[<]{2,60})/im);
    if (nameField) {
        const candidate = nameField[1].replace(/<[^>]+>/g, '').trim();
        if (candidate && !/^(character|unknown|user)$/i.test(candidate)) return candidate;
    }
    return null;
}

/**
 * Helper to gather candidate chat IDs across SillyTavern and MultiHog context.
 */
function getCandidateChatIds(chatId) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const raw = [
        chatId,
        getActiveChatId(),
        ctx?.getCurrentChatId?.(),
        ctx?.chatId,
        (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null),
    ].filter(Boolean).map(String);
    const expanded = [];
    for (const id of raw) {
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
        if (s.chatStates?.[cid]?.playerCharacter?.name) {
            return s.chatStates[cid].playerCharacter.name.trim();
        }
        if (s.chatStates?.[cid]?.pbtaCampaignDossier?.protagonist?.name) {
            return s.chatStates[cid].pbtaCampaignDossier.protagonist.name.trim();
        }
    }

    // 2. Chat partition currentMemo
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]?.currentMemo) {
            const name = extractNameFromMemo(s.chatStates[cid].currentMemo);
            if (name) return name;
        }
    }

    // 3. Current RPG memo [CHARACTER] block
    // Accept if projection owner matches candidate IDs OR is unset/empty (e.g. boot/reload, chat link disabled, or turn 0)
    const owner = String(s.chatStateProjectionOwner || '').trim();
    const isOwnerMatch = owner && candidateIds.some(cid => cid === owner);
    const isOwnerUnset = !owner;

    if ((isOwnerMatch || isOwnerUnset) && s.currentMemo) {
        const name = extractNameFromMemo(s.currentMemo);
        if (name) return name;
    }

    // 4. Top-level playerCharacter (if live)
    if (s.playerCharacter?.name) {
        return s.playerCharacter.name.trim();
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
 */
function getMultihogPlayerPortrait(chatId, charName) {
    const s = getRpgSettings();
    if (!s) return null;

    const candidateIds = getCandidateChatIds(chatId);

    // 1. Check pbtaCampaignDossier or playerCharacter portraitSrc across candidate partitions
    for (const cid of candidateIds) {
        const dossierPortrait = s.chatStates?.[cid]?.pbtaCampaignDossier?.protagonist?.portraitSrc;
        if (dossierPortrait) return dossierPortrait;
        const pcPortrait = s.chatStates?.[cid]?.playerCharacter?.portraitSrc;
        if (pcPortrait) return pcPortrait;
    }

    const charVariants = getNameMatchingVariants(charName);

    const lookupInMap = (map) => {
        if (!map || typeof map !== 'object') return null;

        // Exact match
        if (charName && map[charName]) return map[charName];

        // Case-insensitive / normalized search across name variants
        const keys = Object.keys(map);
        for (const k of keys) {
            const keyVariants = getNameMatchingVariants(k);
            if (charVariants.some(cv => keyVariants.includes(cv))) {
                return map[k];
            }
        }

        // Substring / prefix match
        for (const k of keys) {
            const keyVariants = getNameMatchingVariants(k);
            for (const cv of charVariants) {
                if (cv.length < 2) continue;
                for (const kv of keyVariants) {
                    if (kv.length < 2) continue;
                    if (cv.startsWith(kv) || kv.startsWith(cv)) {
                        return map[k];
                    }
                }
            }
        }

        if (map['CHARACTER']) return map['CHARACTER'];
        if (map['PC']) return map['PC'];
        return null;
    };

    // 2. Check all partition customPortraits
    for (const cid of candidateIds) {
        const part = s.chatStates?.[cid]?.customPortraits;
        const res = lookupInMap(part);
        if (res) return res;
    }

    // 3. Check live customPortraits
    const live = lookupInMap(s.customPortraits);
    if (live) return live;

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
        const bustParam = `?t=${Date.now()}`;
        const selector = `.mes[is_user="true"] .avatar img, #avatar, #user_avatar_block img, .persona_avatar_element, img[src*="${avatarId}"]`;
        if (typeof $ !== 'undefined') {
            $(selector).each(function () {
                const currentSrc = $(this).attr('src') || '';
                const baseSrc = currentSrc.split('?')[0];
                $(this).attr('src', `${baseSrc}${bustParam}`);
            });
        } else if (typeof document !== 'undefined') {
            document.querySelectorAll(selector).forEach(el => {
                const currentSrc = el.getAttribute('src') || '';
                const baseSrc = currentSrc.split('?')[0];
                el.setAttribute('src', `${baseSrc}${bustParam}`);
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
 * Skips execution if the portrait is already recorded as synced.
 */
async function syncPortraitToPersona(chatId, persona, portraitSrc) {
    const ctx = SillyTavern.getContext();
    const meta = ctx.chatMetadata?.multihog_companion || {};

    if (meta.synced_portrait === portraitSrc && meta.synced_persona === persona.avatar) {
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
 * Force-renders Multihog tracker cards and updates all persistence layers.
 * @param {object} s Multihog tracker settings
 * @param {string} chatId
 * @param {string} memo
 * @returns {Promise<boolean>}
 */
async function forceRenderTrackerView(s, chatId, memo) {
    if (!memo) return false;

    // 1. Textarea
    const textarea = document.getElementById('rpg-tracker-memo');
    if (textarea) textarea.value = memo;

    // 2. Multihog global helper
    if (typeof globalThis._rpgUpdateUIMemo === 'function') {
        globalThis._rpgUpdateUIMemo(memo);
    }

    // 3. Runtime bridge
    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.syncMemoView === 'function') bridge.syncMemoView();
        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
        if (typeof bridge.saveSettings === 'function') bridge.saveSettings();
    } catch (_) {}

    // 4. Force direct DOM card render if #rpg-tracker-render still shows .rt-empty
    const renderEl = document.getElementById('rpg-tracker-render');
    if (renderEl) {
        try {
            const renderer = await import('../SillyTavern-MultihogDnDFramework/renderer.js');
            if (typeof renderer.renderMemoAsCards === 'function') {
                const cardsHtml = renderer.renderMemoAsCards(memo, null, {});
                if (cardsHtml && !cardsHtml.includes('rt-empty')) {
                    renderEl.innerHTML = cardsHtml;
                    if (typeof renderer.bindRenderedCardEvents === 'function') {
                        renderer.bindRenderedCardEvents(renderEl, memo, false);
                    }
                }
            }
        } catch (domErr) {
            console.warn('[MultiHog Companion] Direct card render fallback error:', domErr);
        }
    }

    // 5. State manager
    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        if (typeof stateMgr.saveChatState === 'function' && chatId) {
            stateMgr.saveChatState(chatId);
        }
    } catch (_) {}

    // 6. SillyTavern settings persistence
    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
    } catch (_) {}

    console.log(`[MultiHog Companion] Hydrated Multihog game state memo for PbtA campaign in chat "${chatId}".`);
    return true;
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

    const candidateIds = [
        chatId,
        getActiveChatId(),
        ctx?.getCurrentChatId?.(),
        ctx?.chatId,
        (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null),
    ].filter(Boolean).map(String);
    const uniqueIds = [...new Set(candidateIds)];
    const effectiveChatId = uniqueIds[0] || 'active';

    const liveMemo = String(s.currentMemo || '').trim();
    const hasCharBlock = liveMemo && /\[CHARACTER\]/i.test(liveMemo);

    const trackerEl = document.getElementById('rpg-tracker-render');
    const isDomEmpty = trackerEl ? (trackerEl.querySelector('.rt-empty') !== null || !trackerEl.children.length) : false;

    // If liveMemo already has [CHARACTER] and the DOM is NOT empty, nothing to do
    if (hasCharBlock && !isDomEmpty) {
        return false;
    }

    // If liveMemo already has [CHARACTER] but DOM IS empty, re-poke and force-render!
    if (hasCharBlock && isDomEmpty) {
        return await forceRenderTrackerView(s, effectiveChatId, liveMemo);
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

    return await forceRenderTrackerView(s, effectiveChatId, initialMemo);
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

        let didWork = false;

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
            let powerUser = ctx.powerUser;
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
                const portraitChanged = await syncPortraitToPersona(chatId, persona, portraitSrc);
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
    s.customSyspromptLibrary.push(...cartridge.payload.customSyspromptLibrary);

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

    // 8. Re-apply sysprompt via MultiHog runtime bridge
    await refreshMultihogRuntime();

    const activeLabel = overrides.systemLabel || overrides.name || genre.label;
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

    // 1. Remove PbtA overrides from the custom sysprompt library
    if (s.customSyspromptLibrary) {
        s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !p.id.startsWith('pbta_'));
    }

    // 2. Pull factory defaults from MultiHog (graceful fallback)
    let factory;
    try {
        const defs = await import('../SillyTavern-MultihogDnDFramework/src/state/defaults.js');
        factory = defs.buildDefaultSettings();
    } catch (_) {
        factory = null;
    }

    // 3. Restore sysprompt modules from factory (or hardcoded fallback)
    const factoryModules = factory?.syspromptModules ?? {
        role: true, rng_system: true, combat: true, ruleset_note: true,
        end_of_output_footer: true, xp_system: true,
        '[PARTY]_mechanics': true,
        weapon_proficiencies: true, attacks_per_round: true, saving_throws: true,
        level_up_protocol: true, homebrew_and_custom_classes: true,
        resting: true, loot: true, random_events: true,
    };
    if (s.syspromptModules) {
        Object.assign(s.syspromptModules, factoryModules);
    }

    // 4. Restore stock prompts (delete allows MultiHog to fall back to its own factory constants)
    if (factory?.stockPrompts) {
        s.stockPrompts = { ...factory.stockPrompts };
    } else {
        delete s.stockPrompts;
    }

    // 4b. Restore CYOA prompt
    if (factory?.cyoaConfig) {
        s.cyoaConfig = JSON.parse(JSON.stringify(factory.cyoaConfig));
    } else if (s.cyoaConfig) {
        s.cyoaConfig.useCustomPrompt = false;
        s.cyoaConfig.customPromptText = '';
    }

    // 5. Restore block order and modules
    s.blockOrder = factory?.blockOrder
        ?? ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];
    if (factory?.modules && s.modules) {
        Object.assign(s.modules, factory.modules);
    } else if (s.modules) {
        s.modules.spells = true;
    }

    // 6. Restore RNG defaults
    s.rngEnabled = factory?.rngEnabled ?? true;
    s.rngQueueD20 = factory?.rngQueueD20 ?? true;
    s.rngQueueD100 = factory?.rngQueueD100 ?? false;
    s.diceFunctionTool = factory?.diceFunctionTool ?? false;

    saveSettingsDebounced();
    await refreshMultihogRuntime();

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
            await qs.runQuickStart(genre.multihogGenre, null, cleanCharName, instructions);
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

        // ── 6. Developer & Debug Mode Controls ──
        const debugCb = $('#mhc_concierge_debug_mode');
        debugCb.prop('checked', current.conciergeDebugMode || false);
        debugCb.on('change', function () {
            updateSettings({ conciergeDebugMode: $(this).is(':checked') });
        });

        $('#mhc_refresh_debug_btn').on('click', function () {
            renderDebugInspectorView();
            showToast('info', 'Concierge debug inspector view refreshed.', 'MultiHog Companion');
        });

        $(document).off('click.mhcDebugTrace', '.mhc-copy-debug-trace-btn').on('click.mhcDebugTrace', '.mhc-copy-debug-trace-btn', function () {
            const trace = window._mhcLastBuilderTransaction || window._lastConciergeBuilderDiagnostic;
            if (!trace) {
                if (typeof toastr !== 'undefined') toastr.warning('No diagnostic trace recorded yet.');
                return;
            }
            const md = formatDiagnosticTrace(trace);
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(md).then(() => {
                    if (typeof toastr !== 'undefined') toastr.success('Copied Antigravity debug trace to clipboard!');
                }).catch(() => {
                    prompt('Copy Antigravity debug trace:', md);
                });
            } else {
                prompt('Copy Antigravity debug trace:', md);
            }
        });

        renderDebugInspectorView();
    } catch (err) {
        console.error('[MultiHog Companion] Failed to load UI template:', err);
    }
}

// ── PbtA Detection ──────────────────────────────────────────────────────────────

/**
 * Check if PbtA overrides are currently enabled in MultiHog's live settings.
 * Per-chat scoping is handled by MultiHog's Chat Setup Link, which hydrates
 * the live customSyspromptLibrary with per-chat enabled states on chat switch.
 */
export function isPbtAActive() {
    const s = SillyTavern.getContext().extensionSettings?.rpg_tracker;
    if (!s?.customSyspromptLibrary) return false;
    return s.customSyspromptLibrary.some(p => p.id.startsWith('pbta_') && p.enabled);
}

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
    if (!isPbtAActive()) return;
    if (!Array.isArray(chat)) return;

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

// Register the interceptor on globalThis so SillyTavern can call it.
globalThis.mhcGenerationInterceptor = mhcGenerationInterceptor;

// ── Ruleset Status Badge ────────────────────────────────────────────────────────

/**
 * Update the status badge in the settings panel to show the active ruleset.
 */
function updateRulesetBadge() {
    const badge = document.getElementById('mhc_ruleset_status');
    const summary = document.getElementById('mhc_pbta_summary_line');
    if (!badge) return;

    if (isPbtAActive()) {
        const current = getSettings();
        const genreKey = current.lastGenre || 'fantasy';
        const genreObj = PBTA_GENRES[genreKey];
        const genreLabel = genreObj ? genreObj.label.split(' (')[0].replace(/^[^\w\s]+\s*/, '') : 'PbtA';

        badge.textContent = `🎲 PbtA (${genreLabel})`;
        badge.style.background = 'rgba(90,160,250,0.2)';
        badge.style.borderColor = 'rgba(90,160,250,0.5)';
        badge.style.color = '#88ccff';

        if (summary) {
            summary.innerHTML = `<span style="color: #88ccff; font-weight: 500;">🎲 ${genreObj?.icon || ''} ${genreLabel}</span> &mdash; 2d6 moves &amp; Harm clocks active`;
        }
    } else {
        badge.textContent = '⚔️ D&D 5e Active';
        badge.style.background = 'rgba(255,180,60,0.15)';
        badge.style.borderColor = 'rgba(255,180,60,0.4)';
        badge.style.color = '#ffcc88';

        if (summary) {
            summary.textContent = 'MultiHog running factory D&D 5e ruleset';
        }
    }
}

/**
 * Extension entry point.
 */
jQuery(async () => {
    // 1. Initialize UI
    await initUI();

    // 2. Setup Smart Aspect-Ratio & Crop Bridge (/imagine interceptor)
    setupImagineInterceptor();

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
    }

    // 4. Register Event Listeners
    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, setupImagineInterceptor);
    }
    setupMultiHogRollHooks(() => {
        const s = getSettings();
        return s.enableNameRag !== false && s.nameRagEnhanceMultiHog !== false;
    });
    if (event_types.CHAT_RENAMED) {
        eventSource.on(event_types.CHAT_RENAMED, async (detail) => {
            const s = getSettings();
            if (s.enableLorebookSync && s.autoSyncOnRename) {
                setTimeout(async () => {
                    await syncCampaignLorebooks({ isAuto: true });
                    await updateLorebookSyncUI();
                }, 200);
            }
        });
    }
    eventSource.on(event_types.CHAT_CHANGED, () => {
        scheduleSync('CHAT_CHANGED', 500);
        setTimeout(updateRulesetBadge, 600);
        setTimeout(updateLorebookSyncUI, 650);
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => scheduleSync('CHARACTER_MESSAGE_RENDERED', 400));
    eventSource.on(event_types.MESSAGE_RECEIVED, () => scheduleSync('MESSAGE_RECEIVED', 400));
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        scheduleSync('SETTINGS_UPDATED', 600);
        setTimeout(updateRulesetBadge, 700);
        setTimeout(updateLorebookSyncUI, 750);
    });

    // Initial check on load
    scheduleSync('INITIAL_LOAD', 1000);
    setTimeout(updateRulesetBadge, 1200);
    setTimeout(updateLorebookSyncUI, 1300);

    console.log('[MultiHog Companion] Extension loaded successfully.');
});

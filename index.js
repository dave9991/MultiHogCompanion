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
import { openConciergeModal } from './concierge-ui.js';

const EXTENSION_NAME = 'multihog_companion';
const EXTENSION_FOLDER = 'scripts/extensions/third-party/MultiHogCompanion';

const DEFAULT_SETTINGS = {
    enablePersonaSync: true,
    enablePortraitSync: true,
    showToasts: true,
    enableAspectRatioBridge: true,
    sceneWidth: 672,
    sceneHeight: 384,
    portraitWidth: 512,
    portraitHeight: 512,
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
 * Extract player character name from Multihog settings/memo.
 */
function getMultihogPlayerName(chatId) {
    const s = getRpgSettings();
    if (!s) return null;

    // 1. Chat partition playerCharacter
    if (chatId && s.chatStates?.[chatId]?.playerCharacter?.name) {
        return s.chatStates[chatId].playerCharacter.name.trim();
    }

    // 2. Top-level playerCharacter (if live)
    if (s.playerCharacter?.name) {
        return s.playerCharacter.name.trim();
    }

    // 3. Current RPG memo [CHARACTER] block
    const memo = s.currentMemo;
    if (memo && typeof memo === 'string') {
        const charBlock = memo.match(/\[CHARACTER\]([\s\S]*?)\[\/CHARACTER\]/i);
        if (charBlock) {
            const firstLine = charBlock[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim();
            const m = firstLine.match(/^([^(:\[\n]{2,50}?)(?:\s*\(|\s*:)/);
            if (m) {
                const candidate = m[1].trim();
                if (candidate && !/^(character|unknown|user|name)$/i.test(candidate)) return candidate;
            }
        }
        const nameField = memo.match(/(?:^|\n)\s*(?:Name|Character Name)\s*[:\|]\s*([^\n\|\[<]{2,60})/im);
        if (nameField) {
            const candidate = nameField[1].replace(/<[^>]+>/g, '').trim();
            if (candidate && !/^(character|unknown|user)$/i.test(candidate)) return candidate;
        }
    }

    return null;
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

    const clean = charName.trim().toLowerCase();

    // 1. Exact name match
    for (const [avatarId, name] of Object.entries(powerUser.personas)) {
        if (name && name.trim().toLowerCase() === clean) {
            return { avatar: avatarId, name };
        }
    }

    // 2. Prefix / substring match for titled names (e.g. "Bob" matching "Bob the Barbarian")
    for (const [avatarId, name] of Object.entries(powerUser.personas)) {
        if (name) {
            const n = name.trim().toLowerCase();
            if (clean.startsWith(n) || n.startsWith(clean)) {
                return { avatar: avatarId, name };
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

    const partitionPortraits = (chatId && s.chatStates?.[chatId]?.customPortraits) || null;
    const livePortraits = s.customPortraits || null;

    const lookupInMap = (map) => {
        if (!map || typeof map !== 'object') return null;
        if (charName) {
            if (map[charName]) return map[charName];
            const clean = charName.trim().toLowerCase();
            const foundKey = Object.keys(map).find(k => k.trim().toLowerCase() === clean);
            if (foundKey && map[foundKey]) return map[foundKey];
        }
        if (map['CHARACTER']) return map['CHARACTER'];
        if (map['PC']) return map['PC'];
        return null;
    };

    return lookupInMap(partitionPortraits) || lookupInMap(livePortraits) || null;
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
        const url = imageSrc.startsWith('/') ? imageSrc : `/${imageSrc}`;
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
        const { getUserAvatar, getThumbnailUrl, reloadUserAvatar, getUserAvatars } = await import('../../../personas.js');
        if (typeof getUserAvatar === 'function') {
            await fetch(getUserAvatar(avatarId), { cache: 'reload' }).catch(() => {});
        }
        if (typeof getThumbnailUrl === 'function') {
            await fetch(getThumbnailUrl('persona', avatarId), { cache: 'reload' }).catch(() => {});
        }
        if (typeof reloadUserAvatar === 'function') {
            reloadUserAvatar(true);
        }
        if (typeof getUserAvatars === 'function') {
            await getUserAvatars(true, avatarId).catch(() => {});
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
 * Automatically hydrates the live Multihog memo and rendered dashboard
 * from an existing PbtA Campaign Dossier if the tracker is currently showing
 * the empty onboarding / "create an adventure" screen.
 *
 * @param {string} [chatId]
 * @returns {Promise<boolean>}
 */
export async function hydratePbtaMemoIfNeeded(chatId) {
    const s = getRpgSettings();
    if (!s) return false;
    const effectiveChatId = chatId || getActiveChatId();
    if (!effectiveChatId) return false;

    // Check if the current partition has a PbtA dossier
    const partition = s.chatStates?.[effectiveChatId];
    let dossier = partition?.pbtaCampaignDossier;

    // Fallback: check localStorage draft if partition didn't have it
    if (!dossier) {
        try {
            const rawDraft = localStorage.getItem('mhc_pbta_concierge_draft');
            if (rawDraft) {
                const parsed = JSON.parse(rawDraft);
                if (parsed?.protagonist?.name) {
                    dossier = parsed;
                }
            }
        } catch (_) {}
    }

    if (!dossier) return false;

    // If currentMemo already has a [CHARACTER] block, nothing to do
    const liveMemo = String(s.currentMemo || '').trim();
    if (liveMemo && /\[CHARACTER\]/i.test(liveMemo)) {
        return false;
    }

    const { formatInitialPbtaMemo } = await import('./pbta-ruleset.js');
    const initialMemo = formatInitialPbtaMemo(dossier);
    if (!initialMemo) return false;

    s.currentMemo = initialMemo;
    if (partition) {
        partition.currentMemo = initialMemo;
        partition.pbtaCampaignDossier = dossier;
    }

    if (typeof globalThis._rpgUpdateUIMemo === 'function') {
        globalThis._rpgUpdateUIMemo(initialMemo);
    }

    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.syncMemoView === 'function') bridge.syncMemoView();
        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
        if (typeof bridge.saveSettings === 'function') bridge.saveSettings();
    } catch (_) {}

    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        if (typeof stateMgr.saveChatState === 'function') {
            stateMgr.saveChatState(effectiveChatId);
        }
    } catch (_) {}

    console.log(`[MultiHog Companion] Hydrated Multihog game state memo for PbtA campaign in chat "${effectiveChatId}".`);
    return true;
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

        if (!settings.enablePersonaSync && !settings.enablePortraitSync) return didWork;

        const charName = getMultihogPlayerName(chatId);
        if (!charName) return didWork;

        const persona = await findMatchingPersona(charName);
        if (!persona) return didWork;

        if (settings.enablePersonaSync) {
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
 * Applies the PbtA Game Cartridge to MultiHog settings.
 * @param {string} genreKey
 * @returns {Promise<boolean>}
 */
export async function applyPbtACartridge(genreKey = 'fantasy') {
    const ctx = SillyTavern.getContext();
    const s = ctx.extensionSettings?.rpg_tracker;
    if (!s) {
        showToast('error', 'Multihog D&D Framework not detected.', 'MultiHog Companion');
        return false;
    }

    const cartridge = buildPbtACartridge(genreKey);
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

    showToast('success', `PbtA ruleset (${genre.label}) applied to this chat! 🎲`, 'PbtA Engine Active');
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

        personaCb.on('change', function () {
            updateSettings({ enablePersonaSync: $(this).is(':checked') });
        });

        portraitCb.on('change', function () {
            updateSettings({ enablePortraitSync: $(this).is(':checked') });
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
        const sceneW = $('#mhc_scene_width');
        const sceneH = $('#mhc_scene_height');
        const portraitW = $('#mhc_portrait_width');
        const portraitH = $('#mhc_portrait_height');
        const resetResolutionsBtn = $('#mhc_aspect_ratio_reset');

        aspectCb.prop('checked', current.enableAspectRatioBridge);
        sceneW.val(current.sceneWidth);
        sceneH.val(current.sceneHeight);
        portraitW.val(current.portraitWidth);
        portraitH.val(current.portraitHeight);

        aspectCb.on('change', function () {
            updateSettings({ enableAspectRatioBridge: $(this).is(':checked') });
        });

        sceneW.on('change', function () {
            const val = parseInt($(this).val(), 10);
            if (!isNaN(val) && val > 0) updateSettings({ sceneWidth: val });
        });

        sceneH.on('change', function () {
            const val = parseInt($(this).val(), 10);
            if (!isNaN(val) && val > 0) updateSettings({ sceneHeight: val });
        });

        portraitW.on('change', function () {
            const val = parseInt($(this).val(), 10);
            if (!isNaN(val) && val > 0) updateSettings({ portraitWidth: val });
        });

        portraitH.on('change', function () {
            const val = parseInt($(this).val(), 10);
            if (!isNaN(val) && val > 0) updateSettings({ portraitHeight: val });
        });

        resetResolutionsBtn.on('click', function () {
            sceneW.val(DEFAULT_SETTINGS.sceneWidth);
            sceneH.val(DEFAULT_SETTINGS.sceneHeight);
            portraitW.val(DEFAULT_SETTINGS.portraitWidth);
            portraitH.val(DEFAULT_SETTINGS.portraitHeight);
            updateSettings({
                sceneWidth: DEFAULT_SETTINGS.sceneWidth,
                sceneHeight: DEFAULT_SETTINGS.sceneHeight,
                portraitWidth: DEFAULT_SETTINGS.portraitWidth,
                portraitHeight: DEFAULT_SETTINGS.portraitHeight,
            });
            showToast('info', 'Resolutions reset to recommended defaults (672x384 & 512x512).', 'MultiHog Companion');
        });

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

        badge.textContent = '🎲 PbtA Active';
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
                return hydrated
                    ? 'PbtA game state memo hydrated and Multihog panel updated.'
                    : 'PbtA panel is already up to date.';
            },
            helpString: '<div>Synchronizes the Multihog D&D Framework panel with the active PbtA Campaign Dossier.</div>',
        }));
    }

    // 4. Register Event Listeners
    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, setupImagineInterceptor);
    }
    eventSource.on(event_types.CHAT_CHANGED, () => {
        scheduleSync('CHAT_CHANGED', 500);
        setTimeout(updateRulesetBadge, 600);
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => scheduleSync('CHARACTER_MESSAGE_RENDERED', 400));
    eventSource.on(event_types.MESSAGE_RECEIVED, () => scheduleSync('MESSAGE_RECEIVED', 400));
    eventSource.on(event_types.SETTINGS_UPDATED, () => {
        scheduleSync('SETTINGS_UPDATED', 600);
        setTimeout(updateRulesetBadge, 700);
    });

    // Initial check on load
    scheduleSync('INITIAL_LOAD', 1000);
    setTimeout(updateRulesetBadge, 1200);

    console.log('[MultiHog Companion] Extension loaded successfully.');
});

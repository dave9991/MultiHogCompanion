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
async function findMatchingPersona(charName) {
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
async function syncPersonaToChat(chatId, persona) {
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
async function uploadImageToPersona(avatarId, imageSrc) {
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
 * Main synchronizer function.
 */
export async function runSync(reason = '') {
    const settings = getSettings();
    if (!settings.enablePersonaSync && !settings.enablePortraitSync) return false;

    if (_isSyncing) return false;
    _isSyncing = true;

    try {
        const chatId = getActiveChatId();
        if (!chatId) return false;

        const charName = getMultihogPlayerName(chatId);
        if (!charName) return false;

        const persona = await findMatchingPersona(charName);
        if (!persona) return false;

        let didWork = false;

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

    // 8. Re-apply sysprompt via MultiHog runtime bridge if possible
    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.saveSettings === 'function') bridge.saveSettings();
        if (typeof bridge.autoApplySysprompt === 'function') await bridge.autoApplySysprompt(true);
        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
    } catch (_) {
        const applyBtn = document.getElementById('rpg_tracker_btn_apply_sysprompt');
        if (applyBtn) applyBtn.click();
    }

    if (typeof globalThis._rpgSyncSettingsUi === 'function') {
        globalThis._rpgSyncSettingsUi();
    }

    showToast('success', `PbtA ruleset (${genre.label}) applied to MultiHog! 🎲`, 'PbtA Engine Active');
    return true;
}

/**
 * Restores MultiHog to factory D&D 5e settings.
 * @returns {Promise<boolean>}
 */
export async function restoreStockDnd() {
    const ctx = SillyTavern.getContext();
    const s = ctx.extensionSettings?.rpg_tracker;
    if (!s) return false;

    // 1. Remove PbtA overrides
    if (s.customSyspromptLibrary) {
        s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !p.id.startsWith('pbta_'));
    }

    // 2. Re-enable standard base modules
    if (s.syspromptModules) {
        s.syspromptModules.role = true;
        s.syspromptModules.rng_system = true;
        s.syspromptModules.combat = true;
        s.syspromptModules.ruleset_note = true;
        s.syspromptModules.end_of_output_footer = true;
        s.syspromptModules.xp_system = true;
        s.syspromptModules.weapon_proficiencies = true;
        s.syspromptModules.attacks_per_round = true;
        s.syspromptModules.saving_throws = true;
    }

    // 3. Reset stock prompts (delete allows MultiHog to fall back to factory constants)
    delete s.stockPrompts;

    // 4. Reset block order
    s.blockOrder = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];
    if (s.modules) {
        s.modules.spells = true;
    }

    saveSettingsDebounced();

    try {
        const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
        if (typeof bridge.saveSettings === 'function') bridge.saveSettings();
        if (typeof bridge.autoApplySysprompt === 'function') await bridge.autoApplySysprompt(true);
        if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
    } catch (_) {
        const applyBtn = document.getElementById('rpg_tracker_btn_apply_sysprompt');
        if (applyBtn) applyBtn.click();
    }

    if (typeof globalThis._rpgSyncSettingsUi === 'function') {
        globalThis._rpgSyncSettingsUi();
    }

    showToast('info', 'Restored MultiHog to factory D&D 5e ruleset. 📦', 'Ruleset Restored');
    return true;
}

/**
 * Triggers Quick Start for a PbtA adventure.
 * @param {string} genreKey
 * @param {string} charName
 * @returns {Promise<void>}
 */
export async function quickStartPbtA(genreKey = 'fantasy', charName = '') {
    const ok = await applyPbtACartridge(genreKey);
    if (!ok) return;

    const genre = PBTA_GENRES[genreKey] || PBTA_GENRES.fantasy;
    const instructions = buildPbtAQuickStartInstructions(genreKey, charName);

    try {
        const qs = await import('../SillyTavern-MultihogDnDFramework/quickstart.js');
        if (typeof qs.runQuickStart === 'function') {
            showToast('info', `Starting ${genre.label} adventure...`, 'Quick Start');
            await qs.runQuickStart(genre.multihogGenre, null, charName, instructions);
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
            statusSpan.text('Syncing...');
            try {
                const didWork = await runSync('manual_button');
                statusSpan.text(didWork ? 'Synced!' : 'Up to date');
                setTimeout(() => statusSpan.text('Ready'), 2500);
            } catch (_) {
                statusSpan.text('Sync failed');
            } finally {
                syncBtn.prop('disabled', false);
            }
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

        // ── PbtA Ruleset Controls ──
        const genreSelect = $('#mhc_pbta_genre');
        const statsPreview = $('#mhc_pbta_stats_preview');
        const movesPreview = $('#mhc_pbta_moves_preview');

        function updateGenrePreview(key) {
            const g = PBTA_GENRES[key] || PBTA_GENRES.fantasy;
            if (statsPreview.length) statsPreview.text(`Stats: ${g.stats.join(', ')}`);
            if (movesPreview.length) movesPreview.text(`Key Moves: ${g.moves.slice(0, 4).map(m => m.split(' — ')[0]).join(', ')}`);
        }

        genreSelect.on('change', function () {
            updateGenrePreview($(this).val());
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

        $('#mhc_pbta_quickstart').on('click', async function () {
            const btn = $(this);
            const charName = ($('#mhc_pbta_char_name').val() || '').trim();
            btn.prop('disabled', true);
            try {
                await quickStartPbtA(genreSelect.val(), charName);
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
                const ok = await applyPbtACartridge(genre);
                return ok ? `PbtA ruleset (${genre}) loaded into MultiHog.` : 'Failed to load PbtA ruleset.';
            },
            helpString: '<div>Loads the PbtA (Powered by the Apocalypse) 2d6 ruleset cartridge into MultiHog. Usage: <code>/mhc-pbta [fantasy|scifi|anime|horror]</code></div>',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'mhc-dnd',
            callback: async () => {
                const ok = await restoreStockDnd();
                return ok ? 'MultiHog restored to factory D&D 5e ruleset.' : 'Failed to restore D&D ruleset.';
            },
            helpString: '<div>Restores MultiHog back to factory default D&D 5e ruleset.</div>',
        }));
    }

    // 4. Register Event Listeners
    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, setupImagineInterceptor);
    }
    eventSource.on(event_types.CHAT_CHANGED, () => scheduleSync('CHAT_CHANGED', 500));
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => scheduleSync('CHARACTER_MESSAGE_RENDERED', 400));
    eventSource.on(event_types.MESSAGE_RECEIVED, () => scheduleSync('MESSAGE_RECEIVED', 400));
    eventSource.on(event_types.SETTINGS_UPDATED, () => scheduleSync('SETTINGS_UPDATED', 600));

    // Initial check on load
    scheduleSync('INITIAL_LOAD', 1000);

    console.log('[MultiHog Companion] Extension loaded successfully.');
});

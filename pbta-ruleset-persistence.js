/**
 * pbta-ruleset-persistence.js
 *
 * Ensures PbtA ruleset configuration, cartridge prompts, and system settings
 * persist across page reloads (F5), chat setup snapshots, and chat switches.
 * Prevents MultiHog's Chat Setup Link from resetting PbtA campaigns to stock D&D.
 */

import { PBTA_GENRES, buildPbtACartridge } from './pbta-ruleset.js';
import { isAdventureActive } from './adventure-chat.js';

/**
 * Helper to gather candidate chat IDs across SillyTavern and MultiHog context,
 * expanding .jsonl extensions and checking projection owners.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @returns {string[]}
 */
export function getCandidateChatIds(chatId, rpgSettings = null) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
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
                rpgSettings?.chatStateProjectionOwner,
            ];
        }
    }
    const filtered = raw.filter(Boolean).map(String);
    const expanded = [];
    for (const id of filtered) {
        expanded.push(id);
        const collapsed = id.replace(/\s+/g, ' ');
        if (collapsed !== id) {
            expanded.push(collapsed);
        }
        if (id.endsWith('.jsonl')) {
            expanded.push(id.slice(0, -6));
            if (collapsed !== id) expanded.push(collapsed.slice(0, -6));
        } else {
            expanded.push(`${id}.jsonl`);
            if (collapsed !== id) expanded.push(`${collapsed}.jsonl`);
        }
    }
    return [...new Set(expanded)];
}

/**
 * Retrieve the explicit CompanionActiveCartridge record for a chat.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @param {object|null} [companionSettings=null]
 * @returns {object|null}
 */
export function getCompanionActiveCartridge(chatId = null, rpgSettings = null, companionSettings = null) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const comp = companionSettings
        || ctx?.extensionSettings?.multihog_companion
        || (typeof extension_settings !== 'undefined' ? extension_settings.multihog_companion : null);

    const candidateIds = getCandidateChatIds(chatId, rpgSettings);

    // 1. Check extension_settings.multihog_companion.companionActiveCartridges
    if (comp?.companionActiveCartridges && typeof comp.companionActiveCartridges === 'object') {
        for (const cid of candidateIds) {
            if (comp.companionActiveCartridges[cid]) {
                return comp.companionActiveCartridges[cid];
            }
        }
        // Normalize whitespace fallback
        const normCandidates = candidateIds.map(c => c.replace(/\s+/g, ' '));
        for (const [key, val] of Object.entries(comp.companionActiveCartridges)) {
            if (normCandidates.includes(key.replace(/\s+/g, ' '))) {
                return val;
            }
        }
    }

    // 2. Check ctx.chatMetadata?.CompanionActiveCartridge
    if (ctx?.chatMetadata?.CompanionActiveCartridge) {
        return ctx.chatMetadata.CompanionActiveCartridge;
    }

    return null;
}

/**
 * Stamp the explicit CompanionActiveCartridge record for a chat.
 *
 * @param {string|null} chatId
 * @param {object} cartridgeData e.g. { cartridgeId: 'pbta', genre: 'fantasy', systemLabel: 'Dungeon World' }
 * @param {object|null} [rpgSettings=null]
 * @param {object|null} [companionSettings=null]
 * @returns {boolean}
 */
export async function setCompanionActiveCartridge(chatId = null, cartridgeData = {}, rpgSettings = null, companionSettings = null) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    let comp = companionSettings
        || ctx?.extensionSettings?.multihog_companion
        || (typeof extension_settings !== 'undefined' ? extension_settings.multihog_companion : null);

    if (!comp && typeof extension_settings !== 'undefined') {
        extension_settings.multihog_companion = extension_settings.multihog_companion || {};
        comp = extension_settings.multihog_companion;
    }

    const candidateIds = getCandidateChatIds(chatId, rpgSettings);
    const primaryId = candidateIds[0] || chatId || 'active';

    const record = {
        ...cartridgeData,
        updatedAt: Date.now(),
    };

    if (comp) {
        comp.companionActiveCartridges = comp.companionActiveCartridges || {};
        for (const cid of candidateIds) {
            comp.companionActiveCartridges[cid] = { ...record };
        }
    }

    // Persist directly to chat metadata (written into line 1 of the chat .jsonl file)
    let chatMetaSaved = false;
    if (ctx?.chatMetadata) {
        ctx.chatMetadata.CompanionActiveCartridge = { ...record };
        if (typeof ctx.saveMetadata === 'function') {
            try {
                await ctx.saveMetadata();
                chatMetaSaved = true;
            } catch (err) {
                console.warn('[MultiHog Companion] saveMetadata failed:', err);
            }
        }
        if (!chatMetaSaved && typeof ctx.saveMetadataDebounced === 'function') {
            ctx.saveMetadataDebounced();
            chatMetaSaved = true;
        }
    }

    // Synchronize dossier into in-memory chatStates partition if present
    const s = rpgSettings || ctx?.extensionSettings?.rpg_tracker;
    if (s?.chatStates && record.dossier) {
        for (const cid of candidateIds) {
            if (s.chatStates[cid]) {
                s.chatStates[cid].pbtaCampaignDossier = record.dossier;
            }
        }
    }

    logRulesetEvent('setCompanionActiveCartridge', {
        chatId: primaryId,
        cartridgeId: record.cartridgeId,
        genre: record.genre,
        systemLabel: record.systemLabel,
        hasDossier: !!record.dossier,
        chatMetaSaved,
    });

    // Save extension settings (attempt immediate saveSettings first to prevent F5 reload loss)
    if (typeof ctx?.saveSettings === 'function') {
        try {
            await ctx.saveSettings();
        } catch (_) {
            if (typeof ctx?.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
            }
        }
    } else if (typeof ctx?.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
    }

    return true;
}

/**
 * Check if PbtA overrides are active for the given or current chat.
 * Checks:
 * 0. Explicit CompanionActiveCartridge stamp (Primary source of truth)
 * 1. Live customSyspromptLibrary pbta_ entries
 * 2. Chat partition pbtaCampaignDossier across candidate IDs
 * 3. Chat setup syspromptSnippetStates
 * 4. Partition memo or live memo Harm markers
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @returns {boolean}
 */
export function isPbtAActive(chatId = null, rpgSettings = null, companionSettings = null) {
    // 0. Primary Source of Truth: Explicit CompanionActiveCartridge
    const activeCart = getCompanionActiveCartridge(chatId, rpgSettings, companionSettings);
    if (activeCart?.cartridgeId === 'pbta') {
        return true;
    }
    if (activeCart?.cartridgeId === 'dnd5e') {
        return false;
    }

    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;

    const candidateIds = getCandidateChatIds(chatId, s);
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]) {
            // 1. Chat partition contains a PbtA campaign dossier
            if (s.chatStates[cid].pbtaCampaignDossier) {
                return true;
            }

            // 2. Chat setup states have enabled pbta snippets
            const snippetStates = s.chatStates[cid].setup?.syspromptSnippetStates;
            if (snippetStates && typeof snippetStates === 'object') {
                if (Object.keys(snippetStates).some(k => k.startsWith('pbta_') && snippetStates[k])) {
                    return true;
                }
            }

            // 3. Chat memo contains PbtA markers
            const partitionMemo = s.chatStates[cid].currentMemo || '';
            if (typeof partitionMemo === 'string' && partitionMemo) {
                if (/Harm:\s*\d+/i.test(partitionMemo) || /\[PBTA_/i.test(partitionMemo) || /Hack & Slash/i.test(partitionMemo)) {
                    return true;
                }
            }
        }
    }

    // 4. Live settings / memo check (only if live settings belong to this chat)
    const owner = String(s.chatStateProjectionOwner || '').trim();
    const isOwnerMatch = !owner || candidateIds.some(cid => cid === owner);
    if (isOwnerMatch) {
        if (Array.isArray(s.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled)) {
            return true;
        }

        if (typeof s.currentMemo === 'string' && s.currentMemo) {
            if (/Harm:\s*\d+/i.test(s.currentMemo) || /\[PBTA_/i.test(s.currentMemo) || /Hack & Slash/i.test(s.currentMemo)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Check if a chat partition is bound to a PbtA campaign.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @returns {boolean}
 */
export function isPbtaChat(chatId = null, rpgSettings = null, companionSettings = null) {
    const activeCart = getCompanionActiveCartridge(chatId, rpgSettings, companionSettings);
    if (activeCart?.cartridgeId === 'pbta') return true;
    if (activeCart?.cartridgeId === 'dnd5e') return false;

    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;
    const candidateIds = getCandidateChatIds(chatId, s);
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]?.pbtaCampaignDossier) return true;
    }
    return isPbtAActive(chatId, s, companionSettings);
}

/**
 * Format badge label and summary for the active ruleset.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @param {string|null} [lastGenre='fantasy']
 * @param {object|null} [companionSettings=null]
 * @returns {{ isActive: boolean, displayLabel: string, badgeText: string, summaryHtml: string, badgeStyle: object }}
 */
export function formatRulesetBadge(chatId = null, rpgSettings = null, lastGenre = 'fantasy', companionSettings = null) {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    const candidateIds = getCandidateChatIds(chatId, s);
    const activeCart = getCompanionActiveCartridge(chatId, s, companionSettings);
    let dossier = null;
    for (const cid of candidateIds) {
        if (s?.chatStates?.[cid]?.pbtaCampaignDossier) {
            dossier = s.chatStates[cid].pbtaCampaignDossier;
            break;
        }
    }

    if (isPbtAActive(chatId, s)) {
        const genreKey = activeCart?.genre || dossier?.meta?.systemKey || lastGenre || 'fantasy';
        const genreObj = PBTA_GENRES[genreKey];

        let displayLabel = 'PbtA';
        if (activeCart?.systemLabel) {
            displayLabel = activeCart.systemLabel.replace(/^PbtA:\s*/i, '').trim();
        } else if (dossier?.meta?.systemLabel) {
            displayLabel = dossier.meta.systemLabel.replace(/^PbtA:\s*/i, '').trim();
        } else if (genreObj) {
            const m = genreObj.label.match(/\(([^)]+)\)/);
            displayLabel = m ? m[1].split('/')[0].trim() : genreObj.label.replace(/^[^\w\s]+\s*/, '').trim();
        }

        return {
            isActive: true,
            displayLabel,
            badgeText: `🎲 PbtA (${displayLabel})`,
            summaryHtml: `<span style="color: #88ccff; font-weight: 500;">🎲 ${genreObj?.icon || ''} ${displayLabel}</span> &mdash; 2d6 moves &amp; Harm clocks active`,
            badgeStyle: {
                background: 'rgba(90,160,250,0.2)',
                borderColor: 'rgba(90,160,250,0.5)',
                color: '#88ccff',
            },
        };
    }

    return {
        isActive: false,
        displayLabel: 'D&D 5e',
        badgeText: '⚔️ D&D 5e Active',
        summaryHtml: 'MultiHog running factory D&D 5e ruleset',
        badgeStyle: {
            background: 'rgba(255,180,60,0.15)',
            borderColor: 'rgba(255,180,60,0.4)',
            color: '#ffcc88',
        },
    };
}

let _isPersistingPbtaChatState = false;
let _persistResetTimer = null;
let _inFlightPersist = false;

export function isPersistingPbtaChatState() {
    return _isPersistingPbtaChatState;
}

export function clearPersistingPbtaChatState() {
    _isPersistingPbtaChatState = false;
    if (_persistResetTimer) {
        clearTimeout(_persistResetTimer);
        _persistResetTimer = null;
    }
}

/**
 * Persists the current chat's PbtA configuration into MultiHog's per-chat setup snapshot
 * and global snippet database, ensuring it survives F5 page reloads and chat switches.
 *
 * @param {string} chatId
 * @param {object|null} [rpgSettings=null]
 */
export async function persistPbtaChatState(chatId, rpgSettings = null) {
    if (!chatId) return;
    if (_inFlightPersist) return;
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return;

    _inFlightPersist = true;
    _isPersistingPbtaChatState = true;
    if (_persistResetTimer) clearTimeout(_persistResetTimer);
    _persistResetTimer = setTimeout(() => {
        _isPersistingPbtaChatState = false;
        _persistResetTimer = null;
    }, 2500);
    if (_persistResetTimer?.unref) {
        _persistResetTimer.unref();
    }
    try {
        try {
            const { checkHistoryPersistenceBlocked, isSameChatId } = await import('./history-integrity-guard.js');
            if (await checkHistoryPersistenceBlocked()) {
                console.warn(`[MultiHog Companion] Skipping persistPbtaChatState("${chatId}") because MultiHog history persistence is blocked.`);
                return;
            }
            if (s.chatStateProjectionOwner && !isSameChatId(chatId, s.chatStateProjectionOwner)) {
                console.warn(`[MultiHog Companion] Skipping persistPbtaChatState("${chatId}") because projectionOwner="${s.chatStateProjectionOwner}" does not match.`);
                return;
            }
        } catch (_) {}

        let snapshot = null;

        try {
            const setupMod = await import('../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js');
            if (typeof setupMod.syncChatSetupCatalogs === 'function') {
                setupMod.syncChatSetupCatalogs(s);
            }
            if (typeof setupMod.snapshotChatSetup === 'function') {
            snapshot = setupMod.snapshotChatSetup(s);
        }
    } catch (_) {
        // Fallback: manually ensure catalog & setup
        if (!s.syspromptSnippetDatabase) s.syspromptSnippetDatabase = [];
        if (Array.isArray(s.customSyspromptLibrary)) {
            for (const item of s.customSyspromptLibrary) {
                const idx = s.syspromptSnippetDatabase.findIndex(sn => sn.id === item.id);
                if (idx >= 0) s.syspromptSnippetDatabase[idx] = { ...item };
                else s.syspromptSnippetDatabase.push({ ...item });
            }
        }
        snapshot = {
            version: 3,
            syspromptSnippetStates: {},
            customFieldStates: {},
            gameSystemStates: {},
            stockPrompts: s.stockPrompts,
            modules: s.modules,
            blockOrder: s.blockOrder,
            syspromptModules: s.syspromptModules,
            cyoaConfig: s.cyoaConfig,
        };
        if (Array.isArray(s.customSyspromptLibrary)) {
            for (const item of s.customSyspromptLibrary) {
                if (item.id) snapshot.syspromptSnippetStates[item.id] = !!item.enabled;
            }
        }
    }

    const candidateIds = getCandidateChatIds(chatId, s);
    let existingDossier = null;
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]?.pbtaCampaignDossier) {
            existingDossier = s.chatStates[cid].pbtaCampaignDossier;
            break;
        }
    }

    s.chatStates = s.chatStates || {};
    for (const cid of candidateIds) {
        s.chatStates[cid] = s.chatStates[cid] || {};
        if (snapshot) {
            s.chatStates[cid].setup = snapshot;
        }
        if (existingDossier) {
            s.chatStates[cid].pbtaCampaignDossier = existingDossier;
        }
    }

    try {
        const persMod = await import('../SillyTavern-MultihogDnDFramework/src/state/chat-persistence.js');
        if (typeof persMod.saveChatState === 'function') {
            persMod.saveChatState(chatId);
        }
    } catch (_) {
        try {
            const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
            if (typeof stateMgr.saveChatState === 'function') {
                stateMgr.saveChatState(chatId);
            }
        } catch (_) {}
    }

    // Guarantee pbtaCampaignDossier remains on candidate partitions if saveChatState clobbered it
    if (existingDossier) {
        for (const cid of candidateIds) {
            if (s.chatStates[cid]) {
                s.chatStates[cid].pbtaCampaignDossier = existingDossier;
            }
        }
    }

    logRulesetEvent('persistPbtaChatState', {
        chatId,
        hasDossier: !!existingDossier,
        candidatesCount: candidateIds.length,
    });

    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (typeof ctx?.saveSettingsDebounced === 'function') {
        ctx.saveSettingsDebounced();
    }
    } catch (err) {
        console.warn('[MultiHog Companion] Error during persistPbtaChatState:', err);
        clearPersistingPbtaChatState();
    } finally {
        _inFlightPersist = false;
    }
}

/**
 * Detects if the live MultiHog settings object contains residual PbtA or Dungeon World
 * instructions in stockPrompts, disabled core D&D syspromptModules, or active pbta_ snippets.
 *
 * @param {object|null} s
 * @returns {boolean}
 */
export function isLiveSettingsPollutedWithPbtA(s) {
    if (!s || typeof s !== 'object') return false;

    // 1. Check stockPrompts for PbtA / Dungeon World markers
    const charPrompt = String(s.stockPrompts?.character || '');
    if (/NO D&D MECHANICS/i.test(charPrompt)
        || (/Harm:\s*\d+/i.test(charPrompt) && !/AC CALCULATION/i.test(charPrompt))
        || (/Might.*Agility.*Wits.*Heart/i.test(charPrompt) && !/Attr:\s*STR/i.test(charPrompt))) {
        return true;
    }

    const partyPrompt = String(s.stockPrompts?.party || '');
    if (/Dungeon World style/i.test(partyPrompt) || /moves_or_boons/i.test(partyPrompt) || /boon-driven hirelings/i.test(partyPrompt)) {
        return true;
    }

    const combatPrompt = String(s.stockPrompts?.combat || '');
    if (/Harm clock/i.test(combatPrompt) || /Tier 1: 1-2 Harm/i.test(combatPrompt)) {
        return true;
    }

    // 2. Check if core D&D modules were disabled by PbtA cartridge
    const mods = s.syspromptModules;
    if (mods && typeof mods === 'object') {
        if (mods.role === false && mods.combat === false && mods.rng_system === false) {
            return true;
        }
    }

    // 3. Check for enabled pbta_ snippets in customSyspromptLibrary
    if (Array.isArray(s.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled)) {
        return true;
    }

    // 4. Check for pbta_ snippets in syspromptSnippetDatabase or section order
    if (Array.isArray(s.syspromptSnippetDatabase) && s.syspromptSnippetDatabase.some(p => p.id?.startsWith('pbta_') && p.globalEnabled)) {
        return true;
    }
    if (Array.isArray(s.syspromptSectionOrder) && s.syspromptSectionOrder.some(k => k.startsWith('lib:pbta_'))) {
        return true;
    }

    // 5. Check if cyoaConfig has custom PbtA prompt active
    if (s.cyoaConfig?.useCustomPrompt && /\[INTERACTIVE CHOICE BUTTONS\]/i.test(s.cyoaConfig?.customPromptText || '')) {
        return true;
    }

    return false;
}

/**
 * Restores MultiHog live settings to pure factory D&D 5e configuration,
 * cleansing contaminated stockPrompts, syspromptModules, and blockOrder.
 * Safe and non-destructive: updates live memory and setup snapshot without popup/toast spam.
 *
 * @param {object|null} [s=null]
 * @param {object} [options={}]
 * @returns {Promise<boolean>}
 */
export async function cleanseStockDndSettings(s = null, options = {}) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const settings = s
        || ctx?.extensionSettings?.rpg_tracker
        || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : (globalThis.extension_settings?.rpg_tracker || null));
    if (!settings || typeof settings !== 'object') return false;

    // 1. Remove or disable PbtA overrides from customSyspromptLibrary, snippet database, and section order
    if (Array.isArray(settings.customSyspromptLibrary)) {
        settings.customSyspromptLibrary = settings.customSyspromptLibrary.filter(p => !p.id?.startsWith('pbta_'));
    }
    if (Array.isArray(settings.syspromptSnippetDatabase)) {
        settings.syspromptSnippetDatabase = settings.syspromptSnippetDatabase.filter(p => !p.id?.startsWith('pbta_'));
    }
    if (Array.isArray(settings.syspromptSectionOrder)) {
        settings.syspromptSectionOrder = settings.syspromptSectionOrder.filter(k => !k.startsWith('lib:pbta_'));
    }
    if (Array.isArray(settings.gameSystemDatabase)) {
        settings.gameSystemDatabase = settings.gameSystemDatabase.filter(p => !p.id?.startsWith('pbta_'));
    }
    if (Array.isArray(settings.gameSystems)) {
        settings.gameSystems = settings.gameSystems.filter(p => !p.id?.startsWith('pbta_'));
    }

    // 2. Pull factory defaults from MultiHog defaults.js (with resilient fallback)
    let factory = null;
    try {
        const defs = await import('../SillyTavern-MultihogDnDFramework/src/state/defaults.js');
        if (typeof defs.buildDefaultSettings === 'function') {
            factory = defs.buildDefaultSettings();
        }
    } catch (_) {
        factory = null;
    }

    // 3. Restore syspromptModules
    const dndBaseModules = {
        role: true,
        rng_system: true,
        combat: true,
        ruleset_note: true,
        end_of_output_footer: true,
        xp_system: true,
        '[PARTY]_mechanics': true,
        weapon_proficiencies: true,
        attacks_per_round: true,
        saving_throws: true,
        level_up_protocol: true,
        homebrew_and_custom_classes: true,
        resting: true,
        loot: true,
        random_events: true,
    };
    const factoryModules = {
        ...dndBaseModules,
        ...(factory?.syspromptModules || {}),
    };
    if (settings.syspromptModules && typeof settings.syspromptModules === 'object') {
        Object.assign(settings.syspromptModules, factoryModules);
    } else {
        settings.syspromptModules = { ...factoryModules };
    }

    // 4. Restore stockPrompts
    if (factory?.stockPrompts) {
        settings.stockPrompts = { ...factory.stockPrompts };
    } else {
        try {
            const consts = await import('../SillyTavern-MultihogDnDFramework/constants.js');
            if (consts.DEFAULT_STOCK_PROMPTS) {
                settings.stockPrompts = { ...consts.DEFAULT_STOCK_PROMPTS };
            } else {
                delete settings.stockPrompts;
            }
        } catch (_) {
            delete settings.stockPrompts;
        }
    }

    // 5. Restore cyoaConfig
    if (factory?.cyoaConfig) {
        settings.cyoaConfig = JSON.parse(JSON.stringify(factory.cyoaConfig));
    } else if (settings.cyoaConfig) {
        settings.cyoaConfig.useCustomPrompt = false;
        settings.cyoaConfig.customPromptText = '';
    }

    // 6. Restore block order and modules
    settings.blockOrder = factory?.blockOrder
        ?? ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];
    if (factory?.modules && settings.modules) {
        Object.assign(settings.modules, factory.modules);
    } else if (settings.modules) {
        settings.modules.spells = true;
    }

    // 7. Restore RNG defaults
    settings.rngEnabled = factory?.rngEnabled ?? true;
    settings.rngQueueD20 = factory?.rngQueueD20 ?? true;
    settings.rngQueueD100 = factory?.rngQueueD100 ?? false;
    settings.diceFunctionTool = factory?.diceFunctionTool ?? false;

    // 8. Synchronize chat setup snapshot if requested and chat partition exists
    const targetChatId = options.chatId
        || ctx?.getCurrentChatId?.() || ctx?.chatId
        || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
        || null;

    if (options.syncSetup && targetChatId && settings.chatStates?.[targetChatId]) {
        try {
            const { checkHistoryPersistenceBlocked, isSameChatId } = await import('./history-integrity-guard.js');
            const blocked = await checkHistoryPersistenceBlocked();
            const ownerOk = !settings.chatStateProjectionOwner || isSameChatId(targetChatId, settings.chatStateProjectionOwner);
            if (!blocked && ownerOk) {
                const setupMod = await import('../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js');
                if (typeof setupMod.snapshotChatSetup === 'function') {
                    settings.chatStates[targetChatId].setup = setupMod.snapshotChatSetup(settings);
                }
                const persMod = await import('../SillyTavern-MultihogDnDFramework/src/state/chat-persistence.js');
                if (typeof persMod.saveChatState === 'function') {
                    persMod.saveChatState(targetChatId);
                }
            }
        } catch (_) {}
    }

    // 8b. Explicitly stamp the chat as dnd5e to prevent false-positive ruleset bleed
    if (targetChatId) {
        try {
            await setCompanionActiveCartridge(targetChatId, {
                cartridgeId: 'dnd5e',
                genre: 'fantasy',
                systemLabel: 'D&D 5e',
            }, settings);
        } catch (_) {}
    }

    // 9. Save settings debounced & re-apply sysprompt in live runtime
    if (typeof SillyTavern !== 'undefined') {
        if (typeof ctx?.saveSettingsDebounced === 'function') {
            ctx.saveSettingsDebounced();
        }
        try {
            const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
            if (typeof bridge.autoApplySysprompt === 'function') {
                await bridge.autoApplySysprompt(true);
            }
        } catch (_) {}
    }

    logRulesetEvent('cleanseStockDndSettings', {
        chatId: targetChatId,
        syncSetup: !!options.syncSetup,
    });

    return true;
}

/**
 * Ensures that if the active chat is a PbtA campaign, the cartridge, catalog definitions,
 * and setup snapshot are fully hydrated and active in MultiHog settings.
 * Prevents MultiHog's Chat Setup Link or F5 reloads from silently reverting to stock D&D.
 * Conversely, ensures that non-PbtA / unstarted chats are cleansed of any lingering PbtA stock prompts.
 *
 * @param {string|null} [chatId=null]
 * @param {object|null} [rpgSettings=null]
 * @param {Function|null} [applyCartridgeFn=null]
 * @returns {Promise<boolean>}
 */
export async function ensureActiveChatRulesetConsistency(chatId = null, rpgSettings = null, applyCartridgeFn = null, companionSettings = null) {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;

    try {
        const { checkHistoryPersistenceBlocked } = await import('./history-integrity-guard.js');
        if (await checkHistoryPersistenceBlocked()) {
            logRulesetEvent('ensureActiveChatRulesetConsistency:blocked_skip', { chatId });
            return false;
        }
    } catch (_) {}

    const candidateIds = getCandidateChatIds(chatId, s);
    let resolvedChatId = candidateIds[0] || null;
    let dossier = null;

    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]?.pbtaCampaignDossier) {
            dossier = s.chatStates[cid].pbtaCampaignDossier;
            resolvedChatId = cid;
            break;
        }
    }

    const activeCart = getCompanionActiveCartridge(chatId, s, companionSettings);
    if (!dossier && activeCart?.dossier) {
        dossier = activeCart.dossier;
        if (resolvedChatId && s.chatStates?.[resolvedChatId]) {
            s.chatStates[resolvedChatId].pbtaCampaignDossier = dossier;
        }
    }
    const isPbta = activeCart?.cartridgeId === 'pbta' || (!activeCart && (!!dossier || isPbtAActive(chatId, s, companionSettings)));
    const hasLiveOverrides = Array.isArray(s.customSyspromptLibrary)
        && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled);

    logRulesetEvent('ensureActiveChatRulesetConsistency', {
        chatId,
        resolvedChatId,
        isPbta,
        activeCartridge: activeCart?.cartridgeId || null,
        hasDossier: !!dossier,
        hasLiveOverrides,
    });

    if (!isPbta) {
        if (isLiveSettingsPollutedWithPbtA(s)) {
            await cleanseStockDndSettings(s, { chatId: resolvedChatId || chatId, syncSetup: true });
        }
        return false;
    }

    // Never rehydrate or force PbtA onto an unstarted chat unless it has an explicit cartridge or dossier
    if (!activeCart && !dossier && !isAdventureActive(chatId)) {
        if (isLiveSettingsPollutedWithPbtA(s)) {
            await cleanseStockDndSettings(s, { chatId: resolvedChatId || chatId, syncSetup: true });
        }
        return false;
    }

    if (!hasLiveOverrides) {
        console.log(`[MultiHog Companion] Active chat ${resolvedChatId || chatId} has active cartridge PbtA, but live customSyspromptLibrary was not hydrated (e.g. reload or setup reset). Rehydrating cartridge...`);
        const genreKey = activeCart?.genre || dossier?.meta?.systemKey || 'fantasy';
        const statsList = Object.keys(dossier?.protagonist?.stats || {});
        const safeId = (resolvedChatId || chatId || 'pbta').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const overrides = dossier ? {
            id: `pbta_${safeId}`,
            campaignTitle: activeCart?.title || dossier.meta?.title,
            name: activeCart?.systemLabel || (dossier.meta?.title ? `PbtA: ${dossier.meta.title}` : null),
            systemLabel: activeCart?.systemLabel || dossier.meta?.systemLabel,
            description: dossier.meta?.premise,
            tone: dossier.meta?.tone,
            factions: dossier.factions,
            worldRules: dossier.worldRules,
            stats: statsList.length >= 3 ? statsList : null,
            startingMoves: dossier.protagonist?.startingMoves,
            cyoaExamples: (Array.isArray(dossier.cyoaExamples) && dossier.cyoaExamples.length > 0) ? dossier.cyoaExamples : null,
            config: dossier.config || {},
            dossier,
        } : (activeCart ? {
            id: `pbta_${safeId}`,
            campaignTitle: activeCart.title,
            systemLabel: activeCart.systemLabel,
        } : {});

        if (typeof applyCartridgeFn === 'function') {
            await applyCartridgeFn(genreKey, overrides);
        } else {
            // Standalone rehydration directly on settings
            const cartridge = buildPbtACartridge(genreKey, overrides);
            if (!s.customSyspromptLibrary) s.customSyspromptLibrary = [];
            s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !p.id.startsWith('pbta_'));
            const pbtaSnippets = cartridge.payload.customSyspromptLibrary.map(item => ({
                ...item,
                enabled: true,
                scope: 'chat',
                _chatSetupMember: true,
            }));
            s.customSyspromptLibrary.push(...pbtaSnippets);

            s.syspromptModules = s.syspromptModules || {};
            Object.assign(s.syspromptModules, cartridge.payload.syspromptModules);

            s.stockPrompts = s.stockPrompts || {};
            Object.assign(s.stockPrompts, cartridge.payload.stockPrompts);

            if (cartridge.payload.cyoaConfig) {
                s.cyoaConfig = s.cyoaConfig || {};
                Object.assign(s.cyoaConfig, cartridge.payload.cyoaConfig);
            }

            s.rngEnabled = true;
            s.rngQueueD20 = true;
            s.rngQueueD100 = false;
            s.diceFunctionTool = false;
            s.diceD100Mode = false;

            s.blockOrder = [...cartridge.payload.blockOrder];
            if (s.modules) {
                Object.assign(s.modules, cartridge.payload.modules);
            }

            if (resolvedChatId) {
                await persistPbtaChatState(resolvedChatId, s);
            }
        }
        return true;
    }

    // Overrides are live; make sure setup snapshot is current in the partition
    if (resolvedChatId) {
        const existingSetup = s.chatStates?.[resolvedChatId]?.setup;
        const hasPbtaSnippets = existingSetup?.customSyspromptLibrary?.some(p => p.id?.startsWith('pbta_'))
            || Object.keys(existingSetup?.syspromptSnippetStates || {}).some(k => k.startsWith('pbta_') && existingSetup.syspromptSnippetStates[k]);
        if (!existingSetup || !hasPbtaSnippets) {
            await persistPbtaChatState(resolvedChatId, s);
        }
    }
    return true;
}

/**
 * In-memory ring buffer recording ruleset lifecycle events.
 *
 * @param {string} eventName
 * @param {object} [details={}]
 */
export function logRulesetEvent(eventName, details = {}) {
    if (typeof globalThis === 'undefined') return;
    globalThis._mhcRulesetEventLog = globalThis._mhcRulesetEventLog || [];
    const entry = {
        time: new Date().toISOString().substring(11, 23),
        event: eventName,
        ...details,
    };
    globalThis._mhcRulesetEventLog.push(entry);
    if (globalThis._mhcRulesetEventLog.length > 50) {
        globalThis._mhcRulesetEventLog.shift();
    }
}

/**
 * Gather a comprehensive markdown diagnostic report of active chat state,
 * ruleset detection layers, MultiHog partitions, setup snapshots, and recent event logs.
 *
 * @param {string|null} [chatId=null]
 * @param {object|null} [rpgSettings=null]
 * @param {object|null} [companionSettings=null]
 * @returns {string} Markdown-formatted diagnostic report
 */
export function collectRulesetDiagnostics(chatId = null, rpgSettings = null, companionSettings = null) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    const s = rpgSettings || ctx?.extensionSettings?.rpg_tracker || null;
    const currentChatId = typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null;
    const candidates = getCandidateChatIds(chatId, s);
    const pbtaActive = isPbtAActive(chatId, s);
    const pbtaChat = isPbtaChat(chatId, s);
    const badge = formatRulesetBadge(chatId, s, companionSettings?.lastGenre || 'fantasy');

    // Identify which detection layers matched
    const layerMatches = [];
    if (Array.isArray(s?.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled)) {
        layerMatches.push('Layer 1: Live customSyspromptLibrary pbta_ snippets active');
    }
    for (const cid of candidates) {
        if (s?.chatStates?.[cid]?.pbtaCampaignDossier) {
            layerMatches.push(`Layer 2: Partition [${cid}] contains pbtaCampaignDossier`);
        }
        const snippetStates = s?.chatStates?.[cid]?.setup?.syspromptSnippetStates;
        if (snippetStates && typeof snippetStates === 'object') {
            if (Object.keys(snippetStates).some(k => k.startsWith('pbta_') && snippetStates[k])) {
                layerMatches.push(`Layer 3: Partition [${cid}] setup has enabled pbta_ snippets`);
            }
        }
        const partitionMemo = s?.chatStates?.[cid]?.currentMemo || '';
        if (typeof partitionMemo === 'string' && partitionMemo) {
            if (/Harm:\s*\d+/i.test(partitionMemo) || /\[PBTA_/i.test(partitionMemo) || /Hack & Slash/i.test(partitionMemo)) {
                layerMatches.push(`Layer 4: Partition [${cid}] memo contains Harm/PbtA markers`);
            }
        }
    }
    if (typeof s?.currentMemo === 'string' && s.currentMemo) {
        if (/Harm:\s*\d+/i.test(s.currentMemo) || /\[PBTA_/i.test(s.currentMemo) || /Hack & Slash/i.test(s.currentMemo)) {
            layerMatches.push('Layer 5: Live memo contains Harm/PbtA markers');
        }
    }

    const lines = [];
    lines.push('### MultiHog Companion — Ruleset & State Diagnostics');
    lines.push(`- **Report Time**: ${new Date().toISOString()}`);
    lines.push('');

    lines.push('#### 1. Chat Identification & Candidates');
    lines.push(`- **Supplied chatId**: \`${chatId || 'null'}\``);
    lines.push(`- **ctx.getCurrentChatId()**: \`${ctx?.getCurrentChatId?.() ?? 'null'}\``);
    lines.push(`- **ctx.chatId**: \`${ctx?.chatId ?? 'null'}\``);
    lines.push(`- **ctx.chatMetadata.chat_id**: \`${ctx?.chatMetadata?.chat_id ?? 'null'}\``);
    lines.push(`- **_rpgCurrentChatId()**: \`${currentChatId ?? 'null'}\``);
    lines.push(`- **s.chatStateProjectionOwner**: \`${s?.chatStateProjectionOwner ?? 'null'}\``);
    lines.push(`- **s.currentChatId**: \`${s?.currentChatId ?? 'null'}\``);
    const charName = ctx?.characters?.[ctx?.characterId]?.name || ctx?.character?.name || null;
    lines.push(`- **Active Character**: \`${charName ?? 'null'}\` (ID: \`${ctx?.characterId ?? 'null'}\`)`);
    lines.push(`- **Candidate Chat IDs**: ${JSON.stringify(candidates)}`);
    lines.push('');

    lines.push('#### 2. Ruleset Status & Detection Layers');
    const activeCart = getCompanionActiveCartridge(chatId, s, companionSettings);
    lines.push(`- **CompanionActiveCartridge**: ${activeCart ? `\`${JSON.stringify(activeCart)}\`` : '*(none set)*'}`);
    lines.push(`- **Ruleset Badge**: \`${badge.badgeText}\` (Active: \`${badge.isActive}\`, Label: \`${badge.displayLabel}\`)`);
    lines.push(`- **isPbtAActive()**: \`${pbtaActive}\``);
    lines.push(`- **isPbtaChat()**: \`${pbtaChat}\``);
    lines.push(`- **Matching Detection Layers**: ${layerMatches.length > 0 ? layerMatches.join('; ') : 'None (evaluates as stock D&D 5e)'}`);
    lines.push('');

    lines.push('#### 3. MultiHog Framework Settings');
    lines.push(`- **chatLinkEnabled**: \`${s?.chatLinkEnabled ?? 'undefined'}\``);
    lines.push(`- **chatSetupLinkEnabled**: \`${s?.chatSetupLinkEnabled ?? 'undefined'}\``);
    lines.push(`- **chatSetupCatalogVersion**: \`${s?.chatSetupCatalogVersion ?? 'undefined'}\``);
    lines.push(`- **rngEnabled**: \`${s?.rngEnabled ?? 'undefined'}\` | **rngQueueD20**: \`${s?.rngQueueD20 ?? 'undefined'}\` | **diceFunctionTool**: \`${s?.diceFunctionTool ?? 'undefined'}\``);
    lines.push(`- **debugMode**: \`${s?.debugMode ?? 'undefined'}\``);
    lines.push('');

    lines.push('#### 4. MultiHog Partition Storage (chatStates)');
    const allPartitionKeys = Object.keys(s?.chatStates || {});
    lines.push(`- **Total Partitions Count**: \`${allPartitionKeys.length}\``);
    lines.push(`- **Partition Keys**: ${JSON.stringify(allPartitionKeys.slice(0, 15))}${allPartitionKeys.length > 15 ? ` (+${allPartitionKeys.length - 15} more)` : ''}`);
    lines.push('');

    lines.push('##### Candidate Partitions Detail:');
    if (candidates.length === 0) {
        lines.push('*(No candidate chat IDs resolved)*');
    } else {
        for (const cid of candidates) {
            const part = s?.chatStates?.[cid];
            if (!part) {
                lines.push(`- **Partition \`${cid}\`**: *NOT FOUND in chatStates*`);
            } else {
                lines.push(`- **Partition \`${cid}\`**:`);
                lines.push(`  - \`characterName\`: \`${part.characterName || 'undefined'}\``);
                lines.push(`  - \`historyStorage\`: \`${part.historyStorage ?? 'undefined'}\``);
                if (part.pbtaCampaignDossier) {
                    const d = part.pbtaCampaignDossier;
                    const stats = Object.keys(d.protagonist?.stats || {});
                    lines.push(`  - \`pbtaCampaignDossier\`: PRESENT`);
                    lines.push(`    - Title: "${d.meta?.title || 'Untitled'}" | System: ${d.meta?.systemKey} (${d.meta?.systemLabel || 'none'})`);
                    lines.push(`    - Protagonist: "${d.protagonist?.name || 'Unnamed'}" (Playbook: ${d.protagonist?.playbook || 'none'}, Stats: [${stats.join(', ')}])`);
                    lines.push(`    - Harm Limit: ${d.config?.harmLimit ?? 'default'} | Stress Limit: ${d.config?.stressLimit ?? 'default'}`);
                    lines.push(`    - Last Updated: ${d.meta?.lastUpdated || 'unknown'}`);
                } else {
                    lines.push(`  - \`pbtaCampaignDossier\`: *NONE*`);
                }

                if (part.setup) {
                    const snips = Object.keys(part.setup.syspromptSnippetStates || {});
                    const activeSnips = snips.filter(k => part.setup.syspromptSnippetStates[k]);
                    lines.push(`  - \`setup\`: PRESENT (v${part.setup.version})`);
                    lines.push(`    - Active sysprompt snippets: [${activeSnips.join(', ')}]`);
                    lines.push(`    - All snippet states: ${JSON.stringify(part.setup.syspromptSnippetStates || {})}`);
                } else {
                    lines.push(`  - \`setup\`: *NONE*`);
                }

                const memo = String(part.currentMemo || '');
                lines.push(`  - \`currentMemo\`: ${memo.length} chars (Harm present: ${/Harm:\s*\d+/i.test(memo)}, Excerpt: "${memo.slice(0, 100).replace(/\n/g, ' ')}...")`);
            }
        }
    }
    lines.push('');

    lines.push('#### 5. Live MultiHog Control Room & Catalogs');
    const liveSnippets = Array.isArray(s?.customSyspromptLibrary)
        ? s.customSyspromptLibrary.map(item => `${item.id}(scope:${item.scope},enabled:${item.enabled})`)
        : [];
    lines.push(`- **Live customSyspromptLibrary (${liveSnippets.length})**: ${liveSnippets.join(', ') || '*(empty)*'}`);

    const dbSnippets = Array.isArray(s?.syspromptSnippetDatabase)
        ? s.syspromptSnippetDatabase.map(item => `${item.id}(scope:${item.scope},globalEnabled:${item.globalEnabled})`)
        : [];
    lines.push(`- **syspromptSnippetDatabase (${dbSnippets.length})**: ${dbSnippets.join(', ') || '*(empty)*'}`);
    const liveMemo = String(s?.currentMemo || '');
    lines.push(`- **Live currentMemo**: ${liveMemo.length} chars (Harm present: ${/Harm:\s*\d+/i.test(liveMemo)}, Excerpt: "${liveMemo.slice(0, 100).replace(/\n/g, ' ')}...")`);
    lines.push('');

    lines.push('#### 6. MultiHog Companion Settings');
    lines.push(`\`\`\`json\n${JSON.stringify(companionSettings || {}, null, 2)}\n\`\`\``);
    lines.push('');

    lines.push('#### 7. Recent Ruleset & Reload Event Log');
    const events = (globalThis._mhcRulesetEventLog || []).slice(-20);
    if (events.length === 0) {
        lines.push('*(No lifecycle events recorded yet)*');
    } else {
        lines.push('```');
        for (const ev of events) {
            lines.push(`[${ev.time}] ${ev.event}: ${JSON.stringify(ev)}`);
        }
        lines.push('```');
    }

    return lines.join('\n');
}

/**
 * Resets persistence state and cancels any pending timers for testing.
 */
export function resetPersistTimerForTesting() {
    if (_persistResetTimer) {
        clearTimeout(_persistResetTimer);
        _persistResetTimer = null;
    }
    _isPersistingPbtaChatState = false;
    _inFlightPersist = false;
}

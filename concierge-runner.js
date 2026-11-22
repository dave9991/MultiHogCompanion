/// <reference path="./types.d.ts" />
/**
 * concierge-runner.js — MultiHog Companion
 *
 * The Campaign Execution Pipeline for the PbtA Concierge.
 * Handles the automated handoff when "Launch Campaign" is clicked:
 * 1. Installs PbtA cartridge & 2d6 RNG rules
 * 2. Creates & binds player persona and Lorebook Agent player card
 * 3. Sequentially runs Map Architect for queued sites (seeded with Bestiary threat context)
 * 4. Upserts staged NPCs into the NPC Library and monsters into {prefix}_Bestiary
 * 5. Injects the Campaign Dossier into World Info (GM permanent memory)
 * 6. Drops the player into the fiction with Turn 0 opening scene
 */

import { serializeDossierToMarkdown, isDefaultUntitledCampaignTitle } from './concierge-parser.js';
import { formatInitialPbtaMemo, isAlliedCompanionRole } from './pbta-ruleset.js';
import { formatInitialFaeMemo } from './fae-state-sync.js';
import { buildFaeCartridge } from './fae-ruleset.js';
import { getStagedCanonEntries, writeStagedCanon } from './concierge-canon.js';
import { systemRegistry } from './concierge-system-registry.js';
import './concierge-system-pbta.js';
import './concierge-system-fae.js';
import './concierge-system-dnd5e.js';
import {
    loadMainNpcSectionNames,
    buildNpcEntryContent,
    buildNpcKeys,
} from './concierge-npc-format.js';
import {
    buildDossierWorldInfoEntry,
    buildLocationEntry,
    prepareCampaignLorebookDistributions,
    buildMapThreatBrief,
    buildWorldSkeletonEntries,
} from './concierge-lore-distributor.js';
import {
    loadMainPcSectionNames,
    buildPlayerCardBio,
} from './concierge-pc-format.js';
import { normalizeGameSystemDrivers, toWizardDriverFlags } from './game-system-bridge.js';
import { setPartitionDossier } from './pbta-ruleset-persistence.js';
import {
    parseResolvedNameToken,
    resolveDossierNamePlaceholders,
    sanitizeDossierResolvedNameTokens,
} from './namerag-hooks.js';

export const STANDARD_CAMPAIGN_BOOK_SUFFIXES = Object.freeze([
    'NPCs', 'Bestiary', 'Locations', 'Quests', 'Factions', 'Rules', 'Skeleton', 'Canon', 'World',
]);

/**
 * Sanitizes a raw campaign/chat identifier into a safe lorebook prefix,
 * matching upstream `sanitizeCampaignPrefixString` rules.
 *
 * @param {string} raw
 * @param {any} [stateMgr=null]
 * @returns {string}
 */
export function sanitizePrefixFallback(raw, stateMgr = null) {
    if (!raw) return '';
    if (typeof stateMgr?.sanitizeCampaignPrefixString === 'function') {
        return stateMgr.sanitizeCampaignPrefixString(String(raw));
    }
    return String(raw).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Resolves the canonical campaign prefix for a chat, honoring any Step 0b
 * `renamedCampaignPrefix` pin before falling back to upstream router prefix or sanitized chatId/title.
 *
 * @param {string} chatId
 * @param {{ adventureTitle?: string, rpgSettings?: any, stateMgr?: any }} [options={}]
 * @returns {string}
 */
export function resolveCanonicalCampaignPrefix(chatId, {
    adventureTitle = '',
    rpgSettings = null,
    stateMgr = null,
} = {}) {
    const rawId = String(chatId || '').trim();
    const cleanChatId = rawId.replace(/\.jsonl$/i, '').trim();
    const existingPin = rpgSettings?.chatStates?.[rawId]?.renamedCampaignPrefix
        || rpgSettings?.chatStates?.[cleanChatId]?.renamedCampaignPrefix
        || (cleanChatId ? rpgSettings?.chatStates?.[`${cleanChatId}.jsonl`]?.renamedCampaignPrefix : '')
        || '';
    if (existingPin) {
        return sanitizePrefixFallback(existingPin, stateMgr);
    }
    if (typeof stateMgr?.getEffectiveRouterCampaignPrefix === 'function') {
        const eff = stateMgr.getEffectiveRouterCampaignPrefix(cleanChatId || rawId);
        if (eff) return sanitizePrefixFallback(eff, stateMgr);
    }
    return sanitizePrefixFallback(cleanChatId || adventureTitle, stateMgr);
}

/**
 * Stamps the canonical campaign prefix and standard campaign lorebook names onto the chat's
 * MultiHog `chatStates` partition so Steps 3, 4, 4b, 5, and upstream router passes share one prefix.
 *
 * @param {string} chatId
 * @param {string} prefix
 * @param {any} rpgSettings
 * @returns {string}
 */
export function stampCanonicalCampaignPrefix(chatId, prefix, rpgSettings) {
    const cleanPrefix = sanitizePrefixFallback(prefix);
    if (!chatId || !cleanPrefix || !rpgSettings) return cleanPrefix || '';
    rpgSettings.chatStates = rpgSettings.chatStates || {};
    rpgSettings.chatStates[chatId] = rpgSettings.chatStates[chatId] || {};
    rpgSettings.chatStates[chatId].renamedCampaignPrefix = cleanPrefix;

    const campaignBooksSet = new Set(rpgSettings.chatStates[chatId].campaignBooks || []);
    for (const suf of STANDARD_CAMPAIGN_BOOK_SUFFIXES) {
        campaignBooksSet.add(`${cleanPrefix}_${suf}`);
    }
    rpgSettings.chatStates[chatId].campaignBooks = [...campaignBooksSet];
    return cleanPrefix;
}

/**
 * Replaces the `[CORE]...[/CORE]` block inside an existing Location/Entity entry while
 * preserving any upstream Map Architect `Host Site:` / `Host Brief:` lines, `[MAP]...[/MAP]` block,
 * and chronicle text appended below `[/CORE]`.
 *
 * @param {string} existingContent
 * @param {string} incomingCore
 * @returns {string}
 */
export function mergePreservingMappedLocationCore(existingContent, incomingCore) {
    const source = String(existingContent || '');
    const nextCoreRaw = String(incomingCore || '').trim();
    if (!nextCoreRaw) return source;

    const existingCoreMatch = source.match(/\[CORE\]([\s\S]*?)\[\/CORE\]/i);
    if (!existingCoreMatch) return source;

    const hostLines = String(existingCoreMatch[1] || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^Host Site:/i.test(line) || /^Host Brief:/i.test(line));

    let mergedCore = nextCoreRaw;
    if (hostLines.length > 0) {
        const innerMatch = nextCoreRaw.match(/^\[CORE\]([\s\S]*?)\[\/CORE\]$/i);
        const innerText = (innerMatch ? innerMatch[1] : nextCoreRaw).trim();
        const existingLower = innerText.toLowerCase();
        const missingHostLines = hostLines.filter(hl => !existingLower.includes(hl.toLowerCase()));
        const combinedInner = [innerText, ...missingHostLines].filter(Boolean).join('\n');
        mergedCore = `[CORE]\n${combinedInner}\n[/CORE]`;
    }

    return source.replace(/\[CORE\][\s\S]*?\[\/CORE\]/i, () => mergedCore);
}

/**
 * Wraps Game System GM instructions in exactly one `<tag>...</tag>` wrapper,
 * matching upstream `normalizeGmContent` (`src/state/sysprompt-content.js`).
 *
 * @param {string} tag
 * @param {string} content
 * @returns {string}
 */
export function wrapGameSystemGmContent(tag, content) {
    const cleanTag = String(tag || '').trim();
    let body = String(content || '').trim();
    if (!cleanTag || !body) return body;
    const escapedTag = cleanTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagToken = `<\\s*\\/?\\s*${escapedTag}(?:\\s+[^>]*)?\\s*>`;
    body = body.replace(new RegExp(`^[\\t ]*${tagToken}[\\t ]*(?:\\r?\\n|$)`, 'gim'), '');
    body = body.replace(new RegExp(tagToken, 'gi'), '');
    body = body.trim();
    return `<${cleanTag}>\n${body}\n</${cleanTag}>`;
}

/**
 * Builds the complete `CompanionActiveCartridge` metadata record for a chat,
 * preserving custom genre specs, stats/pools, knobs, and config across Step 5
 * and Living-World Sync.
 *
 * @param {object} adapter
 * @param {string} systemKey
 * @param {object} dossier
 * @param {{ title?: string, cartridgeOverrides?: object }} [options={}]
 * @returns {object}
 */
export function buildCompanionActiveCartridgeRecord(
    adapter,
    systemKey,
    dossier,
    { title = null, cartridgeOverrides = null } = {},
) {
    const customGenreSpec = dossier?.meta?.customGenreSpec || cartridgeOverrides?.customGenreSpec || null;
    const statsList = Object.keys(dossier?.protagonist?.stats || {});
    const stats = statsList.length >= 3
        ? statsList
        : (Array.isArray(cartridgeOverrides?.stats) && cartridgeOverrides.stats.length >= 3 ? [...cartridgeOverrides.stats] : null);
    const pools = (dossier?.protagonist?.pools && Object.keys(dossier.protagonist.pools).length > 0)
        ? dossier.protagonist.pools
        : (cartridgeOverrides?.pools && Object.keys(cartridgeOverrides.pools).length > 0 ? cartridgeOverrides.pools : null);
    const knobs = cartridgeOverrides?.knobs || dossier?.config?.knobs || null;
    const config = dossier?.config || cartridgeOverrides?.config || null;

    return {
        cartridgeId: adapter?.id || 'pbta',
        genre: systemKey || 'fantasy',
        systemLabel: dossier?.meta?.systemLabel || adapter?.label || '',
        title: title || dossier?.meta?.title || null,
        ...(customGenreSpec ? { customGenreSpec: JSON.parse(JSON.stringify(customGenreSpec)) } : {}),
        ...(stats ? { stats: [...stats] } : {}),
        ...(pools ? { pools: JSON.parse(JSON.stringify(pools)) } : {}),
        ...(knobs ? { knobs: JSON.parse(JSON.stringify(knobs)) } : {}),
        ...(config ? { config: JSON.parse(JSON.stringify(config)) } : {}),
        dossier: JSON.parse(JSON.stringify(dossier || {})),
    };
}

/**
 * Registers or updates a Concierge Custom HUD Tracker / Game System in MultiHog settings
 * using upstream's v3 catalog schema (`gameSystems`, `customSyspromptLibrary`, `customFields`,
 * boolean driver flags, `<tag>...</tag>` wrapper, `scope: 'chat'`, and global v3 catalogs).
 *
 * @param {object} rpgSettings
 * @param {object} customMod
 * @param {{ chatId?: string|null, syncChatSetupCatalogs?: Function|null }} [options={}]
 * @returns {boolean}
 */
export function registerCustomGameSystemInSettings(
    rpgSettings,
    customMod,
    { chatId = null, syncChatSetupCatalogs = null } = {},
) {
    if (!rpgSettings || !customMod || !(customMod.tag || customMod.fieldKey || customMod.label)) {
        return false;
    }

    const customTag = String(customMod.tag || customMod.fieldKey || customMod.label)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toUpperCase();
    const gmTag = String(customMod.gmTag || customTag)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase();
    const driversList = normalizeGameSystemDrivers(customMod.drivers || customMod);
    const driverFlags = toWizardDriverFlags(customMod.drivers || customMod);
    const label = customMod.label || customMod.tag || customMod.fieldKey || customTag;
    const instruction = String(customMod.instruction || customMod.gmInstruction || '').trim();
    const sampleTemplate = String(customMod.sampleContent || customMod.sample || customMod.trackerContent || '').trim();

    rpgSettings.gameSystems = rpgSettings.gameSystems || [];
    const existingGsIdx = rpgSettings.gameSystems.findIndex(
        gs => gs?.customFieldTag?.toUpperCase() === customTag || (customMod.id && gs?.id === customMod.id),
    );
    const existingGs = existingGsIdx >= 0 ? rpgSettings.gameSystems[existingGsIdx] : null;
    const systemId = customMod.id || existingGs?.id || `gs_${customTag.toLowerCase()}`;
    const syspromptId = instruction
        ? (customMod.syspromptLibraryId || existingGs?.syspromptLibraryId || `sys_${systemId}`)
        : null;

    // 1. Register in rpgSettings.gameSystems (upstream v3 schema with boolean drivers & chat scope)
    const gsDef = {
        id: systemId,
        name: label,
        icon: customMod.icon || '📟',
        description: instruction,
        author: 'Concierge',
        version: '1.0.0',
        enabled: true,
        scope: 'chat',
        _chatSetupMember: true,
        needsTracker: Boolean(sampleTemplate),
        driverTime: driverFlags.driverTime,
        driverGmAnnotation: driverFlags.driverGmAnnotation,
        driverStatedFact: driverFlags.driverStatedFact,
        drivers: driversList,
        effectOwner: customMod.effectOwner || 'world',
        customFieldTag: customTag,
        syspromptLibraryId: syspromptId,
        isBuiltin: false,
        createdAt: existingGs?.createdAt || customMod.createdAt || Date.now(),
    };
    if (existingGsIdx >= 0) {
        rpgSettings.gameSystems[existingGsIdx] = gsDef;
    } else {
        rpgSettings.gameSystems.push(gsDef);
    }

    // 2. Register in rpgSettings.customSyspromptLibrary with <tag>...</tag> wrapper
    if (instruction && syspromptId) {
        rpgSettings.customSyspromptLibrary = rpgSettings.customSyspromptLibrary || [];
        const existingSysIdx = rpgSettings.customSyspromptLibrary.findIndex(sp => sp?.id === syspromptId);
        const sysDef = {
            id: syspromptId,
            tag: gmTag,
            name: `${label} (Game System)`,
            description: `Game System: ${label}`,
            content: wrapGameSystemGmContent(gmTag, instruction),
            icon: 'fa-hat-wizard',
            category: 'Game Systems',
            tags: ['game-system', customTag.toLowerCase()],
            enabled: true,
            origin: 'wizard',
            scope: 'chat',
            _chatSetupMember: true,
        };
        if (existingSysIdx >= 0) {
            rpgSettings.customSyspromptLibrary[existingSysIdx] = sysDef;
        } else {
            rpgSettings.customSyspromptLibrary.push(sysDef);
        }
    }

    // 3. Register in rpgSettings.customFields
    rpgSettings.customFields = rpgSettings.customFields || [];
    const existingFieldIdx = rpgSettings.customFields.findIndex(f => f?.tag?.toUpperCase() === customTag);
    const fieldDef = {
        tag: customTag,
        label,
        icon: customMod.icon || '📟',
        prompt: instruction,
        template: sampleTemplate,
        enabled: true,
        origin: 'wizard',
        scope: 'chat',
        _chatSetupMember: true,
    };
    if (existingFieldIdx >= 0) {
        rpgSettings.customFields[existingFieldIdx] = fieldDef;
    } else {
        rpgSettings.customFields.push(fieldDef);
    }

    if (Array.isArray(rpgSettings.blockOrder) && !rpgSettings.blockOrder.includes(customTag)) {
        rpgSettings.blockOrder.push(customTag);
    }

    // 4. Sync into upstream global v3 catalogs (gameSystemDatabase, syspromptSnippetDatabase, trackerModuleDatabase)
    if (typeof syncChatSetupCatalogs === 'function') {
        if (rpgSettings.chatSetupCatalogVersion === undefined) {
            rpgSettings.chatSetupCatalogVersion = 3;
        }
        syncChatSetupCatalogs(rpgSettings);
    } else {
        const upsertCatalogDef = (dbKey, defObj, keyFn) => {
            rpgSettings[dbKey] = rpgSettings[dbKey] || [];
            const cleanDef = { ...defObj };
            delete cleanDef.enabled;
            delete cleanDef._chatSetupMember;
            const targetKey = keyFn(cleanDef);
            const idx = rpgSettings[dbKey].findIndex(item => keyFn(item) === targetKey);
            if (idx >= 0) rpgSettings[dbKey][idx] = { ...rpgSettings[dbKey][idx], ...cleanDef };
            else rpgSettings[dbKey].push(cleanDef);
        };
        upsertCatalogDef('gameSystemDatabase', gsDef, x => String(x?.id || '').trim());
        upsertCatalogDef('trackerModuleDatabase', fieldDef, x => String(x?.tag || '').trim().toUpperCase());
        if (instruction && syspromptId) {
            const sysItem = rpgSettings.customSyspromptLibrary.find(sp => sp?.id === syspromptId);
            if (sysItem) upsertCatalogDef('syspromptSnippetDatabase', sysItem, x => String(x?.id || '').trim());
        }
    }

    // 5. Retain chatStates[chatId].customFields mirror for launch/sync consumers
    if (chatId) {
        rpgSettings.chatStates = rpgSettings.chatStates || {};
        rpgSettings.chatStates[chatId] = rpgSettings.chatStates[chatId] || {};
        rpgSettings.chatStates[chatId].customFields = [...rpgSettings.customFields];
    }

    return true;
}

/**
 * Refreshes the campaign's saved entry inside `rpgSettings.gameCartridges` after
 * Step 5 finalizes CYOA toggles, `npcRelationshipBars`, `blockOrder`, and custom Game Systems.
 *
 * @param {object} rpgSettings
 * @param {string|null} cartridgeId
 * @returns {boolean}
 */
export function syncSavedCartridgePayloadFromLiveSettings(rpgSettings, cartridgeId) {
    if (!rpgSettings || !cartridgeId || !Array.isArray(rpgSettings.gameCartridges)) return false;
    const cartridge = rpgSettings.gameCartridges.find(c => c && c.id === cartridgeId);
    if (!cartridge) return false;
    cartridge.payload = cartridge.payload || {};

    const clone = (val) => JSON.parse(JSON.stringify(val));
    if (Array.isArray(rpgSettings.customSyspromptLibrary)) {
        cartridge.payload.customSyspromptLibrary = clone(rpgSettings.customSyspromptLibrary);
    }
    if (rpgSettings.syspromptModules && typeof rpgSettings.syspromptModules === 'object') {
        cartridge.payload.syspromptModules = clone(rpgSettings.syspromptModules);
    }
    if (Array.isArray(rpgSettings.syspromptSectionOrder)) {
        cartridge.payload.syspromptSectionOrder = clone(rpgSettings.syspromptSectionOrder);
    }
    if (Array.isArray(rpgSettings.blockOrder)) {
        cartridge.payload.blockOrder = clone(rpgSettings.blockOrder);
    }
    if (rpgSettings.cyoaConfig && typeof rpgSettings.cyoaConfig === 'object') {
        cartridge.payload.cyoaConfig = clone(rpgSettings.cyoaConfig);
    }
    if (Array.isArray(rpgSettings.gameSystems)) {
        cartridge.payload.gameSystems = clone(rpgSettings.gameSystems);
    }
    if (Array.isArray(rpgSettings.customFields)) {
        cartridge.payload.customFields = clone(rpgSettings.customFields);
    }
    if (typeof rpgSettings.npcRelationshipBars === 'boolean') {
        cartridge.payload.npcRelationshipBars = rpgSettings.npcRelationshipBars;
    }
    cartridge.updatedAt = Date.now();
    return true;
}

/**
 * Registers a newly written or updated World Info book with both Upstream MultiHog's router cache/list
 * and SillyTavern's in-memory registry + active chat world list so `loadWorldInfo()` and Turn 1 scanning
 * see it immediately without requiring an F5 reload.
 *
 * @param {string} bookName
 * @param {object} bookData
 * @param {{ ctx?: any, router?: any, activateOnChat?: boolean }} [options={}]
 * @returns {Promise<boolean>}
 */
export async function registerAndActivateWorldInfoBook(
    bookName,
    bookData,
    { ctx = null, router = null, activateOnChat = true } = {},
) {
    if (!bookName) return false;
    if (typeof router?.updateWorldInfoCache === 'function') {
        try { await router.updateWorldInfoCache(bookName, bookData); } catch (_) {}
    }
    if (typeof router?.rememberCampaignBook === 'function') {
        try { router.rememberCampaignBook(bookName); } catch (_) {}
    }
    if (typeof ctx?.saveWorldInfo === 'function') {
        try { await ctx.saveWorldInfo(bookName, bookData); } catch (_) {}
    }
    if (typeof ctx?.updateWorldInfoList === 'function') {
        try { await ctx.updateWorldInfoList(); } catch (_) {}
    }
    if (activateOnChat && typeof ctx?.executeSlashCommandsWithOptions === 'function') {
        try {
            const safeBookName = String(bookName).replace(/"/g, '\\"');
            await ctx.executeSlashCommandsWithOptions(`/world state=on silent=true "${safeBookName}"`);
        } catch (_) {}
    }
    return true;
}

/**
 * Resolves any lingering `[[NAME:...]]` placeholders, runs `healAndNormalizeDossier`,
 * and recursively strips all NameRAG evolution tokens (`[NAME: ..., RESOLVED TO: ...]`, etc.)
 * across the entire dossier before handing off to the upstream MultiHog framework.
 *
 * @param {object} rawDossier
 * @param {{ healAndNormalizeDossier: Function, resolvePlaceholders?: Function }} deps
 * @returns {Promise<object>}
 */
export async function prepareSanitizedDossierForFramework(rawDossier, {
    healAndNormalizeDossier,
    resolvePlaceholders = resolveDossierNamePlaceholders,
} = {}) {
    let sanitizedRawDossier = rawDossier;
    const rawDossierStr = JSON.stringify(rawDossier || {});
    if (rawDossierStr.includes('[[NAME') && typeof resolvePlaceholders === 'function') {
        try {
            const resolvedStr = await resolvePlaceholders(rawDossierStr, rawDossier);
            sanitizedRawDossier = JSON.parse(typeof resolvedStr === 'string' ? resolvedStr : resolvedStr.text);
        } catch (sweepErr) {
            console.warn('[PbtA Concierge] Pre-handoff placeholder sweep non-fatal error:', sweepErr);
        }
    }

    const dossier = healAndNormalizeDossier(sanitizedRawDossier);
    sanitizeDossierResolvedNameTokens(dossier);

    // Also strip surrounding quotes via parseResolvedNameToken on entity .name fields
    if (dossier.protagonist?.name) {
        dossier.protagonist.name = parseResolvedNameToken(dossier.protagonist.name).cleanName;
    }
    (dossier.npcs || []).forEach(n => {
        if (n.name) n.name = parseResolvedNameToken(n.name).cleanName;
    });
    (dossier.monsters || []).forEach(m => {
        if (m.name) m.name = parseResolvedNameToken(m.name).cleanName;
    });
    (dossier.factions || []).forEach(f => {
        if (f.name) f.name = parseResolvedNameToken(f.name).cleanName;
    });

    return dossier;
}

/**
 * Send an outgoing user chat message into SillyTavern.
 * @param {string} text
 */
async function sendOutgoingChatMessage(text) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const textarea = document.getElementById('send_textarea');
    const sendBtn = document.getElementById('send_but');

    if (textarea && sendBtn) {
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
        sendBtn.click();
        return;
    }

    if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
        await ctx.executeSlashCommandsWithOptions(text);
        return;
    }

    throw new Error('Chat input is not available.');
}

/**
 * Injects or updates the Campaign Dossier World Info entry for the active chat.
 */
async function injectDossierIntoWorldInfo(chatId, dossierMarkdown, bookName) {
    const ctx = SillyTavern.getContext();
    const cleanChatId = chatId ? String(chatId).replace(/\.jsonl$/i, '').trim() : '';
    const effectiveBook = bookName || (ctx.chatMetadata?.world_info || `Campaign_${cleanChatId || 'PbtA'}`);

    try {
        const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
        const getRes = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: effectiveBook }),
        });

        let bookData = { entries: {} };
        if (getRes.ok) {
            bookData = await getRes.json();
            bookData.entries = bookData.entries || {};
        }

        // Find or create dossier entry
        let targetUid = null;
        for (const [uid, entry] of Object.entries(bookData.entries)) {
            if (entry.comment?.includes('CAMPAIGN_DOSSIER') || entry.key?.includes('campaign_dossier') || entry.key?.includes('campaign dossier')) {
                targetUid = uid;
                break;
            }
        }

        if (!targetUid) {
            targetUid = String(Date.now());
        }

        // Use buildDossierWorldInfoEntry with constant: false to prevent context bloat
        bookData.entries[targetUid] = buildDossierWorldInfoEntry(dossierMarkdown, targetUid);

        await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: effectiveBook, data: bookData }),
        });

        // Invalidate or update SillyTavern's frontend worldInfoCache
        try {
            const wiMod = await import('../../../world-info.js');
            if (wiMod?.worldInfoCache && typeof wiMod.worldInfoCache.set === 'function') {
                wiMod.worldInfoCache.set(effectiveBook, bookData);
            }
        } catch (_) {}

        // Ensure chat binds this world info book if not already bound
        if (ctx.chatMetadata && !ctx.chatMetadata.world_info) {
            ctx.chatMetadata.world_info = effectiveBook;
            if (typeof ctx.saveMetadataDebounced === 'function') {
                ctx.saveMetadataDebounced();
            }
        }

        await registerAndActivateWorldInfoBook(effectiveBook, bookData, { ctx, activateOnChat: true });
    } catch (err) {
        console.warn('[PbtA Concierge] Could not inject World Info via API directly:', err);
    }
}

/**
 * Robust upsert helper for MultiHog modular lorebooks.
 * Updates [CORE] on existing entries and appends new ones with proper metadata.
 *
 * @param {string} bookName
 * @param {Array<{ name: string, keys: string[], core: string, full?: string }>} items
 */
async function upsertWorldInfoBook(bookName, items = []) {
    if (!bookName || !items || !items.length) return;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    if (!ctx) return;

    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
        const mainSettings = (typeof stateMgr.getSettings === 'function' ? stateMgr.getSettings() : null) || {};
        const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));

        let bookData = null;
        try {
            const res = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ name: bookName }),
            });
            if (res.ok) {
                bookData = await res.json();
            }
        } catch (_) {}

        if (!bookData || typeof bookData !== 'object' || !bookData.entries) {
            bookData = { entries: {}, name: bookName, scan_depth: 4, token_budget: 400, recursive: false, extensions: {} };
        }
        bookData.entries = bookData.entries || {};

        let modified = false;

        const assignedMap = {};

        for (const item of items) {
            const cleanName = (item.name || item.comment || '').trim();
            if (!cleanName || !item.core) continue;
            const lowerName = cleanName.toLowerCase();

            const existingEntry = Object.values(bookData.entries).find(e => {
                const label = (e.comment || '').replace(/^\[.*?\]\s*/i, '').trim().toLowerCase();
                return label === lowerName;
            });

            if (existingEntry) {
                assignedMap[lowerName] = {
                    bookName,
                    uid: existingEntry.uid,
                    fullId: `${bookName}::${existingEntry.uid}`,
                };
                // Re-launch / edited dossier: refresh only the protected [CORE] identity block,
                // preserving Map Architect host lines, [MAP] section, and live-play chronicle text.
                const current = String(existingEntry.content || '');
                if (/\[CORE\][\s\S]*?\[\/CORE\]/i.test(current)) {
                    const next = mergePreservingMappedLocationCore(current, item.core);
                    if (next !== current) {
                        existingEntry.content = next;
                        modified = true;
                    }
                }
                const isMappedRoot = /\[MAP\][\s\S]*?\[\/MAP\]/i.test(String(existingEntry.content || ''))
                    || Boolean(existingEntry.extensions?.dungeonMap);
                if (isMappedRoot && existingEntry.disable !== true) {
                    existingEntry.disable = true;
                    modified = true;
                }
                continue;
            }

            const uids = Object.keys(bookData.entries).map(Number).filter(num => !isNaN(num));
            const nextUid = uids.length > 0 ? Math.max(...uids) + 1 : 0;

            assignedMap[lowerName] = {
                bookName,
                uid: nextUid,
                fullId: `${bookName}::${nextUid}`,
            };

            bookData.entries[nextUid] = {
                uid: nextUid,
                key: item.keys || [cleanName],
                keysecondary: [],
                comment: cleanName,
                content: item.full || item.core,
                constant: false,
                selective: false,
                selectiveLogic: 0,
                addMemo: true,
                order: mainSettings.routerDefaultOrder ?? 100,
                position: mainSettings.routerDefaultPosition ?? 0,
                disable: false,
                probability: 100,
                useProbability: false,
                depth: mainSettings.routerDefaultDepth ?? 4,
            };
            modified = true;
        }

        if (modified) {
            await fetch('/api/worldinfo/edit', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ name: bookName, data: bookData }),
            });

            await registerAndActivateWorldInfoBook(bookName, bookData, { ctx, router, activateOnChat: true });
        }
        return assignedMap;
    } catch (err) {
        console.warn(`[PbtA Concierge] Could not auto-inject entries into "${bookName}":`, err);
        return {};
    }
}

/**
 * Distributes dossier entities across MultiHog's native modular campaign lorebooks:
 * - {prefix}_NPCs      (Supporting NPCs & Social Rivals)
 * - {prefix}_Bestiary  (Monsters, Packs, Drones, & Hazards)
 * - {prefix}_Factions  (Factions)
 * - {prefix}_Locations (Maps / Sites)
 * - {prefix}_Quests    (Starting Crisis)
 * - {prefix}_Rules     (World Axioms & Custom Trackers)
 * @returns {Promise<Record<string, { bookName: string, uid: number|string, fullId: string }>>}
 */
async function injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames = null, explicitPrefix = '') {
    if (!dossier || typeof dossier !== 'object') return {};
    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const mainSettings = (typeof stateMgr.getSettings === 'function' ? stateMgr.getSettings() : null) || null;
        const prefix = explicitPrefix || resolveCanonicalCampaignPrefix(chatId, { rpgSettings: mainSettings, stateMgr });

        const npcBookName = prefix ? `${prefix}_NPCs` : 'NPCs';
        const bestiaryBookName = prefix ? `${prefix}_Bestiary` : 'Bestiary';
        const factionBookName = prefix ? `${prefix}_Factions` : 'Factions';
        const locBookName = prefix ? `${prefix}_Locations` : 'Locations';
        const questBookName = prefix ? `${prefix}_Quests` : 'Quests';
        const rulesBookName = prefix ? `${prefix}_Rules` : 'Rules';

        const dist = prepareCampaignLorebookDistributions(dossier, sectionNames);

        const [npcMap] = await Promise.all([
            upsertWorldInfoBook(npcBookName, dist.npcs),
            ...(dist.bestiary?.length ? [upsertWorldInfoBook(bestiaryBookName, dist.bestiary)] : []),
            upsertWorldInfoBook(factionBookName, dist.factions),
            upsertWorldInfoBook(locBookName, dist.locations),
            upsertWorldInfoBook(questBookName, dist.quests),
            ...(dist.worldRules?.length ? [upsertWorldInfoBook(rulesBookName, dist.worldRules)] : []),
        ]);
        return npcMap || {};
    } catch (err) {
        console.warn('[PbtA Concierge] Campaign lorebook distribution encountered error:', err);
        return {};
    }
}

/**
 * Writes staged Archivist-mode lore into the `{prefix}_Canon` lorebook (vectorized entries)
 * and registers the book on the chat so MultiHog's keyword/vector matching can see it.
 * No-op in Vibe mode (nothing staged).
 *
 * @param {string} chatId
 */
async function injectCanonBook(chatId, explicitPrefix = '') {
    try {
        if (!getStagedCanonEntries().length) return null;
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const mainSettings = (typeof stateMgr.getSettings === 'function' ? stateMgr.getSettings() : null) || null;
        const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
        const prefix = explicitPrefix || resolveCanonicalCampaignPrefix(chatId, { rpgSettings: mainSettings, stateMgr });
        const res = await writeStagedCanon(prefix, {
            afterSave: async (bookName, bookData) => {
                await registerAndActivateWorldInfoBook(bookName, bookData, { ctx, router, activateOnChat: true });
            },
        });
        if (res?.written) {
            globalThis.toastr?.info(`Canon lorebook "${res.bookName}": ${res.written} entries added.`);
        }
        return res;
    } catch (err) {
        console.warn('[PbtA Concierge] Canon lorebook write failed:', err);
        globalThis.toastr?.warning('Could not write the Canon lorebook; your lore was not saved to the campaign.');
        return null;
    }
}

/**
 * Injects Day 0 macro premises into MultiHog's World Skeleton ({prefix}_Skeleton).
 * Provides foundational fuel for MultiHog's World Progression engine to simulate
 * the campaign off-screen right from launch.
 *
 * @param {string} chatId
 * @param {object} dossier
 */
async function injectWorldSkeleton(chatId, dossier, explicitPrefix = '') {
    if (!dossier || typeof dossier !== 'object') return;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    if (!ctx) return;

    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const mainSettings = (typeof stateMgr.getSettings === 'function' ? stateMgr.getSettings() : null) || null;
        const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
        const prefix = explicitPrefix || resolveCanonicalCampaignPrefix(chatId, { rpgSettings: mainSettings, stateMgr });
        const skeletonBookName = prefix ? `${prefix}_Skeleton` : 'World_Skeleton';

        const skeletonEntries = buildWorldSkeletonEntries(dossier);
        if (!skeletonEntries.length) return;

        const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
        let bookData = null;
        try {
            const res = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ name: skeletonBookName }),
            });
            if (res.ok) {
                bookData = await res.json();
            }
        } catch (_) {}

        if (!bookData || typeof bookData !== 'object' || !bookData.entries) {
            bookData = {
                entries: {},
                name: skeletonBookName,
                scan_depth: 4,
                token_budget: 400,
                recursive: false,
                extensions: {},
            };
        }
        bookData.entries = bookData.entries || {};

        let uid = 0;
        const keys = Object.keys(bookData.entries).map(Number);
        if (keys.length > 0) {
            uid = Math.max(...keys) + 1;
        }

        let modified = false;
        for (const entry of skeletonEntries) {
            const cleanLabel = (entry.comment || '').toLowerCase().trim();
            const existingEntry = Object.values(bookData.entries).find(e => {
                const l = (e.comment || '').toLowerCase().trim();
                return l === cleanLabel;
            });

            if (existingEntry) {
                if (existingEntry.content !== entry.content) {
                    existingEntry.content = entry.content;
                    modified = true;
                }
                continue;
            }

            bookData.entries[uid] = {
                ...entry,
                uid,
            };
            uid++;
            modified = true;
        }

        if (modified) {
            await fetch('/api/worldinfo/edit', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ name: skeletonBookName, data: bookData }),
            });

            await registerAndActivateWorldInfoBook(skeletonBookName, bookData, { ctx, router, activateOnChat: true });
        }
    } catch (err) {
        console.warn('[PbtA Concierge] World Skeleton injection encountered non-fatal error:', err);
    }
}

/**
 * Main Campaign Launch Pipeline
 *
 * @param {object} dossier The completed PbtaCampaignDossier
 * @param {(stepText: string, pct: number) => void} [onProgress] Progress callback
 * @param {object} [options]
 * @param {string} [options.wipeOldTitle] If set, completely purges previous chat and lorebooks for this title
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function launchPbtaCampaign(rawDossier, onProgress = () => {}, options = {}) {
    const { wipeOldTitle = null } = options;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const { healAndNormalizeDossier } = await import('./concierge-parser.js');
    const { applyPbtACartridge, applyFaeCartridge, syncPersonaToChat, uploadImageToPersona, findMatchingPersona } = await import('./index.js');
    const { ensureCleanAdventureChat } = await import('./adventure-chat.js');

    // Pre-Launch Safety Net: Resolve [[NAME:...]] & strip all NameRAG evolution tokens recursively
    const dossier = await prepareSanitizedDossierForFramework(rawDossier, { healAndNormalizeDossier });

    dossier.meta = dossier.meta || {};
    dossier.meta.conciergeCreated = true;
    dossier.meta.isStub = false;
    delete dossier.meta.autoScaffolded;
    const systemKey = dossier.meta?.systemKey || 'fantasy';
    const charName = (dossier.protagonist?.name || '').trim();
    let adventureTitle = (dossier.meta?.title || '').trim();
    if (!adventureTitle || isDefaultUntitledCampaignTitle(adventureTitle)) {
        const loc = (dossier.maps?.[0]?.name || dossier.theKick?.startingLocation || '').trim();
        if (charName && loc) {
            adventureTitle = `${charName} - ${loc}`;
        } else if (charName) {
            adventureTitle = `${charName}'s Adventure`;
        } else if (dossier.meta?.premise) {
            adventureTitle = dossier.meta.premise.slice(0, 40).trim();
        }
        if (adventureTitle) {
            dossier.meta = dossier.meta || {};
            dossier.meta.title = adventureTitle;
        }
    }

    try {
        // ── 0. Optional Fresh Wipe / Lorebook Purge ────────────────────────────
        if (wipeOldTitle) {
            onProgress(`🧹 Purging previous campaign lorebooks for "${wipeOldTitle}"...`, 3);
            try {
                const { purgeCampaignLorebooks } = await import('./campaign-lore-sync.js');
                await purgeCampaignLorebooks(wipeOldTitle, ctx);
            } catch (purgeErr) {
                console.warn('[PbtA Concierge] Lorebook purge encountered non-fatal error:', purgeErr);
            }

            // Clean out old MultiHog chatState for the wiped title
            const effectiveCtxEarly = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
            const rpgEarly = effectiveCtxEarly?.extensionSettings?.rpg_tracker;
            if (rpgEarly?.chatStates) {
                delete rpgEarly.chatStates[wipeOldTitle];
                delete rpgEarly.chatStates[wipeOldTitle.replace(/\s+/g, '_')];
            }

            // Also clean out previous Campaign_${wipeOldTitle} world info book (raw and sanitized forms)
            try {
                const getHeaders = ctx?.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
                const oldClean = String(wipeOldTitle).replace(/\.jsonl$/i, '').trim();
                const oldSanitized = sanitizePrefixFallback(oldClean);
                const legacyBookNames = [...new Set([
                    oldClean ? `Campaign_${oldClean}` : '',
                    oldSanitized ? `Campaign_${oldSanitized}` : '',
                ].filter(Boolean))];
                const wiMod = await import('../../../world-info.js').catch(() => null);
                for (const oldBook of legacyBookNames) {
                    await fetch('/api/worldinfo/delete', {
                        method: 'POST',
                        headers: getHeaders(),
                        body: JSON.stringify({ name: oldBook }),
                    });
                    if (wiMod?.worldInfoCache && typeof wiMod.worldInfoCache.delete === 'function') {
                        wiMod.worldInfoCache.delete(oldBook);
                    }
                }
            } catch (_) {}
        }

        // ── 0b. Ensure Clean Chat & Auto-Rename ────────────────────────────────
        onProgress('🛡️ Preparing clean adventure session...', 5);
        const rulesetId = systemRegistry.detectRuleset(dossier);
        const adapter = systemRegistry.get(rulesetId);
        const isFae = adapter.id === 'fae';
        const fallbackLabel = `${adapter.label.includes('FAE') ? 'FAE' : adapter.id.toUpperCase()} ${systemKey.charAt(0).toUpperCase() + systemKey.slice(1)} Adventure`;
        const chatId = await ensureCleanAdventureChat({
            adventureTitle,
            fallbackLabel,
            wipeOldTitle,
        });

        // Resolve & stamp canonical campaign prefix BEFORE Step 3 (Map Architect) and Step 4 lorebooks
        const effectiveCtxEarly = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
        const rpgEarly = effectiveCtxEarly?.extensionSettings?.rpg_tracker;
        let stateMgrEarly = null;
        try {
            stateMgrEarly = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        } catch (_) {}
        const campaignPrefix = resolveCanonicalCampaignPrefix(chatId, {
            adventureTitle,
            rpgSettings: rpgEarly,
            stateMgr: stateMgrEarly,
        });
        if (chatId && campaignPrefix && rpgEarly) {
            stampCanonicalCampaignPrefix(chatId, campaignPrefix, rpgEarly);
        }
        // ── 1. Apply Ruleset Cartridge with Dynamic Overrides ───────────────────
        onProgress(`🎲 Installing ${adapter.label} (${adapter.diceEngine})...`, 15);
        const statsList = Object.keys(dossier.protagonist?.stats || {});
        const cartridgeOverrides = {
            id: chatId ? `${adapter.id}_${chatId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : null,
            campaignTitle: adventureTitle,
            name: adventureTitle ? `${adapter.id.toUpperCase()}: ${adventureTitle}` : null,
            systemLabel: dossier.meta?.systemLabel,
            description: dossier.meta?.premise,
            tone: dossier.meta?.tone,
            factions: dossier.factions,
            worldRules: dossier.worldRules,
            positive_tags: dossier.protagonist?.positiveTags,
            negative_tags: dossier.protagonist?.negativeTags,
            pools: dossier.protagonist?.pools,
            stats: statsList.length >= 3 ? statsList : null,
            startingMoves: dossier.protagonist?.startingMoves,
            cyoaExamples: (Array.isArray(dossier.cyoaExamples) && dossier.cyoaExamples.length > 0) ? dossier.cyoaExamples : null,
            heroicTier: Boolean(
                dossier.config?.heroicTier ??
                dossier.config?.heroic_tier ??
                dossier.config?.knobs?.heroic_tier
            ),
            heroicDomain: dossier.protagonist?.heroicDomain || dossier.character?.heroic_domain || null,
            actionTempo: dossier.config?.actionTempo || dossier.config?.knobs?.action_tempo || 'gritty_default',
            config: dossier.config || {},
            knobs: {
                ...(dossier.config?.knobs || {}),
                action_tempo: dossier.config?.actionTempo || dossier.config?.knobs?.action_tempo || 'gritty_default',
            },
            customGenreSpec: dossier.meta?.customGenreSpec || null,
            dossier,
        };
        const cartridgeOk = await adapter.installCartridge(systemKey, cartridgeOverrides, { ...options, ctx, chatId });
        if (cartridgeOk === false) {
            throw new Error(`Failed to install ${adapter.label} ruleset cartridge.`);
        }

        // Apply native MultiHog CYOA toggle based on playstyle dial
        const isFreeform = (dossier.config?.playstyle === 'freeform');
        if (rpgEarly) {
            rpgEarly.syspromptModules = rpgEarly.syspromptModules || {};
            rpgEarly.syspromptModules.CYOA_mode = !isFreeform;
            if (rpgEarly.cyoaConfig) {
                rpgEarly.cyoaConfig.useCustomPrompt = !isFreeform;
                rpgEarly.cyoaConfig.useButtonTags = !isFreeform;
                rpgEarly.cyoaConfig.useXmlTag = !isFreeform;
                rpgEarly.cyoaConfig.playstyle = dossier.config?.playstyle || 'cyoa_5';
                if (isFreeform) rpgEarly.cyoaConfig.customPromptText = '';
            }
            if (chatId && rpgEarly.chatStates?.[chatId]) {
                const part = rpgEarly.chatStates[chatId];
                if (part.setup) {
                    part.setup.syspromptModules = part.setup.syspromptModules || {};
                    part.setup.syspromptModules.CYOA_mode = !isFreeform;
                    if (part.setup.cyoaConfig) {
                        part.setup.cyoaConfig.useCustomPrompt = !isFreeform;
                        part.setup.cyoaConfig.useButtonTags = !isFreeform;
                        part.setup.cyoaConfig.useXmlTag = !isFreeform;
                        part.setup.cyoaConfig.playstyle = dossier.config?.playstyle || 'cyoa_5';
                        if (isFreeform) part.setup.cyoaConfig.customPromptText = '';
                    }
                }
            }
        }

        // ── 2. Player Persona & Lorebook Card ────────────────────────────────────
        if (charName) {
            onProgress(`👤 Setting up protagonist "${charName}"...`, 30);
            try {
                const charCreator = await import('../SillyTavern-MultihogDnDFramework/character-creator.js');

                // Activate or create persona
                let avatarId = null;
                if (typeof charCreator.activateSillyTavernPersona === 'function') {
                    avatarId = await charCreator.activateSillyTavernPersona(charName, { chatId });
                }

                // Add to Lorebook Agent with structured sections matching DEFAULT_PC_SECTIONS
                if (typeof charCreator.addPlayerCardToLorebookAgent === 'function') {
                    const pcSectionNames = await loadMainPcSectionNames();
                    const bio = buildPlayerCardBio(dossier.protagonist, pcSectionNames, { ruleset: dossier.meta?.ruleset });
                    await charCreator.addPlayerCardToLorebookAgent(charName, bio, 150, { chatId });
                }

                // Resolve persona
                let persona = await findMatchingPersona(charName);
                if (!persona && avatarId) {
                    persona = { avatar: avatarId, name: charName };
                }
                if (!persona) {
                    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
                    const activeAvatar = effectiveCtx?.chatMetadata?.persona || effectiveCtx?.user_avatar;
                    if (activeAvatar) {
                        persona = { avatar: activeAvatar, name: charName };
                    }
                }

                // Sync portrait if available
                if (dossier.protagonist.portraitSrc && persona) {
                    await uploadImageToPersona(persona.avatar, dossier.protagonist.portraitSrc);
                    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
                    if (effectiveCtx?.chatMetadata) {
                        effectiveCtx.chatMetadata.multihog_companion = {
                            ...effectiveCtx.chatMetadata.multihog_companion,
                            synced_portrait: dossier.protagonist.portraitSrc,
                            synced_persona: persona.avatar,
                            synced_at: Date.now(),
                        };
                        if (typeof effectiveCtx.saveMetadataDebounced === 'function') {
                            effectiveCtx.saveMetadataDebounced();
                        }
                    }
                }

                // Lock persona to chat
                if (persona) {
                    await syncPersonaToChat(chatId, persona);
                }
            } catch (err) {
                console.warn('[PbtA Concierge] Protagonist persona setup encountered non-fatal error:', err);
            }
        }

        // ── 3. Primary Map Architect Generation (Staggered Launch) ─────────────
        const maps = dossier.maps || [];
        const monsters = dossier.monsters || [];
        const sectionNamesForLaunch = (dossier.npcs?.length || monsters.length)
            ? await loadMainNpcSectionNames()
            : null;
        if (maps.length) {
            try {
                const mapArch = await import('../SillyTavern-MultihogDnDFramework/map-architect.js');
                if (typeof mapArch.runMapArchitect === 'function') {
                    // Staggered / Lazy Generation: Generate the primary starting location map at launch.
                    // Secondary sites are already registered in {prefix}_Locations with [CORE],
                    // ready for Map Architect to generate on entry or via Campaign Records!
                    const startSiteName = (dossier.theKick?.startingLocation || maps[0]?.site || '').toLowerCase().trim();
                    const primaryMap = maps.find(m => (m.site || '').toLowerCase().trim() === startSiteName) || maps[0];

                    if (primaryMap?.site) {
                        onProgress(`🗺️ Generating starting map: ${primaryMap.site}...`, 45);
                        try {
                            let mapLorebookNames = [];
                            if (monsters.length > 0) {
                                try {
                                    const prefix = campaignPrefix || resolveCanonicalCampaignPrefix(chatId, {
                                        adventureTitle,
                                        rpgSettings: rpgEarly,
                                        stateMgr: stateMgrEarly,
                                    });
                                    const bestiaryBookName = prefix ? `${prefix}_Bestiary` : 'Bestiary';
                                    const preDist = prepareCampaignLorebookDistributions(dossier, sectionNamesForLaunch);
                                    if (preDist.bestiary?.length) {
                                        await upsertWorldInfoBook(bestiaryBookName, preDist.bestiary);
                                        mapLorebookNames = [bestiaryBookName];
                                    }
                                } catch (bestiaryErr) {
                                    console.warn('[PbtA Concierge] Could not pre-seed Bestiary before Map Architect:', bestiaryErr);
                                }
                            }

                            const archNotes = (dossier.worldRules?.axioms || [])
                                .map(a => a.architecturalNotes ? a.architecturalNotes.trim() : '')
                                .filter(Boolean);
                            const archContext = archNotes.length > 0 ? ` Living Architecture & Infrastructure: ${archNotes.join('; ')}.` : '';
                            const threatContext = buildMapThreatBrief(dossier);

                            await mapArch.runMapArchitect({
                                site: primaryMap.site,
                                entrance: primaryMap.entrance || 'Main Threshold',
                                kind: primaryMap.kind || 'SETTLEMENT',
                                scale: 'SMALL',
                                threat: primaryMap.threat || 'MODERATE',
                                prompt: `${primaryMap.prompt || primaryMap.briefDescription}${archContext}${threatContext}`,
                                brief_description: `${primaryMap.briefDescription || primaryMap.prompt || ''}${archContext}`.trim(),
                                locationCore: buildLocationEntry(primaryMap).core,
                                ...(mapLorebookNames.length ? { lorebookNames: mapLorebookNames } : {}),
                            });
                        } catch (mapErr) {
                            console.warn(`[PbtA Concierge] Map Architect skipped starting map "${primaryMap.site}":`, mapErr);
                        }
                    }

                    if (maps.length > 1) {
                        console.log(`[PbtA Concierge] Staged ${maps.length - 1} secondary site(s) into Locations lorebook for lazy on-entry generation.`);
                    }
                }
            } catch (err) {
                console.warn('[PbtA Concierge] Map Architect import failed:', err);
            }
        }

        // ── 4. Register Supporting NPCs (library) & All Partition Lorebooks/Canon/Skeleton ──
        const npcs = dossier.npcs || [];
        const factions = dossier.factions || [];
        let npcMapping = {};
        onProgress('👥 Distributing cast, locations, lorebooks & world skeleton...', 70);
        const sectionNames = sectionNamesForLaunch || ((npcs.length || monsters.length) ? await loadMainNpcSectionNames() : null);
        if (npcs.length) {
            try {
                const npcLib = await import('../SillyTavern-MultihogDnDFramework/npc-library.js');
                if (typeof npcLib.saveNpcToLibrary === 'function') {
                    // Main's saveNpcToLibrary(settings, record) upserts by name and persists settings.
                    // Keep NPC Library strictly for recurring named NPCs — never monsters/hazards.
                    const libEntries = npcs.map(n => ({ name: n.name, content: buildNpcEntryContent(n, sectionNames).core, notes: n.notes || '' }));
                    for (const e of libEntries) {
                        if (!e.name || !e.content) continue;
                        await npcLib.saveNpcToLibrary(null, { name: e.name, content: e.content, keys: buildNpcKeys(e.name), notes: e.notes });
                    }
                } else {
                    console.warn('[PbtA Concierge] Main NPC library API (saveNpcToLibrary) not found — skipping library registration. Main extension may have changed.');
                }
            } catch (err) {
                console.warn('[PbtA Concierge] NPC library registration failed:', err);
            }
        }

        // Always distribute across MultiHog's native campaign lorebooks (_NPCs, _Bestiary, _Factions, _Locations, _Quests, _Rules)
        try {
            npcMapping = await injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames, campaignPrefix);
        } catch (loreErr) {
            console.warn('[PbtA Concierge] Campaign lorebook injection skipped:', loreErr);
        }

        // Archivist mode: full imported lore → {prefix}_Canon (vector-matchable)
        await injectCanonBook(chatId, campaignPrefix);

        // ── 4b. Seed Day 0 World Skeleton ({prefix}_Skeleton) for World Progression ──
        onProgress('🌍 Seeding Day 0 World Skeleton for macro progression...', 78);
        try {
            await injectWorldSkeleton(chatId, dossier, campaignPrefix);
        } catch (skelErr) {
            console.warn('[PbtA Concierge] World Skeleton injection skipped:', skelErr);
        }

        // ── 5. Inject Dossier into World Info & State ───────────────────────────
            onProgress('📜 Inscribing Campaign Dossier into World Memory...', 85);
            const dossierMd = serializeDossierToMarkdown(dossier, { includeCyoa: false });
            await injectDossierIntoWorldInfo(chatId, dossierMd);

            // Store dossier and initialize game state memo in MultiHog for runtime panel access
            const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
            const rpgSettings = effectiveCtx?.extensionSettings?.rpg_tracker;
            const initialMemo = adapter.formatInitialMemo(dossier, { location: dossier.theKick?.startingLocation });

            if (rpgSettings) {
                rpgSettings.currentMemo = initialMemo;
                rpgSettings.chatStates = rpgSettings.chatStates || {};

                // ── 5b. Synchronize Relationships & Turn 1 Context ─────────────────
                const relsEnabled = dossier.config?.relationships !== false;
                rpgSettings.npcRelationshipBars = relsEnabled;

                if (relsEnabled && npcMapping && Object.keys(npcMapping).length > 0) {
                    rpgSettings.npcRelationshipValues = rpgSettings.npcRelationshipValues || {};
                    rpgSettings.npcRelationshipLog = rpgSettings.npcRelationshipLog || {};
                    rpgSettings.activeRouterKeys = rpgSettings.activeRouterKeys || [];

                    for (const n of (dossier.npcs || [])) {
                        const cleanName = (n.name || '').toLowerCase().trim();
                        const mapped = npcMapping[cleanName];
                        if (!mapped?.fullId) continue;

                        const fullId = mapped.fullId;
                        const friendship = n.friendship ?? 0;
                        const affection = n.affection ?? 0;

                        rpgSettings.npcRelationshipValues[fullId] = {
                            friendship,
                            affection,
                        };

                        if (!Array.isArray(rpgSettings.npcRelationshipLog[fullId])) {
                            rpgSettings.npcRelationshipLog[fullId] = [];
                        }
                        rpgSettings.npcRelationshipLog[fullId].unshift({
                            timestamp: Date.now(),
                            field: 'friendship',
                            delta: friendship,
                            newValue: friendship,
                            source: 'concierge_session_zero',
                        });
                        if (affection !== 0) {
                            rpgSettings.npcRelationshipLog[fullId].unshift({
                                timestamp: Date.now(),
                                field: 'affection',
                                delta: affection,
                                newValue: affection,
                                source: 'concierge_session_zero',
                            });
                        }

                        // Activate starting companions / mentors on Turn 1 so they appear in [NPC_RELATIONS]
                        const isAllied = isAlliedCompanionRole(n.role);
                        if (isAllied && !rpgSettings.activeRouterKeys.includes(fullId)) {
                            rpgSettings.activeRouterKeys.push(fullId);
                        }
                    }
                }

                const simDepth = dossier.config?.simulationDepth || 'active_fronts';
                if (simDepth === 'static') {
                    rpgSettings.worldProgressionEnabled = false;
                    rpgSettings.mapEvolutionEnabled = false;
                } else if (simDepth === 'living_world') {
                    rpgSettings.worldProgressionEnabled = true;
                    rpgSettings.worldProgressionIntervalHours = 24;
                    rpgSettings.mapEvolutionEnabled = true;
                    rpgSettings.mapEvolutionIntervalHours = 8;
                } else {
                    // 'active_fronts' (default recommended)
                    rpgSettings.worldProgressionEnabled = true;
                    rpgSettings.worldProgressionIntervalHours = 24;
                    rpgSettings.mapEvolutionEnabled = false;
                }

                if (chatId) {
                    rpgSettings.chatStates[chatId] = rpgSettings.chatStates[chatId] || {};
                    rpgSettings.chatStates[chatId].currentMemo = initialMemo;
                    setPartitionDossier(rpgSettings.chatStates[chatId], dossier, adapter.id);
                    rpgSettings.chatStates[chatId].simulationDepth = simDepth;
                    rpgSettings.chatStates[chatId].worldProgressionEnabled = rpgSettings.worldProgressionEnabled;
                    rpgSettings.chatStates[chatId].mapEvolutionEnabled = rpgSettings.mapEvolutionEnabled;
                    rpgSettings.chatStates[chatId].npcRelationshipBars = relsEnabled;
                    if (rpgSettings.npcRelationshipValues) {
                        rpgSettings.chatStates[chatId].npcRelationshipValues = JSON.parse(JSON.stringify(rpgSettings.npcRelationshipValues));
                    }
                    if (rpgSettings.activeRouterKeys) {
                        rpgSettings.chatStates[chatId].activeRouterKeys = [...rpgSettings.activeRouterKeys];
                    }
                    if (dossier.config?.artStyle) {
                        rpgSettings.chatStates[chatId].campaignArtStyle = dossier.config.artStyle;
                    }

                    // Preserve canonical campaign prefix and register partition lorebooks for upstream MultiHog purge tracking
                    stampCanonicalCampaignPrefix(
                        chatId,
                        campaignPrefix || resolveCanonicalCampaignPrefix(chatId, {
                            adventureTitle,
                            rpgSettings,
                            stateMgr: stateMgrEarly,
                        }),
                        rpgSettings,
                    );

                    // Register Custom HUD Tracker / Game System in MultiHog v3 catalogs if defined
                    let syncChatSetupCatalogsFn = null;
                    try {
                        const setupMod = await import('../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js');
                        if (typeof setupMod.syncChatSetupCatalogs === 'function') {
                            syncChatSetupCatalogsFn = setupMod.syncChatSetupCatalogs;
                        }
                    } catch (_) {}
                    registerCustomGameSystemInSettings(rpgSettings, dossier.worldRules?.customModule, {
                        chatId,
                        syncChatSetupCatalogs: syncChatSetupCatalogsFn,
                    });
                    syncSavedCartridgePayloadFromLiveSettings(rpgSettings, cartridgeOverrides.id);
                }

            if (dossier.protagonist?.portraitSrc) {
                const pSrc = dossier.protagonist.portraitSrc;
                rpgSettings.customPortraits = rpgSettings.customPortraits || {};
                rpgSettings.customPortraits['CHARACTER'] = pSrc;
                rpgSettings.customPortraits['PC'] = pSrc;
                if (charName) {
                    rpgSettings.customPortraits[charName] = pSrc;
                    const clean = charName.replace(/\s*\(.*?\)/g, '').trim();
                    if (clean) rpgSettings.customPortraits[clean] = pSrc;
                }
                if (chatId) {
                    rpgSettings.chatStates[chatId].customPortraits = rpgSettings.chatStates[chatId].customPortraits || {};
                    rpgSettings.chatStates[chatId].customPortraits['CHARACTER'] = pSrc;
                    rpgSettings.chatStates[chatId].customPortraits['PC'] = pSrc;
                    if (charName) {
                        rpgSettings.chatStates[chatId].customPortraits[charName] = pSrc;
                        const clean = charName.replace(/\s*\(.*?\)/g, '').trim();
                        if (clean) rpgSettings.chatStates[chatId].customPortraits[clean] = pSrc;
                    }
                }
            }
        }

        // Poke the Multihog UI so it immediately transitions out of "Create an adventure" mode
        try {
            if (typeof globalThis._rpgUpdateUIMemo === 'function') {
                globalThis._rpgUpdateUIMemo(initialMemo);
            }
            const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
            if (typeof bridge.syncMemoView === 'function') bridge.syncMemoView();
            if (typeof bridge.refreshRenderedView === 'function') bridge.refreshRenderedView();
            if (typeof bridge.saveSettings === 'function') bridge.saveSettings();
        } catch (uiErr) {
            console.warn('[PbtA Concierge] Could not poke Multihog UI directly:', uiErr);
        }

        try {
            const { persistPbtaChatState, setCompanionActiveCartridge } = await import('./pbta-ruleset-persistence.js');
            if (typeof setCompanionActiveCartridge === 'function' && chatId) {
                await setCompanionActiveCartridge(
                    chatId,
                    buildCompanionActiveCartridgeRecord(adapter, systemKey, dossier, {
                        title: adventureTitle,
                        cartridgeOverrides,
                    }),
                );
            }
            if (typeof persistPbtaChatState === 'function' && chatId) {
                await persistPbtaChatState(chatId);
            }
        } catch (_) {
            try {
                const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
                if (typeof stateMgr.saveChatState === 'function' && chatId) {
                    stateMgr.saveChatState(chatId);
                }
            } catch (_) {}
        }

        // ── 6. Opening Fiction Scene (Turn 0) ───────────────────────────────────
        onProgress('🚀 Launching opening adventure turn...', 95);
        const defaultOpeningTitle = isFae ? 'FAE Adventure' : 'PbtA Adventure';
        const openingText = dossier.theKick?.openingPrompt
            ? dossier.theKick.openingPrompt
            : `[Initial Setup: ${dossier.meta?.title || defaultOpeningTitle}]\n${dossier.meta?.premise || 'The adventure begins.'}\n\nBegin the adventure and frame the opening scene.`;

        // Guarantee MultiHog sysprompt runtime has compiled the latest cartridge settings
        try {
            const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
            if (typeof bridge.autoApplySysprompt === 'function') {
                await bridge.autoApplySysprompt(true);
            }
        } catch (_) {}

        await sendOutgoingChatMessage(openingText);

        // ── 7. Refresh Campaign Records & Lorebook Agent ──────────────────────
        try {
            const bridge = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js');
            if (typeof bridge.refreshAgentManifestNow === 'function') {
                await bridge.refreshAgentManifestNow();
            }
            if (typeof bridge.runRouterPass === 'function') {
                void bridge.runRouterPass(openingText, null, 1, true).catch(() => {});
            }
        } catch (_) {}

        onProgress('✨ Adventure successfully launched!', 100);
        return { success: true, message: 'Campaign launched successfully!' };
    } catch (err) {
        console.error('[PbtA Concierge] Campaign launch failed:', err);
        return { success: false, message: err.message || String(err) };
    }
}

/**
 * In-place synchronization of an active campaign's dossier.
 * Updates rules, cartridge prompts, character harm capacity & tandem HP,
 * and World Info without resetting chat history or sending turn 1.
 *
 * @param {object} rawDossier The modified PbtaCampaignDossier
 * @param {(stepText: string, pct: number) => void} [onProgress] Progress callback
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function syncPbtaCampaignUpdates(rawDossier, onProgress = () => {}, options = {}) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const { healAndNormalizeDossier } = await import('./concierge-parser.js');
    const { applyPbtACartridge } = await import('./index.js');
    const { formatInitialPbtaMemo } = await import('./pbta-ruleset.js');
    const { forceRenderTrackerView } = await import('./index.js');
    const { normalizePbtaMemo, syncLivePbtaMemoVitality } = await import('./pbta-vitality-sync.js');

    const dossier = await prepareSanitizedDossierForFramework(rawDossier, { healAndNormalizeDossier });
    dossier.meta = dossier.meta || {};
    dossier.meta.conciergeCreated = true;
    dossier.meta.isStub = false;
    delete dossier.meta.autoScaffolded;
    const systemKey = dossier.meta?.systemKey || 'fantasy';
    const charName = (dossier.protagonist?.name || '').trim();
    let adventureTitle = (dossier.meta?.title || '').trim();
    if (!adventureTitle || isDefaultUntitledCampaignTitle(adventureTitle)) {
        const loc = (dossier.maps?.[0]?.name || dossier.theKick?.startingLocation || '').trim();
        if (charName && loc) {
            adventureTitle = `${charName} - ${loc}`;
        } else if (charName) {
            adventureTitle = `${charName}'s Adventure`;
        } else if (dossier.meta?.premise) {
            adventureTitle = dossier.meta.premise.slice(0, 40).trim();
        }
        if (adventureTitle) {
            dossier.meta = dossier.meta || {};
            dossier.meta.title = adventureTitle;
        }
    }
    
    // Robust active chat ID resolution matching framework & companion conventions
    const chatId = String(
        (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
        || ctx?.getCurrentChatId?.()
        || ctx?.chatId
        || ctx?.chatMetadata?.chat_id
        || ''
    );

    try {
        const rpgSyncPrefixSettings = ctx?.extensionSettings?.rpg_tracker;
        let stateMgrSync = null;
        try {
            stateMgrSync = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        } catch (_) {}
        const syncCampaignPrefix = resolveCanonicalCampaignPrefix(chatId, {
            adventureTitle,
            rpgSettings: rpgSyncPrefixSettings,
            stateMgr: stateMgrSync,
        });
        if (chatId && syncCampaignPrefix && rpgSyncPrefixSettings) {
            stampCanonicalCampaignPrefix(chatId, syncCampaignPrefix, rpgSyncPrefixSettings);
        }

        // 1. Inscribe updated dossier into World Info
        onProgress('📜 Inscribing updated dossier into World Info...', 20);
        const dossierMd = serializeDossierToMarkdown(dossier, { includeCyoa: false });
        await injectDossierIntoWorldInfo(chatId, dossierMd);

        // 2. Distribute updated entities into campaign lorebooks
        onProgress('📚 Updating campaign lorebooks...', 40);
        const sectionNames = await loadMainNpcSectionNames();
        try {
            await injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames, syncCampaignPrefix);
        } catch (loreErr) {
            console.warn('[PbtA Concierge] Lorebook sync warning:', loreErr);
        }

        // 2b. Refresh Player Character card bio in Lorebook Agent if protagonist name exists
        if (charName) {
            try {
                const charCreator = await import('../SillyTavern-MultihogDnDFramework/character-creator.js');
                if (typeof charCreator.addPlayerCardToLorebookAgent === 'function') {
                    const pcSectionNames = await loadMainPcSectionNames();
                    const bio = buildPlayerCardBio(dossier.protagonist, pcSectionNames, { ruleset: dossier.meta?.ruleset });
                    await charCreator.addPlayerCardToLorebookAgent(charName, bio, 150, { chatId });
                }
            } catch (pcErr) {
                console.warn('[PbtA Concierge] PC card sync warning:', pcErr);
            }
        }

        // 3. Update Ruleset Cartridge with dynamic rules and Harm tiers
        const rulesetId = systemRegistry.detectRuleset(dossier);
        const adapter = systemRegistry.get(rulesetId);
        const isFae = adapter.id === 'fae' || rulesetId === 'fae';
        onProgress(`🎲 Re-applying ${adapter.label} ruleset cartridge...`, 60);
        const statsList = Object.keys(dossier.protagonist?.stats || {});
        const cartridgeOverrides = {
            id: chatId ? `${adapter.id}_${chatId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : null,
            campaignTitle: adventureTitle,
            name: adventureTitle ? `${adapter.id.toUpperCase()}: ${adventureTitle}` : null,
            systemLabel: dossier.meta?.systemLabel,
            description: dossier.meta?.premise,
            tone: dossier.meta?.tone,
            factions: dossier.factions,
            worldRules: dossier.worldRules,
            positive_tags: dossier.protagonist?.positiveTags,
            negative_tags: dossier.protagonist?.negativeTags,
            pools: dossier.protagonist?.pools,
            stats: statsList.length >= 3 ? statsList : null,
            startingMoves: dossier.protagonist?.startingMoves,
            cyoaExamples: (Array.isArray(dossier.cyoaExamples) && dossier.cyoaExamples.length > 0) ? dossier.cyoaExamples : null,
            heroicTier: Boolean(
                dossier.config?.heroicTier ??
                dossier.config?.heroic_tier ??
                dossier.config?.knobs?.heroic_tier
            ),
            heroicDomain: dossier.protagonist?.heroicDomain || dossier.character?.heroic_domain || null,
            actionTempo: dossier.config?.actionTempo || dossier.config?.knobs?.action_tempo || 'gritty_default',
            config: dossier.config || {},
            knobs: {
                ...(dossier.config?.knobs || {}),
                action_tempo: dossier.config?.actionTempo || dossier.config?.knobs?.action_tempo || 'gritty_default',
            },
            customGenreSpec: dossier.meta?.customGenreSpec || null,
            dossier,
        };
        await adapter.installCartridge(systemKey, cartridgeOverrides, { ...options, ctx, chatId });

        const isFreeform = (dossier.config?.playstyle === 'freeform');
        const rpgSync = ctx?.extensionSettings?.rpg_tracker;
        if (rpgSync) {
            rpgSync.syspromptModules = rpgSync.syspromptModules || {};
            rpgSync.syspromptModules.CYOA_mode = !isFreeform;
            if (rpgSync.cyoaConfig) {
                rpgSync.cyoaConfig.useCustomPrompt = !isFreeform;
                rpgSync.cyoaConfig.useButtonTags = !isFreeform;
                rpgSync.cyoaConfig.useXmlTag = !isFreeform;
                rpgSync.cyoaConfig.playstyle = dossier.config?.playstyle || 'cyoa_5';
                if (isFreeform) rpgSync.cyoaConfig.customPromptText = '';
            }
            if (chatId && rpgSync.chatStates?.[chatId]?.setup) {
                const partSetup = rpgSync.chatStates[chatId].setup;
                partSetup.syspromptModules = partSetup.syspromptModules || {};
                partSetup.syspromptModules.CYOA_mode = !isFreeform;
                if (partSetup.cyoaConfig) {
                    partSetup.cyoaConfig.useCustomPrompt = !isFreeform;
                    partSetup.cyoaConfig.useButtonTags = !isFreeform;
                    partSetup.cyoaConfig.useXmlTag = !isFreeform;
                    partSetup.cyoaConfig.playstyle = dossier.config?.playstyle || 'cyoa_5';
                    if (isFreeform) partSetup.cyoaConfig.customPromptText = '';
                }
            }
        }

        // 4. Update live state memo and MultiHog memory
        onProgress('⚙️ Synchronizing live state memo & character vitals...', 80);
        const rpgSettings = ctx?.extensionSettings?.rpg_tracker;
        if (rpgSettings) {
            // Find existing memo across settings, partition, or DOM textarea
            let memo = rpgSettings.currentMemo || (chatId && rpgSettings.chatStates?.[chatId]?.currentMemo) || '';
            if (!memo || !memo.trim()) {
                const domEl = typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo') : null;
                if (domEl && domEl.value && domEl.value.trim()) {
                    memo = domEl.value;
                }
            }

            if (memo && memo.trim()) {
                rpgSettings.currentMemo = adapter.mergeLiveMemo(memo, dossier, charName);
            } else {
                // Only if the adventure was never started/memo was completely blank
                rpgSettings.currentMemo = adapter.formatInitialMemo(dossier, { location: dossier.theKick?.startingLocation });
            }

            // Register/update Custom HUD Tracker / Game System in MultiHog v3 catalogs if defined
            let syncChatSetupCatalogsFn = null;
            try {
                const setupMod = await import('../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js');
                if (typeof setupMod.syncChatSetupCatalogs === 'function') {
                    syncChatSetupCatalogsFn = setupMod.syncChatSetupCatalogs;
                }
            } catch (_) {}
            registerCustomGameSystemInSettings(rpgSettings, dossier.worldRules?.customModule, {
                chatId: null,
                syncChatSetupCatalogs: syncChatSetupCatalogsFn,
            });
            syncSavedCartridgePayloadFromLiveSettings(rpgSettings, cartridgeOverrides.id);

            if (chatId) {
                rpgSettings.chatStateProjectionOwner = chatId;
                rpgSettings.chatStates = rpgSettings.chatStates || {};
                const cleanChatKey = chatId.replace(/\.jsonl$/i, '');
                const keysToSync = [...new Set([chatId, `${cleanChatKey}.jsonl`, cleanChatKey].filter(k => k === chatId || rpgSettings.chatStates[k]))];
                for (const key of keysToSync) {
                    rpgSettings.chatStates[key] = rpgSettings.chatStates[key] || {};
                    setPartitionDossier(rpgSettings.chatStates[key], dossier, adapter.id);
                    rpgSettings.chatStates[key].currentMemo = rpgSettings.currentMemo;
                    rpgSettings.chatStates[key].simulationDepth = dossier.config?.simulationDepth || 'active_fronts';
                    if (rpgSettings.customFields) {
                        rpgSettings.chatStates[key].customFields = [...rpgSettings.customFields];
                    }
                    adapter.syncVitality(rpgSettings, key);
                }
            }

            // Force tracker view hydration so Multihog HUD transitions immediately out of .rt-empty onboarding
            await forceRenderTrackerView(rpgSettings, chatId || 'active', rpgSettings.currentMemo);

            // Persist MultiHog setup snapshot and chat partition so F5 reloads retain PbtA/FAE
            try {
                const { persistPbtaChatState, setCompanionActiveCartridge } = await import('./pbta-ruleset-persistence.js');
                if (typeof setCompanionActiveCartridge === 'function' && chatId) {
                    await setCompanionActiveCartridge(
                        chatId,
                        buildCompanionActiveCartridgeRecord(adapter, systemKey, dossier, {
                            title: adventureTitle,
                            cartridgeOverrides,
                        }),
                    );
                }
                if (typeof persistPbtaChatState === 'function' && chatId) {
                    await persistPbtaChatState(chatId);
                }
            } catch (_) {}
        }

        onProgress('✨ Active campaign successfully synchronized!', 100);
        const syncMsg = adapter.id === 'dnd5e'
            ? 'Active D&D 5e campaign successfully synchronized!'
            : isFae
                ? 'Active FAE campaign successfully synchronized!'
                : `Active campaign synchronized with Harm capacity ${dossier.config?.harmMax || 5}!`;
        return { success: true, message: syncMsg };
    } catch (err) {
        console.error('[PbtA Concierge] Active campaign sync failed:', err);
        return { success: false, message: err.message || String(err) };
    }
}

/**
 * AI Maker Fallback: Sends malformed, legacy, or unstructured markdown to the
 * Concierge Builder model to reconstruct into a valid PbtA Campaign Dossier.
 *
 * @param {string} rawMarkdown
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<object>} Healed PbtaCampaignDossier
 */
export async function reconstituteDossierWithAi(rawMarkdown, onProgress = () => {}) {
    onProgress('Consulting the AI Campaign Architect to heal dossier...');
    const { sendConciergeRequest } = await import('./concierge-connection.js');
    const { createEmptyDossier, applyDossierUpdates, healAndNormalizeDossier } = await import('./concierge-parser.js');

    const prompt = `[TASK: RECONSTITUTE_CAMPAIGN_DOSSIER]
You are the PbtA Campaign Architect. The following text contains an unstructured, corrupted, or legacy campaign outline.
Your goal is to parse and reconstruct this campaign into a complete PbtA Campaign Dossier.
Analyze the text and output complete [UPDATE_DOSSIER] blocks declaring:
- [META] title, system (e.g. fantasy, scifi, horror), premise, tone [/META]
- [PROTAGONIST] name, playbook, stats (Might +2, Agility +1, etc.), harm_max (default 5 or extracted), bio [/PROTAGONIST]
- [NPC] name, role, appearance, demeanor, relationship [/NPC] for any supporting characters
- [MONSTER] name, harm, armor, attacks [/MONSTER] for any adversaries
- [FACTION] name, agenda, standing [/FACTION] for any factions
- [CONFIG] playstyle: cyoa_5, harm_max: 5 (or matching protagonist), party_mode: squad, simulation_depth: active_fronts [/CONFIG]

SOURCE TEXT:
${String(rawMarkdown || '').slice(0, 12000)}

Output the [UPDATE_DOSSIER] ... [/UPDATE_DOSSIER] block now.`;

    const response = await sendConciergeRequest([
        { role: 'system', content: 'You are the PbtA Campaign Architect. Reconstruct the provided campaign into structured [UPDATE_DOSSIER] blocks.' },
        { role: 'user', content: prompt },
    ]);

    let dossier = createEmptyDossier();
    const updateResult = applyDossierUpdates(response || '', dossier);
    dossier = updateResult.updatedDossier || dossier;

    return healAndNormalizeDossier(dossier, rawMarkdown);
}

// Canonical alias for launching a Concierge Session Zero campaign (PbtA or FAE)
export const executeConciergeCampaignLaunch = launchPbtaCampaign;

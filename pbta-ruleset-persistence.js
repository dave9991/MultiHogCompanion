/// <reference path="./types.d.ts" />
/**
 * pbta-ruleset-persistence.js
 *
 * Ensures PbtA ruleset configuration, cartridge prompts, and system settings
 * persist across page reloads (F5), chat setup snapshots, and chat switches.
 * Prevents MultiHog's Chat Setup Link from resetting PbtA campaigns to stock D&D.
 */

import { PBTA_GENRES, buildPbtACartridge, buildCampaignContextSnippets } from './pbta-ruleset.js';
import { FAE_GENRES, buildFaeCartridge } from './fae-ruleset.js';
import { DND_SUBFOOTER_OVERRIDE_ID, getDndAlignedCyoaPrompt } from './dnd-fixes.js';
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
 * Returns the active campaign dossier stored on a chatStates partition,
 * checking canonical `companionDossier` as well as ruleset-scoped keys.
 *
 * @param {object|null|undefined} part
 * @returns {object|null}
 */
export function getPartitionDossier(part) {
    if (!part || typeof part !== 'object') return null;
    return part.companionDossier
        || part.faeCampaignDossier
        || part.pbtaCampaignDossier
        || part.campaignDossier
        || null;
}

/**
 * Writes a campaign dossier into a chatStates partition under canonical `companionDossier`
 * (and `campaignDossier`) while keeping ruleset-specific keys (`faeCampaignDossier` /
 * `pbtaCampaignDossier`) synchronized for FAE and PbtA without polluting them for D&D 5e.
 *
 * @param {object|null|undefined} part
 * @param {object|null|undefined} dossier
 * @param {string|null} [rulesetHint=null]
 */
export function setPartitionDossier(part, dossier, rulesetHint = null) {
    if (!part || typeof part !== 'object' || !dossier || typeof dossier !== 'object') return;
    part.companionDossier = dossier;
    part.campaignDossier = dossier;
    const inferredRuleset = dossier?.meta?.ruleset
        || (dossier?.meta?.systemKey === 'dnd5e' ? 'dnd5e' : '')
        || (dossier?.meta?.isStub && !dossier?.protagonist?.isPbta && !dossier?.protagonist?.isFae ? 'dnd5e' : '');
    const ruleset = String(rulesetHint || inferredRuleset || '').toLowerCase();
    if (ruleset === 'fae') {
        part.faeCampaignDossier = dossier;
    } else if (ruleset === 'dnd5e') {
        if (part.pbtaCampaignDossier?.meta?.ruleset === 'dnd5e') delete part.pbtaCampaignDossier;
        if (part.faeCampaignDossier?.meta?.ruleset === 'dnd5e') delete part.faeCampaignDossier;
    } else {
        part.pbtaCampaignDossier = dossier;
    }
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
                setPartitionDossier(s.chatStates[cid], record.dossier, record.cartridgeId);
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
    if (activeCart?.cartridgeId === 'fae' || activeCart?.cartridgeId === 'dnd5e') {
        return false;
    }

    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;

    const candidateIds = getCandidateChatIds(chatId, s);
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]) {
            // Partition marked explicitly as FAE or D&D 5e must not match PbtA
            const pbtaRuleset = s.chatStates[cid].pbtaCampaignDossier?.meta?.ruleset;
            if (s.chatStates[cid].faeCampaignDossier || pbtaRuleset === 'fae' || pbtaRuleset === 'dnd5e') {
                continue;
            }

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
    if (activeCart?.cartridgeId === 'fae' || activeCart?.cartridgeId === 'dnd5e') return false;

    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;
    const candidateIds = getCandidateChatIds(chatId, s);
    for (const cid of candidateIds) {
        const pbtaRuleset = s.chatStates?.[cid]?.pbtaCampaignDossier?.meta?.ruleset;
        if (s.chatStates?.[cid]?.faeCampaignDossier || pbtaRuleset === 'fae' || pbtaRuleset === 'dnd5e') {
            return false;
        }
        if (s.chatStates?.[cid]?.pbtaCampaignDossier) return true;
    }
    return isPbtAActive(chatId, s, companionSettings);
}

/**
 * Helper to detect FAE memo markers (resource knobs, tag pills, leverage barriers).
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsFaeMarkers(text) {
    if (typeof text !== 'string' || !text) return false;
    return /FAE Knobs:/i.test(text)
        || /\(\(PILLS\)\)\s*Positive Tags:/i.test(text)
        || /\(\(PILLS\)\)\s*Scars & Debuffs:/i.test(text)
        || /Leverage Barriers/i.test(text);
}

/**
 * Check if FAE (Freeform Attrition Engine) overrides are active for the given or current chat.
 * Checks:
 * 0. Explicit CompanionActiveCartridge stamp (Primary source of truth)
 * 1. Chat partition faeCampaignDossier or pbtaCampaignDossier meta.ruleset === 'fae'
 * 2. Chat setup syspromptSnippetStates with fae_ snippets
 * 3. Chat memo contains FAE markers
 * 4. Live customSyspromptLibrary fae_ entries or live memo FAE markers
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @param {object|null} [companionSettings=null]
 * @returns {boolean}
 */
export function isFaeActive(chatId = null, rpgSettings = null, companionSettings = null) {
    // 0. Primary Source of Truth: Explicit CompanionActiveCartridge
    const activeCart = getCompanionActiveCartridge(chatId, rpgSettings, companionSettings);
    if (activeCart?.cartridgeId === 'fae') {
        return true;
    }
    if (activeCart?.cartridgeId === 'pbta' || activeCart?.cartridgeId === 'dnd5e') {
        return false;
    }

    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;

    const candidateIds = getCandidateChatIds(chatId, s);
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]) {
            // 1. Chat partition contains an FAE campaign dossier or pbtaCampaignDossier meta.ruleset === 'fae'
            if (s.chatStates[cid].faeCampaignDossier || s.chatStates[cid].pbtaCampaignDossier?.meta?.ruleset === 'fae') {
                return true;
            }

            // 2. Chat setup states have enabled fae snippets
            const snippetStates = s.chatStates[cid].setup?.syspromptSnippetStates;
            if (snippetStates && typeof snippetStates === 'object') {
                if (Object.keys(snippetStates).some(k => k.startsWith('fae_') && snippetStates[k])) {
                    return true;
                }
            }

            // 3. Chat memo contains FAE markers
            const partitionMemo = s.chatStates[cid].currentMemo || '';
            if (containsFaeMarkers(partitionMemo)) {
                return true;
            }
        }
    }

    // 4. Live settings / memo check (only if live settings belong to this chat)
    const owner = String(s.chatStateProjectionOwner || '').trim();
    const isOwnerMatch = !owner || candidateIds.some(cid => cid === owner);
    if (isOwnerMatch) {
        if (Array.isArray(s.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('fae_') && p.enabled)) {
            return true;
        }

        if (containsFaeMarkers(s.currentMemo)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a chat partition is bound to an FAE campaign.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @param {object|null} [companionSettings=null]
 * @returns {boolean}
 */
export function isFaeChat(chatId = null, rpgSettings = null, companionSettings = null) {
    const activeCart = getCompanionActiveCartridge(chatId, rpgSettings, companionSettings);
    if (activeCart?.cartridgeId === 'fae') return true;
    if (activeCart?.cartridgeId === 'pbta' || activeCart?.cartridgeId === 'dnd5e') return false;

    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;
    const candidateIds = getCandidateChatIds(chatId, s);
    for (const cid of candidateIds) {
        if (s.chatStates?.[cid]?.faeCampaignDossier || s.chatStates?.[cid]?.pbtaCampaignDossier?.meta?.ruleset === 'fae') {
            return true;
        }
    }
    return isFaeActive(chatId, s, companionSettings);
}

/**
 * Resolves the active ruleset identifier for a chat: 'fae', 'pbta', or 'dnd5e'.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @param {object|null} [companionSettings=null]
 * @returns {'fae'|'pbta'|'dnd5e'}
 */
export function getActiveRulesetId(chatId = null, rpgSettings = null, companionSettings = null) {
    if (isFaeActive(chatId, rpgSettings, companionSettings)) return 'fae';
    if (isPbtAActive(chatId, rpgSettings, companionSettings)) return 'pbta';
    return 'dnd5e';
}

/**
 * Format badge label and summary for the active ruleset.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @param {string|null} [lastGenre='fantasy']
 * @param {object|null} [companionSettings=null]
 * @returns {{ isActive: boolean, ruleset: string, displayLabel: string, badgeText: string, summaryHtml: string, badgeStyle: object }}
 */
export function formatRulesetBadge(chatId = null, rpgSettings = null, lastGenre = 'fantasy', companionSettings = null) {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    const candidateIds = getCandidateChatIds(chatId, s);
    const activeCart = getCompanionActiveCartridge(chatId, s, companionSettings);
    let dossier = null;
    for (const cid of candidateIds) {
        if (s?.chatStates?.[cid]?.faeCampaignDossier) {
            dossier = s.chatStates[cid].faeCampaignDossier;
            break;
        }
        if (s?.chatStates?.[cid]?.pbtaCampaignDossier) {
            dossier = s.chatStates[cid].pbtaCampaignDossier;
            break;
        }
    }

    if (isFaeActive(chatId, s, companionSettings)) {
        const genreKey = activeCart?.genre || dossier?.meta?.systemKey || companionSettings?.lastFaeGenre || 'cosmic_horror';
        const genreObj = FAE_GENRES[genreKey] || FAE_GENRES.cosmic_horror;

        let displayLabel = 'Cosmic Horror';
        if (activeCart?.systemLabel) {
            displayLabel = activeCart.systemLabel.replace(/^FAE:\s*/i, '').trim();
        } else if (dossier?.meta?.systemLabel) {
            displayLabel = dossier.meta.systemLabel.replace(/^FAE:\s*/i, '').trim();
        } else if (genreObj) {
            const base = genreObj.label.split('(')[0].trim();
            displayLabel = base.replace(/^[^\w\s]+\s*/, '').replace(/^FAE:\s*/i, '').trim() || genreObj.label;
        }

        return {
            isActive: true,
            ruleset: 'fae',
            displayLabel,
            badgeText: `🕯️ FAE (${displayLabel})`,
            summaryHtml: `<span style="color: #d896ff; font-weight: 500;">🕯️ ${genreObj?.icon || ''} ${displayLabel}</span> &mdash; 4dF Attrition &amp; Resource Pools active`,
            badgeStyle: {
                background: 'rgba(170,90,250,0.2)',
                borderColor: 'rgba(170,90,250,0.5)',
                color: '#e0b0ff',
            },
        };
    }

    if (isPbtAActive(chatId, s, companionSettings)) {
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
            ruleset: 'pbta',
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
        ruleset: 'dnd5e',
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
    let existingFaeDossier = null;
    let existingCompanionDossier = null;
    for (const cid of candidateIds) {
        if (!existingDossier && s.chatStates?.[cid]?.pbtaCampaignDossier) {
            existingDossier = s.chatStates[cid].pbtaCampaignDossier;
        }
        if (!existingFaeDossier && s.chatStates?.[cid]?.faeCampaignDossier) {
            existingFaeDossier = s.chatStates[cid].faeCampaignDossier;
        }
        if (!existingCompanionDossier) {
            const candidate = getPartitionDossier(s.chatStates?.[cid]);
            if (candidate) existingCompanionDossier = candidate;
        }
    }

    s.chatStates = s.chatStates || {};
    for (const cid of candidateIds) {
        s.chatStates[cid] = s.chatStates[cid] || {};
        if (snapshot) {
            s.chatStates[cid].setup = snapshot;
        }
        if (existingCompanionDossier) {
            setPartitionDossier(s.chatStates[cid], existingCompanionDossier);
        }
        if (existingDossier) {
            s.chatStates[cid].pbtaCampaignDossier = existingDossier;
        }
        if (existingFaeDossier) {
            s.chatStates[cid].faeCampaignDossier = existingFaeDossier;
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

    // Guarantee dossiers remain on candidate partitions if saveChatState clobbered them
    if (existingCompanionDossier || existingDossier || existingFaeDossier) {
        for (const cid of candidateIds) {
            if (s.chatStates[cid]) {
                if (existingCompanionDossier) {
                    setPartitionDossier(s.chatStates[cid], existingCompanionDossier);
                }
                if (existingDossier) {
                    s.chatStates[cid].pbtaCampaignDossier = existingDossier;
                }
                if (existingFaeDossier) {
                    s.chatStates[cid].faeCampaignDossier = existingFaeDossier;
                }
            }
        }
    }

    logRulesetEvent('persistPbtaChatState', {
        chatId,
        hasDossier: !!existingDossier,
        hasFaeDossier: !!existingFaeDossier,
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

    // 1b. Check systemPromptTemplate for PbtA State Extractor directives
    const tpl = String(s.systemPromptTemplate || '');
    if (/FICTION-FIRST STATE:/i.test(tpl) || /PbtA does NOT use combat round counters/i.test(tpl)) {
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
 * Detects if the live MultiHog settings object contains residual FAE instructions
 * in stockPrompts, active fae_ snippets, or cyoaConfig prompt text.
 *
 * @param {object|null} s
 * @returns {boolean}
 */
export function isLiveSettingsPollutedWithFae(s) {
    if (!s || typeof s !== 'object') return false;

    // 1. Check stockPrompts for FAE markers
    const promptsStr = JSON.stringify(s.stockPrompts || {});
    if (/Freeform Attrition Engine/i.test(promptsStr)
        || /FAE Knobs:/i.test(promptsStr)
        || /Positive Tags:/i.test(promptsStr)
        || /Leverage Barriers/i.test(promptsStr)) {
        return true;
    }

    // 1b. Check systemPromptTemplate for FAE State Extractor directives
    const tpl = String(s.systemPromptTemplate || '');
    if (/SINGLE-PASS ATTRITION & POOLS:/i.test(tpl) || /FAE does NOT use D&D combat round counters/i.test(tpl)) {
        return true;
    }

    // 2. Check for enabled fae_ snippets in customSyspromptLibrary
    if (Array.isArray(s.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('fae_') && p.enabled)) {
        return true;
    }

    // 3. Check for fae_ snippets in syspromptSnippetDatabase or section order
    if (Array.isArray(s.syspromptSnippetDatabase) && s.syspromptSnippetDatabase.some(p => p.id?.startsWith('fae_') && p.globalEnabled)) {
        return true;
    }
    if (Array.isArray(s.syspromptSectionOrder) && s.syspromptSectionOrder.some(k => k.startsWith('lib:fae_'))) {
        return true;
    }

    // 4. Check if cyoaConfig has custom FAE prompt active
    if (s.cyoaConfig?.useCustomPrompt && (/FORMATTING FAE CHOICES/i.test(s.cyoaConfig?.customPromptText || '') || /FAE/i.test(s.cyoaConfig?.customPromptText || ''))) {
        return true;
    }

    return false;
}

export function isDndFixSnippetId(id) {
    return id === 'mhc_dnd_subfooter_override_footer' || id === 'mhc_dnd_deft_touch_pacing';
}

export function isCompanionRulesetSnippetId(id) {
    if (!id || typeof id !== 'string') return false;
    return id.startsWith('pbta_')
        || id.startsWith('fae_')
        || id.startsWith('dnd5e_campaign_')
        || id.startsWith('dnd5e_custom_');
}

export function pruneCompanionLibSectionOrder(order, keepSnippets = [], { removeDndSubfooter = false } = {}) {
    if (!Array.isArray(order)) return order;
    const keepIds = new Set((keepSnippets || []).map(item => item?.id).filter(Boolean));
    return order.filter(key => {
        if (typeof key !== 'string' || !key.startsWith('lib:')) return true;
        const id = key.slice(4);
        if (removeDndSubfooter && isDndFixSnippetId(id)) return keepIds.has(id);
        if (isCompanionRulesetSnippetId(id)) return keepIds.has(id);
        return true;
    });
}

/**
 * Verifies whether live MultiHog settings (`customSyspromptLibrary`, `stockPrompts`,
 * `cyoaConfig`, `diceFunctionTool`) match the compiled target cartridge for a chat.
 * Minimal test stubs that omit `.content` on library entries are treated as matching
 * so non-full fixtures do not trigger spurious setup saves.
 *
 * @param {object|null} s
 * @param {object|null} cartridge
 * @param {'pbta_'|'fae_'} prefix
 * @returns {boolean}
 */
export function doesLiveLibraryMatchCartridge(s, cartridge, prefix) {
    const liveAll = Array.isArray(s?.customSyspromptLibrary) ? s.customSyspromptLibrary : [];
    const targetAll = Array.isArray(cartridge?.payload?.customSyspromptLibrary) ? cartridge.payload.customSyspromptLibrary : [];
    const liveSnippets = liveAll.filter(p => p?.id?.startsWith(prefix));
    const targetSnippets = targetAll.filter(p => p?.id?.startsWith(prefix));

    const hasPopulatedLiveContent = liveSnippets.some(p => typeof p?.content === 'string' && p.content.length > 0);
    if (!hasPopulatedLiveContent) return true;

    if (liveSnippets.length !== targetSnippets.length) return false;
    for (const target of targetSnippets) {
        const live = liveSnippets.find(p => p.id === target.id);
        if (!live) return false;
        if (Boolean(live.enabled) !== (target.enabled !== false)) return false;
        if ((live.origin || 'custom') !== (target.origin || 'custom')) return false;
        if (live.content !== target.content) return false;
    }

    if (s.stockPrompts?.character !== cartridge.payload.stockPrompts?.character) return false;
    if (s.stockPrompts?.combat !== cartridge.payload.stockPrompts?.combat) return false;
    if (s.stockPrompts?.party !== cartridge.payload.stockPrompts?.party) return false;

    if (cartridge.payload.systemPromptTemplate
        && typeof s.systemPromptTemplate === 'string'
        && s.systemPromptTemplate.length > 0
        && s.systemPromptTemplate !== cartridge.payload.systemPromptTemplate) {
        return false;
    }

    if (cartridge.payload.cyoaConfig) {
        if (Boolean(s.cyoaConfig?.useCustomPrompt) !== Boolean(cartridge.payload.cyoaConfig.useCustomPrompt)) return false;
        if ((s.cyoaConfig?.customPromptText || '') !== (cartridge.payload.cyoaConfig.customPromptText || '')) return false;
    }

    if (Boolean(s.diceFunctionTool) !== Boolean(cartridge.payload.diceFunctionTool)) return false;

    if (Array.isArray(cartridge.payload.blockOrder) && cartridge.payload.blockOrder.length > 0
        && Array.isArray(s.blockOrder) && s.blockOrder.length > 0) {
        if (cartridge.payload.blockOrder.some(tag => !s.blockOrder.includes(tag))) {
            return false;
        }
    }

    return true;
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

    // 1. Remove or disable PbtA, FAE, and campaign-scoped D&D context overrides
    if (Array.isArray(settings.customSyspromptLibrary)) {
        settings.customSyspromptLibrary = settings.customSyspromptLibrary.filter(p => !isCompanionRulesetSnippetId(p?.id));
    }
    if (Array.isArray(settings.syspromptSnippetDatabase)) {
        settings.syspromptSnippetDatabase = settings.syspromptSnippetDatabase.filter(p => !isCompanionRulesetSnippetId(p?.id));
    }
    if (Array.isArray(settings.syspromptSectionOrder)) {
        settings.syspromptSectionOrder = pruneCompanionLibSectionOrder(settings.syspromptSectionOrder, []);
    }
    if (Array.isArray(settings.gameSystemDatabase)) {
        settings.gameSystemDatabase = settings.gameSystemDatabase.filter(p => !p.id?.startsWith('pbta_') && !p.id?.startsWith('fae_'));
    }
    if (Array.isArray(settings.gameSystems)) {
        settings.gameSystems = settings.gameSystems.filter(p => !p.id?.startsWith('pbta_') && !p.id?.startsWith('fae_'));
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
        state_memo: true,
        constraints: true,
        world_progression: true,
        weapon_proficiencies: true,
        attacks_per_round: true,
        saving_throws: true,
        level_up_protocol: false, // [CATALOG: FEAT-10] Suppressed in favor of Autonomous Level-Up Concierge
        homebrew_and_custom_classes: true,
        resting: true,
        loot: true,
        random_events: true,
    };
    const factoryModules = {
        ...dndBaseModules,
        ...(factory?.syspromptModules || {}),
        level_up_protocol: false, // [CATALOG: FEAT-10] Never allow upstream defaults to re-enable narrative-halting level-up pauses
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

    // 4b. Restore State Tracker systemPromptTemplate from factory defaults
    if (factory?.systemPromptTemplate) {
        settings.systemPromptTemplate = factory.systemPromptTemplate;
    } else if (/FICTION-FIRST STATE:|SINGLE-PASS ATTRITION & POOLS:|does NOT use (?:D&D )?combat round counters/i.test(String(settings.systemPromptTemplate || ''))) {
        delete settings.systemPromptTemplate;
    }

    // 5. Restore cyoaConfig (preserving aligned D&D CYOA subfooter contract if footer override is active)
    const hasAlignedDndFooter = Array.isArray(settings.customSyspromptLibrary)
        && settings.customSyspromptLibrary.some(p => p && p.id === DND_SUBFOOTER_OVERRIDE_ID && p.enabled !== false);
    if (factory?.cyoaConfig) {
        settings.cyoaConfig = JSON.parse(JSON.stringify(factory.cyoaConfig));
    } else if (settings.cyoaConfig) {
        settings.cyoaConfig.useCustomPrompt = false;
        settings.cyoaConfig.customPromptText = '';
    }
    if (hasAlignedDndFooter) {
        settings.cyoaConfig = settings.cyoaConfig || {};
        const slotCount = Array.isArray(settings.cyoaConfig.slots) && settings.cyoaConfig.slots.length > 0
            ? settings.cyoaConfig.slots.length
            : 5;
        settings.cyoaConfig.useCustomPrompt = true;
        settings.cyoaConfig.customPromptText = getDndAlignedCyoaPrompt(slotCount);
    }

    // 6. Restore block order and modules
    settings.blockOrder = factory?.blockOrder
        ?? ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];
    if (factory?.modules && settings.modules) {
        Object.assign(settings.modules, factory.modules);
    } else if (settings.modules) {
        Object.assign(settings.modules, {
            character: true,
            party: true,
            'benched party': true,
            combat: true,
            inventory: true,
            abilities: true,
            spells: true,
            time: true,
            xp: true,
            quests: true,
        });
    } else if (factory?.modules) {
        settings.modules = { ...factory.modules };
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
 * Ensures that if the active chat is an FAE or PbtA campaign, the cartridge, catalog definitions,
 * and setup snapshot are fully hydrated and active in MultiHog settings.
 * Prevents MultiHog's Chat Setup Link or F5 reloads from silently reverting to stock D&D.
 * Conversely, ensures that non-custom / unstarted chats are cleansed of any lingering stock prompts.
 *
 * @param {string|null} [chatId=null]
 * @param {object|null} [rpgSettings=null]
 * @param {Function|null} [applyCartridgeFn=null]
 * @param {object|null} [companionSettings=null]
 * @returns {Promise<boolean>}
 */
function stripForeignRulesetSnippets(s, keepPrefix) {
    const isForeign = (id) => Boolean(id && (
        (!id.startsWith(keepPrefix) && isCompanionRulesetSnippetId(id))
        || isDndFixSnippetId(id)
    ));
    if (Array.isArray(s.customSyspromptLibrary)) {
        s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !isForeign(p?.id));
    }
    if (Array.isArray(s.syspromptSnippetDatabase)) {
        s.syspromptSnippetDatabase = s.syspromptSnippetDatabase.filter(p => !isForeign(p?.id));
    }
    if (Array.isArray(s.syspromptSectionOrder)) {
        const kept = Array.isArray(s.customSyspromptLibrary)
            ? s.customSyspromptLibrary.filter(p => p?.id?.startsWith(keepPrefix))
            : [];
        s.syspromptSectionOrder = pruneCompanionLibSectionOrder(s.syspromptSectionOrder, kept, { removeDndSubfooter: true });
    }
}

function resolveToolModeForChat(s, resolvedChatId, dossier, activeCart, isSameProjectionOwner, hasLiveOverrides) {
    const storedToolMode = s.chatStates?.[resolvedChatId]?.setup?.diceFunctionTool
        ?? dossier?.config?.diceFunctionTool
        ?? activeCart?.config?.diceFunctionTool;
    return Boolean(
        hasLiveOverrides && isSameProjectionOwner && typeof s.diceFunctionTool === 'boolean'
            ? s.diceFunctionTool
            : (storedToolMode ?? s.diceFunctionTool ?? false)
    );
}

async function applyStandaloneCartridgeHydration(s, targetCartridge, resolvedToolMode, resolvedChatId) {
    if (!s.customSyspromptLibrary) s.customSyspromptLibrary = [];
    s.customSyspromptLibrary = s.customSyspromptLibrary.filter(
        p => !isCompanionRulesetSnippetId(p?.id) && !isDndFixSnippetId(p?.id)
    );
    const hydratedSnippets = targetCartridge.payload.customSyspromptLibrary.map(item => ({
        ...item,
        enabled: item.enabled !== false,
        scope: 'chat',
        _chatSetupMember: true,
    }));
    s.customSyspromptLibrary.push(...hydratedSnippets);

    if (!Array.isArray(s.syspromptSnippetDatabase)) s.syspromptSnippetDatabase = [];
    s.syspromptSnippetDatabase = s.syspromptSnippetDatabase.filter(
        p => !isCompanionRulesetSnippetId(p?.id) && !isDndFixSnippetId(p?.id)
    );
    s.syspromptSnippetDatabase.push(...hydratedSnippets.map(sn => ({ ...sn })));

    if (Array.isArray(s.syspromptSectionOrder)) {
        s.syspromptSectionOrder = pruneCompanionLibSectionOrder(
            s.syspromptSectionOrder,
            hydratedSnippets,
            { removeDndSubfooter: true },
        );
    }

    s.syspromptModules = s.syspromptModules || {};
    Object.assign(s.syspromptModules, targetCartridge.payload.syspromptModules);

    s.stockPrompts = s.stockPrompts || {};
    Object.assign(s.stockPrompts, targetCartridge.payload.stockPrompts);
    if (targetCartridge.payload.systemPromptTemplate) {
        s.systemPromptTemplate = targetCartridge.payload.systemPromptTemplate;
    }

    if (targetCartridge.payload.cyoaConfig) {
        s.cyoaConfig = s.cyoaConfig || {};
        Object.assign(s.cyoaConfig, targetCartridge.payload.cyoaConfig);
    }

    s.rngEnabled = true;
    s.rngQueueD20 = true;
    s.rngQueueD100 = false;
    s.diceFunctionTool = resolvedToolMode;
    s.diceD100Mode = false;

    s.blockOrder = [...targetCartridge.payload.blockOrder];
    if (s.modules) {
        Object.assign(s.modules, targetCartridge.payload.modules);
    }

    if (resolvedChatId) {
        await persistPbtaChatState(resolvedChatId, s);
    }
}

async function ensurePartitionHasSetupSnippets(s, resolvedChatId, prefix) {
    if (!resolvedChatId) return;
    const existingSetup = s.chatStates?.[resolvedChatId]?.setup;
    const hasSnippets = existingSetup?.customSyspromptLibrary?.some(p => p.id?.startsWith(prefix))
        || Object.keys(existingSetup?.syspromptSnippetStates || {}).some(k => k.startsWith(prefix) && existingSetup.syspromptSnippetStates[k]);
    if (!existingSetup || !hasSnippets) {
        await persistPbtaChatState(resolvedChatId, s);
    }
}

export async function ensureActiveChatRulesetConsistency(chatId = null, rpgSettings = null, applyCartridgeFn = null, companionSettings = null) {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;

    let isSameChatIdFn = (a, b) => String(a || '') === String(b || '');
    try {
        const { checkHistoryPersistenceBlocked, isSameChatId } = await import('./history-integrity-guard.js');
        if (typeof isSameChatId === 'function') isSameChatIdFn = isSameChatId;
        if (await checkHistoryPersistenceBlocked()) {
            logRulesetEvent('ensureActiveChatRulesetConsistency:blocked_skip', { chatId });
            return false;
        }
    } catch (_) {}

    const candidateIds = getCandidateChatIds(chatId, s);
    let resolvedChatId = candidateIds[0] || null;
    let pbtaDossier = null;
    let faeDossier = null;
    let dndDossier = null;

    for (const cid of candidateIds) {
        const part = s.chatStates?.[cid];
        if (!part) continue;
        if (part.pbtaCampaignDossier) {
            const pbtaRuleset = part.pbtaCampaignDossier?.meta?.ruleset;
            if (pbtaRuleset === 'fae') {
                faeDossier = part.pbtaCampaignDossier;
                resolvedChatId = cid;
                break;
            } else if (pbtaRuleset === 'dnd5e') {
                dndDossier = part.pbtaCampaignDossier;
                resolvedChatId = cid;
            } else {
                pbtaDossier = part.pbtaCampaignDossier;
                resolvedChatId = cid;
                break;
            }
        }
        if (part.faeCampaignDossier) {
            faeDossier = part.faeCampaignDossier;
            resolvedChatId = cid;
            break;
        }
        if (!dndDossier) {
            const partDossier = getPartitionDossier(part);
            if (partDossier?.meta?.ruleset === 'dnd5e' || partDossier?.meta?.systemKey === 'dnd5e') {
                dndDossier = partDossier;
                resolvedChatId = cid;
            }
        }
    }

    const activeCart = getCompanionActiveCartridge(chatId, s, companionSettings);
    if (!pbtaDossier && !faeDossier && activeCart?.dossier) {
        if (activeCart.cartridgeId === 'fae' || activeCart.dossier?.meta?.ruleset === 'fae') {
            faeDossier = activeCart.dossier;
            if (resolvedChatId && s.chatStates?.[resolvedChatId]) {
                setPartitionDossier(s.chatStates[resolvedChatId], faeDossier, 'fae');
            }
        } else if (activeCart.cartridgeId === 'dnd5e' || activeCart.dossier?.meta?.ruleset === 'dnd5e') {
            dndDossier = activeCart.dossier;
            if (resolvedChatId && s.chatStates?.[resolvedChatId]) {
                setPartitionDossier(s.chatStates[resolvedChatId], activeCart.dossier, 'dnd5e');
            }
        } else {
            pbtaDossier = activeCart.dossier;
            if (resolvedChatId && s.chatStates?.[resolvedChatId]) {
                setPartitionDossier(s.chatStates[resolvedChatId], pbtaDossier, 'pbta');
            }
        }
    }

    const isFae = activeCart?.cartridgeId === 'fae'
        || (activeCart?.cartridgeId !== 'pbta' && activeCart?.cartridgeId !== 'dnd5e' && (!!faeDossier || isFaeActive(chatId, s, companionSettings)));
    const isPbta = !isFae && (
        activeCart?.cartridgeId === 'pbta'
        || (activeCart?.cartridgeId !== 'dnd5e' && (!!pbtaDossier || isPbtAActive(chatId, s, companionSettings)))
    );

    logRulesetEvent('ensureActiveChatRulesetConsistency', {
        chatId,
        resolvedChatId,
        isFae,
        isPbta,
        activeCartridge: activeCart?.cartridgeId || null,
        hasPbtaDossier: !!pbtaDossier,
        hasFaeDossier: !!faeDossier,
        hasDndDossier: !!dndDossier,
    });

    if (!isPbta && !isFae) {
        if (isLiveSettingsPollutedWithPbtA(s) || isLiveSettingsPollutedWithFae(s)) {
            await cleanseStockDndSettings(s, { chatId: resolvedChatId || chatId, syncSetup: true });
        }

        // Synchronize D&D 5e campaign context (<tone>/<factions>/<world_rules>) per chat
        const effectiveDndDossier = dndDossier || (activeCart?.cartridgeId === 'dnd5e' ? activeCart?.dossier : null);
        const effectiveDndConfig = effectiveDndDossier?.config
            || (activeCart?.cartridgeId === 'dnd5e' ? activeCart?.config : null)
            || {};
        const { snippets: targetDndSnippets, customModuleTag } = effectiveDndDossier
            ? buildCampaignContextSnippets(
                'dnd5e',
                {
                    tone: effectiveDndDossier.meta?.tone,
                    factions: effectiveDndDossier.factions,
                    worldRules: effectiveDndDossier.worldRules,
                },
                effectiveDndConfig,
            )
            : { snippets: [], customModuleTag: null };

        const isDndContextId = (id) => Boolean(id && (id.startsWith('dnd5e_campaign_') || id.startsWith('dnd5e_custom_')));
        const liveDndSnippets = (Array.isArray(s.customSyspromptLibrary) ? s.customSyspromptLibrary : []).filter(p => isDndContextId(p?.id));
        const dbDndSnippets = (Array.isArray(s.syspromptSnippetDatabase) ? s.syspromptSnippetDatabase : []).filter(p => isDndContextId(p?.id));
        const snippetsMatch = liveDndSnippets.length === targetDndSnippets.length
            && dbDndSnippets.length === targetDndSnippets.length
            && targetDndSnippets.every(t => {
                const live = liveDndSnippets.find(p => p.id === t.id);
                const db = dbDndSnippets.find(p => p.id === t.id);
                return live && db && live.enabled === true && live.origin === 'custom' && live.content === t.content && db.content === t.content;
            });
        const missingCustomBlock = Boolean(customModuleTag && (!Array.isArray(s.blockOrder) || !s.blockOrder.includes(customModuleTag)));

        if (!snippetsMatch || missingCustomBlock) {
            if (Array.isArray(s.customSyspromptLibrary)) {
                s.customSyspromptLibrary = s.customSyspromptLibrary.filter(p => !isDndContextId(p?.id));
            } else if (targetDndSnippets.length > 0) {
                s.customSyspromptLibrary = [];
            }
            if (Array.isArray(s.syspromptSnippetDatabase)) {
                s.syspromptSnippetDatabase = s.syspromptSnippetDatabase.filter(p => !isDndContextId(p?.id));
            } else if (targetDndSnippets.length > 0) {
                s.syspromptSnippetDatabase = [];
            }

            const hydratedDnd = targetDndSnippets.map(item => ({
                ...item,
                enabled: true,
                scope: 'chat',
                _chatSetupMember: true,
            }));
            if (hydratedDnd.length > 0) {
                s.customSyspromptLibrary.push(...hydratedDnd);
                s.syspromptSnippetDatabase.push(...hydratedDnd.map(sn => ({ ...sn })));
            }
            if (Array.isArray(s.syspromptSectionOrder)) {
                s.syspromptSectionOrder = pruneCompanionLibSectionOrder(s.syspromptSectionOrder, hydratedDnd);
            }
            if (s.syspromptModules && typeof s.syspromptModules === 'object') {
                if (hydratedDnd.some(p => p.id === 'dnd5e_custom_world_rules')) {
                    s.syspromptModules.world_rules = false;
                } else {
                    delete s.syspromptModules.world_rules;
                }
            }
            if (customModuleTag) {
                if (!Array.isArray(s.blockOrder)) {
                    s.blockOrder = ['COMBAT', 'CHARACTER', 'PARTY', 'INVENTORY', 'ABILITIES', 'SPELLS', 'XP', 'TIME'];
                }
                if (!s.blockOrder.includes(customModuleTag)) {
                    s.blockOrder.push(customModuleTag);
                }
            }
            if (resolvedChatId && (effectiveDndDossier || s.chatStates?.[resolvedChatId]?.setup)) {
                await persistPbtaChatState(resolvedChatId, s);
            }
        }
        return false;
    }

    // Never rehydrate or force ruleset onto an unstarted chat unless it has an explicit cartridge or dossier
    if (isFae && !activeCart && !faeDossier && !isAdventureActive(chatId)) {
        if (isLiveSettingsPollutedWithPbtA(s) || isLiveSettingsPollutedWithFae(s)) {
            await cleanseStockDndSettings(s, { chatId: resolvedChatId || chatId, syncSetup: true });
        }
        return false;
    }
    if (isPbta && !activeCart && !pbtaDossier && !isAdventureActive(chatId)) {
        if (isLiveSettingsPollutedWithPbtA(s) || isLiveSettingsPollutedWithFae(s)) {
            await cleanseStockDndSettings(s, { chatId: resolvedChatId || chatId, syncSetup: true });
        }
        return false;
    }

    const isSameProjectionOwner = Boolean(resolvedChatId && s.chatStateProjectionOwner && isSameChatIdFn(resolvedChatId, s.chatStateProjectionOwner));

    // --- CASE 1: FAE ACTIVE ---
    if (isFae) {
        const hasLiveFaeOverrides = Array.isArray(s.customSyspromptLibrary)
            && s.customSyspromptLibrary.some(p => p.id?.startsWith('fae_') && p.enabled);

        stripForeignRulesetSnippets(s, 'fae_');

        const genreKey = activeCart?.genre || faeDossier?.meta?.systemKey || companionSettings?.lastFaeGenre || 'cosmic_horror';
        const safeId = (resolvedChatId || chatId || 'fae').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const faeChar = faeDossier?.character || faeDossier?.protagonist || {};
        const resolvedToolMode = resolveToolModeForChat(s, resolvedChatId, faeDossier, activeCart, isSameProjectionOwner, hasLiveFaeOverrides);
        const mergedFaeConfig = {
            ...(activeCart?.config || {}),
            ...(faeDossier?.config || {}),
            diceFunctionTool: resolvedToolMode,
        };
        const mergedFaeKnobs = {
            ...(activeCart?.knobs || {}),
            ...(faeDossier?.config?.knobs || {}),
            ...((faeDossier?.config?.actionTempo || activeCart?.config?.actionTempo)
                ? { action_tempo: faeDossier?.config?.actionTempo || activeCart?.config?.actionTempo }
                : {}),
        };
        const effectiveFaeCustomSpec = faeDossier?.meta?.customGenreSpec
            || activeCart?.customGenreSpec
            || activeCart?.dossier?.meta?.customGenreSpec
            || null;
        const effectiveFaePools = (faeChar.pools && Object.keys(faeChar.pools).length > 0)
            ? faeChar.pools
            : (activeCart?.pools && Object.keys(activeCart.pools).length > 0 ? activeCart.pools : null);
        const overrides = faeDossier ? {
            id: `fae_${safeId}`,
            campaignTitle: activeCart?.title || faeDossier.meta?.title,
            name: activeCart?.systemLabel || (faeDossier.meta?.title ? `FAE: ${faeDossier.meta.title}` : null),
            systemLabel: activeCart?.systemLabel || faeDossier.meta?.systemLabel,
            description: faeDossier.meta?.premise,
            tone: faeDossier.meta?.tone,
            factions: faeDossier.factions,
            worldRules: faeDossier.worldRules,
            pools: effectiveFaePools || faeChar.pools,
            positive_tags: faeChar.positiveTags,
            negative_tags: faeChar.negativeTags,
            cyoaExamples: (Array.isArray(faeDossier.cyoaExamples) && faeDossier.cyoaExamples.length > 0) ? faeDossier.cyoaExamples : null,
            heroicTier: Boolean(
                faeDossier.config?.heroicTier
                ?? faeDossier.config?.heroic_tier
                ?? faeDossier.config?.knobs?.heroic_tier
                ?? activeCart?.config?.heroicTier
                ?? activeCart?.knobs?.heroic_tier
                ?? false
            ),
            heroicDomain: faeChar.heroicDomain || faeChar.heroic_domain || null,
            actionTempo: faeDossier.config?.actionTempo || faeDossier.config?.knobs?.action_tempo || activeCart?.knobs?.action_tempo || 'gritty_default',
            genreKey,
            config: mergedFaeConfig,
            knobs: mergedFaeKnobs,
            diceFunctionTool: resolvedToolMode,
            character: faeChar,
            customGenreSpec: effectiveFaeCustomSpec,
            dossier: faeDossier,
        } : (activeCart ? {
            id: `fae_${safeId}`,
            campaignTitle: activeCart.title,
            systemLabel: activeCart.systemLabel,
            genreKey,
            config: mergedFaeConfig,
            knobs: mergedFaeKnobs,
            heroicTier: Boolean(mergedFaeConfig.heroicTier ?? mergedFaeConfig.heroic_tier ?? mergedFaeKnobs.heroic_tier ?? false),
            diceFunctionTool: resolvedToolMode,
            ...(effectiveFaePools ? { pools: effectiveFaePools } : {}),
            ...(effectiveFaeCustomSpec ? { customGenreSpec: effectiveFaeCustomSpec } : {}),
        } : {
            genreKey,
            config: { diceFunctionTool: resolvedToolMode },
            diceFunctionTool: resolvedToolMode,
        });

        const targetFaeCartridge = buildFaeCartridge(genreKey, overrides);
        const needsFaeHydration = !hasLiveFaeOverrides
            || (Boolean(faeDossier || activeCart) && !doesLiveLibraryMatchCartridge(s, targetFaeCartridge, 'fae_'));

        if (needsFaeHydration) {
            console.log(`[MultiHog Companion] Hydrating FAE cartridge for active chat ${resolvedChatId || chatId} (live=${hasLiveFaeOverrides})...`);
            await applyStandaloneCartridgeHydration(s, targetFaeCartridge, resolvedToolMode, resolvedChatId);
            return true;
        }

        await ensurePartitionHasSetupSnippets(s, resolvedChatId, 'fae_');
        return true;
    }

    // --- CASE 2: PBTA ACTIVE ---
    const hasLivePbtaOverrides = Array.isArray(s.customSyspromptLibrary)
        && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled);

    stripForeignRulesetSnippets(s, 'pbta_');

    const genreKey = activeCart?.genre || pbtaDossier?.meta?.systemKey || 'fantasy';
    const statsList = Object.keys(pbtaDossier?.protagonist?.stats || {});
    const safeId = (resolvedChatId || chatId || 'pbta').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const resolvedPbtaToolMode = resolveToolModeForChat(s, resolvedChatId, pbtaDossier, activeCart, isSameProjectionOwner, hasLivePbtaOverrides);
    const mergedPbtaConfig = {
        ...(activeCart?.config || {}),
        ...(pbtaDossier?.config || {}),
        diceFunctionTool: resolvedPbtaToolMode,
    };
    const effectivePbtaCustomSpec = pbtaDossier?.meta?.customGenreSpec
        || activeCart?.customGenreSpec
        || activeCart?.dossier?.meta?.customGenreSpec
        || null;
    const effectivePbtaStats = statsList.length >= 3
        ? statsList
        : (Array.isArray(activeCart?.stats) && activeCart.stats.length >= 3 ? activeCart.stats : null);
    const overrides = pbtaDossier ? {
        id: `pbta_${safeId}`,
        campaignTitle: activeCart?.title || pbtaDossier.meta?.title,
        name: activeCart?.systemLabel || (pbtaDossier.meta?.title ? `PbtA: ${pbtaDossier.meta.title}` : null),
        systemLabel: activeCart?.systemLabel || pbtaDossier.meta?.systemLabel,
        description: pbtaDossier.meta?.premise,
        tone: pbtaDossier.meta?.tone,
        factions: pbtaDossier.factions,
        worldRules: pbtaDossier.worldRules,
        stats: effectivePbtaStats,
        startingMoves: pbtaDossier.protagonist?.startingMoves,
        cyoaExamples: (Array.isArray(pbtaDossier.cyoaExamples) && pbtaDossier.cyoaExamples.length > 0) ? pbtaDossier.cyoaExamples : null,
        config: mergedPbtaConfig,
        diceFunctionTool: resolvedPbtaToolMode,
        customGenreSpec: effectivePbtaCustomSpec,
        dossier: pbtaDossier,
    } : (activeCart ? {
        id: `pbta_${safeId}`,
        campaignTitle: activeCart.title,
        systemLabel: activeCart.systemLabel,
        config: mergedPbtaConfig,
        diceFunctionTool: resolvedPbtaToolMode,
        ...(effectivePbtaStats ? { stats: effectivePbtaStats } : {}),
        ...(effectivePbtaCustomSpec ? { customGenreSpec: effectivePbtaCustomSpec } : {}),
    } : {
        config: { diceFunctionTool: resolvedPbtaToolMode },
        diceFunctionTool: resolvedPbtaToolMode,
    });

    const targetPbtaCartridge = buildPbtACartridge(genreKey, overrides);
    const needsPbtaHydration = !hasLivePbtaOverrides
        || (Boolean(pbtaDossier || activeCart) && !doesLiveLibraryMatchCartridge(s, targetPbtaCartridge, 'pbta_'));

    if (needsPbtaHydration) {
        console.log(`[MultiHog Companion] Hydrating PbtA cartridge for active chat ${resolvedChatId || chatId} (live=${hasLivePbtaOverrides})...`);
        if (typeof applyCartridgeFn === 'function') {
            await applyCartridgeFn(genreKey, overrides);
        } else {
            await applyStandaloneCartridgeHydration(s, targetPbtaCartridge, resolvedPbtaToolMode, resolvedChatId);
        }
        return true;
    }

    await ensurePartitionHasSetupSnippets(s, resolvedChatId, 'pbta_');
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
    const pbtaActive = isPbtAActive(chatId, s, companionSettings);
    const pbtaChat = isPbtaChat(chatId, s, companionSettings);
    const faeActive = isFaeActive(chatId, s, companionSettings);
    const faeChat = isFaeChat(chatId, s, companionSettings);
    const badge = formatRulesetBadge(chatId, s, companionSettings?.lastGenre || 'fantasy', companionSettings);

    // Identify which detection layers matched
    const layerMatches = [];
    if (Array.isArray(s?.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled)) {
        layerMatches.push('PbtA Layer 1: Live customSyspromptLibrary pbta_ snippets active');
    }
    if (Array.isArray(s?.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('fae_') && p.enabled)) {
        layerMatches.push('FAE Layer 1: Live customSyspromptLibrary fae_ snippets active');
    }
    for (const cid of candidates) {
        if (s?.chatStates?.[cid]?.pbtaCampaignDossier && s.chatStates[cid].pbtaCampaignDossier?.meta?.ruleset !== 'fae' && s.chatStates[cid].pbtaCampaignDossier?.meta?.ruleset !== 'dnd5e') {
            layerMatches.push(`PbtA Layer 2: Partition [${cid}] contains pbtaCampaignDossier`);
        }
        if (s?.chatStates?.[cid]?.faeCampaignDossier || s?.chatStates?.[cid]?.pbtaCampaignDossier?.meta?.ruleset === 'fae') {
            layerMatches.push(`FAE Layer 2: Partition [${cid}] contains faeCampaignDossier`);
        }
        const snippetStates = s?.chatStates?.[cid]?.setup?.syspromptSnippetStates;
        if (snippetStates && typeof snippetStates === 'object') {
            if (Object.keys(snippetStates).some(k => k.startsWith('pbta_') && snippetStates[k])) {
                layerMatches.push(`PbtA Layer 3: Partition [${cid}] setup has enabled pbta_ snippets`);
            }
            if (Object.keys(snippetStates).some(k => k.startsWith('fae_') && snippetStates[k])) {
                layerMatches.push(`FAE Layer 3: Partition [${cid}] setup has enabled fae_ snippets`);
            }
        }
        const partitionMemo = s?.chatStates?.[cid]?.currentMemo || '';
        if (typeof partitionMemo === 'string' && partitionMemo) {
            if (/Harm:\s*\d+/i.test(partitionMemo) || /\[PBTA_/i.test(partitionMemo) || /Hack & Slash/i.test(partitionMemo)) {
                layerMatches.push(`PbtA Layer 4: Partition [${cid}] memo contains Harm/PbtA markers`);
            }
            if (containsFaeMarkers(partitionMemo)) {
                layerMatches.push(`FAE Layer 4: Partition [${cid}] memo contains FAE markers`);
            }
        }
    }
    if (typeof s?.currentMemo === 'string' && s.currentMemo) {
        if (/Harm:\s*\d+/i.test(s.currentMemo) || /\[PBTA_/i.test(s.currentMemo) || /Hack & Slash/i.test(s.currentMemo)) {
            layerMatches.push('PbtA Layer 5: Live memo contains Harm/PbtA markers');
        }
        if (containsFaeMarkers(s.currentMemo)) {
            layerMatches.push('FAE Layer 5: Live memo contains FAE markers');
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
    lines.push(`- **Ruleset Badge**: \`${badge.badgeText}\` (Active: \`${badge.isActive}\`, Ruleset: \`${badge.ruleset || 'dnd5e'}\`, Label: \`${badge.displayLabel}\`)`);
    lines.push(`- **isPbtAActive()**: \`${pbtaActive}\``);
    lines.push(`- **isPbtaChat()**: \`${pbtaChat}\``);
    lines.push(`- **isFaeActive()**: \`${faeActive}\``);
    lines.push(`- **isFaeChat()**: \`${faeChat}\``);
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
                if (part.faeCampaignDossier) {
                    const d = part.faeCampaignDossier;
                    lines.push(`  - \`faeCampaignDossier\`: PRESENT`);
                    lines.push(`    - Title: "${d.meta?.title || 'Untitled'}" | System: ${d.meta?.systemKey || d.genreKey} (${d.meta?.systemLabel || 'none'})`);
                    lines.push(`    - Protagonist: "${d.character?.name || d.protagonist?.name || 'Protagonist'}"`);
                    lines.push(`    - Last Updated: ${d.meta?.lastUpdated || 'unknown'}`);
                }
                if (part.pbtaCampaignDossier) {
                    const d = part.pbtaCampaignDossier;
                    const stats = Object.keys(d.protagonist?.stats || {});
                    lines.push(`  - \`pbtaCampaignDossier\`: PRESENT`);
                    lines.push(`    - Title: "${d.meta?.title || 'Untitled'}" | System: ${d.meta?.systemKey} (${d.meta?.systemLabel || 'none'})`);
                    lines.push(`    - Protagonist: "${d.protagonist?.name || 'Unnamed'}" (Playbook: ${d.protagonist?.playbook || 'none'}, Stats: [${stats.join(', ')}])`);
                    lines.push(`    - Harm Limit: ${d.config?.harmLimit ?? 'default'} | Stress Limit: ${d.config?.stressLimit ?? 'default'}`);
                    lines.push(`    - Last Updated: ${d.meta?.lastUpdated || 'unknown'}`);
                }
                if (!part.faeCampaignDossier && !part.pbtaCampaignDossier && part.companionDossier) {
                    const d = part.companionDossier;
                    lines.push(`  - \`companionDossier\`: PRESENT`);
                    lines.push(`    - Title: "${d.meta?.title || 'Untitled'}" | Ruleset: ${d.meta?.ruleset || 'unknown'} | System: ${d.meta?.systemKey || 'none'} (${d.meta?.systemLabel || 'none'})`);
                    lines.push(`    - Protagonist: "${d.character?.name || d.protagonist?.name || 'Unnamed'}"`);
                } else if (!part.faeCampaignDossier && !part.pbtaCampaignDossier) {
                    lines.push(`  - \`dossier\`: *NONE*`);
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
                lines.push(`  - \`currentMemo\`: ${memo.length} chars (Harm present: ${/Harm:\s*\d+/i.test(memo)}, FAE present: ${containsFaeMarkers(memo)}, Excerpt: "${memo.slice(0, 100).replace(/\n/g, ' ')}...")`);
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
    lines.push(`- **Live currentMemo**: ${liveMemo.length} chars (Harm present: ${/Harm:\s*\d+/i.test(liveMemo)}, FAE present: ${containsFaeMarkers(liveMemo)}, Excerpt: "${liveMemo.slice(0, 100).replace(/\n/g, ' ')}...")`);
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

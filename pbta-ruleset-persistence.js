/**
 * pbta-ruleset-persistence.js
 *
 * Ensures PbtA ruleset configuration, cartridge prompts, and system settings
 * persist across page reloads (F5), chat setup snapshots, and chat switches.
 * Prevents MultiHog's Chat Setup Link from resetting PbtA campaigns to stock D&D.
 */

import { PBTA_GENRES, buildPbtACartridge } from './pbta-ruleset.js';

/**
 * Check if PbtA overrides are active for the given or current chat.
 * Checks:
 * 1. Live customSyspromptLibrary pbta_ entries
 * 2. Chat partition pbtaCampaignDossier
 * 3. Chat setup syspromptSnippetStates
 * 4. Partition memo or live memo Harm markers
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @returns {boolean}
 */
export function isPbtAActive(chatId = null, rpgSettings = null) {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;

    // 1. Check live customSyspromptLibrary
    if (Array.isArray(s.customSyspromptLibrary) && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled)) {
        return true;
    }

    const cid = chatId || (typeof SillyTavern !== 'undefined' ? (SillyTavern.getContext()?.getCurrentChatId?.() || SillyTavern.getContext()?.chatId) : null);
    if (cid && s.chatStates?.[cid]) {
        // 2. Chat partition contains a PbtA campaign dossier
        if (s.chatStates[cid].pbtaCampaignDossier) {
            return true;
        }

        // 3. Chat setup states have enabled pbta snippets
        const snippetStates = s.chatStates[cid].setup?.syspromptSnippetStates;
        if (snippetStates && typeof snippetStates === 'object') {
            if (Object.keys(snippetStates).some(k => k.startsWith('pbta_') && snippetStates[k])) {
                return true;
            }
        }

        // 4. Chat memo contains PbtA markers
        const partitionMemo = s.chatStates[cid].currentMemo || '';
        if (typeof partitionMemo === 'string' && partitionMemo) {
            if (/Harm:\s*\d+/i.test(partitionMemo) || /\[PBTA_/i.test(partitionMemo) || /Hack & Slash/i.test(partitionMemo)) {
                return true;
            }
        }
    }

    // 5. Live memo contains PbtA markers
    if (typeof s.currentMemo === 'string' && s.currentMemo) {
        if (/Harm:\s*\d+/i.test(s.currentMemo) || /\[PBTA_/i.test(s.currentMemo) || /Hack & Slash/i.test(s.currentMemo)) {
            return true;
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
export function isPbtaChat(chatId = null, rpgSettings = null) {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;
    const cid = chatId || (typeof SillyTavern !== 'undefined' ? (SillyTavern.getContext()?.getCurrentChatId?.() || SillyTavern.getContext()?.chatId) : null);
    if (cid && s.chatStates?.[cid]?.pbtaCampaignDossier) return true;
    return isPbtAActive(cid, s);
}

/**
 * Format badge label and summary for the active ruleset.
 *
 * @param {string|null} chatId
 * @param {object|null} [rpgSettings=null]
 * @param {string|null} [lastGenre='fantasy']
 * @returns {{ isActive: boolean, displayLabel: string, badgeText: string, summaryHtml: string, badgeStyle: object }}
 */
export function formatRulesetBadge(chatId = null, rpgSettings = null, lastGenre = 'fantasy') {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    const cid = chatId || (typeof SillyTavern !== 'undefined' ? (SillyTavern.getContext()?.getCurrentChatId?.() || SillyTavern.getContext()?.chatId) : null);
    const dossier = (cid && s?.chatStates?.[cid]?.pbtaCampaignDossier) || null;

    if (isPbtAActive(cid, s)) {
        const genreKey = dossier?.meta?.systemKey || lastGenre || 'fantasy';
        const genreObj = PBTA_GENRES[genreKey];

        let displayLabel = 'PbtA';
        if (dossier?.meta?.systemLabel) {
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

/**
 * Persists the current chat's PbtA configuration into MultiHog's per-chat setup snapshot
 * and global snippet database, ensuring it survives F5 page reloads and chat switches.
 *
 * @param {string} chatId
 * @param {object|null} [rpgSettings=null]
 */
export async function persistPbtaChatState(chatId, rpgSettings = null) {
    if (!chatId) return;
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return;

    try {
        const setupMod = await import('../SillyTavern-MultihogDnDFramework/src/state/chat-setup.js');
        if (typeof setupMod.syncChatSetupCatalogs === 'function') {
            setupMod.syncChatSetupCatalogs(s);
        }
        if (typeof setupMod.snapshotChatSetup === 'function') {
            s.chatStates = s.chatStates || {};
            s.chatStates[chatId] = s.chatStates[chatId] || {};
            s.chatStates[chatId].setup = setupMod.snapshotChatSetup(s);
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
        if (s.chatStates?.[chatId]) {
            s.chatStates[chatId].setup = s.chatStates[chatId].setup || { version: 3, syspromptSnippetStates: {} };
            s.chatStates[chatId].setup.syspromptSnippetStates = s.chatStates[chatId].setup.syspromptSnippetStates || {};
            if (Array.isArray(s.customSyspromptLibrary)) {
                for (const item of s.customSyspromptLibrary) {
                    if (item.id) s.chatStates[chatId].setup.syspromptSnippetStates[item.id] = !!item.enabled;
                }
            }
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
}

/**
 * Ensures that if the active chat is a PbtA campaign, the cartridge, catalog definitions,
 * and setup snapshot are fully hydrated and active in MultiHog settings.
 * Prevents MultiHog's Chat Setup Link or F5 reloads from silently reverting to stock D&D.
 *
 * @param {string|null} [chatId=null]
 * @param {object|null} [rpgSettings=null]
 * @param {Function|null} [applyCartridgeFn=null]
 * @returns {Promise<boolean>}
 */
export async function ensureActiveChatRulesetConsistency(chatId = null, rpgSettings = null, applyCartridgeFn = null) {
    const s = rpgSettings || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings?.rpg_tracker : null);
    if (!s) return false;

    const cid = chatId || (typeof SillyTavern !== 'undefined' ? (SillyTavern.getContext()?.getCurrentChatId?.() || SillyTavern.getContext()?.chatId) : null);
    if (!cid) return false;

    const partition = s.chatStates?.[cid];
    const dossier = partition?.pbtaCampaignDossier;
    const isPbta = !!dossier || isPbtAActive(cid, s);

    if (!isPbta) {
        return false;
    }

    // Chat IS PbtA. Check whether live customSyspromptLibrary has pbta overrides active.
    const hasLiveOverrides = Array.isArray(s.customSyspromptLibrary)
        && s.customSyspromptLibrary.some(p => p.id?.startsWith('pbta_') && p.enabled);

    if (!hasLiveOverrides) {
        console.log(`[MultiHog Companion] Active chat ${cid} is a PbtA campaign, but live customSyspromptLibrary was not hydrated (e.g. reload or setup reset). Rehydrating cartridge...`);
        const genreKey = dossier?.meta?.systemKey || 'fantasy';
        const statsList = Object.keys(dossier?.protagonist?.stats || {});
        const overrides = dossier ? {
            id: `pbta_${cid.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
            campaignTitle: dossier.meta?.title,
            name: dossier.meta?.title ? `PbtA: ${dossier.meta.title}` : null,
            systemLabel: dossier.meta?.systemLabel,
            description: dossier.meta?.premise,
            tone: dossier.meta?.tone,
            factions: dossier.factions,
            worldRules: dossier.worldRules,
            stats: statsList.length >= 3 ? statsList : null,
            startingMoves: dossier.protagonist?.startingMoves,
            cyoaExamples: (Array.isArray(dossier.cyoaExamples) && dossier.cyoaExamples.length > 0) ? dossier.cyoaExamples : null,
            config: dossier.config || {},
        } : {};

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

            await persistPbtaChatState(cid, s);
        }
        return true;
    }

    // Overrides are live; make sure setup snapshot is current in the partition
    await persistPbtaChatState(cid, s);
    return true;
}

/**
 * concierge-runner.js — MultiHog Companion
 *
 * The Campaign Execution Pipeline for the PbtA Concierge.
 * Handles the automated handoff when "Launch Campaign" is clicked:
 * 1. Installs PbtA cartridge & 2d6 RNG rules
 * 2. Creates & binds player persona and Lorebook Agent player card
 * 3. Sequentially runs Map Architect for queued sites
 * 4. Upserts staged monsters into the NPC Library
 * 5. Injects the Campaign Dossier into World Info (GM permanent memory)
 * 6. Drops the player into the fiction with Turn 0 opening scene
 */

import { serializeDossierToMarkdown } from './concierge-parser.js';
import { formatInitialPbtaMemo } from './pbta-ruleset.js';
import {
    loadMainNpcSectionNames,
    buildNpcEntryContent,
    buildMonsterEntryContent,
    buildNpcKeys,
} from './concierge-npc-format.js';
import {
    buildDossierWorldInfoEntry,
    prepareCampaignLorebookDistributions,
    buildWorldSkeletonEntries,
} from './concierge-lore-distributor.js';

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
    const effectiveBook = bookName || (ctx.chatMetadata?.world_info || `Campaign_${chatId || 'PbtA'}`);

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

        // Ensure chat binds this world info book if not already bound
        if (ctx.chatMetadata && !ctx.chatMetadata.world_info) {
            ctx.chatMetadata.world_info = effectiveBook;
            if (typeof ctx.saveMetadataDebounced === 'function') {
                ctx.saveMetadataDebounced();
            }
        }
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

        for (const item of items) {
            const cleanName = (item.name || item.comment || '').trim();
            if (!cleanName || !item.core) continue;

            const existingEntry = Object.values(bookData.entries).find(e => {
                const label = (e.comment || '').replace(/^\[.*?\]\s*/i, '').trim().toLowerCase();
                return label === cleanName.toLowerCase();
            });

            if (existingEntry) {
                // Re-launch / edited dossier: refresh only the protected [CORE] identity block and
                // leave any chronicle text the Router has since appended untouched.
                const current = String(existingEntry.content || '');
                if (/\[CORE\][\s\S]*?\[\/CORE\]/i.test(current)) {
                    const next = current.replace(/\[CORE\][\s\S]*?\[\/CORE\]/i, () => item.core);
                    if (next !== current) {
                        existingEntry.content = next;
                        modified = true;
                    }
                }
                continue;
            }

            const uids = Object.keys(bookData.entries).map(Number).filter(num => !isNaN(num));
            const nextUid = uids.length > 0 ? Math.max(...uids) + 1 : 0;

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

            if (typeof router.updateWorldInfoCache === 'function') {
                await router.updateWorldInfoCache(bookName, bookData);
            }
            if (typeof router.rememberCampaignBook === 'function') {
                router.rememberCampaignBook(bookName);
            }
        }
    } catch (err) {
        console.warn(`[PbtA Concierge] Could not auto-inject entries into "${bookName}":`, err);
    }
}

/**
 * Distributes dossier entities across the 4 native campaign lorebooks:
 * - {prefix}_NPCs      (NPCs & Monsters)
 * - {prefix}_Factions  (Factions)
 * - {prefix}_Locations (Maps / Sites)
 * - {prefix}_Quests    (Starting Crisis)
 */
async function injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames = null) {
    if (!dossier || typeof dossier !== 'object') return;
    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const prefix = typeof stateMgr.getEffectiveRouterCampaignPrefix === 'function'
            ? stateMgr.getEffectiveRouterCampaignPrefix(chatId || '')
            : (chatId || '');

        const npcBookName = prefix ? `${prefix}_NPCs` : 'NPCs';
        const factionBookName = prefix ? `${prefix}_Factions` : 'Factions';
        const locBookName = prefix ? `${prefix}_Locations` : 'Locations';
        const questBookName = prefix ? `${prefix}_Quests` : 'Quests';

        const dist = prepareCampaignLorebookDistributions(dossier, sectionNames);

        await Promise.all([
            upsertWorldInfoBook(npcBookName, dist.npcs),
            upsertWorldInfoBook(factionBookName, dist.factions),
            upsertWorldInfoBook(locBookName, dist.locations),
            upsertWorldInfoBook(questBookName, dist.quests),
        ]);
    } catch (err) {
        console.warn('[PbtA Concierge] Campaign lorebook distribution encountered error:', err);
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
async function injectWorldSkeleton(chatId, dossier) {
    if (!dossier || typeof dossier !== 'object') return;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    if (!ctx) return;

    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
        const prefix = typeof stateMgr.getEffectiveRouterCampaignPrefix === 'function'
            ? stateMgr.getEffectiveRouterCampaignPrefix(chatId || '')
            : (chatId || '');
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

            if (typeof router.updateWorldInfoCache === 'function') {
                await router.updateWorldInfoCache(skeletonBookName, bookData);
            }
            if (typeof router.rememberCampaignBook === 'function') {
                router.rememberCampaignBook(skeletonBookName);
            }
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
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function launchPbtaCampaign(dossier, onProgress = () => {}) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const { applyPbtACartridge, syncPersonaToChat, uploadImageToPersona, findMatchingPersona } = await import('./index.js');
    const { ensureCleanAdventureChat } = await import('./adventure-chat.js');
    const systemKey = dossier.meta?.systemKey || 'fantasy';
    const charName = (dossier.protagonist?.name || '').trim();
    const adventureTitle = (dossier.meta?.title || '').trim();

    try {
        // ── 0. Ensure Clean Chat & Auto-Rename ──────────────────────────────────
        onProgress('🛡️ Preparing clean adventure session...', 5);
        const chatId = await ensureCleanAdventureChat({
            adventureTitle,
            fallbackLabel: `PbtA ${systemKey.charAt(0).toUpperCase() + systemKey.slice(1)} Adventure`,
        });
        // ── 1. Apply PbtA Ruleset Cartridge with Dynamic Overrides ─────────────
        onProgress('🎲 Installing PbtA ruleset and 2d6 engine...', 15);
        const statsList = Object.keys(dossier.protagonist?.stats || {});
        const cartridgeOverrides = {
            id: chatId ? `pbta_${chatId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : null,
            campaignTitle: adventureTitle,
            name: adventureTitle ? `PbtA: ${adventureTitle}` : null,
            systemLabel: dossier.meta?.systemLabel,
            description: dossier.meta?.premise,
            tone: dossier.meta?.tone,
            factions: dossier.factions,
            stats: statsList.length >= 3 ? statsList : null,
            startingMoves: dossier.protagonist?.startingMoves,
            cyoaExamples: (Array.isArray(dossier.cyoaExamples) && dossier.cyoaExamples.length > 0) ? dossier.cyoaExamples : null,
            config: dossier.config || {},
        };
        const cartridgeOk = await applyPbtACartridge(systemKey, cartridgeOverrides);
        if (!cartridgeOk) {
            throw new Error('Failed to install PbtA ruleset cartridge.');
        }

        // Apply native MultiHog CYOA toggle based on playstyle dial
        const effectiveCtxEarly = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
        const rpgEarly = effectiveCtxEarly?.extensionSettings?.rpg_tracker;
        if (rpgEarly) {
            rpgEarly.syspromptModules = rpgEarly.syspromptModules || {};
            if (dossier.config?.playstyle === 'freeform') {
                rpgEarly.syspromptModules.CYOA_mode = false;
            } else {
                rpgEarly.syspromptModules.CYOA_mode = true;
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

                // Add to Lorebook Agent
                if (typeof charCreator.addPlayerCardToLorebookAgent === 'function') {
                    const bio = dossier.protagonist.bio || `${charName}, a ${dossier.protagonist.playbook || 'wanderer'}.`;
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
                            await mapArch.runMapArchitect({
                                site: primaryMap.site,
                                entrance: primaryMap.entrance || 'Main Threshold',
                                kind: primaryMap.kind || 'SETTLEMENT',
                                scale: 'SMALL',
                                threat: primaryMap.threat || 'MODERATE',
                                prompt: primaryMap.prompt || primaryMap.briefDescription,
                                brief_description: primaryMap.briefDescription || primaryMap.prompt,
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

        // ── 4. Register Supporting NPCs, Monsters & Factions (library + lorebook) ──
        const npcs = dossier.npcs || [];
        const monsters = dossier.monsters || [];
        const factions = dossier.factions || [];
        if (npcs.length || monsters.length || factions.length) {
            onProgress('👥 Registering supporting cast & adversaries in library...', 70);
            const sectionNames = await loadMainNpcSectionNames();
            try {
                const npcLib = await import('../SillyTavern-MultihogDnDFramework/npc-library.js');
                if (typeof npcLib.saveNpcToLibrary === 'function') {
                    // Main's saveNpcToLibrary(settings, record) upserts by name and persists settings.
                    const libEntries = [
                        ...npcs.map(n => ({ name: n.name, content: buildNpcEntryContent(n, sectionNames).core, notes: n.notes || '' })),
                        ...monsters.map(m => ({ name: m.name, content: buildMonsterEntryContent(m, sectionNames).core, notes: m.notes || '' })),
                    ];
                    for (const e of libEntries) {
                        if (!e.name || !e.content) continue;
                        await npcLib.saveNpcToLibrary(null, { name: e.name, content: e.content, keys: buildNpcKeys(e.name), notes: e.notes });
                    }
                } else {
                    console.warn('[PbtA Concierge] Main NPC library API (saveNpcToLibrary) not found — skipping library registration. Main extension may have changed.');
                }
            } catch (err) {
                console.warn('[PbtA Concierge] NPC / Monster library registration failed:', err);
            }

            // Also inject across the 4 native campaign lorebooks ({prefix}_NPCs, _Factions, _Locations, _Quests)
            try {
                await injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames);
            } catch (loreErr) {
                console.warn('[PbtA Concierge] Campaign lorebook injection skipped:', loreErr);
            }

            // ── 4b. Seed Day 0 World Skeleton ({prefix}_Skeleton) for World Progression ──
            onProgress('🌍 Seeding Day 0 World Skeleton for macro progression...', 78);
            try {
                await injectWorldSkeleton(chatId, dossier);
            } catch (skelErr) {
                console.warn('[PbtA Concierge] World Skeleton injection skipped:', skelErr);
            }
        }

        // ── 5. Inject Dossier into World Info & State ───────────────────────────
        onProgress('📜 Inscribing Campaign Dossier into World Memory...', 85);
        const dossierMd = serializeDossierToMarkdown(dossier);
        await injectDossierIntoWorldInfo(chatId, dossierMd);

        // Store dossier and initialize game state memo in MultiHog for runtime panel access
        const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
        const rpgSettings = effectiveCtx?.extensionSettings?.rpg_tracker;
        const initialMemo = formatInitialPbtaMemo(dossier);

        if (rpgSettings) {
            rpgSettings.currentMemo = initialMemo;
            rpgSettings.chatStates = rpgSettings.chatStates || {};

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
                rpgSettings.chatStates[chatId].pbtaCampaignDossier = dossier;
                rpgSettings.chatStates[chatId].simulationDepth = simDepth;
                rpgSettings.chatStates[chatId].worldProgressionEnabled = rpgSettings.worldProgressionEnabled;
                rpgSettings.chatStates[chatId].mapEvolutionEnabled = rpgSettings.mapEvolutionEnabled;
                if (dossier.config?.artStyle) {
                    rpgSettings.chatStates[chatId].campaignArtStyle = dossier.config.artStyle;
                }
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
            const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
            if (typeof stateMgr.saveChatState === 'function' && chatId) {
                stateMgr.saveChatState(chatId);
            }
        } catch (_) {}

        // ── 6. Opening Fiction Scene (Turn 0) ───────────────────────────────────
        onProgress('🚀 Launching opening adventure turn...', 95);
        const openingText = dossier.theKick?.openingPrompt
            ? dossier.theKick.openingPrompt
            : `[Initial Setup: ${dossier.meta?.title || 'PbtA Adventure'}]\n${dossier.meta?.premise || 'The adventure begins.'}\n\nBegin the adventure and frame the opening scene.`;

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

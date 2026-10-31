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
import { getStagedCanonEntries, writeStagedCanon } from './concierge-canon.js';
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
import {
    loadMainPcSectionNames,
    buildPlayerCardBio,
} from './concierge-pc-format.js';

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
            const wiMod = await import('../../../public/scripts/world-info.js');
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

            if (typeof router.updateWorldInfoCache === 'function') {
                await router.updateWorldInfoCache(bookName, bookData);
            }
            if (typeof router.rememberCampaignBook === 'function') {
                router.rememberCampaignBook(bookName);
            }
        }
        return assignedMap;
    } catch (err) {
        console.warn(`[PbtA Concierge] Could not auto-inject entries into "${bookName}":`, err);
        return {};
    }
}

/**
 * Distributes dossier entities across the 4 native campaign lorebooks:
 * - {prefix}_NPCs      (NPCs & Monsters)
 * - {prefix}_Factions  (Factions)
 * - {prefix}_Locations (Maps / Sites)
 * - {prefix}_Quests    (Starting Crisis)
 * @returns {Promise<Record<string, { bookName: string, uid: number|string, fullId: string }>>}
 */
async function injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames = null) {
    if (!dossier || typeof dossier !== 'object') return {};
    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const prefix = typeof stateMgr.getEffectiveRouterCampaignPrefix === 'function'
            ? stateMgr.getEffectiveRouterCampaignPrefix(chatId || '')
            : (chatId || '');

        const npcBookName = prefix ? `${prefix}_NPCs` : 'NPCs';
        const factionBookName = prefix ? `${prefix}_Factions` : 'Factions';
        const locBookName = prefix ? `${prefix}_Locations` : 'Locations';
        const questBookName = prefix ? `${prefix}_Quests` : 'Quests';
        const rulesBookName = prefix ? `${prefix}_Rules` : 'Rules';

        const dist = prepareCampaignLorebookDistributions(dossier, sectionNames);

        const [npcMap] = await Promise.all([
            upsertWorldInfoBook(npcBookName, dist.npcs),
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
async function injectCanonBook(chatId) {
    try {
        if (!getStagedCanonEntries().length) return null;
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
        const prefix = typeof stateMgr.getEffectiveRouterCampaignPrefix === 'function'
            ? stateMgr.getEffectiveRouterCampaignPrefix(chatId || '')
            : (chatId || '');
        const res = await writeStagedCanon(prefix, {
            afterSave: async (bookName, bookData) => {
                if (typeof router.updateWorldInfoCache === 'function') await router.updateWorldInfoCache(bookName, bookData);
                if (typeof router.rememberCampaignBook === 'function') router.rememberCampaignBook(bookName);
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
 * @param {object} [options]
 * @param {string} [options.wipeOldTitle] If set, completely purges previous chat and lorebooks for this title
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function launchPbtaCampaign(rawDossier, onProgress = () => {}, options = {}) {
    const { wipeOldTitle = null } = options;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const { healAndNormalizeDossier } = await import('./concierge-parser.js');
    const { applyPbtACartridge, syncPersonaToChat, uploadImageToPersona, findMatchingPersona } = await import('./index.js');
    const { ensureCleanAdventureChat } = await import('./adventure-chat.js');
    const dossier = healAndNormalizeDossier(rawDossier);
    const systemKey = dossier.meta?.systemKey || 'fantasy';
    const charName = (dossier.protagonist?.name || '').trim();
    const adventureTitle = (dossier.meta?.title || '').trim();

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

            // Also clean out previous Campaign_${wipeOldTitle} world info book
            try {
                const getHeaders = ctx?.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
                await fetch('/api/worldinfo/delete', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ name: `Campaign_${wipeOldTitle}` }),
                });
                const wiMod = await import('../../../public/scripts/world-info.js');
                if (wiMod?.worldInfoCache && typeof wiMod.worldInfoCache.delete === 'function') {
                    wiMod.worldInfoCache.delete(`Campaign_${wipeOldTitle}`);
                }
            } catch (_) {}
        }

        // ── 0b. Ensure Clean Chat & Auto-Rename ────────────────────────────────
        onProgress('🛡️ Preparing clean adventure session...', 5);
        const chatId = await ensureCleanAdventureChat({
            adventureTitle,
            fallbackLabel: `PbtA ${systemKey.charAt(0).toUpperCase() + systemKey.slice(1)} Adventure`,
            wipeOldTitle,
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
            worldRules: dossier.worldRules,
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

                // Add to Lorebook Agent with structured sections matching DEFAULT_PC_SECTIONS
                if (typeof charCreator.addPlayerCardToLorebookAgent === 'function') {
                    const pcSectionNames = await loadMainPcSectionNames();
                    const bio = buildPlayerCardBio(dossier.protagonist, pcSectionNames);
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
                            const archNotes = (dossier.worldRules?.axioms || [])
                                .map(a => a.architecturalNotes ? a.architecturalNotes.trim() : '')
                                .filter(Boolean);
                            const archContext = archNotes.length > 0 ? ` Living Architecture & Infrastructure: ${archNotes.join('; ')}.` : '';

                            await mapArch.runMapArchitect({
                                site: primaryMap.site,
                                entrance: primaryMap.entrance || 'Main Threshold',
                                kind: primaryMap.kind || 'SETTLEMENT',
                                scale: 'SMALL',
                                threat: primaryMap.threat || 'MODERATE',
                                prompt: `${primaryMap.prompt || primaryMap.briefDescription}${archContext}`,
                                brief_description: `${primaryMap.briefDescription || primaryMap.prompt}${archContext}`,
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
        let npcMapping = {};
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
                npcMapping = await injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames);
            } catch (loreErr) {
                console.warn('[PbtA Concierge] Campaign lorebook injection skipped:', loreErr);
            }

            // Archivist mode: full imported lore → {prefix}_Canon (vector-matchable)
            await injectCanonBook(chatId);

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
            const dossierMd = serializeDossierToMarkdown(dossier, { includeCyoa: false });
            await injectDossierIntoWorldInfo(chatId, dossierMd);

            // Store dossier and initialize game state memo in MultiHog for runtime panel access
            const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
            const rpgSettings = effectiveCtx?.extensionSettings?.rpg_tracker;
            const initialMemo = formatInitialPbtaMemo(dossier);

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
                        const isAllied = /companion|party|mentor|patron|ally/i.test(n.role || '');
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
                    rpgSettings.chatStates[chatId].pbtaCampaignDossier = dossier;
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

                    // Register Custom HUD Tracker Module in MultiHog Settings if defined
                    const customMod = dossier.worldRules?.customModule;
                    if (customMod && (customMod.tag || customMod.fieldKey || customMod.label)) {
                        const customTag = (customMod.tag || customMod.fieldKey || customMod.label)
                            .replace(/[^a-zA-Z0-9_]/g, '_')
                            .toUpperCase();
                        rpgSettings.customFields = rpgSettings.customFields || [];
                        const existingIdx = rpgSettings.customFields.findIndex(f => f.tag?.toUpperCase() === customTag);
                        const fieldDef = {
                            tag: customTag,
                            label: customMod.label || customMod.tag || customMod.fieldKey || customTag,
                            icon: customMod.icon || '📟',
                            prompt: customMod.instruction || '',
                            template: customMod.sampleContent || customMod.sample || '',
                            enabled: true,
                            scope: 'chat',
                        };
                        if (existingIdx >= 0) {
                            rpgSettings.customFields[existingIdx] = fieldDef;
                        } else {
                            rpgSettings.customFields.push(fieldDef);
                        }

                        if (Array.isArray(rpgSettings.blockOrder) && !rpgSettings.blockOrder.includes(customTag)) {
                            rpgSettings.blockOrder.push(customTag);
                        }
                        rpgSettings.chatStates[chatId].customFields = [...rpgSettings.customFields];
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
            const { persistPbtaChatState, setCompanionActiveCartridge } = await import('./pbta-ruleset-persistence.js');
            if (typeof setCompanionActiveCartridge === 'function' && chatId) {
                await setCompanionActiveCartridge(chatId, {
                    cartridgeId: 'pbta',
                    genre: systemKey,
                    systemLabel: dossier.meta?.systemLabel || 'PbtA',
                    title: adventureTitle,
                    dossier: JSON.parse(JSON.stringify(dossier)),
                });
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

/**
 * In-place synchronization of an active campaign's dossier.
 * Updates rules, cartridge prompts, character harm capacity & tandem HP,
 * and World Info without resetting chat history or sending turn 1.
 *
 * @param {object} rawDossier The modified PbtaCampaignDossier
 * @param {(stepText: string, pct: number) => void} [onProgress] Progress callback
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function syncPbtaCampaignUpdates(rawDossier, onProgress = () => {}) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    const { healAndNormalizeDossier } = await import('./concierge-parser.js');
    const { applyPbtACartridge } = await import('./index.js');
    const { formatInitialPbtaMemo } = await import('./pbta-ruleset.js');
    const { forceRenderTrackerView } = await import('./index.js');
    const { normalizePbtaMemo, syncLivePbtaMemoVitality } = await import('./pbta-vitality-sync.js');

    const dossier = healAndNormalizeDossier(rawDossier);
    const systemKey = dossier.meta?.systemKey || 'fantasy';
    const charName = (dossier.protagonist?.name || '').trim();
    const adventureTitle = (dossier.meta?.title || '').trim();
    
    // Robust active chat ID resolution matching framework & companion conventions
    const chatId = String(
        (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
        || ctx?.getCurrentChatId?.()
        || ctx?.chatId
        || ctx?.chatMetadata?.chat_id
        || ''
    );

    try {
        // 1. Inscribe updated dossier into World Info
        onProgress('📜 Inscribing updated dossier into World Info...', 20);
        const dossierMd = serializeDossierToMarkdown(dossier, { includeCyoa: false });
        await injectDossierIntoWorldInfo(chatId, dossierMd);

        // 2. Distribute updated entities into campaign lorebooks
        onProgress('📚 Updating campaign lorebooks...', 40);
        const sectionNames = await loadMainNpcSectionNames();
        try {
            await injectDossierEntitiesIntoCampaignLorebooks(chatId, dossier, sectionNames);
        } catch (loreErr) {
            console.warn('[PbtA Concierge] Lorebook sync warning:', loreErr);
        }

        // 2b. Refresh Player Character card bio in Lorebook Agent if protagonist name exists
        if (charName) {
            try {
                const charCreator = await import('../SillyTavern-MultihogDnDFramework/character-creator.js');
                if (typeof charCreator.addPlayerCardToLorebookAgent === 'function') {
                    const pcSectionNames = await loadMainPcSectionNames();
                    const bio = buildPlayerCardBio(dossier.protagonist, pcSectionNames);
                    await charCreator.addPlayerCardToLorebookAgent(charName, bio, 150, { chatId });
                }
            } catch (pcErr) {
                console.warn('[PbtA Concierge] PC card sync warning:', pcErr);
            }
        }

        // 3. Update PbtA Cartridge with dynamic rules and Harm tiers
        onProgress('🎲 Re-applying PbtA ruleset cartridge...', 60);
        const statsList = Object.keys(dossier.protagonist?.stats || {});
        const cartridgeOverrides = {
            id: chatId ? `pbta_${chatId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : null,
            campaignTitle: adventureTitle,
            name: adventureTitle ? `PbtA: ${adventureTitle}` : null,
            systemLabel: dossier.meta?.systemLabel,
            description: dossier.meta?.premise,
            tone: dossier.meta?.tone,
            factions: dossier.factions,
            worldRules: dossier.worldRules,
            stats: statsList.length >= 3 ? statsList : null,
            startingMoves: dossier.protagonist?.startingMoves,
            cyoaExamples: (Array.isArray(dossier.cyoaExamples) && dossier.cyoaExamples.length > 0) ? dossier.cyoaExamples : null,
            config: dossier.config || {},
        };
        await applyPbtACartridge(systemKey, cartridgeOverrides);

        // 4. Update live state memo and MultiHog memory
        onProgress('⚙️ Synchronizing live state memo & character vitals...', 80);
        const rpgSettings = ctx?.extensionSettings?.rpg_tracker;
        if (rpgSettings) {
            const nextHarmMax = dossier.config?.harmMax || 5;

            // Find existing memo across settings, partition, or DOM textarea
            let memo = rpgSettings.currentMemo || (chatId && rpgSettings.chatStates?.[chatId]?.currentMemo) || '';
            if (!memo || !memo.trim()) {
                const domEl = typeof document !== 'undefined' ? document.getElementById('rpg-tracker-memo') : null;
                if (domEl && domEl.value && domEl.value.trim()) {
                    memo = domEl.value;
                }
            }

            if (memo && memo.trim()) {
                // Non-destructively merge updated protagonist harm capacity and rules into active game
                const { mergeDossierIntoLiveMemo } = await import('./pbta-vitality-sync.js');
                rpgSettings.currentMemo = mergeDossierIntoLiveMemo(memo, dossier, charName);
                rpgSettings.currentMemo = normalizePbtaMemo(rpgSettings.currentMemo);
            } else {
                // Only if the adventure was never started/memo was completely blank
                rpgSettings.currentMemo = formatInitialPbtaMemo(dossier);
            }

            // Register/update Custom HUD Tracker Module in MultiHog Settings if defined
            const customMod = dossier.worldRules?.customModule;
            if (customMod && (customMod.tag || customMod.fieldKey || customMod.label)) {
                const customTag = (customMod.tag || customMod.fieldKey || customMod.label)
                    .replace(/[^a-zA-Z0-9_]/g, '_')
                    .toUpperCase();
                rpgSettings.customFields = rpgSettings.customFields || [];
                const existingIdx = rpgSettings.customFields.findIndex(f => f.tag?.toUpperCase() === customTag);
                const fieldDef = {
                    tag: customTag,
                    label: customMod.label || customMod.tag || customMod.fieldKey || customTag,
                    icon: customMod.icon || '📟',
                    prompt: customMod.instruction || '',
                    template: customMod.sampleContent || customMod.sample || '',
                    enabled: true,
                    scope: 'chat',
                };
                if (existingIdx >= 0) {
                    rpgSettings.customFields[existingIdx] = fieldDef;
                } else {
                    rpgSettings.customFields.push(fieldDef);
                }

                if (Array.isArray(rpgSettings.blockOrder) && !rpgSettings.blockOrder.includes(customTag)) {
                    rpgSettings.blockOrder.push(customTag);
                }
            }

            if (chatId) {
                rpgSettings.chatStateProjectionOwner = chatId;
                rpgSettings.chatStates = rpgSettings.chatStates || {};
                const cleanChatKey = chatId.replace(/\.jsonl$/i, '');
                const keysToSync = [...new Set([chatId, `${cleanChatKey}.jsonl`, cleanChatKey].filter(k => k === chatId || rpgSettings.chatStates[k]))];
                for (const key of keysToSync) {
                    rpgSettings.chatStates[key] = rpgSettings.chatStates[key] || {};
                    rpgSettings.chatStates[key].pbtaCampaignDossier = dossier;
                    rpgSettings.chatStates[key].currentMemo = rpgSettings.currentMemo;
                    rpgSettings.chatStates[key].simulationDepth = dossier.config?.simulationDepth || 'active_fronts';
                    if (rpgSettings.customFields) {
                        rpgSettings.chatStates[key].customFields = [...rpgSettings.customFields];
                    }
                    syncLivePbtaMemoVitality(rpgSettings, key);
                }
            }

            // Force tracker view hydration so Multihog HUD transitions immediately out of .rt-empty onboarding
            await forceRenderTrackerView(rpgSettings, chatId || 'active', rpgSettings.currentMemo);

            // Persist MultiHog setup snapshot and chat partition so F5 reloads retain PbtA
            try {
                const { persistPbtaChatState, setCompanionActiveCartridge } = await import('./pbta-ruleset-persistence.js');
                if (typeof setCompanionActiveCartridge === 'function' && chatId) {
                    await setCompanionActiveCartridge(chatId, {
                        cartridgeId: 'pbta',
                        genre: systemKey,
                        systemLabel: dossier.meta?.systemLabel || 'PbtA',
                        title: dossier.meta?.title || null,
                        dossier: JSON.parse(JSON.stringify(dossier)),
                    });
                }
                if (typeof persistPbtaChatState === 'function' && chatId) {
                    await persistPbtaChatState(chatId);
                }
            } catch (_) {}
        }

        onProgress('✨ Active campaign successfully synchronized!', 100);
        return { success: true, message: `Active campaign synchronized with Harm capacity ${dossier.config?.harmMax || 5}!` };
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

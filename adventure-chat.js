/**
 * adventure-chat.js — MultiHog Companion
 *
 * Provides seamless chat management and intelligent renaming for PbtA adventures:
 * 1. Checks if the current chat is clean (blank or only initial pristine greeting).
 * 2. If existing dialogue is present, seamlessly creates a new chat without deleting the old one.
 * 3. Detects default SillyTavern timestamp-based chat names (e.g. "Game Master - 2026-10-04@09h15m30s123ms")
 *    and renames the chat to the adventure title or campaign name.
 */

/**
 * Checks if the current SillyTavern chat is clean/blank.
 * A chat is clean if it has 0 messages, or exactly 1 message that is a non-user greeting.
 * @param {object} [ctx] SillyTavern context
 * @returns {boolean}
 */
export function isChatClean(ctx) {
    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
    if (!effectiveCtx) return true;
    const chat = effectiveCtx.chat;
    if (!Array.isArray(chat) || chat.length === 0) return true;

    // In SillyTavern, a newly initialized chat with a character contains 1 message (the greeting).
    // If there is only 1 message and the user has not sent any message yet, it is considered clean.
    if (chat.length === 1 && !chat[0]?.is_user) return true;

    return false;
}

/**
 * Determines if the current chat has an actively running adventure.
 * Returns false if the chat is unstarted (0 messages or only initial greeting),
 * or if MultiHog is currently displaying the empty onboarding / "create an adventure" screen.
 *
 * @param {string} [chatId]
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function isAdventureActive(chatId = null, ctx = null) {
    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);

    // 1. If SillyTavern chat is explicitly clean (unstarted / greeting only), no adventure is running
    if (effectiveCtx && Array.isArray(effectiveCtx.chat) && isChatClean(effectiveCtx)) {
        return false;
    }

    // 2. Check MultiHog settings / state
    const s = effectiveCtx?.extensionSettings?.rpg_tracker
        || (typeof extension_settings !== 'undefined' ? extension_settings?.rpg_tracker : (globalThis.extension_settings?.rpg_tracker || null));
    if (!s) return false;

    // 3. Check if the DOM tracker is explicitly displaying the empty onboarding screen
    if (typeof document !== 'undefined') {
        const trackerEl = document.getElementById('rpg-tracker-render');
        if (trackerEl && (trackerEl.querySelector('.rt-empty') !== null || !trackerEl.children.length)) {
            const memo = String(s.currentMemo || '').trim();
            if (!memo || !/\[CHARACTER\]/i.test(memo)) {
                return false;
            }
        }
    }

    // 4. Check if live memo or partitioned state has any character/story data
    const liveMemo = String(s.currentMemo || '').trim();
    if (liveMemo && /\[CHARACTER\]/i.test(liveMemo)) {
        return true;
    }

    const cid = chatId || (typeof globalThis._rpgCurrentChatId === 'function' ? globalThis._rpgCurrentChatId() : null)
        || effectiveCtx?.getCurrentChatId?.() || effectiveCtx?.chatId || '';
    if (cid && s.chatStates?.[cid]) {
        const part = s.chatStates[cid];
        if (part.pbtaCampaignDossier || part.playerCharacter?.name) return true;
        if (part.currentMemo && /\[CHARACTER\]/i.test(part.currentMemo)) return true;
        if (part.npcRelationshipValues && Object.keys(part.npcRelationshipValues).length > 0) return true;
    }

    if (effectiveCtx?.chat_metadata?.character_name) {
        return true;
    }

    return false;
}

/**
 * Detects if a chat identifier or session name matches SillyTavern's default timestamp patterns.
 * e.g. "Game Master - 2026-10-04@09h15m30s123ms", "2026-10-04@12h00m", unix epochs, etc.
 * @param {string} name
 * @returns {boolean}
 */
export function isDefaultChatName(name) {
    if (!name || typeof name !== 'string') return true;
    const clean = name.trim();
    if (!clean) return true;

    // ST humanizedDateTime timestamp pattern (@09h15m...)
    if (/@\d{1,2}h\d{1,2}m/i.test(clean)) return true;

    // ISO-like date stamps (YYYY-MM-DD or YYYY_MM_DD)
    if (/(?:^|[-_\s])\d{4}[-_]\d{2}[-_]\d{2}/i.test(clean)) return true;

    // Pure numeric epoch timestamps
    if (/^\d{10,}$/.test(clean)) return true;

    // Generic placeholder names or interim session names
    if (/^(new chat|untitled|default|pbta session zero|pbta adventure)$/i.test(clean)) return true;
    if (/^pbta\s*(session\s*zero|adventure)$/i.test(clean)) return true;

    return false;
}

/**
 * Escapes characters with special meaning in regular expressions.
 * @param {string} str
 * @returns {string}
 */
export function escapeRegex(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a proposed adventure title already exists in the character's chat list.
 * @param {string} proposedTitle
 * @param {string[]} existingNames
 * @returns {boolean}
 */
export function checkAdventureNameExists(proposedTitle, existingNames = []) {
    if (!proposedTitle || typeof proposedTitle !== 'string') return false;
    const cleanProposed = proposedTitle.trim().toLowerCase();
    if (!cleanProposed) return false;
    return existingNames.some(name => typeof name === 'string' && name.trim().toLowerCase() === cleanProposed);
}

/**
 * Finds the next available incremented version name for an adventure.
 * e.g. "Shadows of the Citadel" -> "Shadows of the Citadel v2"
 * If "Shadows of the Citadel v2" already exists -> "Shadows of the Citadel v3"
 *
 * @param {string} baseTitle The current adventure title
 * @param {string[]} existingNames List of existing chat names
 * @returns {string} The next available incremented name
 */
export function findNextAdventureVersionName(baseTitle, existingNames = []) {
    const cleanBase = (baseTitle || 'Adventure').trim();
    if (!cleanBase) return 'Adventure v2';

    // Strip any existing trailing " v<number>" to extract root title
    const rootMatch = cleanBase.match(/^(.*?)(?:\s+v(\d+))?$/i);
    const rootTitle = (rootMatch && rootMatch[1]) ? rootMatch[1].trim() : cleanBase;

    const lowerRoot = rootTitle.toLowerCase();
    const versionPattern = new RegExp(`^${escapeRegex(lowerRoot)}(?:\\s+v(\\d+))?$`, 'i');

    let highestVersion = 1;

    for (const rawName of existingNames) {
        if (!rawName || typeof rawName !== 'string') continue;
        const name = rawName.trim();
        const match = name.toLowerCase().match(versionPattern);
        if (match) {
            if (match[1]) {
                const verNum = parseInt(match[1], 10);
                if (!isNaN(verNum) && verNum > highestVersion) {
                    highestVersion = verNum;
                }
            } else {
                if (highestVersion < 1) highestVersion = 1;
            }
        }
    }

    const nextVer = highestVersion + 1;
    return `${rootTitle} v${nextVer}`;
}

/**
 * Queries all existing chat names for the active character.
 * @param {string|number} [characterId]
 * @returns {Promise<string[]>} List of chat base names (without .jsonl)
 */
export async function getExistingAdventureNames(characterId = null) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    let chid = characterId;
    if (chid === null || chid === undefined) {
        chid = typeof this_chid !== 'undefined' ? this_chid : ctx?.characterId;
    }
    const charactersList = typeof characters !== 'undefined' ? characters : (ctx?.characters || []);
    const character = (chid !== null && chid !== undefined) ? charactersList[chid] : null;
    if (!character?.avatar) return [];

    let scriptModule = null;
    try {
        scriptModule = await import('../../../../script.js');
    } catch (_) {}

    const getHeaders = scriptModule?.getRequestHeaders || ctx?.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));

    try {
        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: character.avatar, simple: true }),
            headers: getHeaders(),
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];
        return data
            .map(item => item?.file_id || item?.file_name?.replace(/\.jsonl$/i, '') || '')
            .filter(Boolean);
    } catch (err) {
        console.warn('[MultiHog Companion] Could not query existing chat names:', err);
        return [];
    }
}

/**
 * Deletes an existing adventure chat file (.jsonl) for a character.
 * @param {string|number} [characterId]
 * @param {string} chatTitle Title of the chat to delete
 * @param {object} [options]
 * @param {boolean} [options.emitEvent=true] Whether to emit CHAT_DELETED event
 * @returns {Promise<boolean>}
 */
export async function deleteAdventureChat(characterId = null, chatTitle = '', { emitEvent = true } = {}) {
    if (!chatTitle) return false;
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    let chid = characterId;
    if (chid === null || chid === undefined) {
        chid = typeof this_chid !== 'undefined' ? this_chid : ctx?.characterId;
    }
    const charactersList = typeof characters !== 'undefined' ? characters : (ctx?.characters || []);
    const character = (chid !== null && chid !== undefined) ? charactersList[chid] : null;
    if (!character?.avatar) return false;

    let scriptModule = null;
    try {
        scriptModule = await import('../../../../script.js');
    } catch (_) {}

    const getHeaders = scriptModule?.getRequestHeaders || ctx?.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
    const cleanTitle = chatTitle.replace(/\.jsonl$/i, '').trim();

    try {
        const response = await fetch('/api/chats/delete', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                chatfile: `${cleanTitle}.jsonl`,
                avatar_url: character.avatar,
            }),
        });

        if (response.ok) {
            console.log(`[MultiHog Companion] Safely deleted previous adventure chat: "${cleanTitle}"`);
            if (emitEvent) {
                try {
                    if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
                        await eventSource.emit(event_types.CHAT_DELETED, cleanTitle);
                    }
                } catch (_) {}
            }
            return true;
        }
    } catch (err) {
        console.warn(`[MultiHog Companion] Failed to delete chat "${cleanTitle}":`, err);
    }
    return false;
}

/**
 * Helper delay
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensures the user has a clean chat session for the adventure and applies intelligent renaming.
 *
 * @param {object} [options]
 * @param {string} [options.adventureTitle] Title of the adventure or campaign
 * @param {string} [options.fallbackLabel] Fallback label (e.g. "PbtA Fantasy Adventure")
 * @param {string} [options.wipeOldTitle] If set, purges the previous chat with this title first
 * @returns {Promise<string>} The active chatId
 */
export async function ensureCleanAdventureChat({ adventureTitle = '', fallbackLabel = 'PbtA Adventure', wipeOldTitle = null } = {}) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    let scriptModule = null;
    try {
        scriptModule = await import('../../../../script.js');
    } catch (_) {}

    const getCurrentId = scriptModule?.getCurrentChatId || ctx?.getCurrentChatId;
    let currentChatId = getCurrentId ? getCurrentId() : (ctx?.chatId || null);

    // ── 0. Handle Fresh Wipe / Restart if requested ───────────────────────────
    if (wipeOldTitle) {
        console.log(`[MultiHog Companion] Fresh restart requested for "${wipeOldTitle}". Preparing clean slate...`);
        // If the current chat is not clean or IS the old title, create a clean session first
        if (ctx && (!isChatClean(ctx) || currentChatId === wipeOldTitle)) {
            try {
                if (typeof scriptModule?.doNewChat === 'function') {
                    await scriptModule.doNewChat({ deleteCurrentChat: false });
                } else if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
                    await ctx.executeSlashCommandsWithOptions('/newchat delete=false');
                }
            } catch (err) {
                console.warn('[MultiHog Companion] Could not auto-create new chat during wipe:', err);
            }
            await sleep(450);
            currentChatId = getCurrentId ? getCurrentId() : (ctx?.chatId || null);
        }

        // Delete the previous chat file so destination filename is free
        await deleteAdventureChat(null, wipeOldTitle, { emitEvent: false });
        await sleep(250);

        // Crucial: doNewChat switched away from wipeOldTitle, which caused MultiHog's
        // onChatChanged to save the departing chat's state into chatStates[wipeOldTitle].
        // We must purge wipeOldTitle using removeDeletedChatData and saveSettings so that
        // when renameChat runs, MultiHog has a completely clean destination.
        try {
            const { removeDeletedChatData } = await import(
                '../SillyTavern-MultihogDnDFramework/src/features/chat/deleted-chat-data.js'
            );
            const { saveSettings } = await import(
                '../SillyTavern-MultihogDnDFramework/src/app/runtime-bridge.js'
            );
            const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
            const s = stateMgr.getSettings();
            if (typeof removeDeletedChatData === 'function') {
                removeDeletedChatData(s, wipeOldTitle);
                removeDeletedChatData(s, wipeOldTitle.replace(/\s+/g, '_'));
            }
            if (s?.chatStates) {
                delete s.chatStates[wipeOldTitle];
                delete s.chatStates[wipeOldTitle.replace(/\s+/g, '_')];
            }
            if (typeof saveSettings === 'function') {
                await saveSettings(true);
            }
        } catch (_) {}

        try {
            const { removeLocalChatMapEntry, COMPANION_BY_CHAT_KEY, MEMO_RECOVERY_KEY } = await import(
                '../SillyTavern-MultihogDnDFramework/src/features/chat/local-chat-map.js'
            );
            if (typeof removeLocalChatMapEntry === 'function') {
                removeLocalChatMapEntry(COMPANION_BY_CHAT_KEY, wipeOldTitle);
                removeLocalChatMapEntry(MEMO_RECOVERY_KEY, wipeOldTitle);
                removeLocalChatMapEntry(COMPANION_BY_CHAT_KEY, wipeOldTitle.replace(/\s+/g, '_'));
                removeLocalChatMapEntry(MEMO_RECOVERY_KEY, wipeOldTitle.replace(/\s+/g, '_'));
            }
        } catch (_) {}
    }

    // ── 1. Auto-create new chat if active chat is not clean ────────────────────
    if (ctx && !isChatClean(ctx)) {
        console.log('[MultiHog Companion] Active chat contains prior dialogue. Creating seamless new chat...');
        try {
            if (typeof scriptModule?.doNewChat === 'function') {
                await scriptModule.doNewChat({ deleteCurrentChat: false });
            } else if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
                await ctx.executeSlashCommandsWithOptions('/newchat delete=false');
            }
        } catch (err) {
            console.warn('[MultiHog Companion] Could not auto-create new chat via standard method:', err);
        }

        // Allow SillyTavern state and chat file creation to settle
        await sleep(450);
        currentChatId = getCurrentId ? getCurrentId() : (ctx?.chatId || null);
    }

    // ── 2. Intelligent adventure renaming ──────────────────────────────────────
    const candidateTitle = (adventureTitle || fallbackLabel || '').trim();
    if (candidateTitle) {
        // Sanitize illegal filename characters
        const cleanTitle = candidateTitle.replace(/[\\/:*?"<>|]/g, '').trim();
        // Limit to reasonable display length
        const safeTitle = cleanTitle.length > 60 ? cleanTitle.slice(0, 60).trim() : cleanTitle;

        if (safeTitle && currentChatId && (isDefaultChatName(currentChatId) || currentChatId !== safeTitle)) {
            console.log(`[MultiHog Companion] Renaming adventure chat "${currentChatId}" -> "${safeTitle}"`);
            try {
                if (typeof window !== 'undefined') {
                    window._mhcPendingFreshRestart = {
                        oldId: currentChatId,
                        newId: safeTitle,
                    };
                }

                // Arm MultiHog's pendingUnseenChatReset proof marker so MultiHog's onChatRenamedMigrate
                // recognizes the rename as an intentional transition from the timestamp shell to safeTitle.
                try {
                    const { runtimeState } = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-state.js');
                    if (runtimeState) {
                        runtimeState.pendingUnseenChatReset = {
                            oldId: currentChatId,
                            newId: safeTitle,
                            preexistingLocalMapKeys: [],
                        };
                    }
                } catch (_) {}

                if (typeof scriptModule?.renameChat === 'function') {
                    await scriptModule.renameChat(currentChatId, safeTitle);
                } else if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
                    await ctx.executeSlashCommandsWithOptions(`/renamechat "${safeTitle}"`);
                }
                await sleep(350);
                currentChatId = getCurrentId ? getCurrentId() : (ctx?.chatId || null);
            } catch (renameErr) {
                console.warn('[MultiHog Companion] Non-fatal error while renaming adventure chat:', renameErr);
            } finally {
                setTimeout(() => {
                    if (typeof window !== 'undefined' && window._mhcPendingFreshRestart) {
                        window._mhcPendingFreshRestart = null;
                    }
                }, 3000);
            }
        }
    }

    // ── 3. Align Campaign Prefix to Adventure Title ───────────────────────────
    const effectiveChatId = currentChatId || (getCurrentId ? getCurrentId() : null) || ctx?.chatId || 'active';
    const effectiveTitle = candidateTitle || effectiveChatId;
    if (effectiveTitle && effectiveChatId) {
        try {
            const { alignCampaignPrefixForChat } = await import('./campaign-lore-sync.js');
            await alignCampaignPrefixForChat(effectiveChatId, effectiveTitle);
        } catch (alignErr) {
            console.warn('[MultiHog Companion] Could not align campaign prefix in ensureCleanAdventureChat:', alignErr);
        }
    }

    return effectiveChatId;
}

let _renameGuardInitialized = false;

/**
 * Initializes an early CHAT_RENAMED listener using eventSource.makeFirst.
 * This guarantees that when SillyTavern fires CHAT_RENAMED during an adventure launch
 * or restart, MultiHog's pendingUnseenChatReset proof marker is armed BEFORE
 * MultiHog's onChatRenamedMigrate listener executes.
 *
 * This completely prevents the race condition where SillyTavern's reloadCurrentChat()
 * fires CHAT_CHANGED (which clears pendingUnseenChatReset) right before CHAT_RENAMED.
 */
export function initAdventureChatRenameGuard() {
    if (_renameGuardInitialized) return;
    if (typeof eventSource === 'undefined' || typeof event_types === 'undefined' || !event_types.CHAT_RENAMED) {
        return;
    }
    _renameGuardInitialized = true;

    const register = typeof eventSource.makeFirst === 'function'
        ? eventSource.makeFirst.bind(eventSource)
        : eventSource.on.bind(eventSource);

    register(event_types.CHAT_RENAMED, async (detail) => {
        const oldId = String(detail?.oldFileName || '').replace(/\.jsonl$/i, '').trim();
        const newId = String(detail?.newFileName || '').replace(/\.jsonl$/i, '').trim();
        if (!oldId || !newId) return;

        const pending = typeof window !== 'undefined' ? window._mhcPendingFreshRestart : null;
        if (!pending) return;

        const targetName = typeof pending === 'string' ? pending : pending.newId;
        const matchesTarget = (targetName && (newId === targetName || newId.startsWith(targetName) || targetName.startsWith(newId)))
            || (pending?.oldId && (oldId === pending.oldId || pending.oldId.startsWith(oldId)));

        if (matchesTarget) {
            console.log(`[MultiHog Companion] Adventure rename detected ("${oldId}" -> "${newId}"). Synchronizing MultiHog rename shell proof.`);
            try {
                const { runtimeState } = await import('../SillyTavern-MultihogDnDFramework/src/app/runtime-state.js');
                if (runtimeState) {
                    runtimeState.pendingUnseenChatReset = {
                        oldId: oldId,
                        newId: newId,
                        preexistingLocalMapKeys: [],
                    };
                }
            } catch (err) {
                console.warn('[MultiHog Companion] Could not arm pendingUnseenChatReset on rename guard:', err);
            }

            if (typeof window !== 'undefined') {
                window._mhcPendingFreshRestart = null;
            }
        }
    });
}

/**
 * campaign-lore-sync.js — MultiHog Companion
 *
 * Provides intelligent synchronization of MultiHog campaign lorebooks with
 * descriptive SillyTavern chat names (instead of raw timestamp IDs).
 *
 * Key Capabilities:
 * 1. Automatically aligns campaign prefix on session launch (Concierge / Quick Start).
 * 2. Listens for SillyTavern CHAT_RENAMED events to migrate lorebook stacks seamlessly.
 * 3. Verified cloning: checks that all entries exist in the cloned lorebook before
 *    safely deleting old timestamped lorebook files.
 * 4. Updates MultiHog partition pins, active keys, and ST /world activation.
 */

import { isAdventureActive } from './adventure-chat.js';

async function getSafeHeaders(ctx = null) {
    if (typeof ctx?.getRequestHeaders === 'function') {
        return ctx.getRequestHeaders();
    }
    try {
        const scriptModule = await import('../../../../script.js');
        if (typeof scriptModule?.getRequestHeaders === 'function') {
            return scriptModule.getRequestHeaders();
        }
    } catch (_) {}
    return { 'Content-Type': 'application/json' };
}

/**
 * Returns current MultiHogCompanion settings or defaults.
 */
function getCompanionSettings() {
    const extSettings = typeof extension_settings !== 'undefined' ? extension_settings : (globalThis.extension_settings || {});
    const mhc = extSettings.multihog_companion || {};
    return {
        enableLorebookSync: mhc.enableLorebookSync !== false,
        autoSyncOnRename: mhc.autoSyncOnRename !== false,
        deleteOldLorebooksOnSync: mhc.deleteOldLorebooksOnSync !== false,
        showToasts: mhc.showToasts !== false,
    };
}

/**
 * Shows a subtle toast notification if toasts are enabled.
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {string} message
 * @param {string} [title]
 */
function showToast(type, message, title = 'Campaign Lorebooks') {
    const s = getCompanionSettings();
    if (!s.showToasts && type === 'info') return;
    if (typeof toastr !== 'undefined' && typeof toastr[type] === 'function') {
        toastr[type](message, title);
    } else {
        console.log(`[MultiHog Companion: Lorebook Sync] ${type.toUpperCase()}: ${message}`);
    }
}

/**
 * Lists all known World Info names via SillyTavern context or backend endpoints.
 * @param {any} ctx
 * @returns {Promise<string[]>}
 */
export async function listAllWorldNames(ctx) {
    const namesSet = new Set();

    if (Array.isArray(ctx?.world_names)) {
        ctx.world_names.forEach((name) => namesSet.add(name));
    }

    if (typeof ctx?.getWorldInfoNames === 'function') {
        try {
            const n = await ctx.getWorldInfoNames();
            if (Array.isArray(n)) n.forEach((name) => namesSet.add(name));
        } catch (_) { /* fall through */ }
    } else if (typeof ctx?.getLorebookList === 'function') {
        try {
            const n = await ctx.getLorebookList();
            if (Array.isArray(n)) n.forEach((name) => namesSet.add(name));
        } catch (_) { /* fall through */ }
    }

    if (namesSet.size === 0) {
        try {
            const r = await fetch('/api/settings/get', {
                method: 'POST',
                headers: await getSafeHeaders(ctx),
                body: JSON.stringify({}),
            });
            if (r.ok) {
                const j = await r.json();
                if (Array.isArray(j?.world_names)) {
                    j.world_names.forEach((name) => namesSet.add(name));
                }
            }
        } catch (_) { /* non-fatal */ }
    }

    return Array.from(namesSet);
}

/**
 * Resolves the active chat ID and clean display name.
 * @param {string} [chatId]
 * @returns {{ chatId: string, chatTitle: string }}
 */
export function resolveChatInfo(chatId) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    let effectiveId = (chatId || '').trim();
    if (!effectiveId) {
        effectiveId = ctx?.getCurrentChatId?.() || ctx?.chatId || '';
    }
    const cleanTitle = effectiveId ? effectiveId.replace(/\.jsonl$/i, '').trim() : '';
    return {
        chatId: cleanTitle,
        chatTitle: cleanTitle,
    };
}

/**
 * Checks the campaign lorebook synchronization status for a chat.
 * @param {string} [chatId]
 * @returns {Promise<{
 *   inSync: boolean,
 *   activeChatId: string,
 *   chatTitle: string,
 *   targetPrefix: string,
 *   currentPrefix: string,
 *   matchingBooks: string[],
 *   isEnabled: boolean,
 * }>}
 */
export async function getCampaignLorebookStatus(chatId) {
    const { chatId: id, chatTitle } = resolveChatInfo(chatId);
    const mhcSettings = getCompanionSettings();
    if (!id) {
        return {
            inSync: true,
            activeChatId: '',
            chatTitle: '',
            targetPrefix: '',
            currentPrefix: '',
            matchingBooks: [],
            isEnabled: mhcSettings.enableLorebookSync,
        };
    }

    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const { bookBelongsToPrefix } = await import('../SillyTavern-MultihogDnDFramework/src/features/chat/clone-campaign-stack-utils.js');
        const targetPrefix = stateMgr.sanitizeCampaignPrefixString(chatTitle);
        const currentPrefix = stateMgr.getEffectiveRouterCampaignPrefix(id);

        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const allNames = await listAllWorldNames(ctx);
        const matchingBooks = allNames.filter((name) => bookBelongsToPrefix(name, currentPrefix));

        const inSync = Boolean(
            targetPrefix && currentPrefix && targetPrefix.toLowerCase() === currentPrefix.toLowerCase()
        );

        return {
            inSync,
            activeChatId: id,
            chatTitle,
            targetPrefix,
            currentPrefix,
            matchingBooks,
            isEnabled: mhcSettings.enableLorebookSync,
        };
    } catch (err) {
        console.warn('[MultiHog Companion] Could not query lorebook status:', err);
        return {
            inSync: true,
            activeChatId: id,
            chatTitle,
            targetPrefix: '',
            currentPrefix: '',
            matchingBooks: [],
            isEnabled: mhcSettings.enableLorebookSync,
        };
    }
}

/**
 * Aligns MultiHog's campaign prefix immediately to a clean adventure title.
 * Used during session launch (Turn 0) so all newly seeded or generated lorebooks
 * use the clean title prefix rather than a timestamp.
 *
 * @param {string} chatId
 * @param {string} adventureTitle
 * @returns {Promise<string>} The sanitized clean prefix applied
 */
export async function alignCampaignPrefixForChat(chatId, adventureTitle) {
    if (!chatId || !adventureTitle) return '';
    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const cleanPrefix = stateMgr.sanitizeCampaignPrefixString(adventureTitle);
        if (!cleanPrefix) return '';

        const s = stateMgr.getSettings();
        if (!s.chatStates) s.chatStates = {};
        if (!s.chatStates[chatId]) s.chatStates[chatId] = {};

        const part = s.chatStates[chatId];
        part.renamedCampaignPrefix = cleanPrefix;
        part.routerCampaignPrefix = cleanPrefix;

        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const activeId = ctx?.getCurrentChatId?.() || ctx?.chatId || '';
        const isActive = activeId === chatId || activeId.replace(/\.jsonl$/i, '') === chatId;

        if (isActive) {
            s.routerCampaignPrefix = cleanPrefix;
            s.routerCampaignPrefixOverride = cleanPrefix;
            s.routerCampaignPrefixOverrideAnchorChatId = chatId;
        }

        if (typeof stateMgr.saveSettings === 'function') {
            await stateMgr.saveSettings(true);
        }

        console.log(`[MultiHog Companion] Aligned campaign prefix for "${chatId}" -> "${cleanPrefix}"`);
        return cleanPrefix;
    } catch (err) {
        console.warn('[MultiHog Companion] Could not align campaign prefix:', err);
        return '';
    }
}

/**
 * Verifies that all cloned destination lorebooks exist and contain all entries
 * from the source lorebooks before any deletion is allowed.
 *
 * @param {Record<string, string>} bookRenameMap Source -> Destination book name map
 * @param {any} ctx SillyTavern context
 * @returns {Promise<{ ok: boolean, verifiedCount: number, error?: string }>}
 */
export async function verifyClonedLorebooks(bookRenameMap, ctx) {
    if (!bookRenameMap || typeof bookRenameMap !== 'object') {
        return { ok: false, verifiedCount: 0, error: 'No book map provided' };
    }

    const pairs = Object.entries(bookRenameMap);
    if (pairs.length === 0) {
        return { ok: true, verifiedCount: 0 };
    }

    let verified = 0;
    for (const [oldName, newName] of pairs) {
        let oldBook = null;
        let newBook = null;

        try {
            oldBook = await ctx.loadWorldInfo(oldName);
        } catch (_) { /* non-fatal load */ }

        try {
            newBook = await ctx.loadWorldInfo(newName);
        } catch (_) { /* non-fatal load */ }

        // Fallback fetch from backend if loadWorldInfo missed in-memory cache
        if (!newBook) {
            try {
                const res = await fetch('/api/worldinfo/get', {
                    method: 'POST',
                    headers: await getSafeHeaders(ctx),
                    body: JSON.stringify({ name: newName }),
                });
                if (res.ok) newBook = await res.json();
            } catch (_) { /* non-fatal */ }
        }

        if (!newBook || typeof newBook !== 'object' || !newBook.entries) {
            return {
                ok: false,
                verifiedCount: verified,
                error: `Destination lorebook "${newName}" could not be read or contains no entries structure.`,
            };
        }

        const oldEntryCount = Object.keys(oldBook?.entries || {}).length;
        const newEntryCount = Object.keys(newBook?.entries || {}).length;

        // The new book must contain at least as many entries as the old book
        if (newEntryCount < oldEntryCount) {
            return {
                ok: false,
                verifiedCount: verified,
                error: `Destination lorebook "${newName}" has ${newEntryCount} entries, but source had ${oldEntryCount}.`,
            };
        }

        verified++;
    }

    return { ok: true, verifiedCount: verified };
}

/**
 * Safely deletes old lorebooks after verified migration.
 * @param {string[]} bookNames
 * @param {any} ctx
 * @returns {Promise<number>} Count of deleted books
 */
export async function deleteOldLorebooks(bookNames, ctx) {
    if (!Array.isArray(bookNames) || bookNames.length === 0) return 0;
    let deletedCount = 0;

    for (const name of bookNames) {
        try {
            const res = await fetch('/api/worldinfo/delete', {
                method: 'POST',
                headers: await getSafeHeaders(ctx),
                body: JSON.stringify({ name }),
            });
            if (res.ok) {
                deletedCount++;
                console.log(`[MultiHog Companion] Safely cleaned up source lorebook: "${name}"`);
            }
        } catch (err) {
            console.warn(`[MultiHog Companion] Failed to delete lorebook "${name}":`, err);
        }
    }

    if (deletedCount > 0 && typeof ctx?.updateWorldInfoList === 'function') {
        try { await ctx.updateWorldInfoList(); } catch (_) { /* non-fatal */ }
    }

    return deletedCount;
}

/**
 * Completely purges all campaign lorebooks associated with a campaign prefix.
 * Used during a fresh restart (Delete Old & Start Fresh) to ensure zero stale
 * entities, battle states, or mutations from a prior playthrough bleed through.
 *
 * @param {string} prefix Campaign prefix (e.g. "Shadows_of_the_Citadel" or "Shadows of the Citadel")
 * @param {any} [ctx] SillyTavern context
 * @returns {Promise<number>} Number of purged lorebooks
 */
export async function purgeCampaignLorebooks(prefix, ctx = null) {
    if (!prefix || typeof prefix !== 'string') return 0;
    const cleanPrefix = prefix.trim();
    if (!cleanPrefix) return 0;

    let bookBelongsToPrefix = null;
    try {
        const utils = await import('../SillyTavern-MultihogDnDFramework/src/features/chat/clone-campaign-stack-utils.js');
        bookBelongsToPrefix = utils.bookBelongsToPrefix;
    } catch (_) {}

    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null);
    const allNames = await listAllWorldNames(effectiveCtx);
    const targetSet = new Set();

    // Standard 6 campaign lorebook names with both spaces and underscores
    const sanitizedPrefix = cleanPrefix.replace(/\s+/g, '_');
    const standardBooks = [
        `${sanitizedPrefix}_NPCs`,
        `${sanitizedPrefix}_Factions`,
        `${sanitizedPrefix}_Locations`,
        `${sanitizedPrefix}_Quests`,
        `${sanitizedPrefix}_Rules`,
        `${sanitizedPrefix}_Skeleton`,
        `${cleanPrefix}_NPCs`,
        `${cleanPrefix}_Factions`,
        `${cleanPrefix}_Locations`,
        `${cleanPrefix}_Quests`,
        `${cleanPrefix}_Rules`,
        `${cleanPrefix}_Skeleton`,
    ];

    standardBooks.forEach(b => {
        if (allNames.includes(b)) targetSet.add(b);
    });

    // Also include any dynamic books belonging to this prefix
    if (typeof bookBelongsToPrefix === 'function') {
        allNames.forEach(name => {
            if (bookBelongsToPrefix(name, cleanPrefix) || bookBelongsToPrefix(name, sanitizedPrefix)) {
                targetSet.add(name);
            }
        });
    }

    const booksToDelete = Array.from(targetSet);
    if (booksToDelete.length === 0) return 0;

    console.log(`[MultiHog Companion] Purging ${booksToDelete.length} campaign lorebook(s) for fresh restart:`, booksToDelete);
    return await deleteOldLorebooks(booksToDelete, effectiveCtx);
}

/**
 * Performs full campaign lorebook synchronization for a chat.
 *
 * @param {object} [options]
 * @param {string} [options.chatId] Specific chat ID to sync (defaults to active chat)
 * @param {boolean} [options.force] Sync even if prefixes already match
 * @param {boolean} [options.isAuto] Whether triggered by auto-rename
 * @returns {Promise<{
 *   ok: boolean,
 *   changed: boolean,
 *   oldPrefix?: string,
 *   newPrefix?: string,
 *   clonedCount?: number,
 *   deletedCount?: number,
 *   message: string,
 * }>}
 */
export async function syncCampaignLorebooks(options = {}) {
    const { isAuto = false, force = false } = options;
    const mhcSettings = getCompanionSettings();

    if (!mhcSettings.enableLorebookSync) {
        return { ok: true, changed: false, message: 'Lorebook Sync feature is disabled in settings.' };
    }

    const { chatId: id, chatTitle } = resolveChatInfo(options.chatId);
    if (!id) {
        return { ok: false, changed: false, message: 'No active chat session found.' };
    }

    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    if (!ctx) {
        return { ok: false, changed: false, message: 'SillyTavern context is unavailable.' };
    }

    try {
        const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
        const { cloneCampaignStackToPrefix } = await import('../SillyTavern-MultihogDnDFramework/src/features/chat/clone-campaign-stack.js');
        const { bookBelongsToPrefix } = await import('../SillyTavern-MultihogDnDFramework/src/features/chat/clone-campaign-stack-utils.js');

        const targetPrefix = stateMgr.sanitizeCampaignPrefixString(chatTitle);
        const currentPrefix = stateMgr.getEffectiveRouterCampaignPrefix(id);

        if (!targetPrefix) {
            return { ok: false, changed: false, message: 'Target prefix derived from chat title is empty.' };
        }

        const isPrefixEqual = currentPrefix && targetPrefix.toLowerCase() === currentPrefix.toLowerCase();
        if (isPrefixEqual && !force) {
            return {
                ok: true,
                changed: false,
                oldPrefix: currentPrefix,
                newPrefix: targetPrefix,
                message: `Lorebooks already in sync with prefix "${targetPrefix}".`,
            };
        }

        // ── 1. Find matching lorebooks for the current prefix ────────────────
        const allNames = await listAllWorldNames(ctx);
        const matchingBooks = currentPrefix
            ? allNames.filter((name) => bookBelongsToPrefix(name, currentPrefix))
            : [];

        // If no campaign lorebooks exist and chat is unstarted, no-op to prevent pre-emptive partition seeding
        if (matchingBooks.length === 0 && isAuto && !isAdventureActive(id, ctx)) {
            return {
                ok: true,
                changed: false,
                message: 'No campaign lorebooks found to sync for unstarted chat.',
            };
        }

        let clonedCount = 0;
        let deletedCount = 0;
        let bookRenameMap = {};

        // ── 2. Clone books to new prefix if matching books exist ─────────────
        if (matchingBooks.length > 0 && currentPrefix !== targetPrefix) {
            if (!isAuto) {
                showToast('info', `Syncing ${matchingBooks.length} campaign lorebooks: ${currentPrefix} → ${targetPrefix}…`);
            }

            const cloneResult = await cloneCampaignStackToPrefix(currentPrefix, targetPrefix);

            if (cloneResult.collisions?.length) {
                const msg = `Sync aborted: destination lorebooks already exist: ${cloneResult.collisions.join(', ')}`;
                showToast('error', msg);
                return { ok: false, changed: false, message: msg };
            }

            if (!cloneResult.ok) {
                const msg = `Lorebook clone failed: ${cloneResult.errors?.join('; ') || 'Unknown error'}`;
                showToast('error', msg);
                return { ok: false, changed: false, message: msg };
            }

            clonedCount = cloneResult.cloned || 0;
            bookRenameMap = cloneResult.bookRenameMap || {};

            // ── 3. Strict Verification Guard ─────────────────────────────────
            const verification = await verifyClonedLorebooks(bookRenameMap, ctx);
            if (!verification.ok) {
                const warnMsg = `Verification failed for cloned books: ${verification.error}. Preserving original books.`;
                console.warn('[MultiHog Companion]', warnMsg);
                showToast('warning', warnMsg);
            }

            // ── 4. Switch SillyTavern /world Activations ─────────────────────
            if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
                for (const oldBook of Object.keys(bookRenameMap)) {
                    await ctx.executeSlashCommandsWithOptions(`/world state=off silent=true "${oldBook}"`).catch(() => {});
                }
                for (const newBook of Object.values(bookRenameMap)) {
                    await ctx.executeSlashCommandsWithOptions(`/world state=on silent=true "${newBook}"`).catch(() => {});
                }
            }

            // ── 5. Quiet Deletion of Old Books (if enabled and verified) ─────
            if (mhcSettings.deleteOldLorebooksOnSync && verification.ok) {
                deletedCount = await deleteOldLorebooks(Object.keys(bookRenameMap), ctx);
            }
        }

        // ── 6. Update MultiHog Settings Partition & Prefix Pins ──────────────
        const s = stateMgr.getSettings();
        if (!s.chatStates) s.chatStates = {};
        if (!s.chatStates[id]) s.chatStates[id] = {};
        const part = s.chatStates[id];

        part.renamedCampaignPrefix = targetPrefix;
        part.routerCampaignPrefix = targetPrefix;

        // Remap linked campaignBooks in chatState
        if (Array.isArray(part.campaignBooks)) {
            part.campaignBooks = part.campaignBooks.map((name) => bookRenameMap[name] || name);
        }

        // Remap active keys from OldPrefix:: to NewPrefix::
        const remapKey = (k) => {
            if (typeof k !== 'string' || !currentPrefix) return k;
            if (k.startsWith(`${currentPrefix}::`)) {
                return `${targetPrefix}::${k.slice(currentPrefix.length + 2)}`;
            }
            return k;
        };

        if (Array.isArray(part.activeRouterKeys)) part.activeRouterKeys = part.activeRouterKeys.map(remapKey);
        if (Array.isArray(part.activeWorldKeys)) part.activeWorldKeys = part.activeWorldKeys.map(remapKey);
        if (Array.isArray(part.pinnedRouterKeys)) part.pinnedRouterKeys = part.pinnedRouterKeys.map(remapKey);
        if (Array.isArray(part.keywordActivatedKeys)) part.keywordActivatedKeys = part.keywordActivatedKeys.map(remapKey);

        // Update live settings
        s.routerCampaignPrefix = targetPrefix;
        s.routerCampaignPrefixOverride = targetPrefix;
        s.routerCampaignPrefixOverrideAnchorChatId = id;

        if (Array.isArray(s.activeRouterKeys)) s.activeRouterKeys = s.activeRouterKeys.map(remapKey);
        if (Array.isArray(s.activeWorldKeys)) s.activeWorldKeys = s.activeWorldKeys.map(remapKey);
        if (Array.isArray(s.pinnedRouterKeys)) s.pinnedRouterKeys = s.pinnedRouterKeys.map(remapKey);
        if (Array.isArray(s.keywordActivatedKeys)) s.keywordActivatedKeys = s.keywordActivatedKeys.map(remapKey);

        if (typeof stateMgr.saveSettings === 'function') {
            await stateMgr.saveSettings(true);
        }

        const successMsg = clonedCount > 0
            ? `Synced ${clonedCount} lorebook${clonedCount === 1 ? '' : 's'} to "${targetPrefix}"${deletedCount > 0 ? ` (cleaned up ${deletedCount} old)` : ''}.`
            : `Aligned campaign prefix to "${targetPrefix}".`;

        showToast('success', successMsg);
        return {
            ok: true,
            changed: true,
            oldPrefix: currentPrefix,
            newPrefix: targetPrefix,
            clonedCount,
            deletedCount,
            message: successMsg,
        };
    } catch (err) {
        console.error('[MultiHog Companion] Lorebook sync error:', err);
        showToast('error', `Sync failed: ${err.message}`);
        return { ok: false, changed: false, message: err.message };
    }
}

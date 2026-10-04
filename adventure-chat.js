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

    // Generic placeholder names
    if (/^(new chat|untitled|default)$/i.test(clean)) return true;

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
 * @returns {Promise<string>} The active chatId
 */
export async function ensureCleanAdventureChat({ adventureTitle = '', fallbackLabel = 'PbtA Adventure' } = {}) {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    let scriptModule = null;
    try {
        scriptModule = await import('../../../../script.js');
    } catch (_) {}

    const getCurrentId = scriptModule?.getCurrentChatId || ctx?.getCurrentChatId;
    let currentChatId = getCurrentId ? getCurrentId() : (ctx?.chatId || null);

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

        if (safeTitle && currentChatId && isDefaultChatName(currentChatId)) {
            console.log(`[MultiHog Companion] Renaming default chat "${currentChatId}" -> "${safeTitle}"`);
            try {
                if (typeof scriptModule?.renameChat === 'function') {
                    await scriptModule.renameChat(currentChatId, safeTitle);
                } else if (typeof ctx?.executeSlashCommandsWithOptions === 'function') {
                    await ctx.executeSlashCommandsWithOptions(`/renamechat "${safeTitle}"`);
                }
                await sleep(350);
                currentChatId = getCurrentId ? getCurrentId() : (ctx?.chatId || null);
            } catch (renameErr) {
                console.warn('[MultiHog Companion] Non-fatal error while renaming adventure chat:', renameErr);
            }
        }
    }

    return currentChatId || (getCurrentId ? getCurrentId() : null) || ctx?.chatId || 'active';
}

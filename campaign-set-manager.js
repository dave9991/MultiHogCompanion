/**
 * campaign-set-manager.js — MultiHog Companion
 *
 * Provides auditing, grouping, alignment, and safe cleanup of campaign lorebook sets.
 *
 * Core Capabilities:
 * 1. Groups global SillyTavern world info files into cohesive Campaign Sets:
 *    - 1 Primary Dossier (Campaign_{Title})
 *    - Up to 8 MultiHog Partition Books ({Prefix}_{Locations|NPCs|Quests|Factions|Events|Rules|Skeleton|Canon})
 * 2. Identifies Misaligned Sets where a chat was renamed or still points to older protagonist dossiers.
 * 3. Identifies True Orphaned Sets where no matching chat exists across any SillyTavern character.
 * 4. Protects character-bound books and standalone non-campaign lorebooks from deletion.
 * 5. Provides an interactive modal UI for one-click alignment and granular or batch orphan deletion.
 */

import {
    listAllWorldNames,
    resolveChatInfo,
    deleteOldLorebooks,
    verifyClonedLorebooks,
    alignCampaignPrefixForChat,
    getSafeHeaders,
} from './campaign-lore-sync.js';

export const MULTIHOG_PARTITIONS = Object.freeze([
    'npcs', 'locations', 'factions', 'quests', 'events', 'rules', 'skeleton', 'canon'
]);

/**
 * Sanitizes a title string into standard MultiHog campaign prefix format.
 * @param {string} str
 * @returns {string}
 */
export function sanitizeCampaignPrefix(str) {
    return String(str || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Checks if a lorebook filename follows MultiHog partition naming ({prefix}_{partition}).
 * @param {string} bookName
 * @returns {{ isPartition: boolean, prefix: string, partition: string }}
 */
export function parsePartitionBookName(bookName) {
    const raw = String(bookName || '').trim();
    const lastUnderscore = raw.lastIndexOf('_');
    if (lastUnderscore <= 0) {
        return { isPartition: false, prefix: '', partition: '' };
    }
    const prefix = raw.slice(0, lastUnderscore);
    const suffix = raw.slice(lastUnderscore + 1).toLowerCase();
    if (MULTIHOG_PARTITIONS.includes(suffix)) {
        return { isPartition: true, prefix, partition: suffix };
    }
    return { isPartition: false, prefix: '', partition: '' };
}

/**
 * Pure classifier: groups lorebook names against active chats, character cards, and other chats.
 *
 * @param {object} params
 * @param {string[]} params.allWorldNames
 * @param {Array<{ chatId: string, chatTitle: string, worldInfo?: string, prefix?: string }>} params.gmChats
 * @param {string[]} [params.characterBoundBooks=[]]
 * @param {Array<{ chatId: string, chatTitle: string, worldInfo?: string }>} [params.otherCharChats=[]]
 * @returns {object} Audit report with activeSets, misalignedSets, orphanSets, and protectedBooks
 */
export function classifyLorebooks({
    allWorldNames = [],
    gmChats = [],
    characterBoundBooks = [],
    otherCharChats = [],
}) {
    const worldSet = new Set(allWorldNames);
    const charBoundSet = new Set(characterBoundBooks.map(b => String(b || '').trim().toLowerCase()));

    // Map active GM chats by sanitized prefix and title
    const gmChatByPrefix = new Map();
    const gmChatByTitle = new Map();

    for (const chat of gmChats) {
        const title = (chat.chatTitle || chat.chatId || '').replace(/\.jsonl$/i, '').trim();
        const prefix = sanitizeCampaignPrefix(chat.prefix || title);
        const lowerPrefix = prefix.toLowerCase();
        const lowerTitle = title.toLowerCase();

        const chatRecord = {
            chatId: chat.chatId,
            chatTitle: title,
            targetPrefix: prefix,
            boundDossier: (chat.worldInfo || '').trim(),
            dossierBooks: [],
            partitionBooks: [],
            isMisaligned: false,
            misalignedReason: '',
        };

        gmChatByPrefix.set(lowerPrefix, chatRecord);
        gmChatByTitle.set(lowerTitle, chatRecord);
    }

    // Map other characters' chats for cross-character protection
    const otherChatPrefixes = new Set();
    const otherChatDossiers = new Set();
    for (const chat of otherCharChats) {
        const title = (chat.chatTitle || chat.chatId || '').replace(/\.jsonl$/i, '').trim();
        if (title) otherChatPrefixes.add(sanitizeCampaignPrefix(title).toLowerCase());
        if (chat.worldInfo) otherChatDossiers.add(chat.worldInfo.trim().toLowerCase());
    }

    const claimedBooks = new Set();
    const activeSets = [];
    const misalignedSets = [];

    // 1. Pass: Match books to GM chats
    for (const book of allWorldNames) {
        const lowerBook = book.toLowerCase();

        // Check if it is a Campaign_{Title} dossier
        if (lowerBook.startsWith('campaign_')) {
            const rawTitle = book.slice('campaign_'.length).trim();
            const lowerRawTitle = rawTitle.toLowerCase();
            const sanitizedTitle = sanitizeCampaignPrefix(rawTitle).toLowerCase();

            // Direct title or prefix match to a GM chat
            let hitChat = gmChatByTitle.get(lowerRawTitle) || gmChatByPrefix.get(sanitizedTitle);

            // Also check if any GM chat explicitly bounds this world_info in metadata
            if (!hitChat) {
                for (const chat of gmChatByPrefix.values()) {
                    if (chat.boundDossier && chat.boundDossier.toLowerCase() === lowerBook) {
                        hitChat = chat;
                        break;
                    }
                }
            }

            if (hitChat) {
                hitChat.dossierBooks.push(book);
                claimedBooks.add(book);
                continue;
            }
        }

        // Check if it is a MultiHog partition book ({Prefix}_{Partition})
        const parsed = parsePartitionBookName(book);
        if (parsed.isPartition) {
            const lowerPref = parsed.prefix.toLowerCase();
            const hitChat = gmChatByPrefix.get(lowerPref);
            if (hitChat) {
                hitChat.partitionBooks.push(book);
                claimedBooks.add(book);
                continue;
            }
        }
    }

    // Check alignment for each GM chat
    for (const chat of gmChatByPrefix.values()) {
        const expectedDossier = `Campaign_${chat.chatTitle}`;
        const expectedPrefix = chat.targetPrefix;

        // Check for misaligned bound dossier
        if (chat.boundDossier && chat.boundDossier.toLowerCase() !== expectedDossier.toLowerCase()) {
            chat.isMisaligned = true;
            chat.misalignedReason = `Bound dossier is "${chat.boundDossier}", expected "${expectedDossier}"`;
        }

        // Check for partition prefix mismatch or multiple dossiers
        if (chat.dossierBooks.length > 1) {
            chat.isMisaligned = true;
            chat.misalignedReason = `Multiple campaign dossiers found (${chat.dossierBooks.join(', ')})`;
        }

        if (chat.isMisaligned) {
            misalignedSets.push(chat);
        } else {
            activeSets.push(chat);
        }
    }

    // 2. Pass: Examine unclaimed books for orphans vs protected
    const orphanMap = new Map(); // prefix -> book[]
    const protectedBooks = [];

    for (const book of allWorldNames) {
        if (claimedBooks.has(book)) continue;

        const lowerBook = book.toLowerCase();

        // A. Is it explicitly bound to a character card?
        if (charBoundSet.has(lowerBook)) {
            protectedBooks.push({ name: book, reason: 'Bound to Character Card' });
            continue;
        }

        // B. Is it bound to another character's chat?
        if (otherChatDossiers.has(lowerBook)) {
            protectedBooks.push({ name: book, reason: 'Bound to another character\'s adventure' });
            continue;
        }

        // C. Check if it's a partition book of another character's chat
        const parsed = parsePartitionBookName(book);
        if (parsed.isPartition && otherChatPrefixes.has(parsed.prefix.toLowerCase())) {
            protectedBooks.push({ name: book, reason: 'Belongs to another character\'s adventure stack' });
            continue;
        }

        // D. Check if it's a MultiHog partition book without any chat
        if (parsed.isPartition) {
            const groupKey = parsed.prefix;
            if (!orphanMap.has(groupKey)) orphanMap.set(groupKey, []);
            orphanMap.get(groupKey).push(book);
            continue;
        }

        // E. Check if it's an unclaimed Campaign_{Title} dossier
        if (lowerBook.startsWith('campaign_')) {
            const rawTitle = book.slice('campaign_'.length).trim();
            const groupKey = sanitizeCampaignPrefix(rawTitle) || rawTitle;
            if (!orphanMap.has(groupKey)) orphanMap.set(groupKey, []);
            orphanMap.get(groupKey).push(book);
            continue;
        }

        // F. Otherwise, it's a custom / standalone world info book
        protectedBooks.push({ name: book, reason: 'Custom / Standalone World Info' });
    }

    // Format orphan groups
    const orphanSets = [];
    for (const [prefix, books] of orphanMap.entries()) {
        orphanSets.push({
            prefix,
            title: prefix.replace(/_/g, ' '),
            books,
            count: books.length,
        });
    }

    // Sort orphan groups by book count descending, then alphabetically
    orphanSets.sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));

    return {
        activeSets,
        misalignedSets,
        orphanSets,
        protectedBooks,
        totalWorldCount: allWorldNames.length,
    };
}

/**
 * Performs a live audit of the current SillyTavern environment.
 * @param {object} [ctx] SillyTavern context
 * @returns {Promise<object>} Audit report
 */
export async function auditCampaignSets(ctx = null) {
    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);

    // 1. Get all known world info names
    const allWorldNames = await listAllWorldNames(effectiveCtx);

    // 2. Identify active character
    let activeCharName = 'Game Master';
    let activeCharAvatar = 'Game Master.png';

    if (effectiveCtx?.characterId !== undefined && effectiveCtx?.characters) {
        const charObj = effectiveCtx.characters[effectiveCtx.characterId];
        if (charObj) {
            activeCharName = charObj.name || activeCharName;
            activeCharAvatar = charObj.avatar || `${activeCharName}.png`;
        }
    }

    // 3. Collect character-bound books from all character cards
    const characterBoundBooks = [];
    const charactersList = Array.isArray(effectiveCtx?.characters)
        ? effectiveCtx.characters
        : Object.values(effectiveCtx?.characters || {});

    for (const c of charactersList) {
        if (!c) continue;
        const data = c.data || c;
        if (data.extensions?.world) characterBoundBooks.push(data.extensions.world);
        if (data.character_book?.name) characterBoundBooks.push(data.character_book.name);
    }

    // 4. Fetch chats for active GM character via API
    let gmChats = [];
    try {
        const res = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: await getSafeHeaders(effectiveCtx),
            body: JSON.stringify({ avatar_url: activeCharAvatar, metadata: true }),
        });
        if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) {
                gmChats = list.map(item => {
                    const rawName = item.file_name || item.name || '';
                    const title = rawName.replace(/\.jsonl$/i, '');
                    return {
                        chatId: title,
                        chatTitle: title,
                        worldInfo: item.chat_metadata?.world_info || '',
                        prefix: sanitizeCampaignPrefix(title),
                    };
                });
            }
        }
    } catch (err) {
        console.warn('[MultiHog Companion] Could not query GM chats via endpoint:', err);
    }

    // Fallback if API returned empty: include current active chat
    if (gmChats.length === 0) {
        const currId = effectiveCtx?.getCurrentChatId?.() || effectiveCtx?.chatId || '';
        if (currId) {
            const { chatTitle } = resolveChatInfo(currId);
            gmChats.push({
                chatId: chatTitle,
                chatTitle,
                worldInfo: effectiveCtx?.chat_metadata?.world_info || '',
                prefix: sanitizeCampaignPrefix(chatTitle),
            });
        }
    }

    // 5. Run classifier
    const report = classifyLorebooks({
        allWorldNames,
        gmChats,
        characterBoundBooks,
        otherCharChats: [],
    });

    return {
        ...report,
        activeCharName,
        activeCharAvatar,
    };
}

/**
 * Re-aligns a misaligned chat stack in-place.
 * @param {object} misalignedRecord
 * @param {object} [ctx]
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function alignCampaignSetInPlace(misalignedRecord, ctx = null) {
    if (!misalignedRecord) return { ok: false, message: 'No record provided' };
    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);

    const { chatId, chatTitle, boundDossier, targetPrefix } = misalignedRecord;
    const cleanPrefix = sanitizeCampaignPrefix(chatTitle);
    const targetDossierName = `Campaign_${chatTitle}`;

    try {
        // 1. Align runtime partition prefix
        await alignCampaignPrefixForChat(chatId, chatTitle);

        // 2. If bound dossier differs from target, clone it and verify
        if (boundDossier && boundDossier !== targetDossierName) {
            let sourceBook = null;
            try {
                sourceBook = await effectiveCtx?.loadWorldInfo?.(boundDossier);
            } catch (_) {}

            if (!sourceBook) {
                const res = await fetch('/api/worldinfo/get', {
                    method: 'POST',
                    headers: await getSafeHeaders(effectiveCtx),
                    body: JSON.stringify({ name: boundDossier }),
                });
                if (res.ok) sourceBook = await res.json();
            }

            if (sourceBook && typeof sourceBook === 'object') {
                // Save as targetDossierName
                await fetch('/api/worldinfo/save', {
                    method: 'POST',
                    headers: await getSafeHeaders(effectiveCtx),
                    body: JSON.stringify({ name: targetDossierName, data: sourceBook }),
                });

                // Verify target book exists
                const verify = await verifyClonedLorebooks({ [boundDossier]: targetDossierName }, effectiveCtx);
                if (verify.ok) {
                    // Safely clean up old misaligned dossier
                    await deleteOldLorebooks([boundDossier], effectiveCtx);
                }
            }
        }

        // 3. Update chat metadata world_info if active
        const currId = effectiveCtx?.getCurrentChatId?.() || effectiveCtx?.chatId || '';
        const isCurrent = currId === chatId || currId.replace(/\.jsonl$/i, '') === chatId;
        if (isCurrent && effectiveCtx?.chat_metadata) {
            effectiveCtx.chat_metadata.world_info = targetDossierName;
            if (typeof effectiveCtx.saveChat === 'function') {
                await effectiveCtx.saveChat();
            }
        }

        return { ok: true, message: `Successfully aligned Campaign Set to "${chatTitle}"` };
    } catch (err) {
        console.error('[MultiHog Companion] Error aligning set:', err);
        return { ok: false, message: `Failed to align set: ${err.message}` };
    }
}

/**
 * Creates and displays the Campaign Set Manager modal window.
 * @param {object} [ctx] SillyTavern context
 */
export async function openCampaignSetManagerModal(ctx = null) {
    const effectiveCtx = ctx || (typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null);

    // Remove any existing instance
    const existing = document.getElementById('mhc-campaign-set-modal');
    if (existing) existing.remove();

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'mhc-campaign-set-modal';
    backdrop.className = 'mhc-modal-backdrop';

    // Create dialog container
    const dialog = document.createElement('div');
    dialog.className = 'mhc-modal-dialog';
    backdrop.appendChild(dialog);

    // Initial Loading State
    dialog.innerHTML = `
        <div class="mhc-modal-header" style="border-bottom: 1px solid rgba(160,120,240,0.3); padding: 14px 20px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-boxes-stacked" style="color: #cc99ff; font-size: 1.3em;"></i>
                <div>
                    <h3 style="margin: 0; font-size: 1.15em; font-weight: 600; color: #f3f4f6;">Campaign Set Manager</h3>
                    <span style="font-size: 0.8em; opacity: 0.7;">Scanning campaign sets & orphaned lorebooks...</span>
                </div>
            </div>
            <button class="mhc-modal-close" style="background: none; border: none; color: #9ca3af; font-size: 1.2em; cursor: pointer;">&times;</button>
        </div>
        <div class="mhc-modal-body" style="padding: 40px; text-align: center; color: #9ca3af;">
            <i class="fa-solid fa-spinner fa-spin fa-2x" style="color: #cc99ff; margin-bottom: 14px;"></i>
            <div>Analyzing SillyTavern lorebooks and adventure chats...</div>
        </div>
    `;

    document.body.appendChild(backdrop);

    // Wire close handlers
    const closeModal = () => backdrop.remove();
    backdrop.querySelector('.mhc-modal-close')?.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
    });

    // Run audit
    let audit = null;
    try {
        audit = await auditCampaignSets(effectiveCtx);
    } catch (err) {
        console.error('[MultiHog Companion] Audit failed:', err);
        dialog.querySelector('.mhc-modal-body').innerHTML = `
            <div style="color: #fc8181; margin-bottom: 10px;"><i class="fa-solid fa-triangle-exclamation"></i> Audit Failed</div>
            <div style="font-size: 0.85em; opacity: 0.8;">${err.message}</div>
        `;
        return;
    }

    renderModalContent(dialog, audit, effectiveCtx);
}

/**
 * Renders the full interactive content inside the modal dialog.
 * @param {HTMLElement} dialog
 * @param {object} audit
 * @param {object} ctx
 */
function renderModalContent(dialog, audit, ctx) {
    const totalActiveBooks = audit.activeSets.reduce((sum, s) => sum + s.dossierBooks.length + s.partitionBooks.length, 0);
    const totalMisalignedBooks = audit.misalignedSets.reduce((sum, s) => sum + s.dossierBooks.length + s.partitionBooks.length, 0);
    const totalOrphanBooks = audit.orphanSets.reduce((sum, s) => sum + s.count, 0);

    dialog.innerHTML = `
        <div class="mhc-modal-header" style="border-bottom: 1px solid rgba(160,120,240,0.3); padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(20,21,26,0.95);">
            <div style="display: flex; align-items: center; gap: 10px;">
                <i class="fa-solid fa-boxes-stacked" style="color: #cc99ff; font-size: 1.3em;"></i>
                <div>
                    <h3 style="margin: 0; font-size: 1.15em; font-weight: 600; color: #f3f4f6;">Campaign Set Manager</h3>
                    <span style="font-size: 0.8em; opacity: 0.7;">Active Game Master: <strong style="color: #88ccff;">${audit.activeCharName}</strong> &bull; Total Lorebooks: <strong>${audit.totalWorldCount}</strong></span>
                </div>
            </div>
            <button class="mhc-modal-close" style="background: none; border: none; color: #9ca3af; font-size: 1.3em; cursor: pointer; padding: 4px 8px;">&times;</button>
        </div>

        <div class="mhc-modal-body" style="padding: 16px 20px; max-height: 75vh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
            
            <!-- SECTION 1: ACTIVE HEALTHY SETS -->
            <div class="mhc-set-section" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                <div class="mhc-set-section-hdr" style="padding: 10px 14px; background: rgba(52, 211, 153, 0.08); border-bottom: 1px solid rgba(52, 211, 153, 0.2); display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <div style="font-weight: 600; color: #6ee7b7; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-circle-check"></i>
                        <span>Active Campaign Sets</span>
                        <span style="font-size: 0.8em; opacity: 0.8; font-weight: normal;">(${audit.activeSets.length} chats · ${totalActiveBooks} books)</span>
                    </div>
                    <i class="fa-solid fa-chevron-right" style="font-size: 0.8em; opacity: 0.7;"></i>
                </div>
                <div class="mhc-set-section-content" style="padding: 10px 14px; display: none; flex-direction: column; gap: 8px;">
                    ${audit.activeSets.length === 0 ? '<div style="font-size: 0.85em; opacity: 0.6; font-style: italic;">No active campaign sets found.</div>' : ''}
                    ${audit.activeSets.map(chat => `
                        <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 8px 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                <strong style="color: #f3f4f6;">${chat.chatTitle}</strong>
                                <span style="font-size: 0.75em; background: rgba(52, 211, 153, 0.2); color: #6ee7b7; padding: 2px 8px; border-radius: 10px;">${chat.dossierBooks.length + chat.partitionBooks.length} book(s) in sync</span>
                            </div>
                            <div style="font-family: monospace; font-size: 0.78em; opacity: 0.7; display: flex; flex-wrap: wrap; gap: 6px;">
                                ${chat.dossierBooks.map(b => `<span style="background: rgba(160,120,240,0.15); color: #d8b4fe; padding: 1px 6px; border-radius: 4px;">📜 ${b}</span>`).join('')}
                                ${chat.partitionBooks.map(b => `<span style="background: rgba(90,160,250,0.15); color: #93c5fd; padding: 1px 6px; border-radius: 4px;">📂 ${b}</span>`).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- SECTION 2: MISALIGNED SETS -->
            ${audit.misalignedSets.length > 0 ? `
            <div class="mhc-set-section" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                <div class="mhc-set-section-hdr" style="padding: 10px 14px; background: rgba(245, 158, 11, 0.1); border-bottom: 1px solid rgba(245, 158, 11, 0.25); display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <div style="font-weight: 600; color: #fbbf24; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>Misaligned Campaign Sets</span>
                        <span style="font-size: 0.8em; opacity: 0.8; font-weight: normal;">(${audit.misalignedSets.length} chats · ${totalMisalignedBooks} books)</span>
                    </div>
                    <i class="fa-solid fa-chevron-down" style="font-size: 0.8em; opacity: 0.7;"></i>
                </div>
                <div class="mhc-set-section-content" style="padding: 10px 14px; display: flex; flex-direction: column; gap: 10px;">
                    <div style="font-size: 0.82em; opacity: 0.8; color: #fde68a;">These adventures have mismatched dossier names or multiple versions left over from chat renames. Aligning will clone and re-link them in-place.</div>
                    ${audit.misalignedSets.map((chat, idx) => `
                        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 6px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 260px;">
                                <strong style="color: #f3f4f6; font-size: 0.95em;">${chat.chatTitle}</strong>
                                <div style="font-size: 0.78em; color: #fca5a5; margin-top: 2px;">${chat.misalignedReason}</div>
                                <div style="font-family: monospace; font-size: 0.75em; opacity: 0.7; margin-top: 4px;">
                                    Current books: ${[...chat.dossierBooks, ...chat.partitionBooks].join(', ') || 'None found'}
                                </div>
                            </div>
                            <button class="mhc-align-set-btn menu_button interactable" data-index="${idx}" style="font-size: 0.78em; padding: 4px 12px; display: inline-flex; align-items: center; gap: 5px; background: rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.4); color: #fde68a;">
                                <i class="fa-solid fa-arrows-rotate"></i>
                                <span>Align Set Now</span>
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <!-- SECTION 3: ORPHANED SETS -->
            <div class="mhc-set-section" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                <div class="mhc-set-section-hdr" style="padding: 10px 14px; background: rgba(239, 68, 68, 0.08); border-bottom: 1px solid rgba(239, 68, 68, 0.2); display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <div style="font-weight: 600; color: #f87171; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-trash-can"></i>
                        <span>Orphaned Campaign Lorebooks</span>
                        <span style="font-size: 0.8em; opacity: 0.8; font-weight: normal;">(${audit.orphanSets.length} groups · ${totalOrphanBooks} books)</span>
                    </div>
                    <i class="fa-solid fa-chevron-down" style="font-size: 0.8em; opacity: 0.7;"></i>
                </div>
                <div class="mhc-set-section-content" style="padding: 10px 14px; display: flex; flex-direction: column; gap: 12px;">
                    ${audit.orphanSets.length === 0 ? '<div style="font-size: 0.85em; opacity: 0.6; font-style: italic; color: #6ee7b7;"><i class="fa-solid fa-check"></i> Zero orphaned lorebooks detected! Your campaign sets are 100% clean.</div>' : `
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px;">
                            <label style="font-size: 0.8em; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                                <input type="checkbox" id="mhc_orphan_select_all" />
                                <span>Select All (${totalOrphanBooks} books)</span>
                            </label>
                            <button id="mhc_delete_selected_orphans_btn" class="menu_button interactable" style="font-size: 0.78em; padding: 4px 12px; display: inline-flex; align-items: center; gap: 5px; background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4); color: #fca5a5;" disabled>
                                <i class="fa-solid fa-trash"></i>
                                <span>Delete Selected</span>
                            </button>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${audit.orphanSets.map((grp, gIdx) => `
                                <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: 6px; padding: 8px 12px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <div style="display: flex; align-items: center; gap: 8px;">
                                            <input type="checkbox" class="mhc-orphan-group-cb" data-gidx="${gIdx}" />
                                            <strong style="color: #fca5a5;">${grp.title}</strong>
                                            <span style="font-size: 0.75em; opacity: 0.7;">(${grp.count} book${grp.count === 1 ? '' : 's'})</span>
                                        </div>
                                        <button class="mhc-delete-group-btn menu_button interactable" data-gidx="${gIdx}" style="font-size: 0.72em; padding: 2px 8px; background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5;">
                                            <i class="fa-solid fa-trash-can"></i> Delete Set
                                        </button>
                                    </div>
                                    <div style="display: flex; flex-direction: column; gap: 4px; padding-left: 24px;">
                                        ${grp.books.map((b, bIdx) => `
                                            <label style="font-family: monospace; font-size: 0.76em; opacity: 0.8; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                                                <input type="checkbox" class="mhc-orphan-item-cb" data-gidx="${gIdx}" data-bidx="${bIdx}" data-book="${b}" />
                                                <span>${b}</span>
                                            </label>
                                        `).join('')}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>
            </div>

            <!-- SECTION 4: PROTECTED / EXTERNAL -->
            <div class="mhc-set-section" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; overflow: hidden; flex-shrink: 0;">
                <div class="mhc-set-section-hdr" style="padding: 10px 14px; background: rgba(90, 160, 250, 0.08); border-bottom: 1px solid rgba(90, 160, 250, 0.2); display: flex; justify-content: space-between; align-items: center; cursor: pointer;">
                    <div style="font-weight: 600; color: #93c5fd; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-shield-halved"></i>
                        <span>Protected External & Standalone Lorebooks</span>
                        <span style="font-size: 0.8em; opacity: 0.8; font-weight: normal;">(${audit.protectedBooks.length} books)</span>
                    </div>
                    <i class="fa-solid fa-chevron-right" style="font-size: 0.8em; opacity: 0.7;"></i>
                </div>
                <div class="mhc-set-section-content" style="padding: 10px 14px; display: none; flex-direction: column; gap: 6px;">
                    <div style="font-size: 0.8em; opacity: 0.75; margin-bottom: 4px;">These lorebooks are preserved and locked because they belong to other character cards or standalone custom worlds.</div>
                    ${audit.protectedBooks.length === 0 ? '<div style="font-size: 0.85em; opacity: 0.6; font-style: italic;">No protected external books found.</div>' : ''}
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${audit.protectedBooks.map(b => `
                            <span style="background: rgba(90,160,250,0.12); border: 1px solid rgba(90,160,250,0.25); color: #bfdbfe; font-size: 0.78em; padding: 2px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px;">
                                <i class="fa-solid fa-lock" style="font-size: 0.75em; opacity: 0.7;"></i>
                                <span style="font-family: monospace;">${b.name}</span>
                                <span style="font-size: 0.85em; opacity: 0.6;">(${b.reason})</span>
                            </span>
                        `).join('')}
                    </div>
                </div>
            </div>
                    <div style="font-size: 0.8em; opacity: 0.75; margin-bottom: 4px;">These lorebooks are preserved and locked because they belong to other character cards or standalone custom worlds.</div>
                    ${audit.protectedBooks.length === 0 ? '<div style="font-size: 0.85em; opacity: 0.6; font-style: italic;">No protected external books found.</div>' : ''}
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${audit.protectedBooks.map(b => `
                            <span style="background: rgba(90,160,250,0.12); border: 1px solid rgba(90,160,250,0.25); color: #bfdbfe; font-size: 0.78em; padding: 2px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px;">
                                <i class="fa-solid fa-lock" style="font-size: 0.75em; opacity: 0.7;"></i>
                                <span style="font-family: monospace;">${b.name}</span>
                                <span style="font-size: 0.85em; opacity: 0.6;">(${b.reason})</span>
                            </span>
                        `).join('')}
                    </div>
                </div>
            </div>

        </div>

        <div class="mhc-modal-footer" style="border-top: 1px solid rgba(255,255,255,0.08); padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(20,21,26,0.95);">
            <button id="mhc_refresh_audit_btn" class="menu_button interactable" style="font-size: 0.8em; padding: 4px 12px; display: inline-flex; align-items: center; gap: 6px;">
                <i class="fa-solid fa-arrows-rotate"></i>
                <span>Refresh Audit</span>
            </button>
            <button class="mhc-modal-close menu_button interactable" style="font-size: 0.8em; padding: 4px 16px;">
                <span>Close</span>
            </button>
        </div>
    `;

    // ── Bind Event Listeners ──

    // Close buttons
    dialog.querySelectorAll('.mhc-modal-close').forEach(btn => {
        btn.addEventListener('click', () => dialog.closest('.mhc-modal-backdrop')?.remove());
    });

    // Refresh audit
    dialog.querySelector('#mhc_refresh_audit_btn')?.addEventListener('click', async () => {
        const btn = dialog.querySelector('#mhc_refresh_audit_btn');
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...';
        const freshAudit = await auditCampaignSets(ctx);
        renderModalContent(dialog, freshAudit, ctx);
    });

    // Collapsible accordion headers
    dialog.querySelectorAll('.mhc-set-section-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => {
            const content = hdr.nextElementSibling;
            const chevron = hdr.querySelector('.fa-chevron-down, .fa-chevron-right');
            if (content.style.display === 'none') {
                content.style.display = 'flex';
                if (chevron) { chevron.classList.remove('fa-chevron-right'); chevron.classList.add('fa-chevron-down'); }
            } else {
                content.style.display = 'none';
                if (chevron) { chevron.classList.remove('fa-chevron-down'); chevron.classList.add('fa-chevron-right'); }
            }
        });
    });

    // Checkbox synchronization for orphan selection
    const selectAllCb = dialog.querySelector('#mhc_orphan_select_all');
    const deleteSelectedBtn = dialog.querySelector('#mhc_delete_selected_orphans_btn');
    const itemCheckboxes = dialog.querySelectorAll('.mhc-orphan-item-cb');
    const groupCheckboxes = dialog.querySelectorAll('.mhc-orphan-group-cb');

    function updateDeleteSelectedBtnState() {
        const checkedCount = dialog.querySelectorAll('.mhc-orphan-item-cb:checked').length;
        if (deleteSelectedBtn) {
            deleteSelectedBtn.disabled = checkedCount === 0;
            deleteSelectedBtn.innerHTML = `<i class="fa-solid fa-trash"></i> <span>Delete Selected (${checkedCount})</span>`;
        }
        if (selectAllCb) {
            selectAllCb.checked = checkedCount > 0 && checkedCount === itemCheckboxes.length;
        }
    }

    selectAllCb?.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        itemCheckboxes.forEach(cb => { cb.checked = isChecked; });
        groupCheckboxes.forEach(cb => { cb.checked = isChecked; });
        updateDeleteSelectedBtnState();
    });

    groupCheckboxes.forEach(gCb => {
        gCb.addEventListener('change', (e) => {
            const gIdx = e.target.getAttribute('data-gidx');
            const isChecked = e.target.checked;
            dialog.querySelectorAll(`.mhc-orphan-item-cb[data-gidx="${gIdx}"]`).forEach(cb => {
                cb.checked = isChecked;
            });
            updateDeleteSelectedBtnState();
        });
    });

    itemCheckboxes.forEach(iCb => {
        iCb.addEventListener('change', (e) => {
            const gIdx = e.target.getAttribute('data-gidx');
            const siblingItems = dialog.querySelectorAll(`.mhc-orphan-item-cb[data-gidx="${gIdx}"]`);
            const checkedSiblings = dialog.querySelectorAll(`.mhc-orphan-item-cb[data-gidx="${gIdx}"]:checked`);
            const parentGCb = dialog.querySelector(`.mhc-orphan-group-cb[data-gidx="${gIdx}"]`);
            if (parentGCb) {
                parentGCb.checked = siblingItems.length === checkedSiblings.length;
            }
            updateDeleteSelectedBtnState();
        });
    });

    // Delete Group Button
    dialog.querySelectorAll('.mhc-delete-group-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const gIdx = Number(btn.getAttribute('data-gidx'));
            const group = audit.orphanSets[gIdx];
            if (!group) return;

            const confirmed = window.confirm(
                `Are you sure you want to permanently delete all ${group.count} lorebooks in the "${group.title}" orphan set?\n\n` +
                group.books.join('\n')
            );
            if (!confirmed) return;

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

            await deleteOldLorebooks(group.books, ctx);
            const freshAudit = await auditCampaignSets(ctx);
            renderModalContent(dialog, freshAudit, ctx);
        });
    });

    // Delete Selected Orphans Button
    deleteSelectedBtn?.addEventListener('click', async () => {
        const checkedItems = Array.from(dialog.querySelectorAll('.mhc-orphan-item-cb:checked'))
            .map(cb => cb.getAttribute('data-book'))
            .filter(Boolean);

        if (checkedItems.length === 0) return;

        const confirmed = window.confirm(
            `Are you sure you want to permanently delete these ${checkedItems.length} selected orphaned lorebooks?\n\n` +
            checkedItems.join('\n')
        );
        if (!confirmed) return;

        deleteSelectedBtn.disabled = true;
        deleteSelectedBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';

        await deleteOldLorebooks(checkedItems, ctx);
        const freshAudit = await auditCampaignSets(ctx);
        renderModalContent(dialog, freshAudit, ctx);
    });

    // Align Misaligned Set Button
    dialog.querySelectorAll('.mhc-align-set-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = Number(btn.getAttribute('data-index'));
            const record = audit.misalignedSets[idx];
            if (!record) return;

            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Aligning...';

            const result = await alignCampaignSetInPlace(record, ctx);
            if (typeof toastr !== 'undefined') {
                if (result.ok) toastr.success(result.message, 'Campaign Sets');
                else toastr.error(result.message, 'Campaign Sets');
            }

            const freshAudit = await auditCampaignSets(ctx);
            renderModalContent(dialog, freshAudit, ctx);
        });
    });
}

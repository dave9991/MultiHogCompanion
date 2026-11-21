/// <reference path="./types.d.ts" />
/**
 * concierge-intake-ui.js — MultiHog Companion
 *
 * Pure & DOM UI helpers for the Concierge chat stream, attachment tray,
 * Archivist Import & Commit box, quick-reply start/promote chips,
 * dynamic send/commit button state, and retry/abort classification.
 */

import {
    ConciergeLoopError,
    ConciergeTimeoutError,
    detectRepetition,
} from './concierge-connection.js';
import {
    getCurrentMode,
    getStagedCanonEntries,
    shouldBrief,
    getStagedTokenTotal,
} from './concierge-canon.js';
import { escapeHtml } from './concierge-parser.js';

/** Max chars of a failed Builder reply echoed back on retry (never feed a loop back to the model). */
export const MAX_RETRY_ECHO_CHARS = 1500;

/**
 * Append a chat bubble to `#mhc_chat_messages`.
 *
 * @param {'user'|'assistant'} role
 * @param {string} text
 * @param {string|null} [imageSrc=null]
 * @param {boolean} [hasDiagnostic=false]
 * @returns {HTMLElement|undefined}
 */
export function appendChatBubbleDom(role, text, imageSrc = null, hasDiagnostic = false) {
    if (typeof document === 'undefined') return undefined;
    const stream = document.getElementById('mhc_chat_messages');
    if (!stream) return undefined;

    const bubble = document.createElement('div');
    bubble.className = `mhc-bubble mhc-bubble-${role}`;

    let html = '';
    if (imageSrc) {
        html += `<img class="mhc-thumb-preview" src="${escapeHtml(imageSrc)}" alt="Attached Image">`;
    }

    if (text) {
        const formatted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(?!\s)([^*\n]+?)\*/g, '<i>$1</i>')
            .replace(/\n/g, '<br>');
        html += `<div>${formatted}</div>`;
    }

    if (hasDiagnostic) {
        html += `
            <div style="margin-top: 8px;">
                <button type="button" class="mhc-copy-debug-trace-btn" style="font-size: 0.78em; padding: 4px 10px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 4px; color: #ef4444; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                    📋 Copy Antigravity Debug Trace
                </button>
            </div>
        `;
    }

    bubble.innerHTML = html;
    stream.appendChild(bubble);
    stream.scrollTop = stream.scrollHeight;
    return bubble;
}

/**
 * Synchronize the Import & Commit Box visibility and state with active imports and staged canon entries.
 *
 * @param {object} [params={}]
 * @param {string[]} [params.activeImports=[]]
 * @param {boolean} [params.isImportCommitPending=false]
 * @param {string} [params.importStatusText='']
 * @param {() => void} [params.onClearPending=null]
 */
export function syncImportCommitBoxDom({
    activeImports = [],
    isImportCommitPending = false,
    importStatusText = '',
    onClearPending = null,
} = {}) {
    if (typeof $ === 'undefined') return;
    const hasImporting = activeImports.length > 0 && isImportCommitPending;
    const canonEntries = getCurrentMode() === 'archivist' ? getStagedCanonEntries() : [];
    const needsCommit = isImportCommitPending && (hasImporting || (canonEntries.length > 0 && shouldBrief()));
    if (needsCommit) {
        $('.mhc-chat-input-row').hide();
        $('#mhc_import_commit_box').show();
        if (hasImporting) {
            $('#mhc_import_commit_icon').html('<span class="mhc-spin">⏳</span>');
            $('#mhc_import_commit_status_text').text(importStatusText || `Importing ${activeImports.join(', ')}...`);
            $('#mhc_import_commit_btn').prop('disabled', true).text('⏳ Importing Lore...');
            $('#mhc_import_cancel_btn').show();
            $('#mhc_import_use_vibe_btn').hide();
        } else {
            $('#mhc_import_commit_icon').text('🗃️');
            $('#mhc_import_commit_status_text').text(`Ready: ${canonEntries.length} canon entries catalogued (~${getStagedTokenTotal()} tok). Add more files or click Commit for your setting overview.`);
            $('#mhc_import_commit_btn').prop('disabled', false).text(`✅ Commit & Review Lore (${canonEntries.length} entries)`);
            $('#mhc_import_cancel_btn').hide();
            $('#mhc_import_use_vibe_btn').show();
        }
    } else {
        if (typeof onClearPending === 'function') {
            onClearPending();
        }
        $('#mhc_import_commit_box').hide();
        $('.mhc-chat-input-row').show();
    }
}

/**
 * Render the attachment tray chips and wire removal handlers.
 *
 * @param {object} [params={}]
 * @param {Array<object>} [params.pendingAttachments=[]]
 * @param {string[]} [params.activeImports=[]]
 * @param {(idx: number) => void} [params.onRemoveAttachment=null]
 * @param {() => void} [params.onSyncImportCommitBox=null]
 * @param {() => void} [params.onUpdateSendButton=null]
 */
export function renderAttachmentTrayDom({
    pendingAttachments = [],
    activeImports = [],
    onRemoveAttachment = null,
    onSyncImportCommitBox = null,
    onUpdateSendButton = null,
} = {}) {
    if (typeof $ === 'undefined') return;
    const tray = $('#mhc_attachment_tray');
    tray.empty();

    if (!pendingAttachments.length && !activeImports.length) {
        tray.hide();
        if (typeof onSyncImportCommitBox === 'function') onSyncImportCommitBox();
        if (typeof onUpdateSendButton === 'function') onUpdateSendButton();
        return;
    }

    tray.show();

    // 1. Settled attachment chips
    pendingAttachments.forEach((att, idx) => {
        let icon = '📄';
        if (att.type === 'image') icon = '🖼️';
        if (att.type === 'char') icon = '👤';
        if (att.type === 'lore') icon = '📚';
        if (att.type === 'chat') icon = '💬';

        const tokenBadge = att.tokens ? ` <span style="opacity:0.75;font-size:0.82em;">(~${att.tokens} tok)</span>` : '';
        const chip = $(`
            <div class="mhc-chip">
                <span>${icon} ${att.name}${tokenBadge}</span>
                <span class="mhc-chip-remove" data-index="${idx}" title="Remove attachment">✕</span>
            </div>
        `);
        tray.append(chip);
    });

    // 2. Active in-progress import chips
    activeImports.forEach(label => {
        const loadingChip = $(`
            <div class="mhc-chip mhc-chip-loading" title="Processing import...">
                <span class="mhc-spin">⏳</span>
                <span>Importing <b>${label}</b>...</span>
            </div>
        `);
        tray.append(loadingChip);
    });

    $('.mhc-chip-remove').on('click', function () {
        const idx = parseInt($(this).attr('data-index'), 10);
        if (typeof onRemoveAttachment === 'function') {
            onRemoveAttachment(idx);
        }
    });

    if (typeof onSyncImportCommitBox === 'function') onSyncImportCommitBox();
    if (typeof onUpdateSendButton === 'function') onUpdateSendButton();
}

/**
 * Synchronize the Send / Commit button state, icon, and tooltip based on input & attachments.
 *
 * @param {object} [params={}]
 * @param {boolean} [params.isGenerating=false]
 * @param {number} [params.pendingAttachmentsCount=0]
 */
export function updateSendButtonStateDom({
    isGenerating = false,
    pendingAttachmentsCount = 0,
} = {}) {
    const sendBtn = typeof $ !== 'undefined' ? $('#mhc_send_btn') : null;
    if (!sendBtn || !sendBtn.length || typeof sendBtn.prop !== 'function') return;
    if (isGenerating) {
        sendBtn.prop('disabled', true);
        return;
    }
    const inputEl = $('#mhc_chat_input');
    const text = (typeof inputEl?.val === 'function' ? inputEl.val() : '')?.trim() || '';
    const attCount = Number(pendingAttachmentsCount) || 0;

    if (!text && attCount === 0) {
        sendBtn.prop('disabled', true);
        if (typeof sendBtn.text === 'function') sendBtn.text('➤');
        if (typeof sendBtn.attr === 'function') sendBtn.attr('title', 'Type a prompt or attach files to begin');
    } else if (text && attCount === 0) {
        sendBtn.prop('disabled', false);
        if (typeof sendBtn.text === 'function') sendBtn.text('➤');
        if (typeof sendBtn.attr === 'function') sendBtn.attr('title', 'Send message to Concierge');
    } else if (!text && attCount > 0) {
        sendBtn.prop('disabled', false);
        if (typeof sendBtn.text === 'function') sendBtn.text('📥');
        if (typeof sendBtn.attr === 'function') sendBtn.attr('title', `Commit ${attCount} attached source${attCount > 1 ? 's' : ''} to Concierge`);
    } else {
        sendBtn.prop('disabled', false);
        if (typeof sendBtn.text === 'function') sendBtn.text('🚀');
        if (typeof sendBtn.attr === 'function') sendBtn.attr('title', `Send message & commit ${attCount} attached source${attCount > 1 ? 's' : ''}`);
    }
}

/**
 * Clip a failed Builder reply before echoing it back for a retry. A looping/garbage reply is
 * replaced entirely so the model is never conditioned on its own degenerate output.
 *
 * @param {string} raw
 * @param {number} [maxChars=MAX_RETRY_ECHO_CHARS]
 * @returns {string}
 */
export function clipRetryEcho(raw, maxChars = MAX_RETRY_ECHO_CHARS) {
    const text = String(raw || '');
    if (detectRepetition(text)) return '[previous reply discarded: repetitive output]';
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n[…truncated]` : text;
}

/**
 * True when a generation failed because it was stopped by the user, looped, or timed out.
 *
 * @param {any} err
 * @returns {'user'|'loop'|'timeout'|null}
 */
export function classifyTurnAbort(err) {
    if (err?.name === 'AbortError') return 'user';
    if (err instanceof ConciergeLoopError || err?.name === 'ConciergeLoopError') return 'loop';
    if (err instanceof ConciergeTimeoutError || err?.name === 'ConciergeTimeoutError') return 'timeout';
    return null;
}

/**
 * Render "where to start" quick-reply chips under the latest assistant bubble.
 * Clicking a chip fills the input and triggers `onSelectStart`.
 *
 * @param {string[]} starts
 * @param {() => void} [onSelectStart=null]
 * @param {() => boolean} [isBusy=null]
 */
export function renderStartChipsDom(starts, onSelectStart = null, isBusy = null) {
    if (typeof $ === 'undefined') return;
    $('.mhc-start-chips').remove();
    if (!starts?.length) return;
    const wrap = $('<div class="mhc-start-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;"></div>');
    for (const label of starts) {
        const chip = $('<button type="button" class="mhc-chip mhc-start-chip" style="cursor:pointer;"></button>').text(`▶ ${label}`);
        chip.on('click', () => {
            if (typeof isBusy === 'function' && isBusy()) return;
            $('.mhc-start-chips').remove();
            $('#mhc_chat_input').val(`Let's start with: ${label}`);
            if (typeof onSelectStart === 'function') onSelectStart();
        });
        wrap.append(chip);
    }
    $('#mhc_chat_messages').append(wrap);
    if (typeof document !== 'undefined') {
        const box = document.getElementById('mhc_chat_messages');
        if (box) box.scrollTop = box.scrollHeight;
    }
}

/**
 * Offer one-click "pull in from Canon" chips for entries the Concierge asked to promote.
 *
 * @param {Array<{ name: string }>} found
 * @param {() => void} [onSelectPromote=null]
 * @param {() => boolean} [isBusy=null]
 */
export function renderPromoteChipsDom(found, onSelectPromote = null, isBusy = null) {
    if (typeof $ === 'undefined') return;
    $('.mhc-start-chips').remove();
    const wrap = $('<div class="mhc-start-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;"></div>');
    const chip = $('<button type="button" class="mhc-chip mhc-start-chip" style="cursor:pointer;"></button>')
        .text(`📥 Pull in from Canon: ${found.map(e => e.name).join(', ')}`);
    chip.on('click', () => {
        if (typeof isBusy === 'function' && isBusy()) return;
        $('.mhc-start-chips').remove();
        $('#mhc_chat_input').val(`Build out ${found.map(e => e.name).join(' and ')} from the canon.`);
        if (typeof onSelectPromote === 'function') onSelectPromote();
    });
    wrap.append(chip);
    $('#mhc_chat_messages').append(wrap);
    if (typeof document !== 'undefined') {
        const box = document.getElementById('mhc_chat_messages');
        if (box) box.scrollTop = box.scrollHeight;
    }
}

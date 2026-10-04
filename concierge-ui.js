/**
 * concierge-ui.js — MultiHog Companion
 *
 * Controller for the PbtA Concierge Session Zero modal interface.
 * Handles chat messaging, drag-and-drop / file attachments, live dossier updating,
 * and campaign launching.
 */

import {
    getConciergeConnectionSettings,
    updateConciergeConnectionSettings,
    sendConciergeRequest,
} from './concierge-connection.js';
import {
    readImageAsDataUrl,
    extractDocumentContent,
    formatDocumentPromptBlock,
} from './concierge-files.js';
import { buildConciergeSystemPrompt } from './concierge-prompt.js';
import {
    createEmptyDossier,
    stripConciergeStateBlocks,
    parseConciergeStateBlock,
    serializeDossierToMarkdown,
} from './concierge-parser.js';
import { launchPbtaCampaign } from './concierge-runner.js';
import { PBTA_GENRES } from './pbta-ruleset.js';

const STORAGE_DRAFT_KEY = 'mhc_pbta_concierge_draft';

let modalInitialized = false;
let activeDossier = createEmptyDossier();
let chatHistory = [];
let pendingAttachments = [];
let isGenerating = false;

/**
 * Ensure the modal HTML template is loaded and mounted in the document.
 */
async function ensureModalMounted() {
    if (document.getElementById('mhc_concierge_modal')) return;

    try {
        const res = await fetch('scripts/extensions/third-party/MultiHogCompanion/concierge-modal.html');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container.firstElementChild);
    } catch (err) {
        console.error('[PbtA Concierge] Could not load modal HTML template:', err);
    }
}

/**
 * Save current session draft to localStorage.
 */
function saveDraft() {
    try {
        const payload = {
            dossier: activeDossier,
            chatHistory,
            timestamp: Date.now(),
        };
        localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(payload));
    } catch (_) {}
}

/**
 * Load draft from localStorage.
 */
function loadDraft() {
    try {
        const raw = localStorage.getItem(STORAGE_DRAFT_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

/**
 * Render the Live Blueprint cards from activeDossier.
 */
function updateBlueprintDeck() {
    const meta = activeDossier.meta || {};
    const proto = activeDossier.protagonist || {};
    const monsters = activeDossier.monsters || [];
    const maps = activeDossier.maps || [];
    const kick = activeDossier.theKick || {};

    // Header Badge & System Card
    const sysLabel = meta.systemLabel || PBTA_GENRES.fantasy.label;
    $('#mhc_header_system_badge').text(`🎲 ${sysLabel}`);
    $('#mhc_deck_system_tag').text(meta.systemKey?.toUpperCase() || 'FANTASY');
    $('#mhc_deck_system_desc').text(meta.premise || `PbtA ${sysLabel} fiction-first narrative engine.`);

    // Protagonist Card
    $('#mhc_deck_char_playbook').text(proto.playbook || 'In Development');
    $('#mhc_deck_char_name').text(proto.name || 'Unnamed Adventurer');

    const statsEl = $('#mhc_deck_char_stats');
    statsEl.empty();
    const statsObj = proto.stats && Object.keys(proto.stats).length ? proto.stats : { Might: 0, Agility: 0, Wits: 0, Heart: 0, Arcana: 0 };
    for (const [sName, sVal] of Object.entries(statsObj)) {
        const sign = sVal >= 0 ? '+' : '';
        statsEl.append(`<span class="mhc-stat-pill">${sName} ${sign}${sVal}</span>`);
    }

    const movesEl = $('#mhc_deck_char_moves');
    if (proto.startingMoves && proto.startingMoves.length) {
        movesEl.html(proto.startingMoves.map(m => `<div>• <b>${m}</b></div>`).join(''));
    } else {
        movesEl.text('• Moves will be forged in the conversation.');
    }

    // Adversaries & Monsters Card
    $('#mhc_deck_monster_count').text(monsters.length);
    const mList = $('#mhc_deck_monsters_list');
    mList.empty();
    if (monsters.length) {
        monsters.forEach(m => {
            const attacks = m.attacks?.length ? m.attacks.join(', ') : 'Natural attacks';
            mList.append(`
                <div class="mhc-deck-item">
                    <div style="font-weight: bold; color: #ff9999;">👹 ${m.name}</div>
                    <div style="font-size: 0.85em; opacity: 0.85;">Harm: ${m.harm} | Armor: ${m.armor} | ${attacks}</div>
                    <div style="font-size: 0.8em; opacity: 0.75;">Weakness: ${m.weakness}</div>
                </div>
            `);
        });
    } else {
        mList.append('<div class="mhc-empty-hint">No monsters queued yet.</div>');
    }

    // Maps Card
    $('#mhc_deck_map_count').text(maps.length);
    const mapList = $('#mhc_deck_maps_list');
    mapList.empty();
    if (maps.length) {
        maps.forEach(map => {
            mapList.append(`
                <div class="mhc-deck-item">
                    <div style="display: flex; justify-content: space-between;">
                        <b>🗺️ ${map.site}</b>
                        <span class="mhc-pill" style="font-size: 0.72em;">${map.kind} · ${map.threat}</span>
                    </div>
                    <div style="font-size: 0.82em; opacity: 0.8; margin-top: 2px;">${map.briefDescription || map.prompt}</div>
                </div>
            `);
        });
    } else {
        mapList.append('<div class="mhc-empty-hint">No maps queued yet.</div>');
    }

    // Kick Card
    if (kick.crisis || kick.startingLocation) {
        $('#mhc_deck_kick_text').html(`
            <b>Start:</b> ${kick.startingLocation || 'Unknown'}<br>
            <b>Crisis:</b> ${kick.crisis || 'Imminent danger'}
        `);
    } else {
        $('#mhc_deck_kick_text').text('The starting scene and crisis will be staged here.');
    }

    // Raw Markdown Tab
    $('#mhc_raw_markdown_text').val(serializeDossierToMarkdown(activeDossier));
}

/**
 * Append a chat bubble to the message stream.
 */
function appendChatBubble(role, text, imageSrc = null) {
    const stream = document.getElementById('mhc_chat_messages');
    if (!stream) return;

    const bubble = document.createElement('div');
    bubble.className = `mhc-bubble mhc-bubble-${role}`;

    let html = '';
    if (imageSrc) {
        html += `<img class="mhc-thumb-preview" src="${imageSrc}" alt="Attached Image">`;
    }

    if (text) {
        // Basic markdown line breaks and bolding
        const formatted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
            .replace(/\*(.*?)\*/g, '<i>$1</i>')
            .replace(/\n/g, '<br>');
        html += `<div>${formatted}</div>`;
    }

    bubble.innerHTML = html;
    stream.appendChild(bubble);
    stream.scrollTop = stream.scrollHeight;
}

/**
 * Render the attachment tray chips.
 */
function renderAttachmentTray() {
    const tray = $('#mhc_attachment_tray');
    tray.empty();

    if (!pendingAttachments.length) {
        tray.hide();
        return;
    }

    tray.show();
    pendingAttachments.forEach((att, idx) => {
        const icon = att.type === 'image' ? '🖼️' : '📄';
        const chip = $(`
            <div class="mhc-chip">
                <span>${icon} ${att.name}</span>
                <span class="mhc-chip-remove" data-index="${idx}">✕</span>
            </div>
        `);
        tray.append(chip);
    });

    $('.mhc-chip-remove').on('click', function () {
        const idx = parseInt($(this).attr('data-index'), 10);
        pendingAttachments.splice(idx, 1);
        renderAttachmentTray();
    });
}

/**
 * Populate Connection dropdowns.
 */
function updateConnectionDropdowns() {
    const s = getConciergeConnectionSettings();
    const sourceSelect = $('#mhc_concierge_connection_source');
    const profileSelect = $('#mhc_concierge_profile_select');

    sourceSelect.val(s.connectionSource);

    const ctx = SillyTavern.getContext();
    const profiles = ctx.extensionSettings?.connectionManager?.profiles || [];

    profileSelect.empty();
    profileSelect.append('<option value="">-- Select Profile --</option>');
    profiles.forEach(p => {
        profileSelect.append(`<option value="${p.id}">${p.name || p.id}</option>`);
    });

    if (s.connectionSource === 'profile') {
        profileSelect.show();
        profileSelect.val(s.connectionProfileId);
    } else {
        profileSelect.hide();
    }
}

/**
 * Process a user submission.
 */
async function handleUserSend() {
    if (isGenerating) return;

    const input = $('#mhc_chat_input');
    const text = input.val().trim();
    if (!text && !pendingAttachments.length) return;

    input.val('');
    const attachmentsToProcess = [...pendingAttachments];
    pendingAttachments = [];
    renderAttachmentTray();

    // 1. Process attachments into prompt additions
    let imageSrcForDisplay = null;
    let imagePayload = null;
    let documentPromptAdditions = '';

    for (const att of attachmentsToProcess) {
        if (att.type === 'image') {
            imageSrcForDisplay = att.dataUrl;
            imagePayload = {
                type: 'image_url',
                image_url: { url: att.dataUrl },
            };
            if (!activeDossier.protagonist.portraitSrc) {
                activeDossier.protagonist.portraitSrc = att.dataUrl;
            }
        } else if (att.type === 'doc') {
            documentPromptAdditions += formatDocumentPromptBlock(att.name, att.text);
        }
    }

    const fullUserText = (text + (documentPromptAdditions ? `\n${documentPromptAdditions}` : '')).trim();

    // Display user bubble
    appendChatBubble('user', text || '(Attached inspiration)', imageSrcForDisplay);

    // Format LLM message payload
    let userMsgContent;
    if (imagePayload) {
        userMsgContent = [
            { type: 'text', text: fullUserText || 'Please analyze this inspiration image for our PbtA campaign.' },
            imagePayload,
        ];
    } else {
        userMsgContent = fullUserText;
    }

    chatHistory.push({ role: 'user', content: userMsgContent });

    // Show typing bubble
    const stream = document.getElementById('mhc_chat_messages');
    const typingBubble = document.createElement('div');
    typingBubble.className = 'mhc-bubble mhc-bubble-assistant';
    typingBubble.id = 'mhc_typing_indicator';
    typingBubble.innerHTML = '<i>🎩 The Concierge is contemplating the fiction...</i>';
    stream.appendChild(typingBubble);
    stream.scrollTop = stream.scrollHeight;

    isGenerating = true;
    $('#mhc_send_btn').prop('disabled', true);

    try {
        const fullMessages = [
            { role: 'system', content: buildConciergeSystemPrompt() },
            ...chatHistory,
        ];

        const rawResponse = await sendConciergeRequest(fullMessages);
        typingBubble.remove();

        // Parse state updates
        activeDossier = parseConciergeStateBlock(rawResponse, activeDossier);
        updateBlueprintDeck();

        // Clean text for bubble
        const cleanBubbleText = stripConciergeStateBlocks(rawResponse);
        appendChatBubble('assistant', cleanBubbleText || rawResponse);

        // Record response in history
        chatHistory.push({ role: 'assistant', content: rawResponse });
        saveDraft();
    } catch (err) {
        typingBubble.remove();
        console.error('[PbtA Concierge] Request failed:', err);
        appendChatBubble('assistant', `⚠️ **Error communicating with Concierge:** ${err.message || String(err)}`);
    } finally {
        isGenerating = false;
        $('#mhc_send_btn').prop('disabled', false);
    }
}

/**
 * Handle file input or dropped files.
 */
async function handleFilesSelected(files) {
    for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) {
            try {
                const dataUrl = await readImageAsDataUrl(file);
                pendingAttachments.push({
                    type: 'image',
                    file,
                    name: file.name,
                    dataUrl,
                });
            } catch (err) {
                toastr?.error(`Could not read image "${file.name}": ${err.message}`);
            }
        } else {
            try {
                const doc = await extractDocumentContent(file);
                pendingAttachments.push({
                    type: 'doc',
                    file,
                    name: doc.filename,
                    text: doc.text,
                });
                toastr?.info(`Extracted text from "${doc.filename}".`);
            } catch (err) {
                toastr?.error(`Could not parse document "${file.name}": ${err.message}`);
            }
        }
    }
    renderAttachmentTray();
}

/**
 * Bind modal DOM events.
 */
function bindModalEvents() {
    if (modalInitialized) return;
    modalInitialized = true;

    // Close
    $('#mhc_concierge_close').on('click', () => {
        saveDraft();
        $('#mhc_concierge_modal').fadeOut(180);
    });

    // Connection controls
    $('#mhc_concierge_connection_source').on('change', function () {
        const val = $(this).val();
        updateConciergeConnectionSettings({ conciergeConnectionSource: val });
        updateConnectionDropdowns();
    });

    $('#mhc_concierge_profile_select').on('change', function () {
        updateConciergeConnectionSettings({ conciergeConnectionProfileId: $(this).val() });
    });

    // Send on button or Enter (Shift+Enter for newline)
    $('#mhc_send_btn').on('click', handleUserSend);
    $('#mhc_chat_input').on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleUserSend();
        }
    });

    // Attachment button & file input
    $('#mhc_attach_btn').on('click', () => $('#mhc_file_input').click());
    $('#mhc_file_input').on('change', function () {
        if (this.files && this.files.length) {
            handleFilesSelected(this.files);
            this.value = '';
        }
    });

    // Drag and drop onto chat stream
    const dropArea = document.getElementById('mhc_concierge_modal');
    dropArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer?.files?.length) {
            handleFilesSelected(e.dataTransfer.files);
        }
    });

    // Tab buttons
    $('.mhc-tab-btn').on('click', function () {
        $('.mhc-tab-btn').removeClass('active');
        $('.mhc-tab-content').removeClass('active');
        $(this).addClass('active');
        const tab = $(this).attr('data-tab');
        $(`#mhc_tab_${tab}`).addClass('active');
    });

    // Copy Markdown
    $('#mhc_copy_markdown_btn').on('click', () => {
        const text = $('#mhc_raw_markdown_text').val();
        navigator.clipboard.writeText(text).then(() => {
            toastr?.success('Campaign Dossier copied to clipboard!');
        });
    });

    // Save Draft
    $('#mhc_save_draft_btn').on('click', () => {
        saveDraft();
        toastr?.success('Draft saved successfully!');
    });

    // Export Dossier
    $('#mhc_export_dossier_btn').on('click', () => {
        const text = serializeDossierToMarkdown(activeDossier);
        const filename = `${(activeDossier.meta?.title || 'pbta_campaign').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_dossier.md`;
        const blob = new Blob([text], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Reset Session
    $('#mhc_reset_session_btn').on('click', () => {
        if (!confirm('Reset current Session Zero and start fresh? All unlaunched progress will be lost.')) return;
        localStorage.removeItem(STORAGE_DRAFT_KEY);
        activeDossier = createEmptyDossier();
        chatHistory = [];
        pendingAttachments = [];
        $('#mhc_chat_messages').empty();
        renderAttachmentTray();
        updateBlueprintDeck();
        appendChatBubble('assistant', "Welcome to Session Zero! I'm your PbtA Concierge. Tell me what kind of game or adventure you'd like to play, or drop in a screenshot, character art, or lore document to inspire our world. What genre or vibe are you aiming for?");
    });

    // Finalize & Launch Campaign
    $('#mhc_launch_campaign_btn').on('click', async () => {
        const overlay = $('#mhc_launch_progress_overlay');
        const label = $('#mhc_launch_progress_label');
        const bar = $('#mhc_launch_progress_bar');

        overlay.show();
        const progressCb = (msg, pct) => {
            label.text(msg);
            bar.css('width', `${pct}%`);
        };

        const res = await launchPbtaCampaign(activeDossier, progressCb);
        setTimeout(() => {
            overlay.hide();
            if (res.success) {
                $('#mhc_concierge_modal').fadeOut(250);
                toastr?.success('PbtA Campaign ready! The game is now beginning.', 'Adventure Launched');
            } else {
                toastr?.error(`Launch error: ${res.message}`, 'Launch Failed');
            }
        }, 800);
    });
}

/**
 * Open the PbtA Concierge modal window.
 */
export async function openConciergeModal() {
    await ensureModalMounted();
    bindModalEvents();
    updateConnectionDropdowns();

    // Check for existing draft or initialize greeting
    const draft = loadDraft();
    if (draft && draft.chatHistory?.length && !chatHistory.length) {
        activeDossier = draft.dossier || activeDossier;
        chatHistory = draft.chatHistory || [];
        $('#mhc_chat_messages').empty();
        chatHistory.forEach(msg => {
            if (typeof msg.content === 'string') {
                const isAssistant = msg.role === 'assistant';
                const text = isAssistant ? stripConciergeStateBlocks(msg.content) : msg.content;
                appendChatBubble(msg.role, text);
            } else if (Array.isArray(msg.content)) {
                let text = '';
                let imgSrc = null;
                msg.content.forEach(p => {
                    if (p.type === 'text') text += p.text;
                    if (p.type === 'image_url') imgSrc = p.image_url?.url;
                });
                appendChatBubble(msg.role, text, imgSrc);
            }
        });
    } else if (!chatHistory.length) {
        $('#mhc_chat_messages').empty();
        appendChatBubble(
            'assistant',
            "Welcome to Session Zero! I'm your PbtA Concierge. Tell me what kind of game or adventure you'd like to play, or drop in a screenshot, character art, or lore document to inspire our world. What genre or vibe are you aiming for?",
        );
    }

    updateBlueprintDeck();
    $('#mhc_concierge_modal').fadeIn(200);
}

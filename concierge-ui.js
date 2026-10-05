/**
 * concierge-ui.js — MultiHog Companion
 *
 * Controller for the PbtA Concierge Session Zero modal interface.
 * Handles chat messaging, drag-and-drop / file attachments, character card & lorebook
 * imports, live dossier updating, and campaign launching.
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
    formatChatTranscriptPromptBlock,
} from './concierge-files.js';
import {
    parseCharacterFile,
    formatCharacterInspirationBlock,
    normalizeCharacterCard,
    resolveCardMacros,
    stripSillyTavernMacros,
} from './concierge-card-reader.js';
import {
    fetchWorldInfoBook,
    processLorebookForConcierge,
} from './concierge-lore-reader.js';
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
let activeImports = [];

function startImportProgress(label) {
    if (!label) return;
    activeImports.push(label);
    renderAttachmentTray();
}

function stopImportProgress(label) {
    if (!label) return;
    const idx = activeImports.indexOf(label);
    if (idx >= 0) activeImports.splice(idx, 1);
    renderAttachmentTray();
}

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
    const npcs = activeDossier.npcs || [];
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

    // Supporting Cast & Allies (NPCs) Card
    $('#mhc_deck_npc_count').text(npcs.length);
    const npcList = $('#mhc_deck_npcs_list');
    npcList.empty();
    if (npcs.length) {
        npcs.forEach(n => {
            const role = n.role || 'Ally';
            const demeanor = n.demeanor ? ` · <i>${n.demeanor}</i>` : '';
            const app = n.appearance ? `<div style="font-size: 0.8em; opacity: 0.85;"><b>Look:</b> ${n.appearance}</div>` : '';
            const rel = n.relationship ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Bond:</b> ${n.relationship}</div>` : '';
            const boons = n.movesOrBoons ? `<div style="font-size: 0.8em; opacity: 0.75;"><b>Boons/Moves:</b> ${n.movesOrBoons}</div>` : '';
            npcList.append(`
                <div class="mhc-deck-item">
                    <div style="font-weight: bold; color: var(--mhc-accent, #3b82f6);">👤 ${n.name} <span class="mhc-pill" style="font-size: 0.72em;">${role}</span>${demeanor}</div>
                    ${app}
                    ${rel}
                    ${boons}
                </div>
            `);
        });
    } else {
        npcList.append('<div class="mhc-empty-hint">No supporting NPCs queued yet.</div>');
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
                    <div style="font-weight: bold; color: var(--mhc-danger, #ef4444);">👹 ${m.name}</div>
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

    if (!pendingAttachments.length && !activeImports.length) {
        tray.hide();
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

        const chip = $(`
            <div class="mhc-chip">
                <span>${icon} ${att.name}</span>
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
 * Populate the Character and Lorebook inspiration dropdowns.
 */
function populateInspirationDropdowns() {
    const ctx = SillyTavern.getContext();

    // 1. ST Characters
    const chars = ctx.characters || [];
    const charSelect = $('#mhc_st_char_select');
    charSelect.empty();
    charSelect.append('<option value="">-- Choose Character --</option>');
    chars.forEach((c, idx) => {
        if (c?.name) {
            charSelect.append(`<option value="${idx}">${c.name}</option>`);
        }
    });

    // 2. ST Lorebooks
    const loreSelect = $('#mhc_st_lore_select');
    loreSelect.empty();
    loreSelect.append('<option value="">-- Choose Lorebook --</option>');

    let bookNames = [];
    if (Array.isArray(window.world_names)) {
        bookNames = window.world_names;
    } else {
        $('#world_info option').each(function () {
            const txt = $(this).text().trim();
            if (txt && !bookNames.includes(txt)) bookNames.push(txt);
        });
    }

    bookNames.forEach(b => {
        loreSelect.append(`<option value="${b}">${b}</option>`);
    });
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
            documentPromptAdditions += formatDocumentPromptBlock(att.name, att.text, 5000, activeDossier?.protagonist?.name || '');
        } else if (att.type === 'char') {
            if (att.avatar && !imageSrcForDisplay) {
                imageSrcForDisplay = att.avatar;
            }
            if (att.avatar && !activeDossier.protagonist.portraitSrc) {
                activeDossier.protagonist.portraitSrc = att.avatar;
            }
            documentPromptAdditions += `\n${att.promptAddition}\n`;
        } else if (att.type === 'chat') {
            documentPromptAdditions += formatChatTranscriptPromptBlock(att.chatData, att.name, 40, activeDossier?.protagonist?.name || '');
        } else if (att.type === 'lore') {
            documentPromptAdditions += `\n${att.promptAddition}\n`;
        }
    }

    const rawUserText = (text + (documentPromptAdditions ? `\n${documentPromptAdditions}` : '')).trim();
    const fullUserText = resolveCardMacros(rawUserText, activeDossier?.protagonist?.name || '');

    // Display user bubble
    appendChatBubble('user', text || '(Provided inspiration details)', imageSrcForDisplay);

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
            { role: 'system', name: 'System', content: buildConciergeSystemPrompt() },
            ...chatHistory.map(m => ({
                role: m.role,
                name: m.role === 'assistant' ? 'PbtA_Concierge' : 'Player',
                content: m.content,
            })),
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
        startImportProgress(file.name);
        try {
            // 1. Try Character Card (PNG metadata or JSON)
            let handledAsCard = false;
            try {
                const card = await parseCharacterFile(file);
                if (card) {
                    handledAsCard = true;
                    pendingAttachments.push({
                        type: 'char',
                        name: card.name,
                        card,
                        promptAddition: formatCharacterInspirationBlock(card),
                        avatar: card.avatar,
                    });
                    toastr?.success(`Imported character: "${card.name}".`);

                    // If character card embeds a world book, import that too!
                    if (card.characterBook) {
                        startImportProgress(`${card.name}'s Worldbook`);
                        try {
                            const loreRes = await processLorebookForConcierge(`${card.name}'s Lorebook`, card.characterBook, () => {}, card.name);
                            pendingAttachments.push({
                                type: 'lore',
                                name: `${card.name}'s Lorebook`,
                                promptAddition: loreRes.block,
                                mode: loreRes.mode,
                            });
                            toastr?.info(`Imported embedded worldbook for "${card.name}".`);
                        } catch (_) {}
                        finally {
                            stopImportProgress(`${card.name}'s Worldbook`);
                        }
                    }
                    renderAttachmentTray();
                    continue;
                }
            } catch (_) {}

            if (handledAsCard) continue;

            // 2. Try Lorebook JSON (has entries)
            if (file.name.endsWith('.json')) {
                let handledAsLore = false;
                try {
                    const text = await file.text();
                    const json = JSON.parse(text);
                    if (json.entries && (typeof json.entries === 'object' || Array.isArray(json.entries))) {
                        handledAsLore = true;
                        const loreRes = await processLorebookForConcierge(
                            file.name.replace(/\.json$/i, ''),
                            json,
                            msg => toastr?.info(msg),
                            activeDossier?.protagonist?.name || '',
                        );
                        pendingAttachments.push({
                            type: 'lore',
                            name: file.name.replace(/\.json$/i, ''),
                            promptAddition: loreRes.block,
                            mode: loreRes.mode,
                        });
                        toastr?.success(`Imported lorebook: "${file.name}" (${loreRes.mode === 'synthesized' ? 'Synthesized' : 'Direct'}).`);
                        renderAttachmentTray();
                        continue;
                    }
                } catch (_) {}
                if (handledAsLore) continue;
            }

            // 3. Fallback to image or document
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
                    if (doc.type === 'chat') {
                        pendingAttachments.push({
                            type: 'chat',
                            file,
                            name: doc.chatData?.charName ? `${doc.chatData.charName} (Chat)` : doc.filename,
                            chatData: doc.chatData,
                        });
                        toastr?.success(`Imported prior chat log: "${doc.chatData?.charName || doc.filename}" (${doc.chatData?.messages?.length || 0} messages).`);
                    } else {
                        pendingAttachments.push({
                            type: 'doc',
                            file,
                            name: doc.filename,
                            text: doc.text,
                        });
                        toastr?.info(`Extracted text from "${doc.filename}".`);
                    }
                } catch (err) {
                    toastr?.error(`Could not parse document "${file.name}": ${err.message}`);
                }
            }
        } finally {
            stopImportProgress(file.name);
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

    // Inspiration Toolbar: ST Character Picker
    $('#mhc_pick_st_char_btn').on('click', () => {
        $('#mhc_st_char_select').toggle();
    });

    $('#mhc_st_char_select').on('change', async function () {
        const idx = $(this).val();
        if (idx === '') return;
        $(this).hide();
        $(this).val('');

        const ctx = SillyTavern.getContext();
        const rawChar = ctx.characters?.[idx];
        if (!rawChar) return;

        const charLabel = rawChar.name || 'Character';
        startImportProgress(charLabel);
        try {
            const avatarUrl = rawChar.avatar ? `/characters/${encodeURIComponent(rawChar.avatar)}` : null;
            const card = normalizeCharacterCard(rawChar, avatarUrl);
            if (!card) return;

            pendingAttachments.push({
                type: 'char',
                name: card.name,
                card,
                promptAddition: formatCharacterInspirationBlock(card),
                avatar: card.avatar,
            });
            renderAttachmentTray();
            toastr?.success(`Imported character: "${card.name}".`);

            if (card.characterBook) {
                startImportProgress(`${card.name}'s Worldbook`);
                try {
                    const loreRes = await processLorebookForConcierge(`${card.name}'s Lorebook`, card.characterBook, () => {}, card.name);
                    pendingAttachments.push({
                        type: 'lore',
                        name: `${card.name}'s Lorebook`,
                        promptAddition: loreRes.block,
                        mode: loreRes.mode,
                    });
                    renderAttachmentTray();
                    toastr?.info(`Imported embedded worldbook for "${card.name}".`);
                } catch (_) {}
                finally {
                    stopImportProgress(`${card.name}'s Worldbook`);
                }
            }
        } finally {
            stopImportProgress(charLabel);
        }
    });

    // Inspiration Toolbar: ST Lorebook Picker
    $('#mhc_pick_st_lore_btn').on('click', () => {
        $('#mhc_st_lore_select').toggle();
    });

    $('#mhc_st_lore_select').on('change', async function () {
        const bookName = $(this).val();
        if (!bookName) return;
        $(this).hide();
        $(this).val('');

        startImportProgress(bookName);
        try {
            toastr?.info(`Loading lorebook "${bookName}"...`);
            const bookData = await fetchWorldInfoBook(bookName);
            if (!bookData) {
                toastr?.error(`Could not load lorebook "${bookName}".`);
                return;
            }

            const loreRes = await processLorebookForConcierge(bookName, bookData, msg => toastr?.info(msg), activeDossier?.protagonist?.name || '');
            pendingAttachments.push({
                type: 'lore',
                name: bookName,
                promptAddition: loreRes.block,
                mode: loreRes.mode,
            });
            renderAttachmentTray();
            toastr?.success(`Imported lorebook: "${bookName}" (${loreRes.mode === 'synthesized' ? 'Synthesized' : 'Direct'}).`);
        } catch (err) {
            toastr?.error(`Lorebook import failed: ${err.message}`);
        } finally {
            stopImportProgress(bookName);
        }
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
    dropArea.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    dropArea.addEventListener('drop', e => {
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
                localStorage.removeItem(STORAGE_DRAFT_KEY);
                $('#mhc_concierge_modal').fadeOut(250);
                toastr?.success('PbtA Campaign ready! The game is now beginning.', 'Adventure Launched');
            } else {
                toastr?.error(`Launch error: ${res.message}`, 'Launch Failed');
            }
        }, 600);
    });
}

/**
 * Open the PbtA Concierge modal window.
 */
export async function openConciergeModal() {
    await ensureModalMounted();
    bindModalEvents();
    updateConnectionDropdowns();
    populateInspirationDropdowns();

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

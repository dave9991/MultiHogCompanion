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
import {
    buildConciergeSystemPrompt,
    buildConciergeBuilderContext,
    buildConciergeTalkerContext,
} from './concierge-prompt.js';
import {
    createEmptyDossier,
    stripConciergeStateBlocks,
    parseConciergeStateBlock,
    applyDossierUpdates,
    formatDossierForContext,
    formatChangelogForContext,
    serializeDossierToMarkdown,
    classifyBuilderReport,
    buildTalkerInstructionNotice,
    formatDiagnosticTrace as formatDiagnosticTraceParser,
} from './concierge-parser.js';
import { launchPbtaCampaign } from './concierge-runner.js';
import { PBTA_GENRES } from './pbta-ruleset.js';
import { buildNameRagSeedsForConcierge, resolveDossierNamePlaceholders } from './namerag-hooks.js';
import { extension_settings } from '../../../extensions.js';

const STORAGE_DRAFT_KEY = 'mhc_pbta_concierge_draft';

let modalInitialized = false;
let activeDossier = createEmptyDossier();
let chatHistory = [];
let changelog = [];
let pendingAttachments = [];
let isGenerating = false;
let activeImports = [];
let activeNameRagSeeds = '';

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
            changelog,
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
    const campTitle = (meta.title || '').trim() || 'Untitled PbtA Campaign';
    $('#mhc_deck_campaign_title').text(campTitle);
    $('#mhc_deck_system_desc').text(meta.premise || `PbtA ${sysLabel} fiction-first narrative engine.`);
    if (meta.tone) {
        $('#mhc_deck_system_tone_text').text(meta.tone);
        $('#mhc_deck_system_tone').show();
    } else {
        $('#mhc_deck_system_tone').hide();
    }

    // Campaign Calibration Dials Card
    const cfg = activeDossier.config || {};
    const playstyle = cfg.playstyle || 'cyoa_5';
    let playstyleLabel = 'CYOA (5 Choices)';
    if (playstyle === 'freeform') playstyleLabel = 'Pure Freeform (No Choices)';
    else if (playstyle === 'cyoa_3') playstyleLabel = 'CYOA (3 Choices)';
    $('#mhc_deck_dial_playstyle').text(playstyleLabel);

    const harmMax = cfg.harmMax || 5;
    let harmTag = '(Standard)';
    if (harmMax === 3) harmTag = '(Gritty)';
    else if (harmMax === 4) harmTag = '(Tense)';
    else if (harmMax === 6) harmTag = '(Pulp)';
    $('#mhc_dial_harm_btn').text(`❤️ Harm: ${harmMax} ${harmTag}`);

    const partyMode = cfg.partyMode || 'squad';
    const partyLabel = partyMode.charAt(0).toUpperCase() + partyMode.slice(1);
    $('#mhc_dial_party_btn').text(`👥 Party: ${partyLabel}`);

    const emojisOn = cfg.cyoaEmojis !== false;
    $('#mhc_dial_emojis_btn').text(`✨ Emojis: ${emojisOn ? 'On' : 'Off'}`);

    const simDepth = cfg.simulationDepth || 'active_fronts';
    let simLabel = 'Active Fronts';
    if (simDepth === 'living_world') simLabel = 'Living World';
    else if (simDepth === 'static') simLabel = 'Static Solo';
    $('#mhc_dial_sim_depth_btn').text(`🌍 Sim: ${simLabel}`);

    const relsOn = cfg.relationships !== false;
    $('#mhc_dial_relationships_btn').text(`🤝 Relations: ${relsOn ? 'On' : 'Off'}`).css('opacity', relsOn ? '1' : '0.65');

    if (cfg.artStyle) {
        $('#mhc_deck_dial_art_text').text(cfg.artStyle);
        $('#mhc_deck_dial_art').show();
    } else {
        $('#mhc_deck_dial_art').hide();
    }

    // World Axioms & Laws Card
    const worldRules = activeDossier.worldRules || { axioms: [], customModule: null };
    const axioms = worldRules.axioms || [];
    $('#mhc_deck_world_rules_count').text(axioms.length);
    const wrList = $('#mhc_deck_world_rules_list');
    wrList.empty();
    if (axioms.length) {
        axioms.forEach(ax => {
            const cat = (ax.category || 'physics').toLowerCase();
            let catColor = 'rgba(156, 163, 175, 0.4)';
            if (cat.includes('bio')) catColor = 'rgba(16, 185, 129, 0.4)';
            else if (cat.includes('magic')) catColor = 'rgba(168, 85, 247, 0.4)';
            else if (cat.includes('physic')) catColor = 'rgba(56, 189, 248, 0.4)';
            else if (cat.includes('social')) catColor = 'rgba(245, 158, 11, 0.4)';

            const subsHtml = ax.substitutions?.length
                ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;"><b>Substitutions:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.substitutions.map(s => `<li>🔄 ${escapeHtml(s)}</li>`).join('')}</ul></div>`
                : '';
            const negHtml = ax.negativeConstraints?.length
                ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.9;"><b>Banned & Absences:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${ax.negativeConstraints.map(nc => `<li>🚫 <span class="mhc-constraint-banned">${escapeHtml(nc)}</span></li>`).join('')}</ul></div>`
                : '';
            const archHtml = ax.architecturalNotes
                ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;">🏛️ <b>Infrastructure:</b> ${escapeHtml(ax.architecturalNotes)}</div>`
                : '';

            wrList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title" style="color: #10b981;">
                            🌐 ${escapeHtml(ax.title || 'World Law')} <span class="mhc-pill" style="font-size: 0.72em; border-color: ${catColor};">${escapeHtml(ax.category || 'physics').toUpperCase()}</span>
                        </div>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        <div style="font-size: 0.85em; opacity: 0.95; margin-bottom: 4px;"><b>Axiom:</b> ${escapeHtml(ax.axiom || '')}</div>
                        ${subsHtml}
                        ${negHtml}
                        ${archHtml}
                    </div>
                </div>
            `);
        });
    } else {
        wrList.append('<div class="mhc-empty-hint">Standard world physics & tropes apply.</div>');
    }

    // Custom HUD Tracker Module Card
    const customMod = worldRules.customModule;
    if (customMod && (customMod.fieldKey || customMod.label)) {
        $('#mhc_deck_custom_module_tag').text((customMod.fieldKey || 'CUSTOM').toUpperCase());
        $('#mhc_deck_custom_module_label').text(customMod.label || customMod.fieldKey);
        $('#mhc_deck_custom_module_instruction').text(customMod.instruction || '');
        if (customMod.sample) {
            $('#mhc_deck_custom_module_sample').text(customMod.sample).show();
        } else {
            $('#mhc_deck_custom_module_sample').hide();
        }
        $('#mhc_deck_custom_module_card').show();
    } else {
        $('#mhc_deck_custom_module_card').hide();
    }

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

            let relControls = '';
            if (relsOn) {
                const fVal = n.friendship ?? 0;
                const aVal = n.affection ?? 0;
                const fSign = fVal >= 0 ? '+' : '';
                const aSign = aVal >= 0 ? '+' : '';
                relControls = `
                    <div class="mhc-npc-rel-controls" style="margin-top: 6px; padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 0.78em;">
                            <span style="color: #4ade80;">🤝 Friendship: <b class="mhc-rel-val-friendship">${fSign}${fVal}</b></span>
                            <input type="range" class="mhc-npc-rel-slider" data-npc="${encodeURIComponent(n.name)}" data-axis="friendship" min="-150" max="150" step="5" value="${fVal}" style="flex: 1; max-width: 130px; height: 3px; accent-color: #4ade80; cursor: pointer;">
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.78em;">
                            <span style="color: #f472b6;">💗 Affection: <b class="mhc-rel-val-affection">${aSign}${aVal}</b></span>
                            <input type="range" class="mhc-npc-rel-slider" data-npc="${encodeURIComponent(n.name)}" data-axis="affection" min="-150" max="150" step="5" value="${aVal}" style="flex: 1; max-width: 130px; height: 3px; accent-color: #f472b6; cursor: pointer;">
                        </div>
                    </div>
                `;
            }

            npcList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title" style="color: var(--mhc-accent, #3b82f6);">
                            👤 ${n.name} <span class="mhc-pill" style="font-size: 0.72em;">${role}</span>${demeanor}
                        </div>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        ${app}
                        ${rel}
                        ${relControls}
                        ${boons}
                    </div>
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
            const moves = m.moves?.length ? m.moves.join('; ') : '';
            const movesLine = moves ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Moves:</b> ${moves}</div>` : '';
            const doomBadge = m.impendingDoom?.length
                ? `<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(245, 158, 11, 0.4); color: #f59e0b;" title="Active Countdown Front / Impending Doom">⏳ Clock: ${m.impendingDoom.length}</span>`
                : '';
            const doomLine = m.impendingDoom?.length
                ? `<div style="font-size: 0.8em; margin-top: 4px; opacity: 0.85;"><b>⏳ Impending Doom:</b><ul style="margin: 2px 0 0 16px; padding: 0;">${m.impendingDoom.map(d => `<li>${d}</li>`).join('')}</ul></div>`
                : '';
            mList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title" style="color: var(--mhc-danger, #ef4444);">
                            👹 ${m.name} <span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(239, 68, 68, 0.4);">Harm: ${m.harm} | Armor: ${m.armor}</span> ${doomBadge}
                        </div>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        <div style="font-size: 0.85em; opacity: 0.85;"><b>Attacks:</b> ${attacks}</div>
                        <div style="font-size: 0.8em; opacity: 0.75;"><b>Weakness:</b> ${m.weakness || 'None specified'}</div>
                        ${movesLine}
                        ${doomLine}
                    </div>
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
        const startSiteName = (kick?.startingLocation || maps[0]?.site || '').toLowerCase().trim();
        maps.forEach(map => {
            const desc = map.briefDescription || map.prompt || '';
            const entrance = map.entrance ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Entrance:</b> ${map.entrance}</div>` : '';
            const features = map.features?.length ? `<div style="font-size: 0.8em; opacity: 0.8; margin-top: 4px;"><b>Features:</b> ${map.features.join(', ')}</div>` : '';
            const isPrimary = (map.site || '').toLowerCase().trim() === startSiteName;
            const stageBadge = isPrimary
                ? '<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;" title="Starting location: Generated immediately at launch">⭐ Starting Site</span>'
                : '<span class="mhc-pill" style="font-size: 0.72em; opacity: 0.75;" title="Queued in Locations lorebook for lazy on-entry generation">📦 Staged for Entry</span>';
            mapList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title">
                            🗺️ ${map.site} <span class="mhc-pill" style="font-size: 0.72em;">${map.kind || 'Site'} · ${map.threat || 'Threat'}</span> ${stageBadge}
                        </div>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        ${entrance}
                        <div style="font-size: 0.82em; opacity: 0.85;">${desc}</div>
                        ${features}
                    </div>
                </div>
            `);
        });
    } else {
        mapList.append('<div class="mhc-empty-hint">No maps queued yet.</div>');
    }

    // Factions & Powers Card
    const factions = activeDossier.factions || [];
    $('#mhc_deck_faction_count').text(factions.length);
    const fList = $('#mhc_deck_factions_list');
    if (fList.length) {
        fList.empty();
        if (factions.length) {
            factions.forEach(f => {
                const standing = f.standing || 'Neutral';
                let badgeColor = 'rgba(156, 163, 175, 0.4)';
                if (/friendly|allied|ally/i.test(standing)) badgeColor = 'rgba(34, 197, 94, 0.4)';
                else if (/hostile|enemy/i.test(standing)) badgeColor = 'rgba(239, 68, 68, 0.4)';
                const notes = f.notes ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Notes:</b> ${f.notes}</div>` : '';
                fList.append(`
                    <div class="mhc-deck-item collapsible">
                        <div class="mhc-deck-item-header">
                            <div class="mhc-deck-item-title" style="color: var(--mhc-warning, #f59e0b);">
                                🚩 ${f.name} <span class="mhc-pill" style="font-size: 0.72em; border-color: ${badgeColor};">${standing}</span>
                            </div>
                            <span class="mhc-deck-item-toggle">▼</span>
                        </div>
                        <div class="mhc-deck-item-detail">
                            <div style="font-size: 0.85em; opacity: 0.85;"><b>Agenda:</b> ${f.agenda || 'Unstated'}</div>
                            ${notes}
                        </div>
                    </div>
                `);
            });
        } else {
            fList.append('<div class="mhc-empty-hint">No factions queued yet.</div>');
        }
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
function appendChatBubble(role, text, imageSrc = null, hasDiagnostic = false) {
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
    const displayUserText = text || '(Provided inspiration details)';
    appendChatBubble('user', displayUserText, imageSrcForDisplay);

    // Format LLM message payload
    let userMsgLlmContent;
    if (imagePayload) {
        userMsgLlmContent = [
            { type: 'text', text: fullUserText || 'Please analyze this inspiration image for our PbtA campaign.' },
            imagePayload,
        ];
    } else {
        userMsgLlmContent = fullUserText;
    }

    chatHistory.push({
        role: 'user',
        content: displayUserText,
        displayContent: displayUserText,
        llmContent: userMsgLlmContent,
        imageSrc: imageSrcForDisplay,
    });

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
        if (!activeNameRagSeeds && extension_settings?.multihog_companion?.nameRagEnhanceConcierge !== false && extension_settings?.multihog_companion?.enableNameRag !== false) {
            try {
                activeNameRagSeeds = await buildNameRagSeedsForConcierge({
                    genre: activeDossier?.meta?.systemKey || activeDossier?.meta?.system || 'fantasy',
                    premise: activeDossier?.meta?.premise || '',
                    limit: 8,
                });
            } catch (_) {}
        }

        const formatHistoryMessage = (m) => {
            if (m.role === 'assistant') {
                const cleanContent = stripConciergeStateBlocks(m.content) || m.content;
                const reportPrefix = m.builderReport ? `[BUILDER_REPORT: ${m.builderReport}]\n\n` : '';
                return {
                    role: 'assistant',
                    name: 'PbtA_Concierge',
                    content: `${reportPrefix}${cleanContent}`,
                };
            }
            return {
                role: m.role,
                name: 'Player',
                content: m.llmContent ?? m.content,
            };
        };

        const typingEl = document.getElementById('mhc_typing_indicator');

        // ── Stage 1: The Builder (State Machine / Extractor) ───────────────
        if (typingEl) {
            typingEl.innerHTML = '<i>🎩 The Concierge is inspecting the blueprint...</i>';
        }

        const builderMessages = [
            {
                role: 'system',
                name: 'System',
                content: buildConciergeBuilderContext(activeDossier, changelog, activeNameRagSeeds),
            },
            ...chatHistory.map(formatHistoryMessage),
        ];

        let builderAttempts = 0;
        const maxBuilderAttempts = 2;
        let builderRawResponse = '';
        let builderReport = null;
        let builderFailed = false;
        let currentBuilderMessages = [...builderMessages];
        const diagnosticAttempts = [];

        let latestNameRagResolutions = [];

        while (builderAttempts < maxBuilderAttempts) {
            builderAttempts++;
            builderRawResponse = await sendConciergeRequest(currentBuilderMessages);
            const preNameRagResponse = builderRawResponse;
            let turnNameRagResolutions = [];

            // Resolve unique Name Diversity placeholders ([[NAME:...]]) via NameRAG before parsing
            if (extension_settings?.multihog_companion?.enableNameRag !== false) {
                try {
                    const resolved = await resolveDossierNamePlaceholders(builderRawResponse, activeDossier, { returnDetails: true });
                    builderRawResponse = resolved.text;
                    turnNameRagResolutions = resolved.resolutions || [];
                    if (turnNameRagResolutions.length > 0) {
                        latestNameRagResolutions = turnNameRagResolutions;
                    }
                } catch (resErr) {
                    console.warn('[MultiHog Companion] Placeholder name resolution error:', resErr);
                }
            }

            builderReport = applyDossierUpdates(builderRawResponse, activeDossier);

            diagnosticAttempts.push({
                attempt: builderAttempts,
                rawResponse: builderRawResponse,
                rawResponseBeforeNameRag: preNameRagResponse,
                nameRagResolutions: turnNameRagResolutions,
                errors: builderReport.errors,
                hasMutations: builderReport.hasMutations,
                isNoop: builderReport.isNoop,
                builderSummary: builderReport.builderSummary,
                report: builderReport,
            });

            if (builderReport.hasMutations || builderReport.isNoop) {
                break;
            }

            // If syntax errors occurred and attempts remain, retry with error feedback
            if (builderAttempts < maxBuilderAttempts && builderReport.errors.length > 0) {
                if (typingEl) {
                    typingEl.innerHTML = '<i>🎩 The Concierge is recalibrating the blueprint...</i>';
                }
                currentBuilderMessages = [
                    ...builderMessages,
                    { role: 'assistant', name: 'PbtA_Builder', content: builderRawResponse },
                    {
                        role: 'system',
                        name: 'System',
                        content: `[PARSER_ERROR: Blueprint update contained errors: ${builderReport.errors.join('; ')}. Please correct these syntax errors and re-emit the [UPDATE_DOSSIER] block.]`,
                    },
                ];
            } else if (builderAttempts < maxBuilderAttempts && !builderReport.hasMutations && !builderReport.isNoop) {
                if (typingEl) {
                    typingEl.innerHTML = '<i>🎩 The Concierge is recalibrating the blueprint...</i>';
                }
                currentBuilderMessages = [
                    ...builderMessages,
                    { role: 'assistant', name: 'PbtA_Builder', content: builderRawResponse },
                    {
                        role: 'system',
                        name: 'System',
                        content: `[PARSER_ERROR: No [UPDATE_DOSSIER] or [NOOP] block found in output. You must emit either an [UPDATE_DOSSIER] block containing blueprint directives or a [NOOP] block.]`,
                    },
                ];
            }
        }

        const finalStatus = classifyBuilderReport(builderReport);
        builderFailed = (finalStatus === 'SYNTAX_ERROR' || finalStatus === 'UNRECOGNIZED_OUTPUT');

        let builderSummaryText = '';
        if (finalStatus === 'MUTATED') {
            activeDossier = builderReport.updatedDossier;
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            builderReport.changes.forEach(c => changelog.push(`[${timeStr}] ${c}`));
            updateBlueprintDeck();
            saveDraft();
            builderSummaryText = builderReport.builderSummary || builderReport.changes.join('; ') || 'Blueprint updated';
        } else if (finalStatus === 'NOOP') {
            builderSummaryText = `NOOP (${builderReport.builderSummary || 'No blueprint changes requested'})`;
        } else if (finalStatus === 'SYNTAX_ERROR') {
            builderSummaryText = `SYNTAX_ERROR: ${builderReport.errors.join('; ')}`;
        } else {
            builderSummaryText = `UNRECOGNIZED_OUTPUT: No [UPDATE_DOSSIER] or [NOOP] block detected.`;
        }

        const transactionRecord = {
            timestamp: new Date().toISOString(),
            systemEngine: activeDossier?.meta?.systemKey || 'fantasy',
            userPrompt: displayUserText,
            builderRequest: {
                messages: currentBuilderMessages,
            },
            attempts: diagnosticAttempts,
            finalStatus,
            builderSummary: builderSummaryText,
            nameRagResolutions: latestNameRagResolutions,
            activeDossierSnapshot: JSON.parse(JSON.stringify(activeDossier)),
        };
        window._mhcLastBuilderTransaction = transactionRecord;
        window._lastConciergeBuilderDiagnostic = transactionRecord;
        renderDebugInspectorView(transactionRecord);

        // ── Stage 2: The Talker (Conversational Session Zero GM) ───────────
        if (typingEl) {
            typingEl.innerHTML = '<i>🎩 The Concierge is contemplating the fiction...</i>';
        }

        const talkerInstruction = buildTalkerInstructionNotice(finalStatus, builderSummaryText, builderReport?.errors);

        const talkerMessages = [
            {
                role: 'system',
                name: 'System',
                content: buildConciergeTalkerContext(activeDossier, changelog, activeNameRagSeeds),
            },
            ...chatHistory.map(formatHistoryMessage),
            {
                role: 'system',
                name: 'System',
                content: talkerInstruction,
            },
        ];

        let finalChatBubbleText = '';
        try {
            const talkerResponse = await sendConciergeRequest(talkerMessages);
            finalChatBubbleText = stripConciergeStateBlocks(talkerResponse) || talkerResponse;
        } catch (talkerErr) {
            console.warn('[PbtA Concierge] Talker error, falling back to basic response:', talkerErr);
            finalChatBubbleText = builderSummaryText ? `I have noted: ${builderSummaryText}` : 'Could not generate conversational response.';
        }

        typingBubble.remove();

        // Render clean bubble to the user (with debug trace button if failure occurred)
        appendChatBubble('assistant', finalChatBubbleText, null, Boolean(builderFailed));

        // Record clean conversation text and builder report in history
        chatHistory.push({
            role: 'assistant',
            content: finalChatBubbleText,
            builderReport: builderSummaryText,
        });
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

    // Campaign Title manual edit interaction
    $('#mhc_deck_edit_title_btn, #mhc_deck_campaign_title').on('click', () => {
        const currentTitle = activeDossier.meta?.title === 'Untitled PbtA Campaign' ? '' : (activeDossier.meta?.title || '');
        const newTitle = window.prompt('Enter campaign title (2-3 words recommended):', currentTitle);
        if (newTitle !== null) {
            const clean = newTitle.trim().replace(/[\\/:*?"<>|]/g, '');
            if (clean) {
                activeDossier.meta = activeDossier.meta || {};
                activeDossier.meta.title = clean;
                changelog.push(`Renamed campaign title to "${clean}"`);
                updateBlueprintDeck();
                saveDraft();
            }
        }
    });

    // Campaign Calibration Dial click interactions (manual cycling)
    $('#mhc_deck_dial_playstyle').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.playstyle || 'cyoa_5';
        const cycle = { 'cyoa_5': 'cyoa_3', 'cyoa_3': 'freeform', 'freeform': 'cyoa_5' };
        activeDossier.config.playstyle = cycle[current] || 'cyoa_5';
        changelog.push(`Toggled playstyle to ${activeDossier.config.playstyle}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_harm_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.harmMax || 5;
        const cycle = { 5: 3, 3: 4, 4: 6, 6: 5 };
        const nextHarm = cycle[current] || 5;
        activeDossier.config.harmMax = nextHarm;
        if (activeDossier.protagonist) {
            activeDossier.protagonist.harm = activeDossier.protagonist.harm || {};
            if (typeof activeDossier.protagonist.harm === 'object') {
                activeDossier.protagonist.harm.max = nextHarm;
            } else {
                activeDossier.protagonist.harm = { current: 0, max: nextHarm };
            }
        }
        changelog.push(`Toggled Harm capacity to ${activeDossier.config.harmMax}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_party_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.partyMode || 'squad';
        const cycle = { 'squad': 'solo', 'solo': 'duo', 'duo': 'squad' };
        activeDossier.config.partyMode = cycle[current] || 'squad';
        changelog.push(`Toggled party mode to ${activeDossier.config.partyMode}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_emojis_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        activeDossier.config.cyoaEmojis = activeDossier.config.cyoaEmojis === false ? true : false;
        changelog.push(`Toggled choice emojis to ${activeDossier.config.cyoaEmojis ? 'On' : 'Off'}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_sim_depth_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        const current = activeDossier.config.simulationDepth || 'active_fronts';
        const cycle = { 'active_fronts': 'living_world', 'living_world': 'static', 'static': 'active_fronts' };
        activeDossier.config.simulationDepth = cycle[current] || 'active_fronts';
        const label = activeDossier.config.simulationDepth === 'static' ? 'Static Solo' : activeDossier.config.simulationDepth === 'living_world' ? 'Living World' : 'Active Fronts';
        changelog.push(`Toggled simulation depth to ${label}`);
        updateBlueprintDeck();
        saveDraft();
    });

    $('#mhc_dial_relationships_btn').on('click', () => {
        activeDossier.config = activeDossier.config || {};
        activeDossier.config.relationships = activeDossier.config.relationships === false ? true : false;
        changelog.push(`Toggled NPC relationships to ${activeDossier.config.relationships ? 'On' : 'Off'}`);
        updateBlueprintDeck();
        saveDraft();
    });

    // NPC relationship slider adjustments
    $('#mhc_concierge_modal').on('input change', '.mhc-npc-rel-slider', function (e) {
        e.stopPropagation();
        const rawName = decodeURIComponent($(this).data('npc') || '');
        const axis = $(this).data('axis');
        const val = parseInt($(this).val(), 10) || 0;
        const sign = val >= 0 ? '+' : '';

        if (!activeDossier?.npcs) return;
        const npc = activeDossier.npcs.find(n => n.name && n.name.toLowerCase() === rawName.toLowerCase());
        if (npc) {
            npc[axis] = val;
            const container = $(this).closest('.mhc-npc-rel-controls');
            if (axis === 'friendship') {
                container.find('.mhc-rel-val-friendship').text(`${sign}${val}`);
            } else if (axis === 'affection') {
                container.find('.mhc-rel-val-affection').text(`${sign}${val}`);
            }
        }
        if (e.type === 'change') {
            saveDraft();
        }
    });

    $('#mhc_concierge_modal').on('click', '.mhc-npc-rel-controls', function (e) {
        e.stopPropagation();
    });

    // Collapsible blueprint items (NPCs, Monsters, Maps)
    $('#mhc_concierge_modal').on('click', '.mhc-deck-item.collapsible .mhc-deck-item-header', function () {
        const item = $(this).closest('.mhc-deck-item');
        const detail = item.find('.mhc-deck-item-detail');
        item.toggleClass('open');
        detail.slideToggle(140);
    });

    // Tab buttons
    $('.mhc-tab-btn').on('click', function () {
        $('.mhc-tab-btn').removeClass('active');
        $('.mhc-tab-content').removeClass('active');
        $(this).addClass('active');
        const tab = $(this).attr('data-tab');
        $(`#mhc_tab_${tab}`).addClass('active');
        if (tab === 'debug') {
            renderDebugInspectorView();
        }
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
        changelog = [];
        pendingAttachments = [];
        activeNameRagSeeds = '';
        window._mhcLastBuilderTransaction = null;
        window._lastConciergeBuilderDiagnostic = null;
        renderDebugInspectorView(null);
        $('#mhc_chat_messages').empty();
        renderAttachmentTray();
        updateBlueprintDeck();
        appendChatBubble('assistant', "Welcome to Session Zero! I'm your PbtA Concierge. Tell me what kind of game or adventure you'd like to play, or drop in a screenshot, character art, or lore document to inspire our world. What genre or vibe are you aiming for?");
    });

    // Finalize & Launch Campaign
    $('#mhc_launch_campaign_btn').on('click', async () => {
        const castEmpty = !(activeDossier?.npcs?.length) && !(activeDossier?.monsters?.length);
        if (castEmpty && !confirm('No NPCs or monsters have been staged for this campaign. Launch anyway?\n\n(Tip: ask the Concierge to propose a cast based on your outline.)')) {
            return;
        }

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

    // Copy Antigravity Debug Trace
    $('#mhc_concierge_modal').on('click', '.mhc-copy-debug-trace-btn', function () {
        const trace = window._mhcLastBuilderTransaction || window._lastConciergeBuilderDiagnostic;
        if (!trace) {
            toastr?.warning('No diagnostic trace found.');
            return;
        }
        const md = formatDiagnosticTrace(trace);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(md).then(() => {
                toastr?.success('Copied Antigravity debug trace to clipboard!');
            }).catch(() => {
                prompt('Copy Antigravity debug trace:', md);
            });
        } else {
            prompt('Copy Antigravity debug trace:', md);
        }
    });
}

function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Format a builder transaction as a rich Markdown diagnostic trace for Antigravity or bug reporting.
 * @param {object} [tx]
 * @returns {string}
 */
export function formatDiagnosticTrace(tx = (window._mhcLastBuilderTransaction || window._lastConciergeBuilderDiagnostic)) {
    return formatDiagnosticTraceParser(tx);
}

/**
 * Renders the latest Builder transaction state into both the in-modal debug inspector and settings drawer.
 * @param {object} [tx]
 */
export function renderDebugInspectorView(tx = (window._mhcLastBuilderTransaction || window._lastConciergeBuilderDiagnostic)) {
    // 1. In-Modal Tab Elements
    const modalBadge = $('#mhc_debug_status_badge');
    const modalTime = $('#mhc_debug_timestamp');
    const modalSummary = $('#mhc_debug_summary_text');
    const modalChanges = $('#mhc_debug_changes_list');
    const modalErrors = $('#mhc_debug_errors_list');
    const modalRaw = $('#mhc_debug_raw_output');
    const modalAttempts = $('#mhc_debug_attempt_count');
    const modalPrompt = $('#mhc_debug_prompt_input');
    const modalDossier = $('#mhc_debug_dossier_json');
    const modalNameRagCount = $('#mhc_debug_namerag_count');
    const modalNameRagList = $('#mhc_debug_namerag_list');

    // 2. Settings Drawer Elements
    const settingsBadge = $('#mhc_settings_debug_badge');
    const settingsStatus = $('#mhc_settings_debug_status');
    const settingsTime = $('#mhc_settings_debug_time');
    const settingsRaw = $('#mhc_settings_debug_raw');
    const settingsSummary = $('#mhc_settings_debug_summary');

    if (!tx) {
        modalBadge.text('Awaiting Turn').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc', borderColor: 'rgba(156,163,175,0.4)' });
        modalTime.text('--:--:--');
        modalSummary.text('No build transactions recorded yet.');
        modalChanges.empty();
        modalErrors.empty();
        modalNameRagCount.text('0 resolved').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        modalNameRagList.html('<div style="opacity: 0.6; font-style: italic;">No name placeholders resolved in this transaction.</div>');
        modalRaw.text('(No raw Builder response captured yet)');
        modalAttempts.text('Attempt 0/2');
        modalPrompt.text('(No prompt recorded yet)');
        modalDossier.text(JSON.stringify(activeDossier || {}, null, 2));

        settingsBadge.text('Idle').css({ background: 'rgba(150,150,150,0.2)', color: '#ccc', borderColor: 'rgba(255,255,255,0.15)' });
        settingsStatus.text('None');
        settingsTime.text('--:--:--');
        settingsRaw.text('(No build transactions recorded yet)');
        settingsSummary.text('None');
        return;
    }

    const attempts = tx.attempts || [];
    const lastAttempt = attempts.length ? attempts[attempts.length - 1] : null;
    const rawText = lastAttempt?.rawResponse || '(empty)';
    const status = tx.finalStatus || 'UNKNOWN';
    const timeFormatted = tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : '--:--:--';

    let badgeColor = '#ccc';
    let badgeBg = 'rgba(150,150,150,0.2)';
    let badgeBorder = 'rgba(255,255,255,0.15)';

    if (status === 'MUTATED') {
        badgeColor = '#4ade80';
        badgeBg = 'rgba(34, 197, 94, 0.2)';
        badgeBorder = 'rgba(34, 197, 94, 0.4)';
    } else if (status === 'NOOP') {
        badgeColor = '#60a5fa';
        badgeBg = 'rgba(59, 130, 246, 0.2)';
        badgeBorder = 'rgba(59, 130, 246, 0.4)';
    } else if (status === 'SYNTAX_ERROR') {
        badgeColor = '#f87171';
        badgeBg = 'rgba(239, 68, 68, 0.2)';
        badgeBorder = 'rgba(239, 68, 68, 0.4)';
    } else if (status === 'UNRECOGNIZED_OUTPUT') {
        badgeColor = '#fbbf24';
        badgeBg = 'rgba(245, 158, 11, 0.2)';
        badgeBorder = 'rgba(245, 158, 11, 0.4)';
    }

    modalBadge.text(status).css({ color: badgeColor, background: badgeBg, borderColor: badgeBorder });
    modalTime.text(timeFormatted);
    modalSummary.text(tx.builderSummary || 'No summary available');

    modalChanges.empty();
    const changes = lastAttempt?.report?.changes || [];
    if (changes.length) {
        modalChanges.html(`<b>Mutations:</b> ${changes.map(c => `• ${escapeHtml(c)}`).join(' ')}`);
    }

    modalErrors.empty();
    const errors = lastAttempt?.report?.errors || lastAttempt?.errors || [];
    if (errors.length) {
        modalErrors.html(`<b>Errors:</b> ${errors.map(e => `⚠️ ${escapeHtml(e)}`).join('; ')}`);
    }

    // Name Diversity Engine (NameRAG) Resolutions
    const resolutions = tx.nameRagResolutions || lastAttempt?.nameRagResolutions || [];
    if (resolutions.length > 0) {
        modalNameRagCount.text(`${resolutions.length} resolved`).css({ background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' });
        const itemsHtml = resolutions.map((r, i) => {
            const candidatesStr = (r.candidates && r.candidates.length)
                ? r.candidates.map(c => c === r.selectedName ? `<b style="color: #4ade80;">${escapeHtml(c)} (picked)</b>` : escapeHtml(c)).join(', ')
                : '(none returned)';
            return `
                <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 6px 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                        <span style="font-weight: 600; color: #facc15;">${escapeHtml(r.placeholder)}</span>
                        <span style="font-size: 0.85em; opacity: 0.75;">${escapeHtml(r.source || 'NameRAG')}</span>
                    </div>
                    <div style="color: #94a3b8; font-size: 0.9em; margin-bottom: 2px;"><b>Query:</b> <i>"${escapeHtml(r.query || '')}"</i></div>
                    <div style="color: #cbd5e1; font-size: 0.9em;"><b>Pool:</b> ${candidatesStr}</div>
                </div>
            `;
        }).join('');
        modalNameRagList.html(itemsHtml);
    } else {
        modalNameRagCount.text('0 resolved').css({ background: 'rgba(156,163,175,0.2)', color: '#ccc' });
        modalNameRagList.html('<div style="opacity: 0.6; font-style: italic;">No name placeholders resolved in this transaction.</div>');
    }

    modalRaw.text(rawText);
    modalAttempts.text(`Attempt ${attempts.length}/2`);
    modalPrompt.text(JSON.stringify(tx.builderRequest?.messages || [], null, 2));
    modalDossier.text(JSON.stringify(tx.activeDossierSnapshot || tx.currentDossierSnapshot || activeDossier || {}, null, 2));

    // Settings drawer updates
    settingsBadge.text(status).css({ color: badgeColor, background: badgeBg, borderColor: badgeBorder });
    settingsStatus.text(status);
    settingsTime.text(timeFormatted);
    settingsRaw.text(rawText);
    settingsSummary.text(tx.builderSummary || 'None');
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
        changelog = draft.changelog || [];
        $('#mhc_chat_messages').empty();
        chatHistory.forEach(msg => {
            const displayStr = msg.displayContent || (typeof msg.content === 'string' ? msg.content : '');
            if (displayStr) {
                const isAssistant = msg.role === 'assistant';
                const text = isAssistant ? stripConciergeStateBlocks(displayStr) : displayStr;
                appendChatBubble(msg.role, text, msg.imageSrc || null);
            } else if (Array.isArray(msg.content)) {
                let text = '';
                let imgSrc = null;
                msg.content.forEach(p => {
                    if (p.type === 'text') text += p.text;
                    if (p.type === 'image_url') imgSrc = p.image_url?.url;
                });
                appendChatBubble(msg.role, text, imgSrc || msg.imageSrc || null);
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
    renderDebugInspectorView();
    $('#mhc_concierge_modal').fadeIn(200);
}

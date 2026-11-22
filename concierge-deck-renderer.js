/// <reference path="./types.d.ts" />
/**
 * concierge-deck-renderer.js — MultiHog Companion
 *
 * Stateful DOM renderer for the Session Zero & Living World Blueprint Deck
 * (system header, calibration dials, world axioms, custom HUD tracker card,
 * protagonist, NPCs, adversaries, maps, factions, initial framing, Series Bible
 * Canon accordion with category filters, and raw markdown preview).
 */

import {
    getStagedSourcesSummary,
    getStagedCanonEntries,
} from './concierge-canon.js';
import {
    serializeDossierToMarkdown,
    isDossierEmptyOrUntouched,
    isDefaultUntitledCampaignTitle,
    escapeHtml,
    buildAxiomCardHtml,
} from './concierge-parser.js';
import { PBTA_GENRES } from './pbta-ruleset.js';
import { parseResolvedNameToken } from './namerag-hooks.js';
import { systemRegistry } from './concierge-system-registry.js';
import './concierge-system-pbta.js';
import './concierge-system-fae.js';
import './concierge-system-dnd5e.js';

/**
 * Formats an entity or canon name for Blueprint Deck cards, rendering any
 * NameRAG-resolved token (`[NAME: concept, RESOLVED TO: Name]`) cleanly with
 * the resolved name prominent and a compact NameRAG badge.
 *
 * @param {string} rawName
 * @param {object} [options={}]
 * @returns {{ cleanName: string, tag: string, isResolvedToken: boolean, badgeHtml: string, html: string }}
 */
export function formatBlueprintNameWithBadge(rawName, {
    fallback = 'Unnamed',
    badgeBg = 'rgba(139, 92, 246, 0.16)',
    badgeBorder = 'rgba(139, 92, 246, 0.45)',
    badgeColor = '#d8b4fe',
} = {}) {
    const { cleanName, tag, isResolvedToken } = parseResolvedNameToken(rawName);
    const display = cleanName || fallback;
    if (!isResolvedToken) {
        return {
            cleanName: display,
            tag: '',
            isResolvedToken: false,
            badgeHtml: '',
            html: escapeHtml(display),
        };
    }
    const tooltip = tag
        ? `Generated via NameRAG from concept: ${tag}`
        : 'Generated via NameRAG';
    const shortTag = tag && tag.length > 24 ? `${tag.slice(0, 22)}…` : tag;
    const badgeText = shortTag ? `🎲 NameRAG · ${shortTag}` : '🎲 NameRAG';
    const badgeHtml = ` <span class="mhc-pill mhc-namerag-badge" style="font-size: 0.7em; background: ${badgeBg}; border-color: ${badgeBorder}; color: ${badgeColor};" title="${escapeHtml(tooltip)}">${escapeHtml(badgeText)}</span>`;
    return {
        cleanName: display,
        tag,
        isResolvedToken: true,
        badgeHtml,
        html: `<span style="font-weight: 700;">${escapeHtml(display)}</span>${badgeHtml}`,
    };
}

/**
 * Render the Live Blueprint Deck cards, step visibility, and track footer buttons
 * from the active dossier and UI track/step state.
 *
 * @param {object} params
 * @param {CompanionDossier} params.activeDossier
 * @param {'new-adventure'|'living-world'} [params.currentNavMode='new-adventure']
 * @param {DossierStageId} [params.currentAdventureStep='initial']
 * @param {string|null} [params.loadedCampaignOriginTitle=null]
 * @param {Array<object>} [params.attachedSources=[]]
 * @param {string} [params.activeCanonFilter='all']
 * @param {(nextFilter: string) => void} [params.onUpdateCanonFilter=null]
 * @param {() => void} [params.onRenderAttachmentTray=null]
 */
export function renderBlueprintDeckDom({
    activeDossier,
    currentNavMode = 'new-adventure',
    currentAdventureStep = 'initial',
    loadedCampaignOriginTitle = null,
    attachedSources = [],
    activeCanonFilter = 'all',
    onUpdateCanonFilter = null,
    onRenderAttachmentTray = null,
} = {}) {
    if (!activeDossier || typeof $ === 'undefined') return;

    const meta = activeDossier.meta || {};
    const proto = activeDossier.protagonist || {};
    const npcs = activeDossier.npcs || [];
    const monsters = activeDossier.monsters || [];
    const maps = activeDossier.maps || [];
    const kick = activeDossier.theKick || {};

    // Header Badge & System Card
    const rulesetId = systemRegistry.detectRuleset(activeDossier);
    const adapter = systemRegistry.get(rulesetId);
    const isFae = adapter.id === 'fae';
    const isUntouchedAndUnestablished = !meta.genreEstablished && isDossierEmptyOrUntouched(activeDossier);

    const titlePrefix = adapter.id === 'fae' ? 'FAE' : adapter.id === 'pbta' ? 'PbtA' : adapter.id.toUpperCase();
    if (currentNavMode === 'living-world') {
        const campTitle = (activeDossier.meta?.title || loadedCampaignOriginTitle || '').trim() || 'Active Campaign';
        $('#mhc_concierge_modal_title').text(`Living World Dossier: ${campTitle}`);
    } else {
        $('#mhc_concierge_modal_title').text('Session Zero Concierge');
    }
    const isStep3Unconfirmed = currentNavMode === 'new-adventure' && currentAdventureStep === 'adventure' && !activeDossier?.meta?.rulesetConfirmed;
    if (isStep3Unconfirmed) {
        $('#mhc_deck_engine_title').text('⚙️ Choose Ruleset Engine');
        $('#mhc_deck_system_tag').text('REQUIRED FOR EPISODE 1').addClass('mhc-tag-required');
    } else {
        $('#mhc_deck_engine_title').text(`${adapter.badgeIcon} ${titlePrefix} Engine`);
        $('#mhc_deck_system_tag').removeClass('mhc-tag-required');
    }

    const toggleContainer = $('#mhc_header_ruleset_toggle');
    if (toggleContainer.length && typeof toggleContainer.find === 'function') {
        const rulesetCards = toggleContainer.find('.mhc-ruleset-card');
        if (rulesetCards.length && typeof rulesetCards.each === 'function') {
            rulesetCards.each(function () {
                const cardRuleset = $(this).attr('data-ruleset');
                const isActive = !isStep3Unconfirmed && (cardRuleset === adapter.id);
                if (typeof $(this).toggleClass === 'function') $(this).toggleClass('active', isActive);
                const btn = $(this).find('.mhc-ruleset-btn');
                if (btn.length) {
                    if (isActive) {
                        btn.text('✓ Active Engine').addClass('active');
                    } else if (isStep3Unconfirmed) {
                        const name = cardRuleset === 'dnd5e' ? 'D&D Lite' : cardRuleset === 'fae' ? 'FAE' : 'PbtA';
                        btn.text(`Select ${name}`).removeClass('active');
                    } else {
                        const name = cardRuleset === 'dnd5e' ? 'D&D' : cardRuleset === 'fae' ? 'FAE' : 'PbtA';
                        btn.text(`Switch to ${name}`).removeClass('active');
                    }
                }
            });
        } else {
            const existingBtns = toggleContainer.find('.mhc-ruleset-btn');
            if (existingBtns && typeof existingBtns.each === 'function') {
                existingBtns.each(function () {
                    const btnRuleset = $(this).attr('data-ruleset');
                    const active = isStep3Unconfirmed ? false : (btnRuleset === adapter.id);
                    if (typeof $(this).toggleClass === 'function') $(this).toggleClass('active', active);
                });
            }
        }
    }

    const isSessionZeroAgnostic = currentNavMode === 'new-adventure' && (currentAdventureStep === 'initial' || currentAdventureStep === 'canon' || !meta.rulesetConfirmed);
    if (isSessionZeroAgnostic || isUntouchedAndUnestablished) {
        $('#mhc_header_system_badge')
            .hide()
            .text('✨ Any Genre / Custom')
            .attr('title', isSessionZeroAgnostic
                ? 'Ruleset and engine will be chosen in Step 3 (Adventure)'
                : `Active Engine: ${adapter.label} (${adapter.diceEngine}) — Use any preset or forge custom setting`);
        $('#mhc_deck_system_tag').text('ANY GENRE / CUSTOM');
        $('#mhc_deck_tune_ruleset_btn').hide();
        $('#mhc_deck_ruleset_spec_summary').hide().empty();
        $('#mhc_deck_system_desc').text(meta.premise || (isFae
            ? 'Single-pass 4dF attrition engine — pick any preset or forge custom Resource Pools.'
            : 'Fiction-first 2d6 narrative engine — pick any preset or forge custom stats & moves.'
        ));
    } else {
        const sysLabel = meta.systemLabel || adapter.getGenre(meta.systemKey)?.label || (isFae ? 'Custom FAE Setting' : PBTA_GENRES.fantasy.label);
        const badgeIcon = adapter.badgeIcon || (isFae ? '🕯️' : '🎲');
        $('#mhc_header_system_badge')
            .show()
            .text(`${badgeIcon} ${sysLabel}`)
            .attr('title', `Active ${adapter.id.toUpperCase()} Genre: ${sysLabel} (${adapter.diceEngine})`);
        $('#mhc_deck_system_tag').text((meta.systemKey || (isFae ? 'CUSTOM' : 'FANTASY')).toUpperCase());
        $('#mhc_deck_system_desc').text(meta.premise || `${titlePrefix} ${sysLabel} narrative engine.`);

        if (currentNavMode === 'new-adventure' && currentAdventureStep === 'adventure' && meta.rulesetConfirmed) {
            $('#mhc_deck_tune_ruleset_btn').show();
            const spec = meta.customGenreSpec;
            const genreObj = adapter.getGenre(meta.systemKey);
            const statsArr = spec?.stats || genreObj?.stats;
            const poolsArr = spec?.pools || (genreObj?.pools ? Object.values(genreObj.pools) : null);
            const archArr = spec?.archetypes || genreObj?.archetypes || genreObj?.classes;
            const specParts = [];
            if (Array.isArray(statsArr) && statsArr.length) {
                specParts.push(`<div><b>Stats:</b> ${escapeHtml(statsArr.join(', '))}</div>`);
            } else if (Array.isArray(poolsArr) && poolsArr.length) {
                specParts.push(`<div><b>Pools:</b> ${escapeHtml(poolsArr.map(p => `${p.label} (${p.max || 8})`).join(', '))}</div>`);
            }
            if (Array.isArray(archArr) && archArr.length) {
                specParts.push(`<div style="margin-top: 2px;"><b>Archetypes:</b> ${escapeHtml(archArr.join(', '))}</div>`);
            }
            if (specParts.length) {
                $('#mhc_deck_ruleset_spec_summary').html(specParts.join('')).show();
            } else {
                $('#mhc_deck_ruleset_spec_summary').hide().empty();
            }
        } else {
            $('#mhc_deck_tune_ruleset_btn').hide();
            $('#mhc_deck_ruleset_spec_summary').hide().empty();
        }
    }

    const defaultCampTitle = isSessionZeroAgnostic ? 'Untitled Campaign' : `Untitled ${titlePrefix} Campaign`;
    const campTitle = (meta.title || '').trim();
    const effectiveCampTitle = isSessionZeroAgnostic && isDefaultUntitledCampaignTitle(campTitle)
        ? 'Untitled Campaign'
        : (campTitle || defaultCampTitle);
    $('#mhc_deck_campaign_title').text(effectiveCampTitle);
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
    let playstyleDialLabel = '🧭 CYOA: 5 Choices';
    if (playstyle === 'freeform') {
        playstyleLabel = 'Pure Freeform (No Choices)';
        playstyleDialLabel = '🧭 CYOA: Freeform';
    } else if (playstyle === 'cyoa_3') {
        playstyleLabel = 'CYOA (3 Choices)';
        playstyleDialLabel = '🧭 CYOA: 3 Choices';
    }
    $('#mhc_deck_dial_playstyle').text(playstyleLabel);
    $('#mhc_dial_playstyle_btn').text(playstyleDialLabel);

    adapter.renderDeckDials($, activeDossier);
    if (!adapter.hasDial('partyMode')) {
        $('#mhc_dial_party_btn').hide();
    }
    if (!adapter.hasDial('relationships')) {
        $('#mhc_dial_relationships_btn').hide();
    }
    const relsOn = cfg.relationships !== false;

    const emojisOn = cfg.cyoaEmojis !== false;
    $('#mhc_dial_emojis_btn').text(`✨ Emojis: ${emojisOn ? 'On' : 'Off'}`);

    const simDepth = cfg.simulationDepth || 'active_fronts';
    let simLabel = 'Active Fronts';
    if (simDepth === 'living_world') simLabel = 'Living World';
    else if (simDepth === 'static') simLabel = 'Static Solo';
    $('#mhc_dial_sim_depth_btn').text(`🌍 Sim: ${simLabel}`);

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
            wrList.append(buildAxiomCardHtml(ax));
        });
    } else {
        wrList.append('<div class="mhc-empty-hint">Standard world physics & tropes apply.</div>');
    }

    // Custom HUD Tracker Module Card
    const customMod = worldRules.customModule;
    const customModTag = customMod ? (customMod.tag || customMod.fieldKey || '') : '';
    const customModSample = customMod ? (customMod.sampleContent || customMod.sample || '') : '';
    const customModDrivers = customMod?.drivers ? String(customMod.drivers).toLowerCase() : '';
    if (customMod && (customModTag || customMod.label)) {
        $('#mhc_deck_custom_module_tag').text((customModTag || 'CUSTOM').toUpperCase());
        $('#mhc_deck_custom_module_label').text(customMod.label || customModTag);
        $('#mhc_deck_custom_module_instruction').text(customMod.instruction || '');
        if (customModDrivers) {
            let driverLabel = `⚡ ${customModDrivers}`;
            if (customModDrivers === 'gm_deltas') driverLabel = '⚡ GM Deltas';
            else if (customModDrivers === 'gm_annotation') driverLabel = '📝 GM Notes';
            else if (customModDrivers === 'auto_tick') driverLabel = '⏱️ Auto-Tick';
            else if (customModDrivers === 'clock') driverLabel = '⏰ Clock';
            $('#mhc_deck_custom_module_drivers').text(driverLabel).show();
        } else {
            $('#mhc_deck_custom_module_drivers').hide();
        }
        if (customModSample) {
            $('#mhc_deck_custom_module_sample').text(customModSample).show();
        } else {
            $('#mhc_deck_custom_module_sample').hide();
        }
        $('#mhc_deck_custom_module_card').show();
    } else {
        $('#mhc_deck_custom_module_card').hide();
    }

    // Protagonist Card
    $('#mhc_deck_char_playbook').text(proto.archetype || proto.playbook || 'In Development');
    const protoFormatted = formatBlueprintNameWithBadge(proto.name, { fallback: 'Unnamed Adventurer' });
    $('#mhc_deck_char_name').html(protoFormatted.html);

    adapter.renderDeckStats({
        vitalsEl: $('#mhc_deck_char_vitals'),
        statsEl: $('#mhc_deck_char_stats'),
        movesEl: $('#mhc_deck_char_moves'),
        heroicEl: $('#mhc_deck_char_heroic_domain'),
    }, proto, activeDossier, { isUntouchedAndUnestablished, escapeHtml });

    // Supporting Cast & Allies (NPCs) Card
    $('#mhc_deck_npc_count').text(npcs.length);
    const npcList = $('#mhc_deck_npcs_list');
    npcList.empty();
    if (npcs.length) {
        npcs.forEach(n => {
            const { cleanName, badgeHtml: tagBadge } = formatBlueprintNameWithBadge(n.name, {
                badgeBg: 'rgba(59, 130, 246, 0.15)',
                badgeBorder: 'rgba(59, 130, 246, 0.4)',
                badgeColor: '#93c5fd',
            });
            const role = n.role || 'Ally';
            const demeanor = n.demeanor ? ` · <i>${n.demeanor}</i>` : '';
            const app = n.appearance ? `<div style="font-size: 0.8em; opacity: 0.85;"><b>Look:</b> ${n.appearance}</div>` : '';
            const rel = n.relationship ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Bond:</b> ${n.relationship}</div>` : '';
            const boonsLabel = isFae ? 'Fictional Leverage:' : 'Boons/Moves:';
            const boons = n.movesOrBoons ? `<div style="font-size: 0.8em; opacity: 0.75;"><b>${boonsLabel}</b> ${n.movesOrBoons}</div>` : '';

            let woundBadge = '';
            let condsHtml = '';
            if (n.harm && (n.harm.current > 0 || n.status || (n.conditions && n.conditions.length))) {
                const nCur = parseInt(n.harm.current, 10) || 0;
                const nMax = parseInt(n.harm.max, 10) || 5;
                const nHp = Math.max(0, nMax - nCur);
                if (nCur > 0) {
                    woundBadge = ` <span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(239, 68, 68, 0.5); color: #f87171;">🩸 ${nHp}/${nMax} HP (${nCur}/${nMax} Harm)</span>`;
                }
            }
            if (n.conditions && n.conditions.length) {
                const condList = Array.isArray(n.conditions) ? n.conditions : [n.conditions];
                condsHtml = `<div style="font-size: 0.8em; opacity: 0.85; color: #f87171;"><b>Conditions:</b> ${escapeHtml(condList.join(', '))}</div>`;
            }

            let relControls = '';
            if (relsOn && !isFae) {
                const fVal = n.friendship ?? 0;
                const aVal = n.affection ?? 0;
                const fSign = fVal >= 0 ? '+' : '';
                const aSign = aVal >= 0 ? '+' : '';
                relControls = `
                    <div class="mhc-npc-rel-controls" style="margin-top: 6px; padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; font-size: 0.78em;">
                            <span style="color: #4ade80;">🤝 Friendship: <b class="mhc-rel-val-friendship">${fSign}${fVal}</b></span>
                            <input type="range" class="mhc-npc-rel-slider" data-npc="${encodeURIComponent(cleanName)}" data-axis="friendship" min="-150" max="150" step="5" value="${fVal}" style="flex: 1; max-width: 130px; height: 3px; accent-color: #4ade80; cursor: pointer;">
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.78em;">
                            <span style="color: #f472b6;">💗 Affection: <b class="mhc-rel-val-affection">${aSign}${aVal}</b></span>
                            <input type="range" class="mhc-npc-rel-slider" data-npc="${encodeURIComponent(cleanName)}" data-axis="affection" min="-150" max="150" step="5" value="${aVal}" style="flex: 1; max-width: 130px; height: 3px; accent-color: #f472b6; cursor: pointer;">
                        </div>
                    </div>
                `;
            }

            npcList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title" style="color: var(--mhc-accent, #3b82f6);">
                            👤 ${escapeHtml(cleanName)} <span class="mhc-pill" style="font-size: 0.72em;">${role}</span>${tagBadge}${woundBadge}${demeanor}
                        </div>
                        <button type="button" class="menu_button mhc-deck-remove-item-btn" data-remove-kind="npc" data-remove-target="${escapeHtml(cleanName)}" style="padding: 1px 6px; font-size: 0.72em; color: #f87171; border-color: rgba(239,68,68,0.3); margin-left: auto; margin-right: 4px;" title="Remove NPC">✕</button>
                        <span class="mhc-deck-item-toggle">▼</span>
                    </div>
                    <div class="mhc-deck-item-detail">
                        ${app}
                        ${rel}
                        ${condsHtml}
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
            mList.append(adapter.renderDeckMonsterHtml(m, { formatBlueprintNameWithBadge, escapeHtml }));
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
            const mapNameInfo = formatBlueprintNameWithBadge(map.site, { fallback: 'Unnamed Site' });
            const isPrimary = mapNameInfo.cleanName.toLowerCase().trim() === startSiteName;
            const stageBadge = isPrimary
                ? '<span class="mhc-pill" style="font-size: 0.72em; border-color: rgba(56, 189, 248, 0.4); color: #38bdf8;" title="Starting location: Generated immediately at launch">⭐ Starting Site</span>'
                : '<span class="mhc-pill" style="font-size: 0.72em; opacity: 0.75;" title="Queued in Locations lorebook for lazy on-entry generation">📦 Staged for Entry</span>';
            mapList.append(`
                <div class="mhc-deck-item collapsible">
                    <div class="mhc-deck-item-header">
                        <div class="mhc-deck-item-title">
                            🗺️ ${mapNameInfo.html} <span class="mhc-pill" style="font-size: 0.72em;">${map.kind || 'Site'} · ${map.threat || 'Threat'}</span> ${stageBadge}
                        </div>
                        <button type="button" class="menu_button mhc-deck-remove-item-btn" data-remove-kind="map" data-remove-target="${escapeHtml(mapNameInfo.cleanName)}" style="padding: 1px 6px; font-size: 0.72em; color: #f87171; border-color: rgba(239,68,68,0.3); margin-left: auto; margin-right: 4px;" title="Remove Location">✕</button>
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
                const { cleanName: factionCleanName, html: factionNameHtml } = formatBlueprintNameWithBadge(f.name, {
                    fallback: 'Unnamed Faction',
                    badgeBg: 'rgba(245, 158, 11, 0.15)',
                    badgeBorder: 'rgba(245, 158, 11, 0.45)',
                    badgeColor: '#fcd34d',
                });
                const standing = f.standing || 'Neutral';
                let badgeColor = 'rgba(156, 163, 175, 0.4)';
                if (/friendly|allied|ally/i.test(standing)) badgeColor = 'rgba(34, 197, 94, 0.4)';
                else if (/hostile|enemy/i.test(standing)) badgeColor = 'rgba(239, 68, 68, 0.4)';
                const notes = f.notes ? `<div style="font-size: 0.8em; opacity: 0.8;"><b>Notes:</b> ${f.notes}</div>` : '';
                fList.append(`
                    <div class="mhc-deck-item collapsible">
                        <div class="mhc-deck-item-header">
                            <div class="mhc-deck-item-title" style="color: var(--mhc-warning, #f59e0b);">
                                🚩 ${factionNameHtml} <span class="mhc-pill" style="font-size: 0.72em; border-color: ${badgeColor};">${standing}</span>
                            </div>
                            <button type="button" class="menu_button mhc-deck-remove-item-btn" data-remove-kind="faction" data-remove-target="${escapeHtml(factionCleanName)}" style="padding: 1px 6px; font-size: 0.72em; color: #f87171; border-color: rgba(239,68,68,0.3); margin-left: auto; margin-right: 4px;" title="Remove Faction">✕</button>
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

    // Step 1 Initial Framing Card
    const isFramingReady = Boolean(meta.framingComplete);
    $('#mhc_initial_framing_status')
        .text(isFramingReady ? '✓ Ready for Canon' : 'In Progress')
        .css({
            borderColor: isFramingReady ? 'rgba(34, 197, 94, 0.4)' : 'rgba(59, 130, 246, 0.4)',
            color: isFramingReady ? '#4ade80' : '#93c5fd',
        });
    const initialCampTitle = (!meta.rulesetConfirmed && isDefaultUntitledCampaignTitle(meta.title))
        ? 'Untitled Campaign'
        : ((meta.title || '').trim() || 'Untitled Campaign');
    $('#mhc_initial_title').text(initialCampTitle);
    $('#mhc_initial_premise').text((meta.premise || '').trim() || '(Waiting for premise...)');
    $('#mhc_initial_focal_lens').text((meta.focalLens || '').trim() || '(Waiting for focal lens/pivot...)');
    $('#mhc_initial_tone').text((meta.tone || '').trim() || '(Waiting for tone...)');

    // Step 1 Attached Sources Card
    const sourceSummaryList = getStagedSourcesSummary();
    const mergedSources = [...attachedSources];
    for (const src of sourceSummaryList) {
        if (!mergedSources.some(m => m.name === src.name)) {
            mergedSources.push(src);
        }
    }
    $('#mhc_initial_sources_count').text(mergedSources.length);
    const initialSourcesList = $('#mhc_initial_sources_list');
    initialSourcesList.empty();
    if (mergedSources.length) {
        mergedSources.forEach(s => {
            let icon = '📄';
            if (s.type === 'lore') icon = '📚';
            else if (s.type === 'char') icon = '👤';
            else if (s.type === 'image') icon = '🖼️';
            const tokStr = s.tokens ? `~${s.tokens} tok` : '';
            initialSourcesList.append(`
                <div class="mhc-initial-source-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span>${icon}</span>
                        <span style="font-size: 0.82em; font-weight: 600; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.name)}</span>
                        ${tokStr ? `<span class="mhc-pill" style="font-size: 0.7em; opacity: 0.7;">${tokStr}</span>` : ''}
                    </div>
                    <button type="button" class="menu_button mhc-source-remove-btn" data-name="${escapeHtml(s.name)}" style="padding: 1px 6px; font-size: 0.75em; color: #f87171; border-color: rgba(239,68,68,0.3);" title="Remove source">✕</button>
                </div>
            `);
        });
    } else {
        initialSourcesList.append('<div class="mhc-empty-hint">No sources attached yet. Click 📎 to attach lore, cards, or notes.</div>');
    }

    // Step 2 Series Bible (_Canon Lorebook) Card
    const stagedCanon = getStagedCanonEntries();
    $('#mhc_deck_canon_count').text(stagedCanon.length);
    const canonDeckList = $('#mhc_deck_canon_list');
    const canonFilterBar = $('#mhc_canon_filter_bar');
    canonDeckList.empty();
    if (stagedCanon.length) {
        const grouped = {};
        for (const entry of stagedCanon) {
            const kind = (entry.kind || 'LORE').toUpperCase();
            if (!grouped[kind]) grouped[kind] = [];
            grouped[kind].push(entry);
        }
        const kindMeta = {
            FACTION: { icon: '🏛️', label: 'Factions' },
            LOCATION: { icon: '🗺️', label: 'Locations' },
            NPC: { icon: '👤', label: 'NPCs' },
            EVENT: { icon: '📜', label: 'Events' },
            RULE: { icon: '⚖️', label: 'Rules' },
            MONSTER: { icon: '👹', label: 'Monsters' },
            LORE: { icon: '📚', label: 'Lore' },
        };
        const order = ['FACTION', 'LOCATION', 'NPC', 'RULE', 'EVENT', 'MONSTER', 'LORE'];
        const allKinds = [...new Set([...order, ...Object.keys(grouped)])].filter(k => grouped[k] && grouped[k].length);

        let effectiveFilter = activeCanonFilter || 'all';
        if (effectiveFilter !== 'all' && !grouped[effectiveFilter]) {
            effectiveFilter = 'all';
            if (typeof onUpdateCanonFilter === 'function') {
                onUpdateCanonFilter('all');
            }
        }

        canonFilterBar.empty().show();
        canonFilterBar.append(`
            <button type="button" class="mhc-canon-filter-pill ${effectiveFilter === 'all' ? 'active' : ''}" data-filter="all">
                All (${stagedCanon.length})
            </button>
        `);
        for (const k of allKinds) {
            const count = grouped[k].length;
            const kindInfo = kindMeta[k] || { icon: '📌', label: k };
            const isActive = effectiveFilter === k;
            canonFilterBar.append(`
                <button type="button" class="mhc-canon-filter-pill ${isActive ? 'active' : ''}" data-filter="${escapeHtml(k)}">
                    ${kindInfo.icon} ${kindInfo.label} (${count})
                </button>
            `);
        }

        for (const k of allKinds) {
            const entries = grouped[k];
            if (!entries || !entries.length) continue;
            const kindInfo = kindMeta[k] || { icon: '📌', label: k };
            const isGroupHeaderVisible = (effectiveFilter === 'all');
            canonDeckList.append(`
                <div class="mhc-canon-group-header" data-kind-header="${escapeHtml(k)}" style="${isGroupHeaderVisible ? '' : 'display: none;'}">
                    ${kindInfo.icon} ${kindInfo.label.toUpperCase()} (${entries.length})
                </div>
            `);
            for (const entry of entries) {
                const comment = entry.comment || `[${entry.kind}] ${entry.name}`;
                const { cleanName: canonCleanName, badgeHtml: canonNameRagBadge } = formatBlueprintNameWithBadge(entry.name, {
                    fallback: 'Untitled',
                    badgeBg: 'rgba(139, 92, 246, 0.16)',
                    badgeBorder: 'rgba(139, 92, 246, 0.45)',
                    badgeColor: '#d8b4fe',
                });
                const isDisabled = Boolean(entry.disabled);
                const statusLabel = isDisabled ? '⊘ Disabled' : '✓ Active';
                const statusStyle = isDisabled
                    ? 'background: rgba(107, 114, 128, 0.25); border-color: rgba(156, 163, 175, 0.4); color: #9ca3af;'
                    : 'background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.5); color: #4ade80;';
                const impBadge = entry.importance !== undefined ? `<span class="mhc-pill" style="font-size: 0.7em;">Imp: ${entry.importance}</span>` : '';
                const entryKind = (entry.kind || k).toUpperCase();
                const isItemVisible = (effectiveFilter === 'all' || effectiveFilter === entryKind);
                canonDeckList.append(`
                    <div class="mhc-deck-item collapsible" data-kind="${escapeHtml(entryKind)}" style="opacity: ${isDisabled ? '0.6' : '1'}; ${isItemVisible ? '' : 'display: none;'}">
                        <div class="mhc-deck-item-header" style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                            <div class="mhc-deck-item-title" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                <span style="margin-right: 2px;">${kindInfo.icon}</span>
                                <span style="font-weight: 700;">${escapeHtml(canonCleanName)}</span>${canonNameRagBadge}
                                <span class="mhc-pill" style="font-size: 0.7em; margin-left: 4px;">${escapeHtml(entry.kind || k)}</span>
                                ${impBadge}
                            </div>
                            <button type="button" class="menu_button mhc-canon-toggle-btn" data-comment="${escapeHtml(comment)}" style="font-size: 0.72em; padding: 2px 8px; border-radius: 4px; font-weight: 600; cursor: pointer; ${statusStyle}" title="Toggle between Active and Disabled">
                                ${statusLabel}
                            </button>
                            <span class="mhc-deck-item-toggle">▼</span>
                        </div>
                        <div class="mhc-deck-item-detail">
                            <div class="mhc-canon-entry-content">${escapeHtml(entry.content || '')}</div>
                        </div>
                    </div>
                `);
            }
        }
    } else {
        canonFilterBar.empty().hide();
        canonDeckList.append('<div class="mhc-empty-hint">No Series Bible entries generated yet. Advance from Initial Framing to build Canon.</div>');
    }

    // Stage-specific cards visibility based on mode & currentAdventureStep
    if (currentNavMode === 'living-world') {
        $('#mhc_new_adventure_stepper').hide();
        $('#mhc_tab_progression_btn').show();
        $('.mhc-chat-column').show();
        $('#mhc_adventure_ruleset_gate_hint').hide();

        $('#mhc_card_initial_framing').hide();
        $('#mhc_card_initial_sources').hide();
        $('#mhc_card_canon_entries').show();
        $('#mhc_deck_world_rules_card').show();
        $('.mhc-card-system').show();
        $('.mhc-card-dials').show();
        $('.mhc-card-char').show();
        $('.mhc-card-npcs').show();
        $('.mhc-card-monsters').show();
        $('.mhc-card-maps').show();
        $('.mhc-card-factions').show();
        $('.mhc-card-kick').show();
    } else {
        $('#mhc_new_adventure_stepper').show();
        $('#mhc_tab_cards .mhc-card').hide();

        if (currentAdventureStep === 'initial') {
            $('#mhc_card_initial_framing').show();
            $('#mhc_card_initial_sources').show();
            $('#mhc_tab_progression_btn').hide();
            $('.mhc-chat-column').show();
            if (typeof onRenderAttachmentTray === 'function') {
                onRenderAttachmentTray();
            }
        } else if (currentAdventureStep === 'canon') {
            $('#mhc_deck_world_rules_card').show();
            $('#mhc_card_canon_entries').show();
            $('#mhc_tab_progression_btn').hide();
            $('.mhc-chat-column').show();
        } else if (currentAdventureStep === 'adventure') {
            $('.mhc-card-system').show();
            $('.mhc-card-dials').show();
            $('#mhc_tab_progression_btn').hide();

            const rulesetConfirmed = Boolean(activeDossier.meta?.rulesetConfirmed);
            if (rulesetConfirmed) {
                $('.mhc-card-kick').show();
                $('.mhc-card-maps').show();
                $('.mhc-card-monsters').show();
                $('.mhc-card-npcs').show();
                $('.mhc-card-factions').show();
                $('#mhc_adventure_ruleset_gate_hint').hide();
                $('.mhc-chat-column').show();
            } else {
                $('#mhc_adventure_ruleset_gate_hint').hide();
                $('#mhc_dial_harm_btn').hide();
                $('#mhc_dial_downed_btn').hide();
                $('#mhc_dial_heroic_btn').hide();
                $('#mhc_dial_tempo_btn').hide();
            }
        } else if (currentAdventureStep === 'character') {
            $('.mhc-card-char').show();
            if (worldRules.customModule && (worldRules.customModule.tag || worldRules.customModule.label)) {
                $('#mhc_deck_custom_module_card').show();
            }
            $('#mhc_tab_progression_btn').show();
            $('.mhc-chat-column').show();
        }
    }

    // Footer button visibility per track
    if (currentNavMode === 'living-world') {
        $('#mhc_save_draft_btn').hide();
        $('#mhc_reset_session_btn').hide();
        $('#mhc_launch_campaign_btn').hide();
        $('#mhc_fork_campaign_btn').show();
        $('#mhc_sync_active_campaign_btn').show();
    } else {
        $('#mhc_save_draft_btn').show();
        $('#mhc_reset_session_btn').show();
        $('#mhc_launch_campaign_btn').show();
        $('#mhc_fork_campaign_btn').hide();
        $('#mhc_sync_active_campaign_btn').hide();
    }

    // Raw Markdown Tab
    $('#mhc_raw_markdown_text').val(serializeDossierToMarkdown(activeDossier));
}

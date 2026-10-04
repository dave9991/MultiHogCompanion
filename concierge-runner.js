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

import { applyPbtACartridge, syncPersonaToChat, uploadImageToPersona, findMatchingPersona } from './index.js';
import { serializeDossierToMarkdown } from './concierge-parser.js';

/**
 * Send an outgoing user chat message into SillyTavern.
 * @param {string} text
 */
function sendOutgoingChatMessage(text) {
    const textarea = document.getElementById('send_textarea');
    const sendBtn = document.getElementById('send_but');
    if (!textarea || !sendBtn) {
        throw new Error('Chat input is not available.');
    }
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    sendBtn.click();
}

/**
 * Injects or updates the Campaign Dossier World Info entry for the active chat.
 */
async function injectDossierIntoWorldInfo(chatId, dossierMarkdown, bookName) {
    const ctx = SillyTavern.getContext();
    const effectiveBook = bookName || (ctx.chatMetadata?.world_info || `Campaign_${chatId || 'PbtA'}`);

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
            if (entry.comment?.includes('CAMPAIGN_DOSSIER') || entry.key?.includes('campaign_dossier')) {
                targetUid = uid;
                break;
            }
        }

        if (!targetUid) {
            targetUid = String(Date.now());
        }

        bookData.entries[targetUid] = {
            uid: parseInt(targetUid, 10) || Date.now(),
            key: ['campaign', 'dossier', 'setting', 'premise', 'monster', 'threat', 'moves'],
            keysecondary: [],
            comment: 'PbtA Concierge: Campaign Dossier Artifact',
            content: dossierMarkdown,
            constant: true,
            selective: false,
            order: 100,
            position: 1, // before char defs / high priority
            disable: false,
        };

        await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: effectiveBook, data: bookData }),
        });

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
 * Main Campaign Launch Pipeline
 *
 * @param {object} dossier The completed PbtaCampaignDossier
 * @param {(stepText: string, pct: number) => void} [onProgress] Progress callback
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function launchPbtaCampaign(dossier, onProgress = () => {}) {
    const ctx = SillyTavern.getContext();
    const chatId = ctx.getCurrentChatId?.() || ctx.chatId || 'active';
    const systemKey = dossier.meta?.systemKey || 'fantasy';
    const charName = (dossier.protagonist?.name || '').trim();

    try {
        // ── 1. Apply PbtA Ruleset Cartridge ─────────────────────────────────────
        onProgress('🎲 Installing PbtA ruleset and 2d6 engine...', 15);
        const cartridgeOk = await applyPbtACartridge(systemKey);
        if (!cartridgeOk) {
            throw new Error('Failed to install PbtA ruleset cartridge.');
        }

        // ── 2. Player Persona & Lorebook Card ────────────────────────────────────
        if (charName) {
            onProgress(`👤 Setting up protagonist "${charName}"...`, 30);
            try {
                const charCreator = await import('../SillyTavern-MultihogDnDFramework/character-creator.js');

                // Activate or create persona
                if (typeof charCreator.activateSillyTavernPersona === 'function') {
                    await charCreator.activateSillyTavernPersona(charName, { chatId });
                }

                // Add to Lorebook Agent
                if (typeof charCreator.addPlayerCardToLorebookAgent === 'function') {
                    const bio = dossier.protagonist.bio || `${charName}, a ${dossier.protagonist.playbook || 'wanderer'}.`;
                    await charCreator.addPlayerCardToLorebookAgent(charName, bio, 150, { chatId });
                }

                // Sync portrait if available
                if (dossier.protagonist.portraitSrc) {
                    const persona = await findMatchingPersona(charName);
                    if (persona) {
                        await uploadImageToPersona(persona.avatar, dossier.protagonist.portraitSrc);
                    }
                }

                // Lock persona to chat
                const persona = await findMatchingPersona(charName);
                if (persona) {
                    await syncPersonaToChat(chatId, persona);
                }
            } catch (err) {
                console.warn('[PbtA Concierge] Protagonist persona setup encountered non-fatal error:', err);
            }
        }

        // ── 3. Sequential Map Architect Generation ──────────────────────────────
        const maps = dossier.maps || [];
        if (maps.length) {
            try {
                const mapArch = await import('../SillyTavern-MultihogDnDFramework/map-architect.js');
                if (typeof mapArch.runMapArchitect === 'function') {
                    let mapIndex = 0;
                    for (const map of maps) {
                        mapIndex++;
                        const pct = 30 + Math.floor((mapIndex / maps.length) * 30);
                        onProgress(`🗺️ Generating map ${mapIndex}/${maps.length}: ${map.site}...`, pct);

                        try {
                            await mapArch.runMapArchitect({
                                site: map.site,
                                entrance: map.entrance || 'Main Threshold',
                                kind: map.kind || 'INTERIOR',
                                scale: 'SMALL',
                                threat: map.threat || 'MODERATE',
                                prompt: map.prompt || map.briefDescription,
                                brief_description: map.briefDescription || map.prompt,
                            });
                        } catch (mapErr) {
                            console.warn(`[PbtA Concierge] Map Architect skipped "${map.site}":`, mapErr);
                        }
                    }
                }
            } catch (err) {
                console.warn('[PbtA Concierge] Map Architect import failed:', err);
            }
        }

        // ── 4. Upsert Monsters into NPC Library ─────────────────────────────────
        const monsters = dossier.monsters || [];
        if (monsters.length) {
            onProgress('👹 Registering adversaries in library...', 70);
            try {
                const npcLib = await import('../SillyTavern-MultihogDnDFramework/npc-library.js');
                if (typeof npcLib.upsertLibraryNpc === 'function') {
                    for (const m of monsters) {
                        const content = `[NPC]\nName: ${m.name}\nThreat Level: PbtA Adversary (Harm ${m.harm}, Armor ${m.armor})\nAttacks: ${m.attacks.join(', ')}\nWeakness: ${m.weakness}\nNotes: ${m.notes}\n[/NPC]`;
                        await npcLib.upsertLibraryNpc({
                            name: m.name,
                            synopsis: `${m.name} — Harm ${m.harm}, Armor ${m.armor}. Weakness: ${m.weakness}`,
                            content,
                        });
                    }
                }
            } catch (err) {
                console.warn('[PbtA Concierge] Monster registration encountered non-fatal error:', err);
            }
        }

        // ── 5. Inject Dossier into World Info & State ───────────────────────────
        onProgress('📜 Inscribing Campaign Dossier into World Memory...', 85);
        const dossierMd = serializeDossierToMarkdown(dossier);
        await injectDossierIntoWorldInfo(chatId, dossierMd);

        // Store dossier in MultiHog chatState for runtime panel access
        const rpgSettings = ctx.extensionSettings?.rpg_tracker;
        if (rpgSettings?.chatStates?.[chatId]) {
            rpgSettings.chatStates[chatId].pbtaCampaignDossier = dossier;
        }

        // ── 6. Opening Fiction Scene (Turn 0) ───────────────────────────────────
        onProgress('🚀 Launching opening adventure turn...', 95);
        const openingText = dossier.theKick?.openingPrompt
            ? dossier.theKick.openingPrompt
            : `[Initial Setup: ${dossier.meta?.title || 'PbtA Adventure'}]\n${dossier.meta?.premise || 'The adventure begins.'}\n\nWhat do you do?`;

        sendOutgoingChatMessage(openingText);

        onProgress('✨ Adventure successfully launched!', 100);
        return { success: true, message: 'Campaign launched successfully!' };
    } catch (err) {
        console.error('[PbtA Concierge] Campaign launch failed:', err);
        return { success: false, message: err.message || String(err) };
    }
}

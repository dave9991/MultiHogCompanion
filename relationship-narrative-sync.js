/**
 * relationship-narrative-sync.js — MultiHog Companion
 *
 * Synchronizes MultiHog NPC relationships with SillyTavern lorebook narratives:
 *
 * 1. Direction A (Day 1 / First Encounter):
 *    Scans the NPC's lorebook entry to evaluate starting friendship & affection
 *    toward the PC. Runs ONCE EVER per NPC (no-op if already seeded or synced).
 *    Strictly assigns (0, 0) if the NPC has not met the PC or is an unaffiliated third party.
 *
 * 2. Direction B (Narrative Evolution / Tier Crossovers):
 *    Monitors relationship scores. When an NPC crosses a major MultiHog tier boundary,
 *    triggers an LLM completion using MultiHog's configured State Tracker connection to
 *    perform a full, cohesive rewrite of the lorebook entry.
 *    Eliminates narrative contradictions while preserving backstory, traits, and appearance.
 *
 * STRICT CONSTRAINT: Does not modify any upstream MultiHog files.
 */

const EXTENSION_NAME = 'multihog_companion';

function getExtSettings() {
    return (typeof extension_settings !== 'undefined' ? extension_settings : (globalThis.extension_settings || {})) || {};
}

function triggerSaveMetadata() {
    if (typeof saveMetadataDebounced === 'function') {
        try { saveMetadataDebounced(); } catch (_) {}
    } else if (typeof globalThis.saveMetadataDebounced === 'function') {
        try { globalThis.saveMetadataDebounced(); } catch (_) {}
    }
}

async function sendLlmPrompt(connSettings, messages) {
    const conn = await import('./concierge-connection.js');
    return await conn.sendRoutedLlmRequest(connSettings, messages);
}

// ── 1. MultiHog Tier Math (Percentage-of-Max Thresholds) ───────────────────────

/**
 * Maps a friendship value to a tier label and behavioral hint.
 * Matches MultiHog upstream relationship-math.js.
 * @param {number} value
 * @param {number} [max=150]
 * @returns {{ label: string, hint: string }}
 */
export function getFriendshipTier(value, max = 150) {
    const m = max || 150;
    const v = Math.max(-m, Math.min(m, Math.round(Number(value) || 0)));
    if (v <= -0.85 * m) return { label: 'HOSTILE', hint: 'open contempt, refuses cooperation, may sabotage or attack' };
    if (v <= -0.65 * m) return { label: 'ENEMY/HATEFUL', hint: 'deeply despises you, actively seeks to undermine your goals' };
    if (v <= -0.45 * m) return { label: 'BITTER/RESENTFUL', hint: 'hostile tone, holds active grudges, quick to anger' };
    if (v <= -0.25 * m) return { label: 'UNFRIENDLY/COLD', hint: 'curt and guarded, answers with bare minimum, visible irritation' };
    if (v <= -0.10 * m) return { label: 'DISTRUSTFUL/GUARDED', hint: 'suspicious of your motives, keeps a physical and emotional distance' };
    if (v <= -0.03 * m) return { label: 'WARY/UNEASY', hint: 'polite but distant, avoids personal topics, second-guesses motives' };
    if (v <=  0.03 * m) return { label: 'NEUTRAL/ACQUAINTANCE', hint: 'civil and transactional, neither warm nor cold' };
    if (v <=  0.10 * m) return { label: 'WARMING/FAVORABLE', hint: 'small smiles, starting to open up, shows basic goodwill' };
    if (v <=  0.25 * m) return { label: 'AMICABLE', hint: 'pleasant and chatty, actively engages in conversation, cooperative' };
    if (v <=  0.45 * m) return { label: 'FRIENDLY', hint: 'genuine warmth, light humor, willing to help when asked' };
    if (v <=  0.65 * m) return { label: 'CLOSE FRIEND', hint: 'deep trust, confides worries, stands up for you, proactive help' };
    if (v <=  0.85 * m) return { label: 'DEEP BOND/TRUSTED', hint: 'fiercely protective, emotional bedrock, treats you as inner circle' };
    return { label: 'BONDED/FAMILY', hint: 'unbreakable loyalty, would risk life without hesitation, shares deepest secrets' };
}

/**
 * Maps an affection value to a tier label and behavioral hint.
 * Matches MultiHog upstream relationship-math.js.
 * @param {number} value
 * @param {number} [max=150]
 * @returns {{ label: string, hint: string }}
 */
export function getAffectionTier(value, max = 150) {
    const m = max || 150;
    const v = Math.max(-m, Math.min(m, Math.round(Number(value) || 0)));
    if (v <= -0.85 * m) return { label: 'REVULSION', hint: 'finds your presence repulsive, recoils from proximity, hostile to advances' };
    if (v <= -0.65 * m) return { label: 'DISGUSTED', hint: 'active disdain for romantic or physical proximity, harsh rejections' };
    if (v <= -0.45 * m) return { label: 'AVERSION', hint: 'clearly uninterested, dismisses flirtation coldly, steers away from intimacy' };
    if (v <= -0.25 * m) return { label: 'AVOIDANT', hint: 'uncomfortable with romantic attention, subtly creates physical distance' };
    if (v <= -0.10 * m) return { label: 'UNRECEPTIVE/WITHDRAWN', hint: 'shuts down romantic undertones, visibly uncomfortable with flirting' };
    if (v <= -0.03 * m) return { label: 'INDIFFERENT/UNINTERESTED', hint: 'no romantic spark, gentle deflection of any advances' };
    if (v <=  0.03 * m) return { label: 'NEUTRAL/NO AFFECTION', hint: 'no romantic or emotional attachment toward you' };
    if (v <=  0.10 * m) return { label: 'CURIOUS/INTRIGUED', hint: 'brief lingering looks, testing waters, open to playful banter' };
    if (v <=  0.25 * m) return { label: 'RECEPTIVE/FLIRTATIOUS', hint: 'actively returns flirting, welcomes light physical touch, playful tension' };
    if (v <=  0.45 * m) return { label: 'INTERESTED', hint: 'steals glances, responds warmly to compliments, comfortable with proximity' };
    if (v <=  0.65 * m) return { label: 'ATTRACTED', hint: 'seeks your company, flustered by bold compliments, visible tension' };
    if (v <=  0.85 * m) return { label: 'SMITTEN/INFATUATED', hint: 'cannot hide feelings, heavily romantic, deeply emotionally invested' };
    return { label: 'DEEPLY IN LOVE', hint: 'emotionally devoted, craves closeness, expresses tenderness openly' };
}

// ── 2. Prompt Builders & Parsers ──────────────────────────────────────────────

/**
 * Direction A: Prompt to evaluate starting relationship from NPC narrative text.
 * @param {string} npcName
 * @param {string} npcContent
 * @param {string} pcName
 * @returns {Array<{ role: string, content: string }>}
 */
export function buildDirectionAPrompt(npcName, npcContent, pcName) {
    const safeNpc = npcName || 'the NPC';
    const safePc = pcName || 'the Protagonist';

    const systemPrompt = `You are an objective RPG relationship evaluator.
Your sole job is to evaluate the starting interpersonal bond of ${safeNpc} toward ${safePc}.

CRITICAL EVALUATION RULES:
1. Evaluate ONLY what ${safeNpc} feels toward ${safePc} (one-directional). Do NOT evaluate what ${safePc} feels toward ${safeNpc}.
2. If ${safeNpc} has not met ${safePc} yet, has no established personal history with ${safePc}, or is an unaffiliated third party (e.g. bandit, stranger, guard, neutral shopkeeper), you MUST strictly assign 0 Friendship and 0 Affection.
3. Only assign non-zero values if the text explicitly describes a pre-existing bond, allegiance, rivalry, friendship, debt, or romantic history with ${safePc}.
4. Scale Range:
   - Friendship: -150 to +150 (Hostile = -100, Distrustful = -40, Neutral/Stranger = 0, Amicable = +25, Friendly = +50, Devoted Ally = +100)
   - Affection: -150 to +150 (Revulsion = -100, Indifferent = 0, Flirtatious/Crush = +30, Deep Romance = +80)

Respond strictly in valid JSON format:
{
  "friendship": <integer -150 to 150>,
  "affection": <integer -150 to 150>,
  "reason": "<brief 1-sentence rationale>"
}`;

    const userPrompt = `NPC NAME: ${safeNpc}
PROTAGONIST: ${safePc}

NPC LOREBOOK DESCRIPTION:
${npcContent}

Evaluate ${safeNpc}'s starting friendship and affection toward ${safePc}:`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Direction A: Parses the JSON response from the evaluator model.
 * @param {string} rawText
 * @returns {{ friendship: number, affection: number, reason: string } | null}
 */
export function parseDirectionAResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.friendship === 'number' && typeof parsed.affection === 'number') {
            return {
                friendship: Math.max(-150, Math.min(150, Math.round(parsed.friendship))),
                affection: Math.max(-150, Math.min(150, Math.round(parsed.affection))),
                reason: String(parsed.reason || '').trim(),
            };
        }
    } catch (_) {}
    return null;
}

/**
 * Direction B: Prompt for full cohesive rewrite of NPC lorebook entry on tier crossover.
 * @param {string} npcName
 * @param {string} currentContent
 * @param {string} pcName
 * @param {Array<object>} recentLogs
 * @param {{ label: string, hint: string }} targetFriendshipTier
 * @param {{ label: string, hint: string }} targetAffectionTier
 * @returns {Array<{ role: string, content: string }>}
 */
export function buildDirectionBPrompt(npcName, currentContent, pcName, recentLogs, targetFriendshipTier, targetAffectionTier) {
    const safeNpc = npcName || 'the NPC';
    const safePc = pcName || 'the Protagonist';

    const formattedLogs = (recentLogs && recentLogs.length > 0)
        ? recentLogs.map(l => `• [${l.field?.toUpperCase() || 'DELTA'} ${l.delta >= 0 ? '+' : ''}${l.delta}] New Value: ${l.newValue}${l.reason ? ` (${l.reason})` : ''}`).join('\n')
        : '(Relationship points shifted through ongoing gameplay)';

    const systemPrompt = `You are an expert RPG narrative author.
The relationship between ${safeNpc} and the protagonist ${safePc} has evolved significantly during the campaign.

Your task is to write a FULL, COHESIVE REWRITE of ${safeNpc}'s lorebook entry.

REWRITE RULES:
1. PRESERVE CORE FACTS: Keep ${safeNpc}'s appearance, voice, equipment, skills, and fundamental historical backstory intact.
2. ELIMINATE CONTRADICTIONS: Update their current demeanor, social standing, and feelings toward ${safePc} so the entire entry flows seamlessly. (For example: if the original entry stated they were an isolated loner who refuses to speak to anyone, update that aspect to reflect that ${safePc} has earned their trust while preserving their quiet, cautious demeanor).
3. NEW ATTITUDE TARGETS:
   - Friendship Standing: ${targetFriendshipTier.label} (${targetFriendshipTier.hint})
   - Affection Standing: ${targetAffectionTier.label} (${targetAffectionTier.hint})
4. FORMAT: Output ONLY the updated lorebook entry text. Do NOT wrap in markdown code blocks (\`\`\`), do NOT include conversational greetings or meta commentary.`;

    const userPrompt = `NPC NAME: ${safeNpc}
PROTAGONIST: ${safePc}

RECENT RELATIONSHIP LOG:
${formattedLogs}

CURRENT LOREBOOK ENTRY FOR ${safeNpc}:
${currentContent}

Write the cohesive updated lorebook entry for ${safeNpc}:`;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];
}

/**
 * Direction B: Parses and cleans the rewritten lorebook text.
 * @param {string} rawText
 * @returns {string | null}
 */
export function parseDirectionBResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    let clean = rawText.trim();
    // Strip markdown code fences if model enclosed response in them
    clean = clean.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    // Strip conversational lead-ins
    clean = clean.replace(/^(?:Here is (?:the|an) updated (?:lorebook )?entry[^:\n]*:\s*)+/i, '').trim();
    return clean.length >= 20 ? clean : null;
}

// ── 3. Connection & State Helpers ─────────────────────────────────────────────

/**
 * Reads MultiHog's configured State Tracker connection parameters.
 * Falls back to default if not configured.
 * @returns {object}
 */
export function getStateTrackerConnectionSettings() {
    const extSettings = getExtSettings();
    const dnd = extSettings.multihog_dnd || {};
    const s = dnd.rpgSettings || {};

    return {
        connectionSource: s.connectionSource || 'default',
        connectionProfileId: s.connectionProfileId || '',
        completionPresetId: s.completionPresetId || '',
        ollamaUrl: s.ollamaUrl || 'http://localhost:11434',
        ollamaModel: s.ollamaModel || '',
        openaiUrl: s.openaiUrl || '',
        openaiKey: s.openaiKey || '',
        openaiModel: s.openaiModel || '',
        maxTokens: 1024,
    };
}

/**
 * Resolves active protagonist / player character name.
 * @returns {string}
 */
export function resolveActiveProtagonistName() {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (ctx?.chat_metadata?.character_name) return ctx.chat_metadata.character_name;
    if (ctx?.name1) return ctx.name1;
    return 'The Protagonist';
}

/**
 * In-memory ledger fallback if chat_metadata is not yet mounted.
 */
const inMemorySyncLedger = new Map();

/**
 * Retrieves the relationship sync ledger for a chat.
 * @param {string} [chatId]
 * @returns {Record<string, object>}
 */
export function getRelationshipSyncLedger(chatId = '') {
    const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
    if (ctx?.chat_metadata) {
        ctx.chat_metadata.mhc_rel_narrative_sync = ctx.chat_metadata.mhc_rel_narrative_sync || {};
        return ctx.chat_metadata.mhc_rel_narrative_sync;
    }
    const key = chatId || 'default';
    if (!inMemorySyncLedger.has(key)) {
        inMemorySyncLedger.set(key, {});
    }
    return inMemorySyncLedger.get(key);
}

/**
 * Updates an entry in the relationship sync ledger.
 * @param {string} fullId `${bookName}::${uid}`
 * @param {object} record
 * @param {string} [chatId]
 */
export function updateRelationshipSyncLedger(fullId, record, chatId = '') {
    const ledger = getRelationshipSyncLedger(chatId);
    ledger[fullId] = Object.assign(ledger[fullId] || {}, record);
    triggerSaveMetadata();
}

// ── 4. Synchronization Orchestration ──────────────────────────────────────────

let isSyncInProgress = false;

/**
 * Checks if Relationship Narrative Sync is currently enabled and permissible.
 * @returns {boolean}
 */
export function isNarrativeSyncEnabled() {
    const extSettings = getExtSettings();
    const companion = extSettings[EXTENSION_NAME] || {};
    const dnd = extSettings.multihog_dnd || {};
    const rpg = dnd.rpgSettings || {};

    const barsEnabled = rpg.npcRelationshipBars !== false;
    const syncEnabled = companion.enableRelationshipNarrativeSync !== false;
    return barsEnabled && syncEnabled;
}

/**
 * Direction A: Scans campaign NPC lorebook entries and initializes unsynced NPCs.
 * Strictly runs ONCE EVER per NPC (no-ops if already seeded or synced).
 *
 * @param {object} [options]
 * @param {boolean} [options.forceAll=false]
 * @returns {Promise<{ scanned: number, initialized: number, skipped: number }>}
 */
export async function scanAndInitUnsyncedNpcs({ forceAll = false } = {}) {
    if (isSyncInProgress) {
        return { scanned: 0, initialized: 0, skipped: 0 };
    }
    if (!isNarrativeSyncEnabled() && !forceAll) {
        return { scanned: 0, initialized: 0, skipped: 0 };
    }

    isSyncInProgress = true;
    let scanned = 0;
    let initialized = 0;
    let skipped = 0;

    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (!ctx) return { scanned: 0, initialized: 0, skipped: 0 };

        const extSettings = getExtSettings();
        const dnd = extSettings.multihog_dnd || {};
        const rpg = dnd.rpgSettings = dnd.rpgSettings || {};
        rpg.npcRelationshipValues = rpg.npcRelationshipValues || {};
        rpg.npcRelationshipLog = rpg.npcRelationshipLog || {};

        const ledger = getRelationshipSyncLedger();
        const pcName = resolveActiveProtagonistName();
        const connSettings = getStateTrackerConnectionSettings();

        // 1. Identify active NPC lorebook
        let npcBookName = rpg.campaignBooks?.npcs || '';
        if (!npcBookName) {
            try {
                const stateMgr = await import('../SillyTavern-MultihogDnDFramework/state-manager.js');
                const chatId = ctx.getCurrentChatId?.() || ctx.chatId || '';
                const prefix = stateMgr.getEffectiveRouterCampaignPrefix?.(chatId);
                if (prefix) npcBookName = `${prefix}_NPCs`;
            } catch (_) {}
        }
        if (!npcBookName) {
            return { scanned: 0, initialized: 0, skipped: 0 };
        }

        // 2. Fetch lorebook entries
        const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
        const res = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name: npcBookName }),
        });
        if (!res.ok) return { scanned: 0, initialized: 0, skipped: 0 };
        const bookData = await res.json();
        if (!bookData?.entries) return { scanned: 0, initialized: 0, skipped: 0 };

        for (const [uidStr, entry] of Object.entries(bookData.entries)) {
            const uid = parseInt(uidStr, 10);
            const fullId = `${npcBookName}::${uid}`;
            const npcName = (entry.comment || entry.key?.[0] || '').trim();
            if (!npcName || !entry.content) continue;
            scanned++;

            // Check ledger: IF ALREADY INITIALIZED -> NO-OP
            if (ledger[fullId]?.initialized && !forceAll) {
                skipped++;
                continue;
            }

            // Check existing values in MultiHog
            const existingVal = rpg.npcRelationshipValues[fullId];
            if (existingVal && (existingVal.friendship !== 0 || existingVal.affection !== 0) && !forceAll) {
                // Already has non-zero values (e.g. from Concierge or manual edit)
                updateRelationshipSyncLedger(fullId, {
                    initialized: true,
                    lastSyncedTier: {
                        friendship: getFriendshipTier(existingVal.friendship).label,
                        affection: getAffectionTier(existingVal.affection).label,
                    },
                    lastFriendshipScore: existingVal.friendship,
                    lastAffectionScore: existingVal.affection,
                    lastSyncedAt: Date.now(),
                    initialSource: 'pre_existing',
                });
                skipped++;
                continue;
            }

            // Execute Direction A Micro-Scan
            const messages = buildDirectionAPrompt(npcName, entry.content, pcName);
            try {
                const rawOutput = await sendLlmPrompt(connSettings, messages);
                const parsed = parseDirectionAResponse(rawOutput);
                if (parsed) {
                    rpg.npcRelationshipValues[fullId] = {
                        friendship: parsed.friendship,
                        affection: parsed.affection,
                    };
                    rpg.npcRelationshipLog[fullId] = rpg.npcRelationshipLog[fullId] || [];
                    rpg.npcRelationshipLog[fullId].unshift({
                        timestamp: Date.now(),
                        field: 'friendship',
                        delta: parsed.friendship,
                        newValue: parsed.friendship,
                        source: 'narrative_init_sync',
                        reason: parsed.reason,
                    });

                    updateRelationshipSyncLedger(fullId, {
                        initialized: true,
                        lastSyncedTier: {
                            friendship: getFriendshipTier(parsed.friendship).label,
                            affection: getAffectionTier(parsed.affection).label,
                        },
                        lastFriendshipScore: parsed.friendship,
                        lastAffectionScore: parsed.affection,
                        lastSyncedAt: Date.now(),
                        initialSource: 'narrative_scan',
                    });
                    initialized++;
                } else {
                    // Default to neutral 0,0 and record so we do not re-run repeatedly
                    updateRelationshipSyncLedger(fullId, {
                        initialized: true,
                        lastSyncedTier: {
                            friendship: getFriendshipTier(0).label,
                            affection: getAffectionTier(0).label,
                        },
                        lastFriendshipScore: 0,
                        lastAffectionScore: 0,
                        lastSyncedAt: Date.now(),
                        initialSource: 'default_neutral',
                    });
                }
            } catch (err) {
                console.warn(`[MultiHog Companion] Direction A scan failed for ${npcName}:`, err);
            }
        }
    } finally {
        isSyncInProgress = false;
    }

    return { scanned, initialized, skipped };
}

/**
 * Direction B: Checks if any tracked NPC has crossed a tier boundary, and updates lorebook narrative.
 * @returns {Promise<{ checked: number, updated: number }>}
 */
export async function checkAndSyncTierCrossovers() {
    if (isSyncInProgress) {
        return { checked: 0, updated: 0 };
    }
    if (!isNarrativeSyncEnabled()) {
        return { checked: 0, updated: 0 };
    }

    isSyncInProgress = true;
    let checked = 0;
    let updated = 0;

    try {
        const ctx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext?.() : null;
        if (!ctx) return { checked: 0, updated: 0 };

        const extSettings = getExtSettings();
        const dnd = extSettings.multihog_dnd || {};
        const rpg = dnd.rpgSettings || {};
        const relValues = rpg.npcRelationshipValues || {};
        const relLogs = rpg.npcRelationshipLog || {};
        const ledger = getRelationshipSyncLedger();
        const pcName = resolveActiveProtagonistName();
        const connSettings = getStateTrackerConnectionSettings();

        for (const [fullId, vals] of Object.entries(relValues)) {
            checked++;
            const fVal = vals?.friendship ?? 0;
            const aVal = vals?.affection ?? 0;
            const curFTier = getFriendshipTier(fVal);
            const curATier = getAffectionTier(aVal);

            const lastRec = ledger[fullId];
            const lastFTierLabel = lastRec?.lastSyncedTier?.friendship;
            const lastATierLabel = lastRec?.lastSyncedTier?.affection;

            // Tier boundary check: If tiers haven't changed, NO-OP!
            if (lastFTierLabel === curFTier.label && lastATierLabel === curATier.label) {
                continue;
            }

            // Split fullId to locate book and entry UID
            const [bookName, uidStr] = fullId.split('::');
            const uid = parseInt(uidStr, 10);
            if (!bookName || isNaN(uid)) continue;

            const getHeaders = ctx.getRequestHeaders || (() => ({ 'Content-Type': 'application/json' }));
            let bookData = null;
            try {
                const bRes = await fetch('/api/worldinfo/get', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ name: bookName }),
                });
                if (bRes.ok) bookData = await bRes.json();
            } catch (_) {}

            const entry = bookData?.entries?.[uid];
            if (!entry || !entry.content) continue;

            const npcName = (entry.comment || entry.key?.[0] || '').trim();
            const recentLogs = (relLogs[fullId] || []).slice(0, 5);

            // Execute Direction B Narrative Rewrite
            const messages = buildDirectionBPrompt(npcName, entry.content, pcName, recentLogs, curFTier, curATier);
            try {
                const rawOutput = await sendLlmPrompt(connSettings, messages);
                const rewritten = parseDirectionBResponse(rawOutput);
                if (rewritten && rewritten !== entry.content) {
                    entry.content = rewritten;

                    // Save to SillyTavern World Info
                    await fetch('/api/worldinfo/edit', {
                        method: 'POST',
                        headers: getHeaders(),
                        body: JSON.stringify({ name: bookName, data: bookData }),
                    });

                    // Flush MultiHog router cache if available
                    try {
                        const router = await import('../SillyTavern-MultihogDnDFramework/router.js');
                        if (typeof router.updateWorldInfoCache === 'function') {
                            await router.updateWorldInfoCache(bookName, bookData);
                        }
                    } catch (_) {}

                    updateRelationshipSyncLedger(fullId, {
                        initialized: true,
                        lastSyncedTier: {
                            friendship: curFTier.label,
                            affection: curATier.label,
                        },
                        lastFriendshipScore: fVal,
                        lastAffectionScore: aVal,
                        lastSyncedAt: Date.now(),
                    });
                    updated++;

                    if (typeof toastr !== 'undefined' && extSettings[EXTENSION_NAME]?.showToasts !== false) {
                        toastr.info(`📖 ${npcName}'s narrative evolved to ${curFTier.label}`, 'Relationship Narrative Sync');
                    }
                }
            } catch (err) {
                console.warn(`[MultiHog Companion] Direction B sync failed for ${npcName}:`, err);
            }
        }
    } finally {
        isSyncInProgress = false;
    }

    return { checked, updated };
}

/**
 * Returns a live status summary of tracked NPCs for UI display.
 * @returns {object}
 */
export function getRelationshipSyncStatus() {
    const extSettings = getExtSettings();
    const dnd = extSettings.multihog_dnd || {};
    const rpg = dnd.rpgSettings || {};
    const relValues = rpg.npcRelationshipValues || {};
    const ledger = getRelationshipSyncLedger();

    const barsEnabled = rpg.npcRelationshipBars !== false;
    const syncEnabled = extSettings[EXTENSION_NAME]?.enableRelationshipNarrativeSync !== false;

    const items = Object.entries(relValues).map(([fullId, vals]) => {
        const parts = fullId.split('::');
        const uid = parts[1] || '';
        const rec = ledger[fullId];
        const fVal = vals?.friendship ?? 0;
        const aVal = vals?.affection ?? 0;
        const fTier = getFriendshipTier(fVal);
        const aTier = getAffectionTier(aVal);

        return {
            fullId,
            uid,
            friendship: fVal,
            affection: aVal,
            friendshipTier: fTier.label,
            affectionTier: aTier.label,
            lastSyncedAt: rec?.lastSyncedAt || null,
            isInitialized: !!rec?.initialized,
        };
    });

    return {
        barsEnabled,
        syncEnabled,
        active: barsEnabled && syncEnabled,
        trackedCount: items.length,
        items,
    };
}

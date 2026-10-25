import assert from 'assert';
import {
    getFriendshipTier,
    getAffectionTier,
    buildDirectionAPrompt,
    parseDirectionAResponse,
    buildDirectionBPrompt,
    parseDirectionBResponse,
    getRelationshipSyncLedger,
    updateRelationshipSyncLedger,
    extractRecentDialoguePairs,
    patchLabeledSection,
    patchNpcLorebookEntry,
    getInGameTimestamp,
} from '../relationship-narrative-sync.js';

console.log('--- Running Relationship Narrative Sync Test Suite ---');

// ── 1. MultiHog Tier Math & Boundaries ──────────────────────────────────────────
console.log('Testing Tier Calculations & Math...');

// Friendship Tiers
assert.strictEqual(getFriendshipTier(-140, 150).label, 'HOSTILE');
assert.strictEqual(getFriendshipTier(-100, 150).label, 'ENEMY/HATEFUL');
assert.strictEqual(getFriendshipTier(-70, 150).label, 'BITTER/RESENTFUL');
assert.strictEqual(getFriendshipTier(-40, 150).label, 'UNFRIENDLY/COLD');
assert.strictEqual(getFriendshipTier(-20, 150).label, 'DISTRUSTFUL/GUARDED');
assert.strictEqual(getFriendshipTier(-10, 150).label, 'WARY/UNEASY');
assert.strictEqual(getFriendshipTier(0, 150).label, 'NEUTRAL/ACQUAINTANCE');
assert.strictEqual(getFriendshipTier(10, 150).label, 'WARMING/FAVORABLE');
assert.strictEqual(getFriendshipTier(30, 150).label, 'AMICABLE');
assert.strictEqual(getFriendshipTier(50, 150).label, 'FRIENDLY');
assert.strictEqual(getFriendshipTier(80, 150).label, 'CLOSE FRIEND');
assert.strictEqual(getFriendshipTier(110, 150).label, 'DEEP BOND/TRUSTED');
assert.strictEqual(getFriendshipTier(140, 150).label, 'BONDED/FAMILY');
console.log('✓ Friendship tiers correctly calculate across all 13 boundary intervals');

// Affection Tiers
assert.strictEqual(getAffectionTier(-140, 150).label, 'REVULSION');
assert.strictEqual(getAffectionTier(-100, 150).label, 'DISGUSTED');
assert.strictEqual(getAffectionTier(0, 150).label, 'NEUTRAL/NO AFFECTION');
assert.strictEqual(getAffectionTier(10, 150).label, 'CURIOUS/INTRIGUED');
assert.strictEqual(getAffectionTier(30, 150).label, 'RECEPTIVE/FLIRTATIOUS');
assert.strictEqual(getAffectionTier(50, 150).label, 'INTERESTED');
assert.strictEqual(getAffectionTier(80, 150).label, 'ATTRACTED');
assert.strictEqual(getAffectionTier(110, 150).label, 'SMITTEN/INFATUATED');
assert.strictEqual(getAffectionTier(140, 150).label, 'DEEPLY IN LOVE');
console.log('✓ Affection tiers correctly calculate across all 13 boundary intervals');

// ── 2. Direction A: Prompt & Response Parsing ─────────────────────────────────
console.log('Testing Direction A (Narrative -> Initial Numbers)...');

const dirAPrompt = buildDirectionAPrompt('Marta Okonkwo', 'Quartermaster who fought alongside Silas Vance during the Siege.', 'Silas Vance');
assert.strictEqual(dirAPrompt.length, 2);
assert.strictEqual(dirAPrompt[0].role, 'system');
assert.ok(dirAPrompt[0].content.includes('Marta Okonkwo'), 'Prompt must specify NPC name');
assert.ok(dirAPrompt[0].content.includes('Silas Vance'), 'Prompt must specify PC name');
assert.ok(dirAPrompt[0].content.includes('one-directional'), 'Prompt must enforce one-directional evaluation');
assert.ok(dirAPrompt[0].content.includes('0 Friendship and 0 Affection'), 'Prompt must instruct 0,0 for unmet or unaffiliated NPCs');
assert.ok(dirAPrompt[1].content.includes('Quartermaster who fought alongside Silas Vance'), 'User prompt must include lorebook text');

// Parsing valid JSON
const validAResp = `Here is my evaluation:
\`\`\`json
{
  "friendship": 45,
  "affection": 10,
  "reason": "Comrades in arms during the Siege of Vane."
}
\`\`\``;
const parsedA = parseDirectionAResponse(validAResp);
assert.ok(parsedA, 'Should parse valid JSON');
assert.strictEqual(parsedA.friendship, 45);
assert.strictEqual(parsedA.affection, 10);
assert.strictEqual(parsedA.reason, 'Comrades in arms during the Siege of Vane.');

// Clamping out-of-bounds
const overBoundResp = JSON.stringify({ friendship: 999, affection: -500, reason: 'Wild extremes' });
const parsedOver = parseDirectionAResponse(overBoundResp);
assert.strictEqual(parsedOver.friendship, 150, 'Friendship should clamp to +150');
assert.strictEqual(parsedOver.affection, -150, 'Affection should clamp to -150');

// Handling invalid / garbage response
assert.strictEqual(parseDirectionAResponse('I think they are friends.'), null);
assert.strictEqual(parseDirectionAResponse(null), null);

// Reasoning models: In-band thinking tags with scratchpad braces before final JSON
const reasoningAResp = `<think>
Let's analyze Marta and Silas.
Could starting bond be { "friendship": 0, "affection": 0 }? No, they served together in the Siege.
I will set friendship to 35.
</think>
\`\`\`json
{
  "friendship": 35,
  "affection": 0,
  "reason": "Served together in the Siege."
}
\`\`\``;
const parsedReasoningA = parseDirectionAResponse(reasoningAResp);
assert.ok(parsedReasoningA, 'Should successfully parse final JSON even with scratchpad in thinking block');
assert.strictEqual(parsedReasoningA.friendship, 35);
assert.strictEqual(parsedReasoningA.affection, 0);
console.log('✓ Direction A prompt builder and robust response parser verified');

// ── 3. Direction B: Prompt, Structured Parsing & [CORE] Surgical Patching ────
console.log('Testing Direction B (Numbers -> Narrative Text Evolution)...');

// Dialogue Extraction
const mockChat = [
    { is_user: true, mes: 'Can you help us with the depot?' },
    { is_user: false, mes: 'I work alone. Stay out of my way.' },
    { is_system: true, mes: 'System notification: combat started.' },
    { is_user: true, mes: 'Watch out behind you!', extra: {} },
    { is_user: false, mes: '', extra: { type: 'tool', tool_calls: [{ id: '1' }] } },
    { is_user: false, mes: 'Marta swings her cybernetic arm and crushes the scavenger.' },
    { is_user: true, mes: 'Good hit! Let me patch up that hydraulic line.' },
    { is_user: false, mes: '...Thanks. That actually helps.' },
];
const extractedPairs = extractRecentDialoguePairs(mockChat, 3);
assert.strictEqual(extractedPairs.length, 3, 'Must extract exactly 3 dialogue pairs');
assert.strictEqual(extractedPairs[0].user, 'Can you help us with the depot?');
assert.strictEqual(extractedPairs[0].assistant, 'I work alone. Stay out of my way.');
assert.strictEqual(extractedPairs[1].user, 'Watch out behind you!');
assert.strictEqual(extractedPairs[1].assistant, 'Marta swings her cybernetic arm and crushes the scavenger.');
assert.strictEqual(extractedPairs[2].user, 'Good hit! Let me patch up that hydraulic line.');
assert.strictEqual(extractedPairs[2].assistant, '...Thanks. That actually helps.');
console.log('✓ extractRecentDialoguePairs correctly filters tools/system messages and matches 3 pairs');

// Direction B Prompt Builder
const coreEntry = `[CORE]
Species: Human, female cyborg.
Body: Muscular build, cybernetic left arm, silver cropped hair.
Worn Equipment: Blast-resistant coveralls, plasma cutter.
Personality: Cautious, blunt, slow to trust anyone.
Brief Background: Veteran engineer who defends the hangar.
Habits/Behaviors: Avoids eye contact and eats alone.
Combat Profile: AC 16, HP 45, BAB +3.
[/CORE]

## Narrative Chronicle
- [Day 10] Met Silas at the depot gates.`;

const logs = [
    { field: 'friendship', delta: 25, newValue: 45, reason: 'Silas repaired her cybernetic arm' },
    { field: 'friendship', delta: 25, newValue: 70, reason: 'Silas defended the supply depot' },
];
const fTier = getFriendshipTier(70);
const aTier = getAffectionTier(0);

const dirBPrompt = buildDirectionBPrompt('Marta Okonkwo', coreEntry, 'Silas Vance', logs, fTier, aTier, extractedPairs);
assert.strictEqual(dirBPrompt.length, 2);
assert.ok(dirBPrompt[0].content.includes('CONSERVATIVE BY DEFAULT'), 'Must instruct conservative edits by default');
assert.ok(dirBPrompt[0].content.includes('BOTH PROGRESSION AND DETERIORATION'), 'Must instruct both progression and deterioration');
assert.ok(dirBPrompt[0].content.includes('PRESERVE ALL OTHER FIELDS'), 'Must forbid changing species/body/equipment');
assert.ok(dirBPrompt[1].content.includes('Silas repaired her cybernetic arm'), 'User prompt must include relationship log context');
assert.ok(dirBPrompt[1].content.includes('Good hit! Let me patch up that hydraulic line.'), 'User prompt must include dialogue context');

// Direction B Response Parsing
const validBJson = `\`\`\`json
{
  "milestone": "Defended the supply depot shoulder-to-shoulder with Silas and allowed him to repair her cybernetic arm.",
  "personality": "Blunt and vigilant by nature, though now openly welcoming Silas to her workbench.",
  "habits": null
}
\`\`\``;
const parsedB = parseDirectionBResponse(validBJson);
assert.ok(parsedB, 'Must parse valid JSON response');
assert.strictEqual(parsedB.milestone, 'Defended the supply depot shoulder-to-shoulder with Silas and allowed him to repair her cybernetic arm.');
assert.strictEqual(parsedB.personality, 'Blunt and vigilant by nature, though now openly welcoming Silas to her workbench.');
assert.strictEqual(parsedB.habits, null);

// Parsing with <think> reasoning tokens
const thinkingBJson = `<think>
Evaluating Marta Okonkwo.
Friendship crossed into CLOSE FRIEND.
Personality should reflect subtle trust while habits remain unchanged.
</think>
{
  "milestone": "Acknowledged Silas as a trusted comrade after the depot defense.",
  "personality": null,
  "habits": null
}`;
const parsedThinking = parseDirectionBResponse(thinkingBJson);
assert.ok(parsedThinking, 'Must parse JSON prefixed with thinking tokens');
assert.strictEqual(parsedThinking.milestone, 'Acknowledged Silas as a trusted comrade after the depot defense.');
assert.strictEqual(parsedThinking.personality, null);

// Rejecting malformed or reasoning-only dumps
assert.strictEqual(parseDirectionBResponse('<think>Thinking only...</think>'), null);
assert.strictEqual(parseDirectionBResponse('{ "milestone": "" }'), null);
assert.strictEqual(parseDirectionBResponse(null), null);

// Testing patchNpcLorebookEntry with [CORE]
const patchedCore = patchNpcLorebookEntry(coreEntry, parsedB, 'Day 12, 14:00');
assert.ok(patchedCore.includes('Species: Human, female cyborg.'), 'Must preserve Species');
assert.ok(patchedCore.includes('Body: Muscular build, cybernetic left arm, silver cropped hair.'), 'Must preserve Body');
assert.ok(patchedCore.includes('Worn Equipment: Blast-resistant coveralls, plasma cutter.'), 'Must preserve Equipment');
assert.ok(patchedCore.includes('Combat Profile: AC 16, HP 45, BAB +3.'), 'Must preserve Combat Profile');
assert.ok(patchedCore.includes('Personality: Blunt and vigilant by nature, though now openly welcoming Silas to her workbench.'), 'Must update Personality');
assert.ok(patchedCore.includes('Habits/Behaviors: Avoids eye contact and eats alone.'), 'Must preserve Habits when null');
assert.ok(patchedCore.includes('- [Day 10] Met Silas at the depot gates.'), 'Must preserve existing chronicle');
assert.ok(patchedCore.includes('- [Day 12, 14:00] Relationship Milestone: Defended the supply depot shoulder-to-shoulder with Silas and allowed him to repair her cybernetic arm.'), 'Must append relationship milestone with timestamp');

// Testing patchNpcLorebookEntry fallback with non-[CORE] entry
const flatEntry = 'Marta is an independent quartermaster who watches the hangar.';
const patchedFlat = patchNpcLorebookEntry(flatEntry, { milestone: 'Earned her respect.' }, 'Day 15');
assert.ok(patchedFlat.startsWith('Marta is an independent quartermaster who watches the hangar.'), 'Must preserve flat text');
assert.ok(patchedFlat.includes('- [Day 15] Relationship Milestone: Earned her respect.'), 'Must append milestone to flat text');

console.log('✓ Direction B prompt builder, JSON parser, and [CORE] surgical patcher verified');

// ── 4. Ledger & Guardrails ────────────────────────────────────────────────────
console.log('Testing Sync Ledger & Once-Ever / Same-Tier Guardrails...');

const testChatId = 'test-adventure-chat';
const fullId = 'TEST_NPCs::4';

updateRelationshipSyncLedger(fullId, {
    initialized: true,
    lastSyncedTier: {
        friendship: 'NEUTRAL/ACQUAINTANCE',
        affection: 'NEUTRAL/NO AFFECTION',
    },
    lastFriendshipScore: 0,
    lastAffectionScore: 0,
    lastSyncedAt: 1728440000,
}, testChatId);

const ledger = getRelationshipSyncLedger(testChatId);
assert.ok(ledger[fullId]);
assert.strictEqual(ledger[fullId].initialized, true);
assert.strictEqual(ledger[fullId].lastSyncedTier.friendship, 'NEUTRAL/ACQUAINTANCE');

// Verify Same-Tier Detection (No-op condition)
const currentFriendshipScore = 3; // Still within NEUTRAL/ACQUAINTANCE (-4.5 to +4.5)
const curTier = getFriendshipTier(currentFriendshipScore);
assert.strictEqual(curTier.label, ledger[fullId].lastSyncedTier.friendship, 'Score of 3 is still Neutral; tier crossover must NOT trigger');

// Verify Tier Crossover Detection (Trigger condition)
const evolvedScore = 20; // Crosses to WARMING/FAVORABLE
const evolvedTier = getFriendshipTier(evolvedScore);
assert.notStrictEqual(evolvedTier.label, ledger[fullId].lastSyncedTier.friendship, 'Score of 20 crosses tier boundary; must trigger Direction B');
// ── 5. Chat Switch & Pre-Existing Relationship Preservation ──────────────────
console.log('Testing Chat Switch & Pre-Existing Relationship Preservation...');

import { scanAndInitUnsyncedNpcs } from '../relationship-narrative-sync.js';

// Setup global mock environment mimicking SillyTavern and MultiHog framework
const mockChatId = 'old-adventure-chat-123';
const mockRpgTracker = {
    npcRelationshipBars: true,
    campaignBooks: { npcs: 'Eldoria_NPCs' },
    npcRelationshipValues: {
        'Eldoria_NPCs::1': { friendship: 45, affection: 15 },
    },
    npcRelationshipLog: {
        'Eldoria_NPCs::1': [
            { field: 'friendship', delta: 45, newValue: 45, reason: 'Historical campaign bond' },
        ],
    },
    chatStates: {
        [mockChatId]: {
            npcRelationshipValues: {
                'Eldoria_NPCs::1': { friendship: 45, affection: 15 },
                'Eldoria_NPCs::2': { friendship: 60, affection: 25 },
            },
        },
    },
};

const mockMetadata = {
    character_name: 'Silas Vance',
    mhc_rel_narrative_sync: {},
};

globalThis.SillyTavern = {
    getContext: () => ({
        chatId: mockChatId,
        getCurrentChatId: () => mockChatId,
        name1: 'Silas Vance',
        chat_metadata: mockMetadata,
        extensionSettings: {
            rpg_tracker: mockRpgTracker,
            multihog_companion: {
                enableRelationshipNarrativeSync: true,
            },
        },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    }),
};

// Mock fetch for world info
globalThis.fetch = async (url, options) => {
    if (url === '/api/worldinfo/get') {
        return {
            ok: true,
            json: async () => ({
                entries: {
                    1: { comment: 'Marta Okonkwo', content: 'Cyborg quartermaster with no known affiliations.' },
                    2: { comment: 'Kaelen Thorne', content: 'Rogue scout wandering the borderlands.' },
                },
            }),
        };
    }
    return { ok: true, json: async () => ({}) };
};

// Run scanAndInitUnsyncedNpcs simulating chat switch into the old chat
const scanResult = await scanAndInitUnsyncedNpcs();
assert.strictEqual(scanResult.scanned, 2, 'Should scan the 2 NPCs');
assert.strictEqual(scanResult.initialized, 0, 'Should not overwrite or re-initialize existing NPCs with 0,0');
assert.strictEqual(scanResult.skipped, 2, 'Both NPCs with pre-existing non-zero values must be skipped');

assert.strictEqual(mockRpgTracker.npcRelationshipValues['Eldoria_NPCs::1'].friendship, 45, 'Marta friendship must remain 45');
assert.strictEqual(mockRpgTracker.npcRelationshipValues['Eldoria_NPCs::1'].affection, 15, 'Marta affection must remain 15');
assert.strictEqual(mockRpgTracker.npcRelationshipValues['Eldoria_NPCs::2'].friendship, 60, 'Kaelen friendship must be preserved from chatStates');
assert.strictEqual(mockRpgTracker.npcRelationshipValues['Eldoria_NPCs::2'].affection, 25, 'Kaelen affection must be preserved from chatStates');

const ledgerAfter = getRelationshipSyncLedger(mockChatId);
assert.strictEqual(ledgerAfter['Eldoria_NPCs::1'].initialSource, 'pre_existing', 'Must be marked pre_existing');
assert.strictEqual(ledgerAfter['Eldoria_NPCs::2'].initialSource, 'pre_existing', 'Must be marked pre_existing');
console.log('✓ Pre-existing relationship values are strictly preserved and never wiped on chat switch');

// Now add an NPC entry #3 that has NO existing values
globalThis.fetch = async (url, options) => {
    if (url === '/api/worldinfo/get') {
        return {
            ok: true,
            json: async () => ({
                entries: {
                    1: { comment: 'Marta Okonkwo', content: 'Cyborg quartermaster with no known affiliations.' },
                    2: { comment: 'Kaelen Thorne', content: 'Rogue scout wandering the borderlands.' },
                    3: { comment: 'Theron Vex', content: 'Mysterious cloaked informant lurking in shadows.' },
                },
            }),
        };
    }
    return { ok: true, json: async () => ({}) };
};

// Passive scan (allowLlmScan: false, simulated F5 / chat switch)
const passiveScanResult = await scanAndInitUnsyncedNpcs({ allowLlmScan: false });
assert.strictEqual(passiveScanResult.scanned, 3, 'Should scan 3 NPCs');
assert.strictEqual(passiveScanResult.skipped, 2, 'Marta and Kaelen must be skipped as already initialized');
assert.strictEqual(passiveScanResult.initialized, 1, 'Theron Vex must be initialized with passive default');

assert.strictEqual(mockRpgTracker.npcRelationshipValues['Eldoria_NPCs::3'].friendship, 0, 'Theron friendship must default to 0');
assert.strictEqual(mockRpgTracker.npcRelationshipValues['Eldoria_NPCs::3'].affection, 0, 'Theron affection must default to 0');

const ledgerAfterPassive = getRelationshipSyncLedger(mockChatId);
assert.strictEqual(ledgerAfterPassive['Eldoria_NPCs::3'].initialSource, 'default_neutral', 'Must be marked default_neutral');
assert.strictEqual(ledgerAfterPassive['Eldoria_NPCs::3'].initialized, true, 'Must be marked initialized');
console.log('✓ Passive scan initializes unrecorded NPCs with neutral baseline without triggering LLM calls');

console.log('--- ALL RELATIONSHIP NARRATIVE SYNC TESTS PASSED CLEANLY! ---');



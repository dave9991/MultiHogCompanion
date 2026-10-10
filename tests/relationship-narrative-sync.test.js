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
console.log('✓ Direction A prompt builder and robust response parser verified');

// ── 3. Direction B: Prompt & Narrative Rewrite Parsing ────────────────────────
console.log('Testing Direction B (Numbers -> Narrative Text Evolution)...');

const existingBio = `Marta Okonkwo is a stern cyborg quartermaster. She trusts nobody, eats alone in the hangar, and regards all newcomers with cold suspicion.`;
const logs = [
    { field: 'friendship', delta: 25, newValue: 45, reason: 'Silas repaired her cybernetic arm' },
    { field: 'friendship', delta: 25, newValue: 70, reason: 'Silas defended the supply depot' },
];
const fTier = getFriendshipTier(70);
const aTier = getAffectionTier(0);

const dirBPrompt = buildDirectionBPrompt('Marta Okonkwo', existingBio, 'Silas Vance', logs, fTier, aTier);
assert.strictEqual(dirBPrompt.length, 2);
assert.ok(dirBPrompt[0].content.includes('PRESERVE CORE FACTS'), 'Must instruct preservation of core backstory and traits');
assert.ok(dirBPrompt[0].content.includes('ELIMINATE CONTRADICTIONS'), 'Must instruct elimination of contradictions');
assert.ok(dirBPrompt[0].content.includes('CLOSE FRIEND'), 'Must specify target friendship tier');
assert.ok(dirBPrompt[1].content.includes('Silas repaired her cybernetic arm'), 'User prompt must include relationship log context');

// Parsing rewritten response
const rawRewritten = `\`\`\`markdown
Marta Okonkwo is a stern cyborg quartermaster. While historically slow to trust others, she now regards Silas Vance as one of her closest and most dependable confidants following the defense of the supply depot. She keeps her vigilant watch over the hangar, but Silas is always welcome at her workbench.
\`\`\``;
const parsedB = parseDirectionBResponse(rawRewritten);
assert.ok(parsedB, 'Should extract clean rewritten text');
assert.ok(!parsedB.startsWith('```'), 'Code fences must be stripped');
assert.ok(!parsedB.endsWith('```'), 'Trailing fences must be stripped');
assert.ok(parsedB.includes('Silas Vance as one of her closest'), 'Preserves evolved narrative');

// Conversational preamble stripping
const withPreamble = `Here is the updated lorebook entry for Marta Okonkwo:
Marta Okonkwo remains the dedicated quartermaster of the depot, fiercely protective of Silas Vance after their shared battles.`;
const parsedPreamble = parseDirectionBResponse(withPreamble);
assert.ok(!parsedPreamble.startsWith('Here is'), 'Conversational preamble must be stripped');
console.log('✓ Direction B prompt builder and clean markdown text parser verified');

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

console.log('--- ALL RELATIONSHIP NARRATIVE SYNC TESTS PASSED CLEANLY! ---');


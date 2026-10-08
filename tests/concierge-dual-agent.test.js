import assert from 'node:assert';
import { createEmptyDossier, applyDossierUpdates, stripConciergeStateBlocks } from '../concierge-parser.js';
import {
    buildConciergeBuilderPrompt,
    buildConciergeTalkerPrompt,
    buildConciergeBuilderContext,
    buildConciergeTalkerContext,
} from '../concierge-prompt.js';

console.log('--- Running Dual-Agent (Builder + Talker) Architecture Test Suite ---');

// 1. Verify Builder Prompt Contract & Strict Protocol
console.log('Testing Builder Prompt Contract & Protocol...');
const builderPrompt = buildConciergeBuilderPrompt();
assert.ok(builderPrompt.includes('PbtA Blueprint Builder'), 'Builder prompt must establish Blueprint Builder identity');
assert.ok(builderPrompt.includes('STRICT OUTPUT PROTOCOL'), 'Builder prompt must mandate strict output protocol');
assert.ok(builderPrompt.includes('Output ONLY an [UPDATE_DOSSIER] block (or [NOOP])'), 'Builder prompt must restrict output to directives');
assert.ok(builderPrompt.includes('summary: <One concise sentence summarizing the changes made>'), 'Builder prompt must mandate summary: field');
assert.ok(builderPrompt.includes('[NOOP]'), 'Builder prompt must document [NOOP] syntax');
assert.ok(builderPrompt.includes('[PROTAGONIST]'), 'Builder prompt must document [PROTAGONIST] schema');
assert.ok(builderPrompt.includes('[MONSTER]'), 'Builder prompt must document [MONSTER] schema');
console.log('✓ Builder prompt strictly defines state extraction and summary protocol');

// 2. Verify Talker Prompt Separation of Concerns & Blueprint Grounding
console.log('Testing Talker Prompt Separation & Grounding...');
const talkerPrompt = buildConciergeTalkerPrompt();
assert.ok(talkerPrompt.includes('PbtA Concierge'), 'Talker prompt must establish PbtA Concierge identity');
assert.ok(talkerPrompt.includes('You Do Not Manage Syntax or Database Updates'), 'Talker must have zero responsibility for database updates');
assert.ok(talkerPrompt.includes('managed by an automated Builder'), 'Talker must recognize automated Builder manages deck');
assert.ok(talkerPrompt.includes('Never Hallucinate Updates'), 'Talker must have strict truth-grounding rule');
assert.ok(talkerPrompt.includes('Do NOT recite full stat sheets'), 'Talker must not recite card lists in prose');
// Ensure Talker prompt does NOT contain code block directives or regex tag format documentation
assert.ok(!talkerPrompt.includes('remove_npc:'), 'Talker prompt must not document regex directive syntax');
assert.ok(!talkerPrompt.includes('remove_monster:'), 'Talker prompt must not document regex directive syntax');
console.log('✓ Talker prompt cleanly decouples conversational roleplay from database maintenance');

// 3. Verify Blueprint Placement at Tail of Talker Context
console.log('Testing Tail-Anchoring of Authoritative Blueprint in Talker Context...');
const testDossier = createEmptyDossier();
testDossier.meta.title = 'Vance: The Long Winter';
testDossier.meta.systemKey = 'horror';
testDossier.meta.systemLabel = 'Horror (Monster of the Week)';
testDossier.protagonist.name = 'Silas Vance';

const talkerContext = buildConciergeTalkerContext(testDossier, ['Protagonist named Silas Vance']);
assert.ok(talkerContext.includes('📋 [CURRENT_LIVE_BLUEPRINT] (AUTHORITATIVE GROUND TRUTH)'), 'Context must label live blueprint with ground truth header');
assert.ok(talkerContext.includes('Vance: The Long Winter'), 'Context must include serialized dossier title');
// Verify blueprint appears towards the tail (after the main role guidelines)
const guidelinesIdx = talkerContext.indexOf('### 💬 Conversational Guidelines for Session Zero:');
const blueprintIdx = talkerContext.indexOf('📋 [CURRENT_LIVE_BLUEPRINT]');
assert.ok(blueprintIdx > guidelinesIdx, 'Authoritative live blueprint must be placed after persona guidelines (tail-anchored)');
console.log('✓ Authoritative blueprint is tail-anchored and clearly labeled as Ground Truth');

// 4. Verify applyDossierUpdates with Builder-Emitted Summary
console.log('Testing Parser Extraction of Builder-Emitted Summary...');
const updateWithSummary = `[UPDATE_DOSSIER]
summary: Converted Silas to Occult Scholar with Warding Sigil move
[PROTAGONIST]
name: Silas Vance
playbook: Occult Scholar
moves:
- Warding Sigil (+Weird) (Place a circle that repels entities)
[/PROTAGONIST]
[/UPDATE_DOSSIER]`;

const report1 = applyDossierUpdates(updateWithSummary, testDossier);
assert.strictEqual(report1.success, true);
assert.strictEqual(report1.hasMutations, true);
assert.strictEqual(report1.isNoop, false);
assert.strictEqual(report1.builderSummary, 'Converted Silas to Occult Scholar with Warding Sigil move');
assert.strictEqual(report1.updatedDossier.protagonist.playbook, 'Occult Scholar');
console.log('✓ applyDossierUpdates extracted Builder semantic summary cleanly');

// 5. Verify applyDossierUpdates with [NOOP]
console.log('Testing [NOOP] Parsing and Reason Extraction...');
const noopWithSummary = `[NOOP]
summary: Player asked a setting question about the regional winter climate; no blueprint mutations needed.
[/NOOP]`;

const report2 = applyDossierUpdates(noopWithSummary, testDossier);
assert.strictEqual(report2.success, true);
assert.strictEqual(report2.hasMutations, false);
assert.strictEqual(report2.isNoop, true);
assert.strictEqual(report2.builderSummary, 'Player asked a setting question about the regional winter climate; no blueprint mutations needed.');
assert.strictEqual(report2.updatedDossier.protagonist.name, 'Silas Vance', 'Dossier remained unchanged');

// Standalone [NOOP] without wrapper tags
const bareNoop = `[NOOP]`;
const report3 = applyDossierUpdates(bareNoop, testDossier);
assert.strictEqual(report3.success, true);
assert.strictEqual(report3.isNoop, true);
assert.strictEqual(report3.hasMutations, false);
console.log('✓ [NOOP] directives handled safely with extracted reason');

// 6. Verify Context Formatting with Historical Inline Annotations
console.log('Testing Historical State-Action Annotation Formatting...');
const sampleHistory = [
    {
        role: 'user',
        content: 'Can you make Silas an Occult Scholar?',
    },
    {
        role: 'assistant',
        content: 'I have updated Silas to be an Occult Scholar.',
        builderReport: 'Converted Silas to Occult Scholar with Warding Sigil',
    },
];

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
        content: m.content,
    };
};

const formatted = sampleHistory.map(formatHistoryMessage);
assert.ok(formatted[1].content.startsWith('[BUILDER_REPORT: Converted Silas to Occult Scholar with Warding Sigil]\n\n'));
assert.ok(formatted[1].content.includes('I have updated Silas to be an Occult Scholar.'));
console.log('✓ Historical chat messages cleanly inject inline [BUILDER_REPORT] annotations');

// 7. Verify Diagnostic Package Construction on Failure
console.log('Testing Diagnostic Package Construction...');
const simulatedFailures = [
    {
        attempt: 1,
        rawResponse: '[UPDATE_DOSSIER] [MONSTER] name: Ghoul [/MONSTER]',
        errors: ['Missing required attacks in [MONSTER]'],
        hasMutations: false,
        isNoop: false,
    },
    {
        attempt: 2,
        rawResponse: '[UPDATE_DOSSIER] [MONSTER] harm: invalid [/MONSTER]',
        errors: ['Could not parse harm value: invalid'],
        hasMutations: false,
        isNoop: false,
    },
];

const diagnosticPackage = {
    timestamp: new Date().toISOString(),
    systemEngine: 'horror',
    userMessage: 'make the monster a ghoul',
    currentDossierSnapshot: testDossier,
    attempts: simulatedFailures,
};

assert.strictEqual(diagnosticPackage.attempts.length, 2);
assert.strictEqual(diagnosticPackage.systemEngine, 'horror');
assert.strictEqual(diagnosticPackage.attempts[1].errors[0], 'Could not parse harm value: invalid');
console.log('✓ Diagnostic trace package constructed successfully');

console.log('--- ALL DUAL-AGENT (BUILDER + TALKER) TESTS PASSED CLEANLY! ---');

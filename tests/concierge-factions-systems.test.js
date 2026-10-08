/**
 * tests/concierge-factions-systems.test.js
 *
 * Verification suite for:
 * 1. PbtA System Aliases & Genre normalization
 * 2. Campaign Tone parsing, state updates, and round-tripping
 * 3. Factions parsing, state updates, removal sanitization, and round-tripping
 * 4. Monster impending doom countdown track serialization & reconstitution
 * 5. Sysprompt Control Room cartridge compilation (pbta_campaign_tone, pbta_campaign_factions)
 * 6. Initial memo [FACTIONS] formatting
 * 7. Prompt hygiene (no {{user}} macros, valid system keys, pacing_xp, art_style)
 */

import assert from 'node:assert';
import {
    applyDossierUpdates,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
    normalizeSystemKey,
    createEmptyDossier,
    stripConciergeStateBlocks,
} from '../concierge-parser.js';
import { buildPbtACartridge, formatInitialPbtaMemo, PBTA_GENRES } from '../pbta-ruleset.js';
import { buildConciergeSystemPrompt } from '../concierge-prompt.js';

console.log('--- Running Concierge Factions, Tone & Systems Test Suite ---');

// ── Test 1: System Aliases Normalization ────────────────────────────────────
console.log('Testing System Aliases Normalization...');
assert.strictEqual(normalizeSystemKey('modern'), 'horror', 'modern should alias to horror');
assert.strictEqual(normalizeSystemKey('pirates'), 'pirate', 'pirates should alias to pirate');
assert.strictEqual(normalizeSystemKey('cosmic'), 'cosmic_horror', 'cosmic should alias to cosmic_horror');
assert.strictEqual(normalizeSystemKey('post-apocalyptic'), 'post_apocalyptic', 'post-apocalyptic should alias to post_apocalyptic');
assert.strictEqual(normalizeSystemKey('heist'), 'gothic_heist', 'heist should alias to gothic_heist');
assert.strictEqual(normalizeSystemKey('cyberpunk'), 'scifi', 'cyberpunk should alias to scifi');
assert.strictEqual(normalizeSystemKey('fantasy'), 'fantasy', 'fantasy should remain fantasy');
console.log('✓ System aliases properly normalized');

// ── Test 2: Tone and Faction Parsing from [UPDATE_DOSSIER] ─────────────────
console.log('Testing Tone and Faction Parsing from [UPDATE_DOSSIER]...');
const directiveSample = `
[UPDATE_DOSSIER]
title: Cold Whispers
system: modern
tone: Gritty paranormal investigative noir with psychological dread
premise: A string of mysterious disappearances at Blackwood Pines.

[FACTION]
name: The Iron Watchers
agenda: Suppress all public knowledge of occult manifestations
standing: Hostile
notes: Headed by Agent Ross
[/FACTION]

[FACTION]
name: The Whispering Circle
agenda: Awaken the slumbering entity beneath the pines
standing: Neutral
notes: Local cult operating out of the old lumber mill
[/FACTION]

[MONSTER]
name: The Ash Wendigo
harm: 4
armor: 1
attacks: Frost Claws (2 Harm, intimate), Paralyzing Shriek (1 Harm, near)
weakness: White birch fire
countdown:
- Day: Hunters vanish in pine valley
- Dusk: Scratch marks outside ranger cabin
- Night: Radio tower collapse, wendigo attacks
[/MONSTER]
[/UPDATE_DOSSIER]
`;

const baseDossier = createEmptyDossier();
const report1 = applyDossierUpdates(directiveSample, baseDossier);
const parsed = report1.updatedDossier;
assert.strictEqual(parsed.meta.systemKey, 'horror', 'modern alias mapped to horror in meta');
assert.strictEqual(parsed.meta.tone, 'Gritty paranormal investigative noir with psychological dread', 'tone parsed correctly');
assert.strictEqual(parsed.factions.length, 2, 'two factions parsed');
assert.strictEqual(parsed.factions[0].name, 'The Iron Watchers');
assert.strictEqual(parsed.factions[0].standing, 'Hostile');
assert.strictEqual(parsed.factions[1].name, 'The Whispering Circle');
assert.strictEqual(parsed.monsters.length, 1);
assert.strictEqual(parsed.monsters[0].impendingDoom.length, 3, 'monster countdown track parsed');
console.log('✓ Tone, factions, and monster countdown parsed cleanly');

// ── Test 3: Dossier State Updates & Mutations ──────────────────────────────
console.log('Testing Dossier State Updates & Mutations...');
assert.strictEqual(report1.hasMutations, true);
assert.strictEqual(report1.updatedDossier.meta.tone, 'Gritty paranormal investigative noir with psychological dread');
assert.strictEqual(report1.updatedDossier.factions.length, 2);

// Test removal of faction with formatting/quotes
const removalSample = `
[UPDATE_DOSSIER]
remove_faction: "**The Iron Watchers**"
[/UPDATE_DOSSIER]
`;
const report2 = applyDossierUpdates(removalSample, report1.updatedDossier);
assert.strictEqual(report2.hasMutations, true);
assert.strictEqual(report2.updatedDossier.factions.length, 1, 'The Iron Watchers removed despite markdown bolding');
assert.strictEqual(report2.updatedDossier.factions[0].name, 'The Whispering Circle');
console.log('✓ Faction additions, mutations, and sanitized removals work as expected');

// ── Test 4: Markdown Serialization & Deserialization Roundtrip ─────────────
console.log('Testing Markdown Serialization & Deserialization Roundtrip...');
const fullDossier = report1.updatedDossier;
const markdown = serializeDossierToMarkdown(fullDossier);
assert.ok(markdown.includes('* **Tone:** Gritty paranormal investigative noir with psychological dread'), 'markdown contains tone');
assert.ok(markdown.includes('## 🚩 Factions & Powers:'), 'markdown contains factions section');
assert.ok(markdown.includes('### 🚩 The Iron Watchers'), 'markdown contains faction heading');
assert.ok(markdown.includes('* **Countdown Clock:**'), 'markdown contains countdown clock heading');

const reconstructed = parseMarkdownToDossier(markdown);
assert.strictEqual(reconstructed.meta.tone, fullDossier.meta.tone, 'tone reconstructed from markdown');
assert.strictEqual(reconstructed.factions.length, 2, 'factions reconstructed from markdown');
assert.strictEqual(reconstructed.factions[0].name, 'The Iron Watchers');
assert.strictEqual(reconstructed.factions[0].standing, 'Hostile');
assert.strictEqual(reconstructed.monsters[0].impendingDoom.length, 3, 'impending doom reconstructed from markdown');
console.log('✓ Markdown serialization and reconstitution round-trip cleanly');

// ── Test 5: Sysprompt Control Room Cartridge Compilation ───────────────────
console.log('Testing Sysprompt Control Room Cartridge Compilation...');
const cartridge = buildPbtACartridge('horror', {
    campaignTitle: 'Cold Whispers',
    tone: fullDossier.meta.tone,
    factions: fullDossier.factions,
    config: { harmMax: 4, pacingXp: 3, partyMode: 'solo' },
});

const sysLib = cartridge.payload.customSyspromptLibrary;
const toneSnippet = sysLib.find(s => s.id === 'pbta_campaign_tone');
assert.ok(toneSnippet, 'pbta_campaign_tone present in customSyspromptLibrary');
assert.strictEqual(toneSnippet.tag, 'tone');
assert.ok(toneSnippet.content.includes('Gritty paranormal investigative noir with psychological dread'));

const factionSnippet = sysLib.find(s => s.id === 'pbta_campaign_factions');
assert.ok(factionSnippet, 'pbta_campaign_factions present in customSyspromptLibrary');
assert.strictEqual(factionSnippet.tag, 'factions');
assert.ok(factionSnippet.content.includes('The Iron Watchers (Hostile)'));
assert.ok(factionSnippet.content.includes('The Whispering Circle (Neutral)'));
console.log('✓ Sysprompt Control Room correctly registers tone & factions snippets');

// ── Test 6: Initial Memo [FACTIONS] Block ──────────────────────────────────
console.log('Testing Initial Memo [FACTIONS] Block...');
const memo = formatInitialPbtaMemo(fullDossier);
assert.ok(memo.includes('[FACTIONS]'), 'memo contains [FACTIONS] block');
assert.ok(memo.includes('((PILLS)) The Iron Watchers: (-) Hostile (Standing), Agenda (Suppress all public knowledge of occult manifestations)'), 'The Iron Watchers missing ((PILLS)) formatting');
assert.ok(memo.includes('((PILLS)) The Whispering Circle: Neutral (Standing), Agenda (Awaken the slumbering entity beneath the pines)'), 'The Whispering Circle missing ((PILLS)) formatting');
console.log('✓ formatInitialPbtaMemo successfully renders ((PILLS)) [FACTIONS] block');

// ── Test 7: Prompt Hygiene & Directives ─────────────────────────────────────
console.log('Testing Prompt Hygiene & Directives...');
const prompt = buildConciergeSystemPrompt();
assert.strictEqual(prompt.includes('{{user}}'), false, 'Concierge prompt has 0 instances of {{user}}');
assert.ok(prompt.includes('cosmic_horror'), 'Concierge prompt includes valid PBTA system keys');
assert.ok(prompt.includes('survival_horror'), 'Concierge prompt includes survival_horror');
assert.ok(prompt.includes('[FACTION]'), 'Concierge prompt documents [FACTION] directive');
assert.ok(prompt.includes('[ATTACHED_DOCUMENT]'), 'Concierge prompt documents [ATTACHED_DOCUMENT]');
assert.ok(prompt.includes('pacing_xp: 3 | 5'), 'Concierge prompt documents pacing_xp dial');
assert.ok(prompt.includes('/imagine'), 'Concierge prompt connects art_style to /imagine');
console.log('✓ Prompt hygiene, system keys, and feature documentation verified');

console.log('--- ALL FACTIONS, TONE & SYSTEMS TESTS PASSED CLEANLY! ---');

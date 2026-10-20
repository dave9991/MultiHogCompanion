import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildConciergeBuilderPrompt,
    buildConciergeCriticPrompt,
    buildConciergeCriticContext,
    buildConciergeRefinerContext,
} from '../concierge-prompt.js';
import {
    createEmptyDossier,
    applyDossierUpdates,
    parseDossierCritique,
    shouldRunContemplativeJudgePass,
    stripConciergeStateBlocks,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
    healAndNormalizeDossier,
    formatDiagnosticTrace,
} from '../concierge-parser.js';
import { buildCustomModuleLoreEntry } from '../concierge-lore-distributor.js';
import { buildPbtACartridge, formatInitialPbtaMemo } from '../pbta-ruleset.js';
import {
    getConciergeConnectionSettings,
    resolveConciergeMaxTokens,
    extractTextFromApiResponse,
} from '../concierge-connection.js';

describe('Contemplative Dossier Builder & Judge Architecture', () => {
    it('1. Builder prompt includes [CONTEMPLATION] scratchpad schema and preserves strict [UPDATE_DOSSIER] instruction', () => {
        const prompt = buildConciergeBuilderPrompt();
        assert.ok(prompt.includes('Output ONLY an [UPDATE_DOSSIER] block (or [NOOP])'));
        assert.ok(prompt.includes('[CONTEMPLATION]'));
        assert.ok(prompt.includes('core_tension:'));
        assert.ok(prompt.includes('world_consequences:'));
        assert.ok(prompt.includes('web_of_entanglement:'));
        assert.ok(prompt.includes('kick_pressure:'));
    });

    it('2. applyDossierUpdates extracts [CONTEMPLATION] scratchpad into updatedDossier.contemplation and report.contemplation', () => {
        const dossier = createEmptyDossier();
        const rawOutput = `[UPDATE_DOSSIER]
[CONTEMPLATION]
core_tension: The Iron Choir wants to harvest the singing whale-leviathan while the protagonist owes a blood debt to its keeper.
world_consequences: Without sunlight, bioluminescent oil is the only currency and heat source.
web_of_entanglement: Sister Vael (NPC) secretly supplies the Iron Choir (Faction) while protecting the Leviathan Sanctuary (Map).
kick_pressure: A choir harpoon-skiff just breached the sanctuary dock while the protagonist's lantern is sputtering out.
[/CONTEMPLATION]
summary: Scaffolded bioluminescent whalepunk campaign with contemplative web
system: dieselpunk
title: Leviathan Choir
premise: Whalepunk city surviving on bioluminescent oil in a sunless abyss.

[PROTAGONIST]
name: Corvo Vane
playbook: The Harpooner
background: Former choir extractor who sabotaged his own rig.
harm: 2/5
armor: 1
[/PROTAGONIST]
[/UPDATE_DOSSIER]`;

        const report = applyDossierUpdates(rawOutput, dossier);
        assert.equal(report.hasMutations, true);
        assert.ok(report.contemplation);
        assert.match(report.contemplation.coreTension, /Iron Choir/);
        assert.match(report.contemplation.worldConsequences, /bioluminescent oil/);
        assert.match(report.contemplation.webOfEntanglement, /Sister Vael/);
        assert.match(report.contemplation.kickPressure, /harpoon-skiff/);
        assert.deepEqual(report.updatedDossier.contemplation, report.contemplation);
    });

    it('3. Smart-Gated Judge triggers on initial scaffolding, attachments, or 3+ categories, and bypasses minor tweaks or NOOP', () => {
        const empty = createEmptyDossier();

        // NOOP -> false
        const noopReport = applyDossierUpdates('[NOOP]\nsummary: Just chatting\n[/NOOP]', empty);
        assert.equal(shouldRunContemplativeJudgePass({
            prevDossier: empty,
            updatedDossier: empty,
            builderReport: noopReport,
            hasAttachments: false,
        }), false);

        // Initial scaffold from blank -> true
        const scaffoldReport = applyDossierUpdates(`[UPDATE_DOSSIER]
system: scifi
title: Starfall
premise: Derelict arkship drifting toward a magnetar.
[/UPDATE_DOSSIER]`, empty);
        assert.equal(shouldRunContemplativeJudgePass({
            prevDossier: empty,
            updatedDossier: scaffoldReport.updatedDossier,
            builderReport: scaffoldReport,
            hasAttachments: false,
        }), true);

        // Minor 1-field tweak on an already populated dossier -> false
        const populated = scaffoldReport.updatedDossier;
        const minorReport = applyDossierUpdates(`[UPDATE_DOSSIER]
[CONFIG]
harm_max: 4
[/CONFIG]
[/UPDATE_DOSSIER]`, populated);
        assert.equal(shouldRunContemplativeJudgePass({
            prevDossier: populated,
            updatedDossier: minorReport.updatedDossier,
            builderReport: minorReport,
            hasAttachments: false,
        }), false);

        // Minor tweak WITH attachment -> true
        assert.equal(shouldRunContemplativeJudgePass({
            prevDossier: populated,
            updatedDossier: minorReport.updatedDossier,
            builderReport: minorReport,
            hasAttachments: true,
        }), true);

        // Major update touching 3+ categories on an already populated dossier -> true
        const majorReport = applyDossierUpdates(`[UPDATE_DOSSIER]
[PROTAGONIST]
name: Kaelen
[/PROTAGONIST]
[NPC]
name: Vesper
role: Rival
[/NPC]
[MONSTER]
name: Void Stalker
harm: 4
[/MONSTER]
[/UPDATE_DOSSIER]`, populated);
        assert.equal(shouldRunContemplativeJudgePass({
            prevDossier: populated,
            updatedDossier: majorReport.updatedDossier,
            builderReport: majorReport,
            hasAttachments: false,
        }), true);
    });

    it('4. parseDossierCritique parses [DOSSIER_CRITIQUE] rubric scores, grades, and directives', () => {
        const critiqueText = `[DOSSIER_CRITIQUE]
verdict: REVISE
score: 72
grade: C+
strengths:
- Strong sunless abyss premise and protagonist concept
weaknesses:
- NPCs lack specific history with the protagonist
- Monster has no countdown clock
directives:
- Add a 4-step countdown clock to the Void Stalker
- Tie Vesper's relationship directly to Kaelen's past sabotage
[/DOSSIER_CRITIQUE]`;

        const parsed = parseDossierCritique(critiqueText);
        assert.equal(parsed.verdict, 'REVISE');
        assert.equal(parsed.score, 72);
        assert.equal(parsed.grade, 'C+');
        assert.equal(parsed.shouldRevise, true);
        assert.equal(parsed.strengths.length, 1);
        assert.equal(parsed.weaknesses.length, 2);
        assert.equal(parsed.directives.length, 2);
        assert.match(parsed.directives[0], /countdown clock/i);

        const passText = `[DOSSIER_CRITIQUE]
verdict: PASS
score: 91
grade: A-
strengths:
- Deep entanglement and sharp mechanical bite
weaknesses:
directives:
[/DOSSIER_CRITIQUE]`;
        const parsedPass = parseDossierCritique(passText);
        assert.equal(parsedPass.verdict, 'PASS');
        assert.equal(parsedPass.score, 91);
        assert.equal(parsedPass.shouldRevise, false);
    });

    it('5. Critic and Refiner context builders include contemplation, rubric, and directives', () => {
        const dossier = createEmptyDossier();
        dossier.meta.title = 'Leviathan Choir';
        dossier.meta.premise = 'Bioluminescent whalepunk';
        const contemplation = {
            coreTension: 'Oil scarcity vs sanctuary',
            worldConsequences: 'Total darkness outside lamp-zones',
            webOfEntanglement: 'Vael owes the Choir',
            kickPressure: 'Harpoon skiff at the dock',
        };

        const criticPrompt = buildConciergeCriticPrompt();
        assert.ok(criticPrompt.includes('[DOSSIER_CRITIQUE]'));

        const criticCtx = buildConciergeCriticContext(dossier, 'Build me a whalepunk game', 'Scaffolded world', contemplation);
        assert.ok(criticCtx.includes('Oil scarcity vs sanctuary'));
        assert.ok(criticCtx.includes('Leviathan Choir'));

        const critique = {
            verdict: 'REVISE',
            score: 74,
            grade: 'C',
            weaknesses: ['Missing faction agenda'],
            directives: ['Add an explicit agenda to the Iron Choir faction'],
        };
        const refinerCtx = buildConciergeRefinerContext(dossier, ['[12:00] Added Faction'], critique, 'Vael, Kaelen');
        assert.ok(refinerCtx.includes('[EDITOR_CRITIQUE_FOR_SECOND_PASS] (MANDATORY REFINEMENT DIRECTIVES)'));
        assert.ok(refinerCtx.includes('Add an explicit agenda to the Iron Choir faction'));
        assert.ok(refinerCtx.includes('Vael, Kaelen'));
    });

    it('6. stripConciergeStateBlocks strips [CONTEMPLATION] and [DOSSIER_CRITIQUE] blocks cleanly', () => {
        const dirty = `[CONTEMPLATION]\ncore_tension: test\n[/CONTEMPLATION]\n[DOSSIER_CRITIQUE]\nverdict: PASS\n[/DOSSIER_CRITIQUE]\nWelcome to the abyss, hunter!`;
        const clean = stripConciergeStateBlocks(dirty);
        assert.equal(clean, 'Welcome to the abyss, hunter!');
    });

    it('7. formatDiagnosticTrace includes contemplation, critique, and refinerPass sections', () => {
        const traceMd = formatDiagnosticTrace({
            timestamp: '2026-10-16T20:00:00Z',
            finalStatus: 'MUTATED',
            systemEngine: 'dieselpunk',
            userPrompt: 'Make a whalepunk setting',
            builderSummary: 'Scaffolded setting [Refined in Pass 2 (C+): Added countdown]',
            contemplation: {
                coreTension: 'Choir vs Sanctuary',
                worldConsequences: 'Sunless sea',
                webOfEntanglement: 'Vael <-> Choir',
                kickPressure: 'Skiff attack',
            },
            critique: {
                verdict: 'REVISE',
                score: 76,
                grade: 'C+',
                shouldRevise: true,
                strengths: ['Evocative tone'],
                weaknesses: ['Thin monster'],
                directives: ['Add monster countdown'],
            },
            refinerPass: {
                builderSummary: 'Added monster countdown',
                changes: ['Updated Adversary "Leviathan"'],
            },
            attempts: [],
        });

        assert.ok(traceMd.includes('Architectural Contemplation (Pass 1 Scratchpad)'));
        assert.ok(traceMd.includes('Choir vs Sanctuary'));
        assert.ok(traceMd.includes('Blueprint Judge / Critic Pass'));
        assert.ok(traceMd.includes('76/100'));
        assert.ok(traceMd.includes('Second-Pass Refiner'));
        assert.ok(traceMd.includes('Added monster countdown'));
    });
});

describe('Concierge Bug Fixes Verification', () => {
    it('Bug Fix 1 & 2: [CUSTOM_MODULE] populates both tag/fieldKey and sampleContent/sample and works across Lore Distributor & Ruleset', () => {
        const dossier = createEmptyDossier();
        const res = applyDossierUpdates(`[UPDATE_DOSSIER]
[CUSTOM_MODULE]
tag: RADIATION
label: Suit Integrity & Rad-Dose
icon: ☢️
instruction: Track mSv exposure and suit seals.
sample:
\`\`\`text
Dose: 120 mSv (Safe) | Suit Seals: 100%
\`\`\`
[/CUSTOM_MODULE]
[/UPDATE_DOSSIER]`, dossier);

        const cm = res.updatedDossier.worldRules.customModule;
        assert.ok(cm);
        assert.equal(cm.tag, 'RADIATION');
        assert.equal(cm.fieldKey, 'RADIATION');
        assert.equal(cm.label, 'Suit Integrity & Rad-Dose');
        assert.equal(cm.sampleContent, 'Dose: 120 mSv (Safe) | Suit Seals: 100%');
        assert.equal(cm.sample, 'Dose: 120 mSv (Safe) | Suit Seals: 100%');

        // Lore distributor compatibility
        const loreEntry = buildCustomModuleLoreEntry(cm);
        assert.ok(loreEntry);
        assert.ok(loreEntry.core.includes('Field: RADIATION'));
        assert.ok(loreEntry.core.includes('Format Sample: Dose: 120 mSv (Safe) | Suit Seals: 100%'));

        // Cartridge blockOrder & Initial Memo compatibility
        const cartridge = buildPbtACartridge('scifi', { worldRules: res.updatedDossier.worldRules });
        assert.ok(cartridge.payload.blockOrder.includes('RADIATION'));

        const memo = formatInitialPbtaMemo(res.updatedDossier);
        assert.ok(memo.includes('[RADIATION]\nDose: 120 mSv (Safe) | Suit Seals: 100%\n[/RADIATION]'));
    });

    it('Bug Fix 3: [MAP] preserves WILDERNESS kind and SAFE / DANGEROUS threat levels', () => {
        const dossier = createEmptyDossier();
        const res = applyDossierUpdates(`[UPDATE_DOSSIER]
[MAP]
site: Whispering Pine Barrens
kind: WILDERNESS
threat: DANGEROUS
entrance: Old Logging Trail
prompt: Foggy pine forest with ancient monoliths
[/MAP]
[MAP]
site: Hearthfire Sanctuary
kind: SETTLEMENT
threat: SAFE
entrance: Main Gate
prompt: Warm stone courtyard
[/MAP]
[/UPDATE_DOSSIER]`, dossier);

        assert.equal(res.updatedDossier.maps.length, 2);
        assert.equal(res.updatedDossier.maps[0].kind, 'WILDERNESS');
        assert.equal(res.updatedDossier.maps[0].threat, 'DANGEROUS');
        assert.equal(res.updatedDossier.maps[1].kind, 'SETTLEMENT');
        assert.equal(res.updatedDossier.maps[1].threat, 'SAFE');
    });

    it('Bug Fix 4: healAndNormalizeDossier preserves NPC friendship/affection across the full -150..+150 range', () => {
        const dossier = createEmptyDossier();
        dossier.npcs.push({
            name: 'Arch-Nemesis Kael',
            role: 'Nemesis',
            friendship: -135,
            affection: 140,
        });

        const healed = healAndNormalizeDossier(dossier);
        assert.equal(healed.npcs[0].friendship, -135);
        assert.equal(healed.npcs[0].affection, 140);
    });

    it('Bug Fix 5: Wounded Harm (cur/max) and Protagonist background round-trip through serializeDossierToMarkdown and parseMarkdownToDossier', () => {
        const dossier = createEmptyDossier();
        const res = applyDossierUpdates(`[UPDATE_DOSSIER]
system: horror
title: Ashwood Sanatorium
premise: Escape the quarantined Victorian sanatorium.
[PROTAGONIST]
name: Dr. Eleanor Vance
playbook: The Alienist
background: Dismissed from St. Jude's after uncovering the director's experiments.
harm: 2/5
armor: 1
[/PROTAGONIST]
[MONSTER]
name: The Orderly of Ward 9
harm: 2/4
armor: 2
attacks: Bone Saw (3 Harm, messy)
weakness: Chloroform & bright magnesium flares
[/MONSTER]
[/UPDATE_DOSSIER]`, dossier);

        const md = serializeDossierToMarkdown(res.updatedDossier);
        assert.ok(md.includes("Dismissed from St. Jude's"));
        assert.ok(md.includes('2/5 (Wounded) | **Armor:** 1'));
        assert.ok(md.includes('2/4 (Wounded) | **Armor:** 2'));

        const hydrated = parseMarkdownToDossier(md);
        assert.ok(hydrated);
        assert.equal(hydrated.protagonist.bio, "Dismissed from St. Jude's after uncovering the director's experiments.");
        assert.equal(hydrated.protagonist.background, "Dismissed from St. Jude's after uncovering the director's experiments.");
        assert.equal(hydrated.protagonist.harm.current, 2);
        assert.equal(hydrated.protagonist.harm.max, 5);
        assert.equal(hydrated.protagonist.harm.armor, 1);

        assert.equal(hydrated.monsters.length, 1);
        assert.equal(hydrated.monsters[0].currentHarm, 2);
        assert.equal(hydrated.monsters[0].harm, 4);
        assert.equal(hydrated.monsters[0].armor, 2);
    });

    it('Live Session Zero Fix 1: getConciergeConnectionSettings & extractTextFromApiResponse prevent 2048 token clamp and truncated CoT leakage', () => {
        const settings = getConciergeConnectionSettings();
        assert.equal(settings.maxTokens, 0, 'Default maxTokens must be 0 so SillyTavern preset token headroom is preserved');

        // Generous preset (100k tokens) returns null so SillyTavern uses native preset untouched
        const generousBudget = resolveConciergeMaxTokens({
            settings,
            messages: [{ role: 'user', content: 'Hello' }],
            context: { chatCompletionSettings: { openai_max_context: 131072, openai_max_tokens: 100000 } },
        });
        assert.equal(generousBudget, null);

        // Small chat reply limit (e.g. 500 tokens) boosts to >= 8192 so reasoning models do not truncate
        const boostedBudget = resolveConciergeMaxTokens({
            settings,
            messages: [{ role: 'user', content: 'Hello' }],
            context: { chatCompletionSettings: { openai_max_context: 32768, openai_max_tokens: 500 } },
        });
        assert.ok(boostedBudget >= 8192, `Expected boosted budget >= 8192, got ${boostedBudget}`);

        // Truncated reasoning_content with empty content does not leak raw chain-of-thought
        const truncatedCoTResp = {
            choices: [{
                message: {
                    content: '',
                    reasoning_content: "Here's a thinking process that leads to the suggested response:\n\n1. **Analyze the Request:**\n   * Required blocks: [PROTAGONIST], [NPC], [MONSTER]",
                },
            }],
        };
        assert.equal(extractTextFromApiResponse(truncatedCoTResp), '');

        // Directive inside reasoning_content is extracted cleanly without preamble
        const directiveInReasoningResp = {
            choices: [{
                message: {
                    content: '',
                    reasoning_content: "Here's a thinking process:\n1. Plan blocks.\n[UPDATE_DOSSIER]\nsummary: Added scout\n[/UPDATE_DOSSIER]",
                },
            }],
        };
        assert.equal(
            extractTextFromApiResponse(directiveInReasoningResp),
            '[UPDATE_DOSSIER]\nsummary: Added scout\n[/UPDATE_DOSSIER]',
        );
    });

    it('Live Session Zero Fix 2: applyDossierUpdates ignores inline [BLOCK] mentions in leaked CoT and stops unclosed blocks at next block boundary', () => {
        const empty = createEmptyDossier();

        // 1. Unfinished CoT dump without [UPDATE_DOSSIER] must NOT trigger fallback scraping
        const leakedCoT = `Here's a thinking process that leads to the suggested response:
1. **Analyze the Request:**
   * Should we include [WORLD_RULES] or [CUSTOM_MODULE]? No.
   * Required blocks: [CONTEMPLATION], [PROTAGONIST], [FACTION], [NPC], [MONSTER], [MAP], [KICK].
2. **Drafting NPC:**
   name: Gideon High-Tower
   role: Mentor`;

        const cotReport = applyDossierUpdates(leakedCoT, empty);
        assert.equal(cotReport.hasMutations, false, 'Must not scrape entities out of an unfinished CoT preamble');
        assert.equal(cotReport.updatedDossier.protagonist.name, '');
        assert.equal(cotReport.updatedDossier.npcs.length, 0);
        assert.equal(cotReport.updatedDossier.monsters.length, 0);
        assert.equal(cotReport.updatedDossier.worldRules.axioms.length, 0);
        assert.equal(cotReport.updatedDossier.worldRules.customModule, null);

        // 2. Unclosed block inside [UPDATE_DOSSIER] stops cleanly at the next standalone [BLOCK] header
        //    and top-level title is NOT overwritten by [WORLD_RULES] title:
        const unclosedAndWorldRule = `[UPDATE_DOSSIER]
summary: Scaffolded megadungeon scout and subterranean law
title: Beneath the Titan's Vault
system: fantasy

[PROTAGONIST]
name: Rook
playbook: The Scout

[NPC]
name: Gideon High-Tower
role: Mentor

[WORLD_RULES]
title: Subterranean Bioluminescence
category: ecology
axiom: Torchlight attracts apex blind-hunters; delvers rely on cold alchemical moss.
[/WORLD_RULES]
[/UPDATE_DOSSIER]`;

        const report2 = applyDossierUpdates(unclosedAndWorldRule, empty);
        assert.equal(report2.hasMutations, true);
        assert.equal(report2.updatedDossier.meta.title, "Beneath the Titan's Vault", 'Campaign title must not be overwritten by [WORLD_RULES] title');
        assert.equal(report2.updatedDossier.protagonist.name, 'Rook', 'Unclosed [PROTAGONIST] must not bleed into [NPC] name');
        assert.equal(report2.updatedDossier.npcs.length, 1);
        assert.equal(report2.updatedDossier.npcs[0].name, 'Gideon High-Tower');
        assert.equal(report2.updatedDossier.worldRules.axioms.length, 1);
        assert.equal(report2.updatedDossier.worldRules.axioms[0].title, 'Subterranean Bioluminescence');
    });

    it('Live Session Zero Fix 3: parseDossierCritique preserves commas inside parenthetical stat arrays and full-sentence strengths', () => {
        const rawCritique = `[DOSSIER_CRITIQUE]
verdict: REVISE
score: 15
grade: D
strengths: - The stat array (+2, +1, +1, 0, -1) follows standard Powered by the Apocalypse conventions, and the tone is evocative.
weaknesses:
- Severe naming collision across [PROTAGONIST], [NPC], [MONSTER], and [FACTION] (all named "Gideon High-Tower").
directives:
- Use [REMOVE_WORLD_RULE: Gideon High-Tower] and [REMOVE_CUSTOM_MODULE], and give each entity a distinct identity.
[/DOSSIER_CRITIQUE]`;

        const parsed = parseDossierCritique(rawCritique);
        assert.equal(parsed.verdict, 'REVISE');
        assert.equal(parsed.score, 15);
        assert.equal(parsed.grade, 'D');
        assert.equal(parsed.strengths.length, 1, 'Must not split (+2, +1, +1, 0, -1) on commas');
        assert.ok(parsed.strengths[0].includes('(+2, +1, +1, 0, -1)'));
    });

    it('extractTextFromApiResponse extracts JSON payloads from reasoning models even when content is empty', () => {
        const reasoningWithJson = {
            choices: [{
                message: {
                    content: '',
                    reasoning_content: `<think>\nLet's analyze the relationship between Marta and Silas.\nMarta is cautious but neutral.\n</think>\n{\n  "friendship": 5,\n  "affection": 0,\n  "reason": "Cautious acquaintance."\n}`,
                },
            }],
        };
        const extracted = extractTextFromApiResponse(reasoningWithJson);
        assert.ok(extracted.includes('"friendship": 5'), 'Must successfully extract JSON from reasoning_content');
        assert.ok(!extracted.includes('<think>'), 'Must extract clean JSON payload without thought markup');
    });

    it('extractTextFromApiResponse safely discards truncated reasoning dumps without structured payload', () => {
        const truncatedReasoning = {
            choices: [{
                message: {
                    content: '',
                    reasoning_content: `<think>\nThinking about this character...\n1. Analyze the context\n2. `,
                },
            }],
        };
        const extracted = extractTextFromApiResponse(truncatedReasoning);
        assert.strictEqual(extracted, '', 'Truncated reasoning without structured payload must return empty string');
    });
});

import assert from 'node:assert';
import {
    parseNameRagOutput,
    discoverNameRagServer,
} from '../namerag-client.js';
import {
    buildGenreQuery,
    NAMERAG_SYSPROMPT_ID,
    syncNameRagAdhocSysprompt,
    buildNameRagSeedsForConcierge,
    extractNamePlaceholders,
    extractContextForPlaceholder,
    buildQueryFromPlaceholderContext,
    resolveDossierNamePlaceholders,
    rollNameRagCandidate,
    normalizeGenderFilter,
    detectGenderFromText,
    cleanContextKeywords,
    buildContextAwareQuery,
    parseResolvedNameToken,
} from '../namerag-hooks.js';
import { buildConciergeSystemPrompt, buildConciergeBuilderPrompt } from '../concierge-prompt.js';

console.log('--- Running NameRAG Integration & Diversity Test Suite ---');

// 1. Verify Concierge prompts include anti-repetition guidance and Builder directives
const prompt = buildConciergeSystemPrompt();
assert.ok(prompt.includes('[NAME_DIVERSITY_SEEDS]'), 'Concierge prompt should contain NAME_DIVERSITY_SEEDS guideline');
assert.ok(prompt.includes('repetitive LLM name tropes'), 'Prompt should instruct to avoid repetitive LLM clichés');

const builderPrompt = buildConciergeBuilderPrompt();
assert.ok(builderPrompt.includes('[[NAME:'), 'Builder prompt must document unique placeholder tokens [[NAME:tag]]');
assert.ok(builderPrompt.includes('Never invent cliché or repetitive LLM default names'), 'Builder prompt must instruct against cliché default names');
console.log('✓ Concierge & Builder prompts include anti-repetition guidance and unique placeholder directives');

// 2. Test parseNameRagOutput with various MCP payload structures
console.log('Testing parseNameRagOutput parsing resilience...');

// 2a. Array of candidates
const arrayPayload = [
    { name: 'Zamarius', gender: 'M', vibe: 'Name: Zamarius | Origin: The Obsidian Vaults | Meaning: "Shadow Weaver" | Vibe: A brooding sorcerer wrapped in midnight velvet.' },
    { name: 'Harryette', gender: 'F', vibe: 'A mischievous spell-caster' },
];
const res1 = parseNameRagOutput(arrayPayload);
assert.strictEqual(res1.length, 2);
assert.strictEqual(res1[0].name, 'Zamarius');
assert.strictEqual(res1[0].gender, 'M');
assert.strictEqual(res1[0].origin, 'The Obsidian Vaults');
assert.strictEqual(res1[0].meaning, '"Shadow Weaver"');
assert.strictEqual(res1[0].vibe, 'A brooding sorcerer wrapped in midnight velvet.');
assert.strictEqual(res1[1].name, 'Harryette');
assert.strictEqual(res1[1].gender, 'F');
console.log('✓ Array payload correctly parsed and formatted');

// 2b. Newline-delimited JSON objects (raw MCP stream format)
const newlineJson = `{
  "name": "Abbegayle",
  "gender": "F",
  "vibe": "Name: Abbegayle | Origin: Mist-Wreathed Moors | Meaning: \\"Father's Joy\\" | Vibe: A melancholic hedge-witch."
}
{
  "name": "Abhijay",
  "gender": "M",
  "vibe": "A stoic monk-commander"
}`;
const res2 = parseNameRagOutput(newlineJson);
assert.strictEqual(res2.length, 2);
assert.strictEqual(res2[0].name, 'Abbegayle');
assert.strictEqual(res2[0].origin, 'Mist-Wreathed Moors');
assert.strictEqual(res2[1].name, 'Abhijay');
console.log('✓ Newline-delimited JSON objects cleanly extracted and normalized');

// 2c. MCP content wrapper { result: { content: [{ type: 'text', text: '...' }] } }
const mcpContentPayload = {
    result: {
        content: [
            {
                type: 'text',
                text: JSON.stringify([
                    { name: 'Zyiah', gender: 'F', vibe: 'Shadow Weaver' },
                ]),
            },
        ],
    },
};
const res3 = parseNameRagOutput(mcpContentPayload);
assert.strictEqual(res3.length, 1);
assert.strictEqual(res3[0].name, 'Zyiah');
console.log('✓ MCP protocol content wrapper parsed successfully');

// 2d. Empty or malformed inputs return empty array safely
assert.deepStrictEqual(parseNameRagOutput(null), []);
assert.deepStrictEqual(parseNameRagOutput(''), []);
assert.deepStrictEqual(parseNameRagOutput('{ invalid json'), []);
console.log('✓ Malformed and empty payloads handle gracefully without throwing');

// 3. Test buildGenreQuery & Context-Aware Query Builders
console.log('Testing buildGenreQuery & buildContextAwareQuery mapping...');
assert.ok(buildGenreQuery('fantasy').includes('fantasy'));
assert.ok(buildGenreQuery('fantasy', 'necromancer').includes('necromancer'));
assert.ok(buildGenreQuery('scifi').includes('cyberpunk'));
assert.ok(buildGenreQuery('western').includes('frontier'));
assert.ok(buildGenreQuery('horror').includes('occult'));

// 3b. Test normalizeGenderFilter and detectGenderFromText
assert.strictEqual(normalizeGenderFilter('Male'), 'M');
assert.strictEqual(normalizeGenderFilter('Female'), 'F');
assert.strictEqual(normalizeGenderFilter('non-binary'), 'Dual');
assert.strictEqual(normalizeGenderFilter('unknown'), undefined);

assert.strictEqual(detectGenderFromText('A young female ranger from the mountains'), 'F');
assert.strictEqual(detectGenderFromText('An old male blacksmith with a scarred arm'), 'M');
assert.strictEqual(detectGenderFromText('An androgynous rogue lurking in shadows'), 'Dual');

// 3c. Test cleanContextKeywords & buildContextAwareQuery
const dirtyInstructions = 'A 28-year-old female ranger with a crossbow, starting in a storm-battered frontier town';
const cleanWords = cleanContextKeywords(dirtyInstructions);
assert.ok(cleanWords.includes('ranger'));
assert.ok(cleanWords.includes('crossbow'));
assert.ok(cleanWords.includes('frontier'));
assert.ok(!cleanWords.includes('with'));
assert.ok(!cleanWords.includes('starting'));

const contextQuery = buildContextAwareQuery({
    genre: 'fantasy',
    classHint: 'ranger',
    contextText: dirtyInstructions,
});
assert.ok(contextQuery.includes('fantasy'));
assert.ok(contextQuery.includes('ranger'));
assert.ok(contextQuery.includes('crossbow'));

// When contextText is empty, falls back to genre query
const emptyContextQuery = buildContextAwareQuery({ genre: 'fantasy', classHint: 'sorcerer' });
assert.strictEqual(emptyContextQuery, buildGenreQuery('fantasy', 'sorcerer'));
console.log('✓ Context-aware queries and gender filters accurately extract character details');

// 4. Test Ad-Hoc GM Guidance Injection in customSyspromptLibrary
console.log('Testing syncNameRagAdhocSysprompt...');
const mockSettings = {
    rpg_tracker: {
        customSyspromptLibrary: [
            { id: 'custom_tone', tag: 'tone', enabled: true },
        ],
        syspromptSnippetDatabase: [
            { id: 'custom_tone', tag: 'tone', scope: 'global', globalEnabled: true },
        ],
    },
};
globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings: mockSettings,
    }),
};

let refreshed = false;
await syncNameRagAdhocSysprompt(true, () => { refreshed = true; });

const lib = mockSettings.rpg_tracker.customSyspromptLibrary;
const entry = lib.find(p => p.id === NAMERAG_SYSPROMPT_ID);
assert.ok(entry, 'Ad-hoc NameRAG prompt snippet should be present');
assert.strictEqual(entry.enabled, true);
assert.strictEqual(entry.scope, 'global', 'Scope should be explicitly global');
assert.strictEqual(entry.globalEnabled, true, 'globalEnabled should be true');
assert.ok(entry.content.startsWith('<name_generation>'), 'Snippet must be enclosed in <name_generation> tags');
assert.ok(entry.content.endsWith('</name_generation>'), 'Snippet must close with </name_generation> tags');
assert.ok(entry.content.includes('search_names'));
assert.ok(entry.content.includes('Elidor'));
assert.strictEqual(refreshed, true, 'Refresh callback should have fired');

const dbEntry = mockSettings.rpg_tracker.syspromptSnippetDatabase.find(p => p.id === NAMERAG_SYSPROMPT_ID);
assert.ok(dbEntry, 'Snippet should be synced into syspromptSnippetDatabase');
assert.strictEqual(dbEntry.scope, 'global');
assert.strictEqual(dbEntry.globalEnabled, true);

// Toggle off
refreshed = false;
await syncNameRagAdhocSysprompt(false, () => { refreshed = true; });
assert.strictEqual(entry.enabled, false, 'Entry should be disabled when toggled off');
assert.strictEqual(entry.scope, 'global', 'Scope should remain global');
assert.strictEqual(entry.globalEnabled, false, 'globalEnabled should be false when toggled off');
assert.strictEqual(dbEntry.globalEnabled, false, 'Database entry globalEnabled should be false when toggled off');
assert.strictEqual(refreshed, true);
console.log('✓ Ad-hoc GM Guidance safely registered, toggled, and verified as GLOBAL in customSyspromptLibrary & syspromptSnippetDatabase');

// 5. Test dynamic discovery fallback when no servers present
console.log('Testing dynamic discovery fallback...');
globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
});
const failedDisc = await discoverNameRagServer(true);
assert.strictEqual(failedDisc.available, false);
assert.strictEqual(failedDisc.serverName, null);
console.log('✓ Discovery cleanly reports unavailable when MCP endpoint returns 404');

// 6. Test dynamic discovery when namerag is registered
globalThis.fetch = async () => ({
    ok: true,
    json: async () => [
        {
            name: 'namerag-mcp',
            isRunning: true,
            cachedTools: [{ name: 'search_names' }, { name: 'get_name_details' }],
        },
    ],
});
const okDisc = await discoverNameRagServer(true);
assert.strictEqual(okDisc.available, true);
assert.strictEqual(okDisc.serverName, 'namerag-mcp');
assert.strictEqual(okDisc.isRunning, true);
console.log('✓ Discovery dynamically identifies server providing search_names with zero hardcoded addresses');

// 7. Test placeholder extraction & context extraction
console.log('Testing placeholder extraction & context parsing...');
const sampleBlueprint = `[UPDATE_DOSSIER]
[PROTAGONIST]
name: [[NAME:protagonist]]
playbook: The Sleuth
demeanor: Cynical and watchful
bio: Former detective investigating occult crimes.
[/PROTAGONIST]
[NPC]
name: [[NAME:mentor]]
role: Mentor
species: Dwarf
background: Veteran runemith who forged the silver seal.
[/NPC]
[MONSTER]
name: [[NAME:stalker]]
attacks: Razor Claws (3 Harm)
[/MONSTER]
[/UPDATE_DOSSIER]`;

const placeholders = extractNamePlaceholders(sampleBlueprint);
assert.strictEqual(placeholders.length, 3);
assert.strictEqual(placeholders[0].token, '[[NAME:protagonist]]');
assert.strictEqual(placeholders[0].tag, 'protagonist');
assert.strictEqual(placeholders[1].token, '[[NAME:mentor]]');
assert.strictEqual(placeholders[1].tag, 'mentor');
assert.strictEqual(placeholders[2].token, '[[NAME:stalker]]');

const protoCtx = extractContextForPlaceholder(sampleBlueprint, '[[NAME:protagonist]]');
assert.strictEqual(protoCtx.blockType, 'PROTAGONIST');
assert.ok(protoCtx.contextSummary.includes('Sleuth'));
assert.ok(protoCtx.contextSummary.includes('occult'));

const query = buildQueryFromPlaceholderContext({
    tag: 'mentor',
    genre: 'fantasy',
    blockType: 'NPC',
    contextSummary: 'Veteran runemith who forged the silver seal.',
});
assert.ok(query.includes('fantasy'));
assert.ok(query.includes('mentor'));
assert.ok(query.includes('runemith'));
console.log('✓ Unique placeholders, entity contexts, and targeted queries extracted accurately');

// 8. Test resolveDossierNamePlaceholders with mocked NameRAG server
console.log('Testing resolveDossierNamePlaceholders with mocked NameRAG responses...');
globalThis.fetch = async (url, opts) => {
    if (url.includes('/call-tool')) {
        const body = JSON.parse(opts.body);
        const q = body.arguments.query;
        if (q.includes('protagonist') || q.includes('Sleuth')) {
            return {
                ok: true,
                json: async () => ({
                    result: [
                        { name: 'Kaelen Valerius', vibe: 'cynical noir investigator' },
                    ],
                }),
            };
        }
        if (q.includes('mentor') || q.includes('runemith')) {
            return {
                ok: true,
                json: async () => ({
                    result: [
                        { name: 'Thorgar Ironbeard', vibe: 'gruff dwarf runemaster' },
                    ],
                }),
            };
        }
        return {
            ok: true,
            json: async () => ({
                result: [
                    { name: 'Morvath', vibe: 'night stalker' },
                ],
            }),
        };
    }
    return {
        ok: true,
        json: async () => [
            {
                name: 'namerag-mcp',
                isRunning: true,
                cachedTools: [{ name: 'search_names' }],
            },
        ],
    };
};

const resolvedOutput = await resolveDossierNamePlaceholders(sampleBlueprint, {
    meta: { systemKey: 'fantasy' },
});
assert.ok(!resolvedOutput.includes('[[NAME:'), 'All [[NAME:...]] placeholders must be resolved');
assert.ok(resolvedOutput.includes('name: Kaelen Valerius'), 'Protagonist name resolved to NameRAG candidate');
assert.ok(resolvedOutput.includes('[NAME: mentor, RESOLVED TO: Thorgar Ironbeard]'), 'Mentor name evolved to blueprint syntax');
assert.ok(resolvedOutput.includes('[NAME: stalker, RESOLVED TO: Morvath]'), 'Monster name evolved to blueprint syntax');
assert.strictEqual(parseResolvedNameToken('[NAME: mentor, RESOLVED TO: Thorgar Ironbeard]').cleanName, 'Thorgar Ironbeard');
assert.strictEqual(parseResolvedNameToken('[NAME: mentor, RESOLVED TO: Thorgar Ironbeard]').tag, 'mentor');
assert.strictEqual(parseResolvedNameToken('[NAME: mentor, RESOLVED TO: Thorgar Ironbeard]').isResolvedToken, true);
console.log('✓ Targeted NameRAG resolution pipeline successfully replaced all placeholders without collisions');

// 9. Test resolveDossierNamePlaceholders offline fallback
console.log('Testing resolveDossierNamePlaceholders offline fallback...');
globalThis.fetch = async () => ({
    ok: false,
    status: 500,
});
// Force discovery cache refresh
await discoverNameRagServer(true);

const offlineBlueprint = `[UPDATE_DOSSIER]
[PROTAGONIST]
name: [[NAME:wanderer]]
playbook: The Wanderer
[/PROTAGONIST]
[/UPDATE_DOSSIER]`;

const offlineResolved = await resolveDossierNamePlaceholders(offlineBlueprint, {
    meta: { systemKey: 'fantasy' },
});
assert.ok(!offlineResolved.includes('[[NAME:'), 'Offline fallback must resolve placeholders completely');
assert.ok(/name:\s+(?:\[NAME:[^\]]+\]|[A-Za-z]+)/.test(offlineResolved), 'A clean replacement or evolved name must be assigned');
assert.ok(parseResolvedNameToken(offlineResolved.match(/name:\s*([^\n\r]+)/)[1]).cleanName.length > 0);
console.log('✓ Offline fallback cleanly populates names without leaving placeholder tokens');

// 10. Test rollNameRagCandidate timeout & fallback source tagging
console.log('Testing rollNameRagCandidate timeout and fallback source tagging...');
const fallbackRoll = await rollNameRagCandidate('fantasy', '', { timeoutMs: 50 });
assert.ok(fallbackRoll.name, 'Fallback roll must return a name');
assert.strictEqual(fallbackRoll.source, 'offline_fallback', 'Should be tagged with offline_fallback source');
assert.ok(fallbackRoll.error, 'Should capture error message for toast notification');
console.log('✓ rollNameRagCandidate tags fallback source and error message cleanly');

// 11. Test explicit gender extraction and NameRAG query passing for companions and protagonists
console.log('Testing explicit gender extraction and NameRAG integration for companion and protagonist...');
const dualRepBlueprint = `[UPDATE_DOSSIER]
[PROTAGONIST]
name: [[NAME:protagonist]]
gender: male
playbook: Veteran Hermit
positive_tags: Steady Hand [when firing under pressure], Companion: [[NAME:companion]] (Courier Scout), Heirloom Halberd [in close quarters]
[/PROTAGONIST]
[NPC]
name: [[NAME:companion]]
role: Companion
gender: female
archetype: Courier Scout
appearance: Spunky young woman with leather messenger satchel
demeanor: Urgent and determined
background: Fled the tyrant's scouts across mountain ridges
[/NPC]
[/UPDATE_DOSSIER]`;

const protoContext = extractContextForPlaceholder(dualRepBlueprint, '[[NAME:protagonist]]');
assert.strictEqual(protoContext.gender, 'M', 'Protagonist explicit gender: male must normalize to "M"');

const compContext = extractContextForPlaceholder(dualRepBlueprint, '[[NAME:companion]]');
assert.strictEqual(compContext.gender, 'F', 'Companion explicit gender: female must normalize to "F"');
assert.strictEqual(compContext.blockType, 'COMPANION');
assert.ok(compContext.contextSummary.includes('Courier Scout'));
assert.ok(compContext.contextSummary.includes('Spunky young woman'));

let receivedArgs = [];
globalThis.fetch = async (url, opts) => {
    if (url.includes('/call-tool')) {
        const body = JSON.parse(opts.body);
        receivedArgs.push(body.arguments);
        if (body.arguments.gender === 'F') {
            return {
                ok: true,
                json: async () => ({
                    result: [{ name: 'Diretha', gender: 'F', vibe: 'courageous rebel messenger' }],
                }),
            };
        }
        return {
            ok: true,
            json: async () => ({
                result: [{ name: 'Montavis', gender: 'M', vibe: 'weary mountain hermit' }],
            }),
        };
    }
    return {
        ok: true,
        json: async () => [
            {
                name: 'namerag-mcp',
                isRunning: true,
                cachedTools: [{ name: 'search_names' }],
            },
        ],
    };
};
await discoverNameRagServer(true);

const { text: resolvedDual, resolutions: dualRes } = await resolveDossierNamePlaceholders(
    dualRepBlueprint,
    { meta: { systemKey: 'fae' } },
    { returnDetails: true }
);

assert.ok(resolvedDual.includes('name: Montavis'), 'Protagonist resolved to Montavis');
assert.ok(resolvedDual.includes('Companion: Diretha (Courier Scout)'), 'Companion tag in protagonist resolved to Diretha');
assert.ok(resolvedDual.includes('name: Diretha'), 'Companion NPC card resolved to Diretha');
assert.ok(!resolvedDual.includes('[[NAME:'), 'All tokens resolved cleanly');

const protoRes = dualRes.find(r => r.placeholder === '[[NAME:protagonist]]');
assert.strictEqual(protoRes.gender, 'M', 'Resolution trace must capture gender: M for protagonist');

const compRes = dualRes.find(r => r.placeholder === '[[NAME:companion]]');
assert.strictEqual(compRes.gender, 'F', 'Resolution trace must capture gender: F for companion');

const compApiCall = receivedArgs.find(a => a.gender === 'F');
assert.ok(compApiCall, 'NameRAG search_names must be called with gender: "F" for companion');
const protoApiCall = receivedArgs.find(a => a.gender === 'M');
assert.ok(protoApiCall, 'NameRAG search_names must be called with gender: "M" for protagonist');

console.log('✓ Companion dual-representation tokens, explicit Builder gender, and NameRAG arguments verified end-to-end');

// 12. Test Canon Series Bible [CANON_ENTRY] card and JSON array context extraction & resolution
console.log('Testing Canon Series Bible placeholder context extraction and resolution...');
const canonEntryBlock = `[UPDATE_DOSSIER]
[CANON_ENTRY]
kind: NPC
name: [[NAME: grizzled wasteland doctor]]
importance: 4
aliases: Doc, The Healer
disabled: false
content: A veteran field medic who survived the Great Fire and now runs a triage outpost in the Rust Wastes. She tends to irradiated nomads.
[/CANON_ENTRY]
[/UPDATE_DOSSIER]`;

const canonCtx = extractContextForPlaceholder(canonEntryBlock, '[[NAME: grizzled wasteland doctor]]');
assert.strictEqual(canonCtx.blockType, 'NPC', 'Block type for kind: NPC canon entry must resolve to NPC');
assert.ok(canonCtx.contextSummary.includes('veteran field medic'), 'Context summary must include canon content');
assert.strictEqual(canonCtx.gender, 'F', 'Gender must be detected as F from "She tends to irradiated nomads"');

const rawJsonCanon = JSON.stringify([
    {
        kind: 'NPC',
        name: '[[NAME: nomadic raider matriarch]]',
        aliases: ['Iron Queen'],
        importance: 4,
        content: 'Fierce warlord who leads the Rust Riders across the ash wastes. She commands with an iron fist.',
    },
    {
        kind: 'LOCATION',
        name: 'The Obsidian Spires',
        aliases: ['The Needle Peaks'],
        importance: 4,
        content: 'Towering crystalline structures that pierce the toxic clouds.',
    },
]);

const jsonCtx = extractContextForPlaceholder(rawJsonCanon, '[[NAME: nomadic raider matriarch]]');
assert.strictEqual(jsonCtx.blockType, 'NPC', 'JSON block type for kind: NPC must resolve to NPC');
assert.ok(jsonCtx.contextSummary.includes('Fierce warlord'), 'JSON context summary must include content');
assert.strictEqual(jsonCtx.gender, 'F', 'JSON gender must be detected as F from "She commands"');

const resolvedJsonOutput = await resolveDossierNamePlaceholders(rawJsonCanon, {
    meta: {
        title: 'Ashen Horizons',
        tone: 'post-apocalyptic wasteland',
        premise: 'Survival in the irradiated desert',
    },
});

assert.ok(!resolvedJsonOutput.includes('[[NAME:'), 'All JSON placeholder tokens must be resolved');
assert.ok(resolvedJsonOutput.includes('The Obsidian Spires'), 'Non-placeholder JSON fields must remain intact');
const parsedJson = JSON.parse(resolvedJsonOutput);
assert.strictEqual(parsedJson.length, 2);
assert.ok(parsedJson[0].name && !parsedJson[0].name.includes('[[NAME:'), 'Resolved name must be valid');
console.log('✓ Series Bible Canon cards and JSON array placeholders extracted and resolved cleanly');

// 13. Test parseResolvedNameToken parser resilience, evolution syntax, and launch sanitization
console.log('Testing parseResolvedNameToken evolution syntax and launch sanitization...');

// 13a. parseResolvedNameToken standard format
const parsed1 = parseResolvedNameToken('[NAME: desperate threshold runner, RESOLVED TO: Kaelen Ward]');
assert.strictEqual(parsed1.cleanName, 'Kaelen Ward');
assert.strictEqual(parsed1.tag, 'desperate threshold runner');
assert.strictEqual(parsed1.isResolvedToken, true);

// 13b. parseResolvedNameToken alternate format
const parsed2 = parseResolvedNameToken('[REALNAME: Silas Vane, NAME: paranoid scrap-doc]');
assert.strictEqual(parsed2.cleanName, 'Silas Vane');
assert.strictEqual(parsed2.tag, 'paranoid scrap-doc');
assert.strictEqual(parsed2.isResolvedToken, true);

// 13c. parseResolvedNameToken clean string pass-through
const parsed3 = parseResolvedNameToken('Coil-Jackal');
assert.strictEqual(parsed3.cleanName, 'Coil-Jackal');
assert.strictEqual(parsed3.tag, '');
assert.strictEqual(parsed3.isResolvedToken, false);

// 13d. parseResolvedNameToken fallback for unstripped placeholder
const parsed4 = parseResolvedNameToken('[[NAME: desperate threshold runner]]');
assert.strictEqual(parsed4.cleanName, 'desperate threshold runner');
assert.strictEqual(parsed4.tag, 'desperate threshold runner');
assert.strictEqual(parsed4.isResolvedToken, false);

// 13e. Exemption from extractNamePlaceholders re-resolution
const sampleEvolvedText = 'name: [NAME: desperate threshold runner, RESOLVED TO: Kaelen Ward]\nname: [NAME: paranoid scrap-doc, RESOLVED TO: Silas Vane]';
const secondPassPlaceholders = extractNamePlaceholders(sampleEvolvedText);
assert.strictEqual(secondPassPlaceholders.length, 0, 'Evolved tokens must never be re-extracted as placeholders');

// 13f. Step 3 Auto-Pass resolution simulation matching user screenshot
const step3AutoPassOutput = `[UPDATE_DOSSIER]
[NPC]
name: [[NAME: desperate threshold runner]]
role: Ally
appearance: Ragged scavenger in padded leather
[/NPC]
[NPC]
name: [[NAME: paranoid scrap-doc]]
role: Ally
appearance: Tense doctor with ocular lens
[/NPC]
[MONSTER]
name: Coil-Jackal
threat_level: 1
[/MONSTER]
[/UPDATE_DOSSIER]`;

const step3Resolved = await resolveDossierNamePlaceholders(step3AutoPassOutput, {
    meta: { systemKey: 'fae', tone: 'post-apocalyptic' },
});

assert.ok(!step3Resolved.includes('[[NAME:'), 'Auto-pass output must have no unresolved [[NAME:');
assert.ok(step3Resolved.includes('[NAME: desperate threshold runner, RESOLVED TO:'), 'Threshold runner must evolve with concept tag');
assert.ok(step3Resolved.includes('[NAME: paranoid scrap-doc, RESOLVED TO:'), 'Scrap doc must evolve with concept tag');
assert.ok(step3Resolved.includes('name: Coil-Jackal'), 'Pre-named monster must remain intact');

// 13g. Launch pipeline sanitization
const { applyDossierUpdates, createEmptyDossier } = await import('../concierge-parser.js');
const { updatedDossier } = applyDossierUpdates(step3Resolved, createEmptyDossier('fae'));
assert.strictEqual(updatedDossier.npcs.length, 2);
// In blueprint, names have evolution syntax
assert.ok(updatedDossier.npcs[0].name.startsWith('[NAME:'));
assert.ok(updatedDossier.npcs[1].name.startsWith('[NAME:'));

// When launched, names are sanitized to clean names
const cleanNpcNames = updatedDossier.npcs.map(n => parseResolvedNameToken(n.name).cleanName);
assert.ok(!cleanNpcNames[0].includes('['), 'Sanitized NPC name must have no brackets');
assert.ok(!cleanNpcNames[1].includes('['), 'Sanitized NPC name must have no brackets');
assert.ok(cleanNpcNames[0].length > 1);
assert.ok(cleanNpcNames[1].length > 1);
console.log('✓ parseResolvedNameToken, evolution format, double-bracket exemption, and launch sanitization verified cleanly');

console.log('--- ALL NAMERAG INTEGRATION TESTS PASSED CLEANLY! ---');

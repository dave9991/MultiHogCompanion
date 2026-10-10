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

// 3. Test buildGenreQuery
console.log('Testing buildGenreQuery mapping...');
assert.ok(buildGenreQuery('fantasy').includes('fantasy'));
assert.ok(buildGenreQuery('fantasy', 'necromancer').includes('necromancer'));
assert.ok(buildGenreQuery('scifi').includes('cyberpunk'));
assert.ok(buildGenreQuery('western').includes('frontier'));
assert.ok(buildGenreQuery('horror').includes('occult'));
console.log('✓ Genre queries correctly mapped with optional archetype hints');

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
assert.ok(resolvedOutput.includes('name: Thorgar Ironbeard'), 'Mentor name resolved to NameRAG candidate');
assert.ok(resolvedOutput.includes('name: Morvath'), 'Monster name resolved to NameRAG candidate');
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
assert.ok(/name:\s+[A-Za-z]+/.test(offlineResolved), 'A clean replacement name must be assigned');
console.log('✓ Offline fallback cleanly populates names without leaving placeholder tokens');

console.log('--- ALL NAMERAG INTEGRATION TESTS PASSED CLEANLY! ---');

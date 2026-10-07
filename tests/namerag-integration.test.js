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
} from '../namerag-hooks.js';
import { buildConciergeSystemPrompt } from '../concierge-prompt.js';

console.log('--- Running NameRAG Integration & Diversity Test Suite ---');

// 1. Verify Concierge prompt includes NAME_DIVERSITY_SEEDS directive
const prompt = buildConciergeSystemPrompt();
assert.ok(prompt.includes('[NAME_DIVERSITY_SEEDS]'), 'Concierge prompt should contain NAME_DIVERSITY_SEEDS guideline');
assert.ok(prompt.includes('repetitive LLM name tropes'), 'Prompt should instruct to avoid repetitive LLM clichés');
console.log('✓ Concierge prompt includes NAME_DIVERSITY_SEEDS directive and anti-repetition guidance');

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
assert.ok(entry.content.includes('search_names'));
assert.ok(entry.content.includes('Elidor'));
assert.strictEqual(refreshed, true, 'Refresh callback should have fired');

// Toggle off
refreshed = false;
await syncNameRagAdhocSysprompt(false, () => { refreshed = true; });
assert.strictEqual(entry.enabled, false, 'Entry should be disabled when toggled off');
assert.strictEqual(refreshed, true);
console.log('✓ Ad-hoc GM Guidance safely registered, toggled, and verified in customSyspromptLibrary');

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

console.log('--- ALL NAMERAG INTEGRATION TESTS PASSED CLEANLY! ---');

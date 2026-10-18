import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEmptyDossier,
    applyDossierUpdates,
    stripConciergeStateBlocks,
    cleanTargetName,
    clampRelationshipScore,
    buildAxiomCardHtml,
} from '../concierge-parser.js';

describe('Concierge Parser & LLM Output Edge Cases', () => {

    it('cleanly strips interleaved reasoning tags and unclosed update blocks', () => {
        const textWithThoughts = `
<think>
The user wants to add an elven archer named Lyra.
I should produce the [UPDATE_DOSSIER] directive.
</think>
Hello adventurer! I have drafted Lyra into your companion roster.
[UPDATE_DOSSIER]
[NPC:Lyra]
role: Ally
playbook: Ranger
[/NPC]
[`;
        const stripped = stripConciergeStateBlocks(textWithThoughts);
        assert.ok(!stripped.includes('<think>'), 'Must strip <think> tag');
        assert.ok(!stripped.includes('The user wants to add'), 'Must strip thinking content');
        assert.ok(!stripped.includes('[UPDATE_DOSSIER]'), 'Must strip unclosed dossier directive');
        assert.ok(!stripped.includes('[NPC:Lyra]'), 'Must strip NPC block');
        assert.match(stripped, /Hello adventurer! I have drafted Lyra into your companion roster\./);
    });

    it('gracefully recovers entity mutations from truncated LLM output', () => {
        const dossier = createEmptyDossier();
        // Model reaches maxTokens and stops abruptly without closing tags
        const truncatedOutput = `
[UPDATE_DOSSIER]
summary: Added obsidian faction and starting location
[FACTION: Obsidian Syndicate]
standing: Hostile
agenda: Control the spice docks
[MAP: Blackwater Docks]
briefDescription: Smuggling port cloaked in heavy fog
`;
        const result = applyDossierUpdates(truncatedOutput, dossier);
        assert.strictEqual(result.hasMutations, true, 'Should extract available blocks despite missing closing tags');
        assert.strictEqual(result.updatedDossier.factions.length, 1);
        assert.strictEqual(result.updatedDossier.factions[0].name, 'Obsidian Syndicate');
        assert.strictEqual(result.updatedDossier.factions[0].standing, 'Hostile');
        assert.strictEqual(result.updatedDossier.maps.length, 1);
        assert.strictEqual(result.updatedDossier.maps[0].site, 'Blackwater Docks');
    });

    it('handles special characters, brackets, quotes, and metacharacters in entity names', () => {
        assert.strictEqual(cleanTargetName('**"Lord [Vex] (The Swift)"**'), 'Lord [Vex] (The Swift)');
        assert.strictEqual(cleanTargetName('`"\'Kael\'"`'), 'Kael');
        assert.strictEqual(cleanTargetName(''), '');

        const dossier = createEmptyDossier();
        const complexUpdate = `
[UPDATE_DOSSIER]
[NPC: "Cpt. Redacted (The Hook)" ]
role: Rival
relationship: Distrustful debtor
stats: Grit +2, Wit -1
[/NPC]
[/UPDATE_DOSSIER]
`;
        const res = applyDossierUpdates(complexUpdate, dossier);
        assert.strictEqual(res.hasMutations, true);
        assert.strictEqual(res.updatedDossier.npcs.length, 1);
        assert.strictEqual(res.updatedDossier.npcs[0].name, 'Cpt. Redacted (The Hook)');

        // Removing with quotes/punctuation in name
        const removeUpdate = `
[UPDATE_DOSSIER]
[REMOVE_NPC: Cpt. Redacted (The Hook)]
[/UPDATE_DOSSIER]
`;
        const res2 = applyDossierUpdates(removeUpdate, res.updatedDossier);
        assert.strictEqual(res2.hasMutations, true);
        assert.strictEqual(res2.updatedDossier.npcs.length, 0, 'Should remove entity whose name contains punctuation');
    });

    it('clamps and normalizes extreme and boundary relationship scores', () => {
        assert.strictEqual(clampRelationshipScore(999), 150);
        assert.strictEqual(clampRelationshipScore(-500), -150);
        assert.strictEqual(clampRelationshipScore('100'), 100);
        assert.strictEqual(clampRelationshipScore('invalid'), 0);
        assert.strictEqual(clampRelationshipScore(undefined), 0);
        assert.strictEqual(clampRelationshipScore(null), 0);
    });

    it('renders axioms with unknown categories using fallback styles without crashing', () => {
        const unknownAxiom = {
            title: 'Cosmic Drift',
            category: 'quantum_weirdness_tier_9',
            axiom: 'Matter occasionally shifts phase.',
            substitutions: ['Boats -> Sub-space Skiffs'],
            negativeConstraints: ['No static structures'],
            architecturalNotes: 'Anchored tethers only',
        };
        const html = buildAxiomCardHtml(unknownAxiom);
        assert.ok(html.includes('QUANTUM_WEIRDNESS_TIER_9'));
        assert.ok(html.includes('rgba(156, 163, 175, 0.4)'), 'Must use default neutral border color');
        assert.ok(html.includes('Sub-space Skiffs'));
    });

    it('guarantees idempotency when identical updates are applied consecutively', () => {
        const dossier = createEmptyDossier();
        const updateBlock = `
[UPDATE_DOSSIER]
[FACTION: Iron Vanguard]
standing: Neutral
agenda: Guard the northern wall
[NPC: Commander Vane]
role: Ally
playbook: Paladin
[/NPC]
[/UPDATE_DOSSIER]
`;
        const firstPass = applyDossierUpdates(updateBlock, dossier);
        assert.strictEqual(firstPass.updatedDossier.factions.length, 1);
        assert.strictEqual(firstPass.updatedDossier.npcs.length, 1);

        // Apply identical block again on updatedDossier (e.g. LLM echoes or re-runs)
        const secondPass = applyDossierUpdates(updateBlock, firstPass.updatedDossier);
        assert.strictEqual(secondPass.updatedDossier.factions.length, 1, 'Should not duplicate existing faction');
        assert.strictEqual(secondPass.updatedDossier.npcs.length, 1, 'Should not duplicate existing NPC');
        assert.strictEqual(secondPass.updatedDossier.npcs[0].name, 'Commander Vane');
    });

});

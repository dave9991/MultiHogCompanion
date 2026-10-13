/**
 * concierge-max-harm-customization.test.js — MultiHog Companion
 *
 * Verifies custom handling of Max Harm (0 HP) across:
 * 1. createEmptyDossier defaults
 * 2. applyDossierUpdates parsing of [CONFIG] directives
 * 3. formatDossierForContext, serializeDossierToMarkdown, parseCampaignDossierMarkdown round-trip
 * 4. healAndNormalizeDossier recovery
 * 5. buildPbtACombatContent dynamic top tier and AT MAX HARM rules
 * 6. buildPbtACyoaPrompt adaptive Downed/Crisis choices
 * 7. buildPbtAStockPrompts custom status tokens
 * 8. buildPbtACartridge integration
 */

import assert from 'node:assert';
import {
    createEmptyDossier,
    applyDossierUpdates,
    formatDossierForContext,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
    healAndNormalizeDossier,
} from '../concierge-parser.js';
import {
    buildPbtACombatContent,
    buildPbtACyoaPrompt,
    buildPbtAStockPrompts,
    buildPbtACartridge,
} from '../pbta-ruleset.js';

console.log('--- Running Concierge Max Harm Customization Test Suite ---');

// ── 1. Default Dossier Schema ────────────────────────────────────────────────
console.log('Testing createEmptyDossier defaults...');
const empty = createEmptyDossier();
assert.ok(empty.config.maxHarmFate, 'createEmptyDossier must have maxHarmFate');
assert.strictEqual(empty.config.maxHarmFate.rule, 'Mortal Peril (Last Breath / Dying)');
assert.strictEqual(empty.config.maxHarmFate.statusToken, '(-) Incapacitated');
console.log('✓ createEmptyDossier defaults verified');

// ── 2. [CONFIG] Directive Parsing in applyDossierUpdates ─────────────────────
console.log('Testing applyDossierUpdates [CONFIG] parsing...');

// A. MMO Respawn with explicit token
const mmoText = `
[CONFIG]
max_harm_fate: MMO / Soul Respawn (Return to nearest shrine or graveyard) | Status: (-) Ghost
[/CONFIG]
`;
const mmoRes = applyDossierUpdates(mmoText, createEmptyDossier());
assert.ok(mmoRes.success, 'Update must succeed');
assert.strictEqual(mmoRes.updatedDossier.config.maxHarmFate.rule, 'MMO / Soul Respawn (Return to nearest shrine or graveyard)');
assert.strictEqual(mmoRes.updatedDossier.config.maxHarmFate.statusToken, '(-) Ghost');
assert.strictEqual(mmoRes.updatedDossier.config.maxHarmFate.cyoaStyle, 'respawn');
assert.ok(mmoRes.changes.some(c => c.includes('Max Harm fate dial set')), 'Must log change');

// B. Slice of Life Burnout with auto token inference
const solText = `
[CONFIG]
downed_fate: Emotional & Physical Burnout (Faint or collapse, retreat to bed)
[/CONFIG]
`;
const solRes = applyDossierUpdates(solText, createEmptyDossier());
assert.ok(solRes.success);
assert.strictEqual(solRes.updatedDossier.config.maxHarmFate.rule, 'Emotional & Physical Burnout (Faint or collapse, retreat to bed)');
assert.strictEqual(solRes.updatedDossier.config.maxHarmFate.statusToken, '(-) Burnt Out');
assert.strictEqual(solRes.updatedDossier.config.maxHarmFate.cyoaStyle, 'burnout');

// C. Knockout / Capture with auto token inference
const koText = `
[CONFIG]
max_harm_rule: Knocked Out / Captured (Subdued by police, taken to holding cell)
[/CONFIG]
`;
const koRes = applyDossierUpdates(koText, createEmptyDossier());
assert.ok(koRes.success);
assert.strictEqual(koRes.updatedDossier.config.maxHarmFate.statusToken, '(-) Unconscious');
assert.strictEqual(koRes.updatedDossier.config.maxHarmFate.cyoaStyle, 'knockout');
console.log('✓ applyDossierUpdates [CONFIG] parsing verified');

// ── 3. Serialization and Deserialization Round-Trip ──────────────────────────
console.log('Testing serialization and deserialization round-trip...');
const customDossier = createEmptyDossier();
customDossier.meta.title = 'Neon MMO Odyssey';
customDossier.meta.premise = 'An epic VRMMO adventure';
customDossier.config.maxHarmFate = {
    rule: 'Soul Crystal Respawn (Return to Grand Plaza)',
    statusToken: '(-) Spirit Form',
    cyoaStyle: 'respawn',
};

const contextStr = formatDossierForContext(customDossier);
assert.ok(contextStr.includes('max_harm_fate=Soul Crystal Respawn (Return to Grand Plaza)'), 'formatDossierForContext must include max_harm_fate');

const md = serializeDossierToMarkdown(customDossier);
assert.ok(md.includes('* **Max Harm Fate:** Soul Crystal Respawn (Return to Grand Plaza) | **Status Token:** (-) Spirit Form'), 'Markdown must serialize Max Harm Fate');

const parsed = parseMarkdownToDossier(md);
assert.ok(parsed, 'Markdown must parse');
assert.strictEqual(parsed.config?.maxHarmFate?.rule, 'Soul Crystal Respawn (Return to Grand Plaza)');
assert.strictEqual(parsed.config?.maxHarmFate?.statusToken, '(-) Spirit Form');

const healed = healAndNormalizeDossier(parsed);
assert.strictEqual(healed.config.maxHarmFate.rule, 'Soul Crystal Respawn (Return to Grand Plaza)');
assert.strictEqual(healed.config.maxHarmFate.statusToken, '(-) Spirit Form');
console.log('✓ Serialization round-trip and dossier normalization verified');

// ── 4. buildPbtACombatContent Custom Tiers & AT MAX HARM ────────────────────
console.log('Testing buildPbtACombatContent dynamic combat prompts...');

// Default combat prompt (no custom fate)
const defaultCombat = buildPbtACombatContent(5);
assert.ok(defaultCombat.includes('5 Harm (Max Harm / 0 HP): Lethal / dying / unconscious (Status: Defeated / Incapacitated)'), 'Default must use standard lethal tier');
assert.ok(defaultCombat.includes('Immediate fictional consequences apply (capture, desperate rescue, last breath / sacrifice, or slipping into darkness)'), 'Default must have standard consequence');

// Custom MMO combat prompt
const mmoCombat = buildPbtACombatContent(5, {
    config: {
        maxHarmFate: {
            rule: 'MMO Soul Respawn at nearest bindstone',
            statusToken: '(-) Ghost',
        },
    },
});
assert.ok(mmoCombat.includes('5 Harm (Max Harm / 0 HP): MMO Soul Respawn at nearest bindstone (Status: (-) Ghost / Defeated).'), 'Combat tier must reflect MMO respawn');
assert.ok(mmoCombat.includes('When {{user}} reaches Max Harm (5/5 Harm, 0/5 HP), they suffer the setting\'s downed fate: MMO Soul Respawn at nearest bindstone (Status: (-) Ghost).'), 'AT MAX HARM must mandate MMO fate');
assert.ok(mmoCombat.includes('Adversaries reaching Max Harm are Defeated/Overcome'), 'Must distinguish adversary defeat');

// Custom Slice-of-Life combat prompt
const solCombat = buildPbtACombatContent(4, {
    config: {
        harmMax: 4,
        maxHarmFate: {
            rule: 'Emotional Burnout & Fainting',
            statusToken: '(-) Burnt Out',
        },
    },
});
assert.ok(solCombat.includes('4 Harm (Max Harm / 0 HP): Emotional Burnout & Fainting (Status: (-) Burnt Out / Defeated).'), 'Combat tier must reflect burnout');
assert.ok(solCombat.includes('Status: (-) Burnt Out'), 'AT MAX HARM must use (-) Burnt Out status');
console.log('✓ buildPbtACombatContent custom rules verified');

// ── 5. buildPbtACyoaPrompt Adaptive Downed Choices ──────────────────────────
console.log('Testing buildPbtACyoaPrompt adaptive downed choices...');

// Default choices
const defaultCyoa = buildPbtACyoaPrompt('fantasy', { playstyle: 'cyoa_5' });
assert.ok(defaultCyoa.includes('CLING TO LIFE / LAST BREATH'), 'Default must have Cling to Life');
assert.ok(defaultCyoa.includes('FAINT UTTERANCE / CALL FOR AID'), 'Default must have Faint Utterance');

// MMO respawn choices
const mmoCyoa = buildPbtACyoaPrompt('scifi', {
    config: {
        playstyle: 'cyoa_5',
        maxHarmFate: {
            rule: 'MMO / Soul Respawn at graveyard',
            statusToken: '(-) Ghost',
            cyoaStyle: 'respawn',
        },
    },
});
assert.ok(mmoCyoa.includes('RELEASE SPIRIT / RESPAWN'), 'MMO must have Release Spirit');
assert.ok(mmoCyoa.includes('AWAIT RESURRECTION'), 'MMO must have Await Resurrection');
assert.ok(mmoCyoa.includes('SLIP INTO THE SHADOWS / PHANTOM FORM'), 'MMO must have Phantom Form');

// Slice-of-Life burnout choices
const solCyoa = buildPbtACyoaPrompt('anime', {
    config: {
        playstyle: 'cyoa_5',
        maxHarmFate: {
            rule: 'Emotional & Physical Burnout',
            statusToken: '(-) Burnt Out',
            cyoaStyle: 'burnout',
        },
    },
});
assert.ok(solCyoa.includes('COLLAPSE / RETREAT TO REST'), 'Burnout must have Retreat to Rest');
assert.ok(solCyoa.includes('ACCEPT COMFORT / CARE'), 'Burnout must have Accept Comfort');
assert.ok(solCyoa.includes('RAW CONFESSION / TEARS'), 'Burnout must have Raw Confession');
console.log('✓ buildPbtACyoaPrompt adaptive downed choices verified');

// ── 6. buildPbtAStockPrompts Status Token Customization ──────────────────────
console.log('Testing buildPbtAStockPrompts status tokens...');

// Default stock prompt
const defaultStock = buildPbtAStockPrompts('fantasy', { config: { harmMax: 5 } });
assert.ok(defaultStock.character.includes('status MUST reflect incapacitation: Status: (-) Incapacitated, (-) Dying, or Defeated.'), 'Default character status must be Incapacitated');

// Custom MMO stock prompt
const mmoStock = buildPbtAStockPrompts('scifi', {
    config: {
        harmMax: 5,
        maxHarmFate: {
            rule: 'Soul Respawn',
            statusToken: '(-) Ghost',
        },
    },
});
assert.ok(mmoStock.character.includes('status MUST reflect condition: Status: (-) Ghost, (-) Incapacitated, (-) Dying, or Defeated.'), 'Custom character status must mandate (-) Ghost');
console.log('✓ buildPbtAStockPrompts custom status tokens verified');

// ── 7. Cartridge Assembly Integration ────────────────────────────────────────
console.log('Testing buildPbtACartridge integration...');
const cartMmo = buildPbtACartridge('scifi', {
    config: {
        harmMax: 5,
        maxHarmFate: {
            rule: 'Soul Respawn at Shrine',
            statusToken: '(-) Ghost',
            cyoaStyle: 'respawn',
        },
    },
});
const combatSnippet = cartMmo.payload.customSyspromptLibrary.find(s => s.id === 'pbta_base_override_combat');
assert.ok(combatSnippet, 'Cartridge must include combat snippet');
assert.ok(combatSnippet.content.includes('Soul Respawn at Shrine (Status: (-) Ghost / Defeated)'), 'Cartridge combat must use custom Max Harm fate');
assert.ok(cartMmo.payload.stockPrompts.character.includes('Status: (-) Ghost'), 'Cartridge stock prompts must include custom status token');
console.log('✓ buildPbtACartridge integration verified');

console.log('--- ALL CONCIERGE MAX HARM CUSTOMIZATION TESTS PASSED CLEANLY! ---');

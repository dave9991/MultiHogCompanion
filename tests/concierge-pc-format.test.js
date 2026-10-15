import assert from 'node:assert/strict';
import {
    FALLBACK_PC_SECTION_NAMES,
    loadMainPcSectionNames,
    buildPlayerCardBio,
} from '../concierge-pc-format.js';
import {
    applyDossierUpdates,
    createEmptyDossier,
    serializeDossierToMarkdown,
    parseMarkdownToDossier,
} from '../concierge-parser.js';
import {
    patchLabeledSection,
    isPcCoreTarget,
    isAppearanceField,
    isEquipmentField,
} from '../../SillyTavern-MultihogDnDFramework/src/state/router-utils.js';
import { DEFAULT_PC_SECTIONS } from '../../SillyTavern-MultihogDnDFramework/src/state/schema-sections.js';

console.log('--- Running Concierge PC Card Alignment & Formatting Tests ---');

// ── 1. Schema Section Names Verification ────────────────────────────────────
console.log('Testing PC section schema names...');
for (const sec of DEFAULT_PC_SECTIONS) {
    assert.ok(FALLBACK_PC_SECTION_NAMES[sec.id], `Fallback names must contain ${sec.id}`);
    assert.equal(FALLBACK_PC_SECTION_NAMES[sec.id], sec.name, `Fallback name for ${sec.id} must equal ${sec.name}`);
}
console.log('✓ Fallback PC section names match upstream DEFAULT_PC_SECTIONS exactly');

// ── 2. Full Protagonist Formatting ──────────────────────────────────────────
console.log('Testing buildPlayerCardBio with full structured protagonist...');
const fullProtagonist = {
    name: 'Silas Vance',
    playbook: 'The Professional',
    species: 'Human, male, early 40s',
    appearance: 'Lean, weathered build, tired eyes, perpetual stubble, wears a rumpled charcoal trench coat',
    equipment: '9mm service pistol (2-Harm, close), tactical vest (1-Armor), badge, leather notebook',
    personality: 'Cynical, dry-witted, fiercely protective of innocents',
    background: 'Former homicide detective turned freelance paranormal investigator in the Narrows.',
    habits: 'Habitually checks cylinder of revolver; taps lighter against table.',
    startingMoves: [
        'Investigate a Mystery (+Sharp) (Ask 1 question from GM list on crime scene)',
        'Act Under Fire (+Cool) (Roll +Cool to stay steady under pressure)',
    ],
    conditions: ['(-) Broken Rib (-1 Hard)'],
};

const fullBio = buildPlayerCardBio(fullProtagonist);
assert.ok(fullBio.includes('Species: Human, male, early 40s'), 'Bio must contain Species');
assert.ok(fullBio.includes('Body: Lean, weathered build'), 'Bio must contain Body');
assert.ok(fullBio.includes('Worn Equipment: 9mm service pistol'), 'Bio must contain Worn Equipment');
assert.ok(fullBio.includes('Personality: Cynical, dry-witted'), 'Bio must contain Personality');
assert.ok(fullBio.includes('Background: Former homicide detective'), 'Bio must contain Background');
assert.ok(fullBio.includes('Habits & Behaviors: Habitually checks cylinder'), 'Bio must contain Habits & Behaviors');
assert.ok(fullBio.includes('Strengths:'), 'Bio must contain Strengths header');
assert.ok(fullBio.includes('- Investigate a Mystery (+Sharp)'), 'Bio must contain moves as Strengths bullets');
assert.ok(fullBio.includes('Flaws:'), 'Bio must contain Flaws header');
assert.ok(fullBio.includes('- (-) Broken Rib (-1 Hard)'), 'Bio must contain conditions as Flaws bullets');
console.log('✓ Full protagonist properly formatted into all 8 DEFAULT_PC_SECTIONS');

// ── 3. Router In-Place Patching Verification ────────────────────────────────
console.log('Testing patchLabeledSection on generated PC card...');
const patchedBody = patchLabeledSection(fullBio, 'Body', 'Fresh scar across cheek and shorter hair.', { isPc: true });
assert.ok(patchedBody.ok, 'patchLabeledSection for Body must succeed');
assert.ok(patchedBody.text.includes('Body: Fresh scar across cheek and shorter hair.'), 'Patched text must contain new Body');
assert.ok(patchedBody.text.includes('Species: Human, male, early 40s'), 'Species must remain untouched');
assert.ok(patchedBody.text.includes('Worn Equipment: 9mm service pistol'), 'Worn Equipment must remain untouched');
assert.ok(patchedBody.text.includes('Personality: Cynical, dry-witted'), 'Personality must remain untouched');

const patchedEquip = patchLabeledSection(fullBio, 'Worn Equipment', 'Heavy winter parka, flare gun, and flashlight.', { isPc: true });
assert.ok(patchedEquip.ok, 'patchLabeledSection for Worn Equipment must succeed');
assert.ok(patchedEquip.text.includes('Worn Equipment: Heavy winter parka, flare gun, and flashlight.'), 'Patched text must contain new Worn Equipment');
assert.ok(patchedEquip.text.includes('Body: Lean, weathered build'), 'Body must remain untouched');
console.log('✓ Lorebook Router can patch Body and Worn Equipment in-place on generated PC card');

// ── 4. Fallback Handling for Legacy/Minimal Dossiers ────────────────────────
console.log('Testing buildPlayerCardBio with minimal legacy dossier (bio + gear only)...');
const legacyProtagonist = {
    name: 'Lyle Holloway',
    playbook: 'Detective',
    bio: 'A seasoned but jaded detective working the beat in New York City. Driven by a need for truth.',
    gear: ['Snub-nosed .38 revolver', 'Trench coat', 'Flashlight'],
    moves: ['On the Case (+Sharp)', 'Street Smarts (+Cool)'],
};

const legacyBio = buildPlayerCardBio(legacyProtagonist);
assert.ok(legacyBio.includes('Species: Human, Detective'), 'Legacy bio synthesizes Species from playbook');
assert.ok(legacyBio.includes('Body: A focused and observant presence matching the Detective playbook.'), 'Legacy bio synthesizes Body');
assert.ok(legacyBio.includes('Worn Equipment: Snub-nosed .38 revolver, Trench coat, Flashlight'), 'Legacy bio maps gear array to Worn Equipment');
assert.ok(legacyBio.includes('Personality: Driven, alert, and determined to see matters through.'), 'Legacy bio synthesizes Personality');
assert.ok(legacyBio.includes('Background: A seasoned but jaded detective working the beat in New York City.'), 'Legacy bio maps bio to Background');
assert.ok(legacyBio.includes('Habits & Behaviors:'), 'Legacy bio synthesizes Habits & Behaviors');
assert.ok(legacyBio.includes('Strengths:\n- On the Case (+Sharp)\n- Street Smarts (+Cool)'), 'Legacy bio maps moves to Strengths bullets');
assert.ok(legacyBio.includes('Flaws:'), 'Legacy bio synthesizes Flaws');
console.log('✓ Legacy minimal protagonist gracefully synthesized into all 8 DEFAULT_PC_SECTIONS');

// ── 5. Concierge Parser Integration ─────────────────────────────────────────
console.log('Testing applyDossierUpdates with structured [PROTAGONIST] block...');
const updateText = `
[UPDATE_DOSSIER]
[PROTAGONIST]
name: Silas Vance
playbook: The Professional
species: Human, male, 42
appearance: Piercing hazel eyes, square jaw, leather jacket
equipment: Concealed holster, lockpick set
personality: Methodical and watchful
background: Veteran private eye
habits: Twirls his silver watch chain
stats: Cool +2, Sharp +1, Hard +1, Hot 0, Weird -1
moves:
- Track Quarry (+Sharp)
harm: 5
armor: 1
conditions: (-) Exhausted
[/PROTAGONIST]
[/UPDATE_DOSSIER]
`;

const dossier = createEmptyDossier();
const result = applyDossierUpdates(updateText, dossier);
assert.ok(result.success, 'Parser update must succeed');
const p = result.updatedDossier.protagonist;
assert.equal(p.name, 'Silas Vance');
assert.equal(p.species, 'Human, male, 42');
assert.equal(p.appearance, 'Piercing hazel eyes, square jaw, leather jacket');
assert.equal(p.equipment, 'Concealed holster, lockpick set');
assert.equal(p.personality, 'Methodical and watchful');
assert.equal(p.background, 'Veteran private eye');
assert.equal(p.habits, 'Twirls his silver watch chain');
assert.deepEqual(p.conditions, ['(-) Exhausted']);
console.log('✓ applyDossierUpdates correctly parses all structured protagonist fields');

// ── 6. Markdown Serialization Round-Trip ────────────────────────────────────
console.log('Testing serializeDossierToMarkdown and parseMarkdownToDossier round-trip...');
const md = serializeDossierToMarkdown(result.updatedDossier);
assert.ok(md.includes('* **Species:** Human, male, 42'), 'Markdown contains Species');
assert.ok(md.includes('* **Appearance:** Piercing hazel eyes'), 'Markdown contains Appearance');
assert.ok(md.includes('* **Personality:** Methodical and watchful'), 'Markdown contains Personality');

const roundtripped = parseMarkdownToDossier(md);
assert.equal(roundtripped.protagonist.name, 'Silas Vance');
assert.equal(roundtripped.protagonist.species, 'Human, male, 42');
assert.equal(roundtripped.protagonist.appearance, 'Piercing hazel eyes, square jaw, leather jacket');
assert.equal(roundtripped.protagonist.personality, 'Methodical and watchful');
console.log('✓ Markdown serialization and reconstitution preserves protagonist fields cleanly');

console.log('\n--- ALL CONCIERGE PC CARD FORMATTING TESTS PASSED CLEANLY! ---');

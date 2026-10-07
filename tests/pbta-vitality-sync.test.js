import assert from 'node:assert';
import {
    normalizePbtaVitalityLine,
    normalizePbtaMemo,
    syncLivePbtaMemoVitality,
} from '../pbta-vitality-sync.js';

console.log('--- Running PbtA Vitality & Tandem HP Normalizer Test Suite ---');

// 1. Line-level tests
console.log('Testing line normalizations...');

// 1a. Harm-only without HP
const line1 = 'Rachael (Companion): Harm: 1/5 | Armor: 0';
const norm1 = normalizePbtaVitalityLine(line1);
assert.strictEqual(
    norm1,
    'Rachael (Companion): 4/5 HP | Harm: 1/5 | Armor: 0',
    'Harm 1/5 should normalize to 4/5 HP'
);
console.log('✓ Harm-only with colon normalizes to tandem HP');

// 1b. Harm-only format "X/Y Harm"
const line2 = '- Roy Batty: 2/5 Harm | Armor: 1';
const norm2 = normalizePbtaVitalityLine(line2);
assert.strictEqual(
    norm2,
    '- Roy Batty: 3/5 HP | Harm: 2/5 | Armor: 1',
    'X/Y Harm format should normalize to tandem HP'
);
console.log('✓ X/Y Harm format normalizes to tandem HP');

// 1c. Desynchronized tandem line (HP was not updated after taking Harm)
const line3 = 'Deckard (Blade Runner): 5/5 HP | Harm: 2/5 | Armor: 1';
const norm3 = normalizePbtaVitalityLine(line3);
assert.strictEqual(
    norm3,
    'Deckard (Blade Runner): 3/5 HP | Harm: 2/5 | Armor: 1',
    'Desynced 5/5 HP with 2/5 Harm should calculate 3/5 HP'
);
console.log('✓ Desynced HP with updated Harm recalculates tandem HP');

// 1d. Max Harm (incapacitated / 0 HP)
const line4 = 'Pris: Harm: 4/4 | Status: Incapacitated';
const norm4 = normalizePbtaVitalityLine(line4);
assert.strictEqual(
    norm4,
    'Pris: 0/4 HP | Harm: 4/4 | Status: Incapacitated',
    'Full Harm should calculate 0 HP'
);
console.log('✓ Full Harm correctly maps to 0 HP');

// 1e. Standard D&D HP line should remain untouched
const line5 = 'Fighter: 25/30 HP | AC: 18';
const norm5 = normalizePbtaVitalityLine(line5);
assert.strictEqual(norm5, line5, 'Standard D&D HP line should remain untouched');
console.log('✓ Non-Harm D&D lines remain untouched');

// 2. Full memo normalization
console.log('Testing full memo normalization...');
const rawMemo = `[TIME]
Day 1, 08:00 AM (Morning)
[/TIME]
[LOCATION]
Sector 4
[/LOCATION]
[CHARACTER]
Deckard: 4/4 HP | Harm: 1/4 | Armor: 1
((PILLS)) Moves: Assess (+Mind)
[/CHARACTER]
[PARTY]
Rachael: Harm: 2/5 | Armor: 0
((PILLS)) Moves: Empathy (+Heart)

- Gaff: 0/5 Harm
[/PARTY]
[ENEMIES]
Gargoyle: Harm: 2/3 | Armor: 2
[/ENEMIES]`;

const normalizedMemo = normalizePbtaMemo(rawMemo);
assert.ok(normalizedMemo.includes('Deckard: 3/4 HP | Harm: 1/4 | Armor: 1'), 'Deckard tandem HP normalized');
assert.ok(normalizedMemo.includes('Rachael: 3/5 HP | Harm: 2/5 | Armor: 0'), 'Rachael tandem HP normalized');
assert.ok(normalizedMemo.includes('- Gaff: 5/5 HP | Harm: 0/5'), 'Gaff tandem HP normalized');
assert.ok(normalizedMemo.includes('Gargoyle: 1/3 HP | Harm: 2/3 | Armor: 2'), 'Gargoyle tandem HP normalized');
console.log('✓ Full memo sections (CHARACTER, PARTY, ENEMIES) normalize cleanly');

// 3. Upstream parser simulation tests
console.log('Testing upstream compatibility simulation...');

// 3a. Upstream portraits.js regex:
// const cleanLine = line.replace(/^\s*[-*+•–—](?:\s+|(?=[A-Za-z]))/, '');
// const hpMatch = cleanLine.match(/^(.+?):\s*([\d,]+)(?:\/([\d,]+))?\s*HP/i);
const simulateUpstreamGetPartyMembers = (partyText) => {
    const lines = partyText.split('\n').map(l => l.trim()).filter(Boolean);
    const members = [];
    for (const l of lines) {
        const clean = l.replace(/^\s*[-*+•–—](?:\s+|(?=[A-Za-z]))/, '');
        const m = clean.match(/^(.+?):\s*([\d,]+)(?:\/([\d,]+))?\s*HP/i);
        if (m) members.push(m[1].trim());
    }
    return members;
};

const extractedParty = simulateUpstreamGetPartyMembers(normalizedMemo.match(/\[PARTY\]([\s\S]*?)\[\/PARTY\]/)[1]);
assert.deepStrictEqual(extractedParty, ['Rachael', 'Gaff'], 'Upstream portraits regex successfully extracts both party members');
console.log('✓ Upstream portraits.js getPartyMembers() successfully extracts companions');

// 3b. Upstream renderer.js extractPartyVitals simulation:
// const hpMatch = line.match(/^(.+?):\s*([+-]?[\d,]+)(?:\/([\d,]+))?\s*HP\s*[:|,]?\s*/i);
// const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 100;
const simulateUpstreamPartyVitals = (partyText) => {
    const lines = partyText.split('\n').map(l => l.trim()).filter(Boolean);
    const vitals = [];
    for (const raw of lines) {
        const line = raw.replace(/^\s*[-*+•–—](?:\s+|(?=[A-Za-z]))/, '');
        const m = line.match(/^(.+?):\s*([+-]?[\d,]+)(?:\/([\d,]+))?\s*HP\s*[:|,]?\s*/i);
        if (!m) continue;
        const name = m[1].trim();
        const cur = Number(m[2]);
        const max = Number(m[3]);
        const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 100;
        vitals.push({ name, cur, max, pct });
    }
    return vitals;
};

const vitals = simulateUpstreamPartyVitals(normalizedMemo.match(/\[PARTY\]([\s\S]*?)\[\/PARTY\]/)[1]);
assert.strictEqual(vitals.length, 2, 'Two vitals entries parsed');
assert.strictEqual(vitals[0].name, 'Rachael');
assert.strictEqual(vitals[0].cur, 3);
assert.strictEqual(vitals[0].max, 5);
assert.strictEqual(vitals[0].pct, 60); // 3/5 = 60%
assert.strictEqual(vitals[1].name, 'Gaff');
assert.strictEqual(vitals[1].cur, 5);
assert.strictEqual(vitals[1].max, 5);
assert.strictEqual(vitals[1].pct, 100); // 5/5 = 100%
console.log('✓ Upstream renderer.js extractPartyVitals() correctly calculates health bar percentages');

// 4. Live settings sync
console.log('Testing live settings sync...');
const mockSettings = {
    currentMemo: rawMemo,
    chatStates: {
        'chat-123': {
            currentMemo: rawMemo
        }
    }
};
const didSync = syncLivePbtaMemoVitality(mockSettings, 'chat-123');
assert.strictEqual(didSync, true, 'syncLivePbtaMemoVitality applied updates');
assert.ok(mockSettings.currentMemo.includes('3/5 HP | Harm: 2/5'), 'Live settings currentMemo updated');
assert.ok(mockSettings.chatStates['chat-123'].currentMemo.includes('3/5 HP | Harm: 2/5'), 'Chat state partition updated');
console.log('✓ syncLivePbtaMemoVitality successfully updates live settings and partitions');

console.log('--- ALL PBTA VITALITY SYNC TESTS PASSED CLEANLY! ---');

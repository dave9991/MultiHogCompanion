/**
 * Verifies the PbtA core-rule prompts reinforce the canonical PbtA loop.
 */
import assert from 'node:assert';
import {
    buildPbtARoleContent,
    buildPbtARngContent,
    buildPbtARulesetNoteContent,
    buildPbtAFooterContent,
    buildPbtAStockPrompts,
    buildPbtACartridge,
} from '../pbta-ruleset.js';

const role = buildPbtARoleContent();
assert.ok(/GM MOVES/.test(role), 'role lists GM moves');
assert.ok(/NPCs and enemies NEVER roll/.test(role), 'role states NPCs never roll');
assert.ok(/Routine actions and ordinary conversation NEVER roll/.test(role), 'role states trigger rule');

const rng = buildPbtARngContent();
assert.ok(/2d6 → 3 \+ 5 = 8/.test(rng), 'rng documents queue line format');
assert.ok(/10\+ Strong Hit/.test(rng) && /7–9 Weak Hit/.test(rng) && /6- Miss/.test(rng), 'rng has all tiers');
assert.ok(/Forward:/.test(rng) && /Hold:/.test(rng), 'rng defines forward and hold');
assert.ok(!/-3 to \+3/.test(rng), 'modifier range is consistent');

assert.ok(!/10\+ Full Success/.test(buildPbtARulesetNoteContent()), 'ruleset_note does not duplicate tiers');
assert.ok(/\/7\)/.test(buildPbtAFooterContent(7, 5)), 'footer uses provided harmMax');
assert.ok(!/disadvantage/i.test(buildPbtAStockPrompts('fantasy').combat.replace(/NEVER[^\n]*disadvantage/gi, '')), 'no D&D disadvantage leak in combat stock prompt');

// --- PbtA Footer & State Tracker Sync Tests ---
const defaultFooter = buildPbtAFooterContent(5, 5);
assert.ok(/ALWAYS end every narrative output with:/.test(defaultFooter), 'footer contains "with:" anchor for MultiHog reminder');
assert.ok(/\*\[HH:MM AM\/PM\], Day \[X\]\*/.test(defaultFooter), 'default footer contains 12h time and Day [X]');
assert.ok(/\*\(Harm: \[current\]\/5\) \| \(XP: \[current\]\/5\)/i.test(defaultFooter), 'footer contains Harm and XP tokens');

// Test MultiHog Turn-1 stealth reminder regex match: /\bwith\b\s*:?\s*([\s\S]*)/i
const reminderMatch = defaultFooter.match(/\bwith\b\s*:?\s*([\s\S]*)/i);
assert.ok(reminderMatch && reminderMatch[1], 'footer matches MultiHog stealth reminder regex');
assert.ok(reminderMatch[1].includes('Harm') && reminderMatch[1].includes('Day'), 'reminder regex captures Harm and Day tokens');

// Test 24h format option
const footer24h = buildPbtAFooterContent(6, 4, { use24hTime: true });
assert.ok(/\*\[HH:MM\] \(24-hour clock, NO AM\/PM\), Day \[X\]\*/.test(footer24h), '24h footer uses [HH:MM] 24-hour clock');
assert.ok(!/\[HH:MM AM\/PM\]/.test(footer24h), '24h footer replaces [HH:MM AM/PM]');

// Test DD/MM/YYYY date format option
const footerDdMmYy = buildPbtAFooterContent(5, 5, { useDdMmYyFormat: true });
assert.ok(/\*\[HH:MM AM\/PM\], \[DD\/MM\/YYYY\]\*/.test(footerDdMmYy), 'dd/mm/yyyy footer uses date token');

// Test combined 24h and DD/MM/YYYY
const footerCombined = buildPbtAFooterContent(5, 5, { use24hTime: true, useDdMmYyFormat: true });
assert.ok(/\*\[HH:MM\] \(24-hour clock, NO AM\/PM\), \[DD\/MM\/YYYY\]\*/.test(footerCombined), 'combined footer uses [HH:MM] 24-hour and [DD/MM/YYYY]');

// Test buildPbtACartridge wiring into pbta_base_override_footer
const cartridge = buildPbtACartridge({ harmMax: 6, pacingXp: 4, use24hTime: true });
const footerPrompt = cartridge.payload.customSyspromptLibrary.find(s => s.id === 'pbta_base_override_footer');
assert.ok(footerPrompt, 'cartridge includes pbta_base_override_footer in customSyspromptLibrary');
assert.strictEqual(footerPrompt.content, footer24h, 'cartridge footer prompt content matches buildPbtAFooterContent');

console.log('--- ALL PBTA CORE RULES PROMPT TESTS PASSED CLEANLY! ---');

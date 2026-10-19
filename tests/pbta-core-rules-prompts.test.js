/**
 * Verifies the PbtA core-rule prompts reinforce the canonical PbtA loop.
 */
import assert from 'node:assert';
import {
    buildPbtARoleContent,
    buildPbtARngContent,
    buildPbtACombatContent,
    buildPbtAConstraintsContent,
    buildPbtARulesetNoteContent,
    buildPbtAFooterContent,
    buildPbtAStockPrompts,
    buildPbtACartridge,
} from '../pbta-ruleset.js';

const role = buildPbtARoleContent();
assert.ok(/GM MOVES/.test(role), 'role lists GM moves');
assert.ok(/SOFT MOVES/.test(role) && /HARD MOVES/.test(role), 'role separates soft and hard move categories and triggers');
assert.ok(/THE ESCALATION LADDER/.test(role), 'role specifies the escalation ladder');
assert.ok(/SINGLE-TURN FLUID RESOLUTION/.test(role), 'role specifies single-turn fluid choice resolution');
assert.ok(/NEVER halt the game mid-turn to ask meta-questions/.test(role), 'role forbids mid-turn meta pauses');
assert.ok(/NO CHOICES OR MENUS IN NARRATIVE/.test(role), 'role forbids narrative choice menus');
assert.ok(!/frame the dilemma for the NEXT turn's CYOA choices/.test(role), 'role does not mention CYOA choices');
assert.ok(/NPCs and enemies NEVER roll/.test(role), 'role states NPCs never roll');
assert.ok(/Routine actions and ordinary conversation NEVER roll/.test(role), 'role states trigger rule');
assert.ok(/Prioritize fictional realism and established danger over artificial game balance/.test(role), 'role emphasizes realism over balance');
assert.ok(/Bleed-in:/i.test(role) && /Hostile Initiative:/i.test(role) && /Organic Intersection:/i.test(role) && /Asymmetric Knowledge:/i.test(role), 'role specifies the 4 macro world progression rules');
assert.ok(/Persistent Named NPCs:/i.test(role), 'role enforces named NPC persistence');

// Test role mode variation (freeform vs CYOA)
const freeformRole = buildPbtARoleContent(true);
assert.ok(/ask "What do you do\?"/.test(freeformRole), 'freeform role asks what you do');
assert.ok(/Tactical choices are generated in the dedicated <choices> block/.test(role), 'CYOA role directs choices to block');

const rng = buildPbtARngContent();
assert.ok(/2d6 → 3 \+ 5 = 8/.test(rng), 'rng documents queue line format');
assert.ok(/10\+ Strong Hit/.test(rng) && /7–9 Weak Hit/.test(rng) && /6- Miss/.test(rng), 'rng has all tiers');
assert.ok(/Make a HARD MOVE/.test(rng), 'rng strictly maps 6- Miss to a Hard Move');
assert.ok(/NO ROUNDABOUT SUCCESS AFTER A FAIL/.test(rng), 'rng mandates anti-softballing rule');
assert.ok(/no unearned bailouts or cosmetic softening/.test(rng), 'rng mandates no bailouts on 6- Miss');
assert.ok(/2d6 \[Roll: Die1 \+ Die2 = Sum\] \+ Mod = Total → Strong Hit \| Weak Hit \| Miss/.test(rng), 'rng specifies strict roll format');
assert.ok(/Forward:/.test(rng) && /Hold:/.test(rng), 'rng defines forward and hold');
assert.ok(!/-3 to \+3/.test(rng), 'modifier range is consistent');

// Combat insights
const combatContent = buildPbtACombatContent(5);
assert.ok(/REALISM OVER BALANCE/.test(combatContent), 'combat includes realism over balance rule');
assert.ok(/RESOURCE & RANGE REJECTIONS/.test(combatContent), 'combat includes resource & range rejection rule');

// Constraints builder insights
const freeformConstraints = buildPbtAConstraintsContent(true);
assert.ok(/Conclude the scene with "What do you do\?" and the status footer/.test(freeformConstraints), 'freeform constraints conclude with what do you do');
const cyoaConstraints = buildPbtAConstraintsContent(false);
assert.ok(/choices belong exclusively inside the <choices><button>/.test(cyoaConstraints), 'cyoa constraints restrict choices to button block');
assert.ok(/do NOT repeat "What do you do\?"/.test(cyoaConstraints), 'cyoa constraints forbid repeating what do you do in prose');
assert.ok(/NO ROUNDABOUT SUCCESS AFTER A FAIL/.test(cyoaConstraints), 'constraints include anti-softballing guardrail');
assert.ok(/intimate strike at far range/i.test(cyoaConstraints), 'constraints enforce weapon tag range rejections');
assert.ok(/exhausted resource, 0 uses, or 0 Hold/i.test(cyoaConstraints), 'constraints enforce 0 hold/uses rejections');

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

// Test CYOA prompt stance, hold, and dilemma integration
assert.ok(/STANCE, HOLD & DILEMMA INTEGRATION/.test(cartridge.payload.cyoaConfig.customPromptText), 'cartridge CYOA prompt includes stance, hold, and dilemma instructions');
assert.ok(/STANCE-LOADED CHOICES/.test(cartridge.payload.cyoaConfig.customPromptText), 'cartridge CYOA prompt includes stance-loaded choice instruction');

console.log('--- ALL PBTA CORE RULES PROMPT TESTS PASSED CLEANLY! ---');

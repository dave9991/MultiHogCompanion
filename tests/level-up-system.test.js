import assert from 'node:assert';
import { test } from 'node:test';
import {
    parseCharacterBlockFromMemo,
    scaffoldDossierStubForChat,
    ensureChatDossier,
} from '../level-up-scaffold.js';
import {
    getCanonicalDndProgression,
    hasProgressionBlueprint,
    getTierPerks,
    parseBlueprintFromResponse,
} from '../level-up-blueprint.js';
import {
    evaluateLevelUpEligibility,
    formulateLevelUpProposal,
    applyLevelUpCommit,
} from '../level-up-runner.js';

test('Level-Up System: Character Parsing & Auto-Scaffold', () => {
    const rawMemo = `[CHARACTER]
Marcus the Valiant (Fighter): 28/28 HP
Appearance: Tall warrior in battered plate armor
Stats: STR 16, DEX 12, CON 14, INT 10, WIS 12, CHA 8
Hit Die: 1d10
Features: Second Wind, Action Surge
Level: 3
[/CHARACTER]
[XP]
Total: 1,200 / 2,700 XP (Level 3)
[/XP]`;

    const parsed = parseCharacterBlockFromMemo(rawMemo);
    assert.strictEqual(parsed.name, 'Marcus the Valiant');
    assert.strictEqual(parsed.class, 'Fighter');
    assert.strictEqual(parsed.currentHp, 28);
    assert.strictEqual(parsed.maxHp, 28);
    assert.strictEqual(parsed.level, 3);
    assert.strictEqual(parsed.hitDie, 'd10');
    assert.strictEqual(parsed.stats.STR, 16);
    assert.strictEqual(parsed.stats.CON, 14);

    const stub = scaffoldDossierStubForChat('test_chat_001', rawMemo, 'The Valiant Saga');
    assert.strictEqual(stub.meta.chatId, 'test_chat_001');
    assert.strictEqual(stub.meta.title, 'The Valiant Saga');
    assert.strictEqual(stub.meta.systemKey, 'dnd5e');
    assert.strictEqual(stub.meta.isStub, true);
    assert.strictEqual(stub.protagonist.name, 'Marcus the Valiant');
    assert.strictEqual(stub.progressionBlueprint, null);

    const mockSettings = { chatStates: { test_chat_001: {} }, currentMemo: rawMemo };
    const ensured = ensureChatDossier('test_chat_001', mockSettings);
    assert.strictEqual(ensured.protagonist.name, 'Marcus the Valiant');
    assert.strictEqual(mockSettings.chatStates.test_chat_001.companionDossier.protagonist.name, 'Marcus the Valiant');

    // Live MultiHog Barbarian memo format test
    const liveBarbarianMemo = `[CHARACTER]
Tadhg Star-Gazer (Barbarian): 15/15 HP
Combat: BAB: +1 | Ranged (1 attack): +3 | Melee (2 attacks): +4/-1 | Base AC: 12 | Total AC: 14
Gear: Longbow (1d8+2 Piercing) | Twin Handaxes (1d6+3 Piercing) | Leather Armor (+2 AC)
Proficiencies: Simple Weapons, Martial Weapons, Light Armor, Medium Armor, Shields
Attr: STR 16 (+3), DEX 14 (+2), CON 16 (+3), INT 10 (+0), WIS 12 (+1), CHA 14 (+2)
Saves: Fort +5 | Ref +3 | Will +2
Skills: Athletics +5, Survival +3
Traits: Unarmored Defense, Feral Instinct, Fast Movement
HD: d12 (15/15)
Status: Healthy
[/CHARACTER]
[XP]
Level: 1 | XP: 5/300
[/XP]`;

    const parsedBarbarian = parseCharacterBlockFromMemo(liveBarbarianMemo);
    assert.strictEqual(parsedBarbarian.name, 'Tadhg Star-Gazer');
    assert.strictEqual(parsedBarbarian.class, 'Barbarian');
    assert.strictEqual(parsedBarbarian.currentHp, 15);
    assert.strictEqual(parsedBarbarian.maxHp, 15);
    assert.strictEqual(parsedBarbarian.level, 1);
    assert.strictEqual(parsedBarbarian.hitDie, 'd12');
    assert.strictEqual(parsedBarbarian.stats.STR, 16);
    assert.strictEqual(parsedBarbarian.stats.CON, 16);
    assert.strictEqual(parsedBarbarian.stats.DEX, 14);

    // Verify stub refresh logic when an uninitialized stub had 'Protagonist'
    const staleStubSettings = {
        chatStates: {
            tadhg_chat: {
                companionDossier: {
                    meta: { isStub: true },
                    protagonist: { name: 'Protagonist', class: 'Adventurer', level: 1 },
                },
            },
        },
    };
    const refreshed = ensureChatDossier('tadhg_chat', staleStubSettings, { memo: liveBarbarianMemo });
    assert.strictEqual(refreshed.protagonist.name, 'Tadhg Star-Gazer');
    assert.strictEqual(refreshed.protagonist.class, 'Barbarian');
    assert.strictEqual(refreshed.protagonist.hitDie, 'd12');
    assert.strictEqual(refreshed.protagonist.hp.max, 15);
});

test('Level-Up System: Deterministic XP Eligibility Evaluation', () => {
    // 1. D&D Under Threshold
    const memoUnder = `[CHARACTER]\nLevel: 1\n[/CHARACTER]\n[XP]\nTotal: 250 / 300 XP (Level 1)\n[/XP]`;
    const evalUnder = evaluateLevelUpEligibility(memoUnder);
    assert.strictEqual(evalUnder.eligible, false);
    assert.strictEqual(evalUnder.currentXp, 250);
    assert.strictEqual(evalUnder.maxThreshold, 300);

    // 2. D&D Over Threshold
    const memoOver = `[CHARACTER]\nLevel: 3\n[/CHARACTER]\n[XP]\nTotal: 2,850 / 2,700 XP (Level 3)\n[/XP]`;
    const evalOver = evaluateLevelUpEligibility(memoOver);
    assert.strictEqual(evalOver.eligible, true);
    assert.strictEqual(evalOver.currentLevel, 3);
    assert.strictEqual(evalOver.nextLevel, 4);
    assert.strictEqual(evalOver.surplusXp, 150);

    // 3. PbtA 5-bucket Evaluation
    const pbtaUnder = `*(Harm: 1/5) | (XP: 3/5) | (Hold: 0)*`;
    const pbtaEvalUnder = evaluateLevelUpEligibility(pbtaUnder, 'pbta');
    assert.strictEqual(pbtaEvalUnder.eligible, false);

    const pbtaOver = `*(Harm: 1/5) | (XP: 6/5) | (Hold: 0)*`;
    const pbtaEvalOver = evaluateLevelUpEligibility(pbtaOver, 'pbta');
    assert.strictEqual(pbtaEvalOver.eligible, true);
    assert.strictEqual(pbtaEvalOver.surplusXp, 1);
});

test('Level-Up System: Blueprint Engine & Canonical 5e Tables', () => {
    const fighterProg = getCanonicalDndProgression('Fighter');
    assert.ok(fighterProg, 'Canonical Fighter progression must exist');
    assert.strictEqual(fighterProg.hitDie, 'd10');

    const rogueProg = getCanonicalDndProgression('Shadow Rogue');
    assert.ok(rogueProg, 'Substrings matching core classes should resolve canonical tables');
    assert.strictEqual(rogueProg.className, 'Rogue');

    // D&D Lite Archetype Specialization verification (no generic subclass placeholders)
    const barbarianProg = getCanonicalDndProgression('Barbarian');
    assert.ok(barbarianProg, 'Canonical Barbarian must exist');
    assert.ok(barbarianProg.levels['3'].features.some(f => f.includes('Primal Instincts')), 'Barbarian Level 3 should grant Primal Instincts archetype feature');
    assert.ok(fighterProg.levels['3'].features.some(f => f.includes('Martial Mastery')), 'Fighter Level 3 should grant Martial Mastery archetype feature');
    assert.ok(rogueProg.levels['3'].features.some(f => f.includes('Skirmish Tactics')), 'Rogue Level 3 should grant Skirmish Tactics archetype feature');

    // Perks for Fighter Level 4 (ASI milestone)
    const conMod = 2; // CON 14
    const perksLvl4 = getTierPerks(fighterProg, 4, conMod);
    assert.strictEqual(perksLvl4.level, 4);
    assert.strictEqual(perksLvl4.isAsi, true);
    // d10 avg = 6 + 2 con = 8
    assert.strictEqual(perksLvl4.averageHpGain, 8);

    // Custom Blueprint JSON parsing
    const customJson = `\`\`\`json
{
  "className": "Cyber-Samurai",
  "hitDie": "d10",
  "primaryStats": ["DEX", "INT"],
  "levels": {
    "1": { "features": ["Kenjutsu Focus"] },
    "2": { "features": ["Overclock Strike"] }
  }
}
\`\`\``;
    const parsedCustom = parseBlueprintFromResponse(customJson);
    assert.strictEqual(parsedCustom.className, 'Cyber-Samurai');
    assert.strictEqual(parsedCustom.levels['2'].features[0], 'Overclock Strike');
});

test('Level-Up System: Proposal Formulation & State Memo Patching', () => {
    const rawMemo = `[CHARACTER]
Marcus (Fighter): 28/28 HP
Stats: STR 16, CON 14, DEX 12
Level: 3
Features: Second Wind, Action Surge
[/CHARACTER]
[XP]
Total: 2,850 / 2,700 XP (Level 3)
[/XP]
[PARTY]
Elena (Cleric): 18/18 HP
[/PARTY]`;

    const dossier = {
        protagonist: {
            name: 'Marcus',
            class: 'Fighter',
            level: 3,
            hp: { current: 28, max: 28 },
            stats: { STR: 16, CON: 14, DEX: 12 },
        },
        party: [{ name: 'Elena', hp: 18 }],
        config: { partySyncEnabled: true },
    };

    const blueprint = getCanonicalDndProgression('Fighter');
    const proposal = formulateLevelUpProposal(dossier, blueprint, 4);

    assert.strictEqual(proposal.targetLevel, 4);
    assert.strictEqual(proposal.isAsi, true);
    assert.strictEqual(proposal.hpChange.oldMax, 28);
    assert.strictEqual(proposal.hpChange.newMax, 36); // 28 + 8
    assert.strictEqual(proposal.partyChanges.length, 1);
    assert.strictEqual(proposal.partyChanges[0].name, 'Elena');

    // Select Option A (+2 STR)
    proposal.asiChoice = proposal.asiOptions.optionA;

    const commitResult = applyLevelUpCommit({
        chatId: 'test_chat_001',
        currentMemo: rawMemo,
        proposal,
        isRespec: false,
    });

    assert.strictEqual(commitResult.success, true);
    const updated = commitResult.updatedMemo;

    // Verify [CHARACTER] updates
    assert.ok(updated.includes('36/36 HP'), 'Max HP must update to 36');
    assert.ok(updated.includes('Level: 4') || updated.includes('Level 4'), 'Level must update to 4');
    assert.ok(updated.includes('STR 18'), 'STR must increase by +2 to 18');

    // Verify [XP] updates to Level 4 with next threshold (6,500 XP)
    assert.ok(updated.includes('6,500 XP (Level 4)'), 'XP block must advance to Level 4 threshold');

    // Verify Party Sync
    assert.ok(/Elena[^:]*:\s*\d+\/24\s*HP/i.test(updated) || updated.includes('Elena (Cleric): 24/24 HP') || updated.includes('Elena (Cleric): 22/22 HP'), 'Party companions must receive lockstep HP bump');
});

test('Level-Up System: Respec & Build Tuning Mode (No Unearned Advancement)', () => {
    const barbarianMemo = `[CHARACTER]
Tadhg Star-Gazer (Barbarian): 15/15 HP
Stats: STR 16, CON 16, DEX 14
Level: 1
Features: Rage, Unarmored Defense
[/CHARACTER]
[XP]
Level: 1 | XP: 5/300
[/XP]`;

    const dossier = {
        protagonist: {
            name: 'Tadhg Star-Gazer',
            class: 'Barbarian',
            level: 1,
            hp: { current: 15, max: 15 },
            stats: { STR: 16, CON: 16, DEX: 14 },
            features: ['Rage (2/day)', 'Unarmored Defense'],
        },
        party: [],
        config: { partySyncEnabled: true },
    };

    const blueprint = getCanonicalDndProgression('Barbarian');

    // Formulate Respec Proposal for Level 1 (with 5 XP)
    const respecProposal = formulateLevelUpProposal(dossier, blueprint, 1, { isRespec: true });

    assert.strictEqual(respecProposal.isRespec, true);
    assert.strictEqual(respecProposal.currentLevel, 1, 'Current level must remain 1');
    assert.strictEqual(respecProposal.targetLevel, 1, 'Target level must remain 1');
    assert.strictEqual(respecProposal.hpChange.gain, 0, 'Respec must NOT grant free level-up HP');
    assert.strictEqual(respecProposal.hpChange.oldMax, 15);
    assert.strictEqual(respecProposal.hpChange.newMax, 15, 'Max HP must remain unchanged');
    assert.strictEqual(respecProposal.partyChanges.length, 0, 'Party sync must not bump companions in respec mode');

    // Add a custom tuned feature
    respecProposal.newFeatures.push('Custom Totem: Eagle Eye');

    const commitResult = applyLevelUpCommit({
        chatId: 'test_tadhg_respec',
        currentMemo: barbarianMemo,
        proposal: respecProposal,
        isRespec: true,
    });

    assert.strictEqual(commitResult.success, true);
    const updated = commitResult.updatedMemo;

    // Verify level and HP were NOT bumped
    assert.ok(updated.includes('15/15 HP'), 'HP must remain 15/15');
    assert.ok(updated.includes('Level: 1'), 'Level must remain 1');
    assert.ok(updated.includes('XP: 5/300'), 'XP and threshold must remain untouched');
    assert.ok(updated.includes('Custom Totem: Eagle Eye'), 'Custom tuned feature must be appended');
});

test('Level-Up & Respec System: Pure PbtA Mechanics & Zero D&D Terminology Leakage', () => {
    const pbtaMemo = `[CHARACTER]
Aelion Crown-Guard (The Wraith): 4/4 HP | Harm: 0/4 | Armor: 1
Stats: Agility +2, Wits +1, Heart +1, Might 0, Arcana -1
((PILLS)) Moves: Volley [+Agility] (When you strike from a distance...), Defy Danger [+Heart] (When you face horror...), Slip Through Shadows [+Agility] (When you move unseen...), Read the Depths [+Wits] (When you analyze ecology...)
((PILLS)) Gear: Worn bone-handled throwing daggers, Reinforced leathers, Coiled grapple-line
((PILLS)) Conditions: (-) Tinnitus from an old blast, (-) Disorientation in absolute silence
XP: 0/5
Status: Healthy
[/CHARACTER]`;

    // 1. Verify parseCharacterBlockFromMemo accurately isolates PbtA
    const parsed = parseCharacterBlockFromMemo(pbtaMemo);
    assert.strictEqual(parsed.isPbta, true, 'Must identify memo as PbtA');
    assert.strictEqual(parsed.name, 'Aelion Crown-Guard');
    assert.strictEqual(parsed.class, 'The Wraith');
    assert.strictEqual(parsed.playbook, 'The Wraith');
    assert.strictEqual(parsed.hitDie, null, 'PbtA character must NOT have a Hit Die');
    assert.strictEqual(parsed.level, null, 'PbtA character must NOT have a D&D character level');
    assert.strictEqual(parsed.harm.current, 0);
    assert.strictEqual(parsed.harm.max, 4);
    assert.strictEqual(parsed.harm.armor, 1);
    assert.strictEqual(parsed.armor, 1);
    assert.strictEqual(parsed.stats.Agility, 2);
    assert.strictEqual(parsed.stats.Arcana, -1);
    assert.strictEqual(parsed.moves.length, 4, 'Must parse all 4 starting moves');
    assert.strictEqual(parsed.conditions.length, 2, 'Must parse conditions');

    // 2. Verify scaffoldDossierStubForChat creates pure PbtA stub
    const stub = scaffoldDossierStubForChat('echoes_below', pbtaMemo, 'Echoes Below');
    assert.strictEqual(stub.meta.systemKey, 'pbta');
    assert.strictEqual(stub.protagonist.isPbta, true);
    assert.strictEqual(stub.protagonist.hitDie, null, 'Dossier stub must NOT assign Hit Die to PbtA');
    assert.strictEqual(stub.protagonist.level, null, 'Dossier stub must NOT assign Level to PbtA');

    // 3. Formulate Respec Proposal for PbtA
    const pbtaDossier = {
        meta: { systemKey: 'pbta', systemLabel: 'PbtA Narrative Engine' },
        protagonist: stub.protagonist,
    };
    const proposal = formulateLevelUpProposal(pbtaDossier, null, null, { isRespec: true });

    assert.strictEqual(proposal.isPbta, true, 'Proposal must be flagged as PbtA');
    assert.strictEqual(proposal.isRespec, true);
    assert.strictEqual(proposal.hitDie, null, 'Proposal must NOT contain Hit Die in PbtA');
    assert.strictEqual(proposal.currentLevel, null, 'Proposal must NOT contain numeric level in PbtA');
    assert.strictEqual(proposal.targetLevel, null, 'Proposal must NOT advance numeric level in PbtA');
    assert.strictEqual(proposal.harm.max, 4);
    assert.strictEqual(proposal.harm.armor, 1);
    assert.strictEqual(proposal.partyChanges.length, 0, 'No party lockstep in PbtA respec');
    
    // Ensure no D&D artifact strings leaked into features
    const hasDndArtifacts = proposal.newFeatures.some(f => /HP\s*Gain|Hit\s*Die|Level\s*\d/i.test(f));
    assert.strictEqual(hasDndArtifacts, false, 'Moves must NOT contain D&D "HP Gain" or "Hit Die" strings');

    // 4. Test Respec Commit (Add a tuned move)
    proposal.newFeatures.push('Shadow Step [+Agility] (Slip through barriers at the cost of Harm)');
    const commitRespec = applyLevelUpCommit({
        chatId: 'echoes_below',
        currentMemo: pbtaMemo,
        proposal,
        isRespec: true,
    });
    assert.strictEqual(commitRespec.success, true);
    assert.ok(commitRespec.updatedMemo.includes('Shadow Step'), 'Tuned move must be present in committed memo');
    assert.ok(commitRespec.updatedMemo.includes('Harm: 0/4 | Armor: 1'), 'Harm & Armor must be preserved');
    assert.ok(commitRespec.updatedMemo.includes('XP: 0/5'), 'XP must remain untouched in respec');
    assert.ok(!commitRespec.updatedMemo.includes('Level: 2'), 'Must NEVER inject D&D Level into PbtA memo');

    // 5. Test Playbook Advance Commit (with 5/5 XP)
    const readyMemo = pbtaMemo.replace('XP: 0/5', 'XP: 5/5');
    const advanceProposal = formulateLevelUpProposal(pbtaDossier, null, null, { isRespec: false });
    advanceProposal.newFeatures.push('Ghost Whispers [+Arcana] (Commune with lingering dungeon souls)');

    const commitAdvance = applyLevelUpCommit({
        chatId: 'echoes_below',
        currentMemo: readyMemo,
        proposal: advanceProposal,
        isRespec: false,
    });
    assert.strictEqual(commitAdvance.success, true);
    assert.ok(commitAdvance.updatedMemo.includes('XP: 0/5'), 'XP must reset from 5/5 to 0/5 on advance');
    assert.ok(commitAdvance.updatedMemo.includes('Ghost Whispers'), 'New advance move must be added');
    assert.ok(!commitAdvance.updatedMemo.includes('Level:'), 'Must NEVER inject D&D Level during PbtA advance');
});

test('Level-Up & Respec System: Instant Modal Open with Async Blueprint Shimmer', async () => {
    const { openLevelUpModal, closeLevelUpModal } = await import('../level-up-ui.js');

    // Create minimal mock DOM
    let mountedModal = null;
    const mockDoc = {
        createElement: (tag) => {
            const el = {
                tagName: tag.toUpperCase(),
                id: '',
                className: '',
                innerHTML: '',
                children: [],
                querySelector: (sel) => {
                    if (sel === '#mhc-blueprint-shimmer') {
                        return el.innerHTML.includes('mhc-blueprint-shimmer') ? { remove: () => { el.innerHTML = el.innerHTML.replace(/<div class="mhc-blueprint-shimmer"[\s\S]*?<\/div>\s*<\/div>/i, ''); } } : null;
                    }
                    if (sel === '#mhc-perks-list-container') {
                        return {
                            set innerHTML(val) { el._perksHtml = val; },
                            get innerHTML() { return el._perksHtml || ''; },
                            querySelectorAll: () => [],
                        };
                    }
                    if (sel === '.mhc-badge-hitdie') {
                        return { set innerHTML(val) { el._hitDieBadge = val; } };
                    }
                    return null;
                },
                querySelectorAll: () => [],
                addEventListener: () => {},
                remove: () => { mountedModal = null; },
            };
            return el;
        },
        body: {
            appendChild: (el) => { mountedModal = el; },
        },
        getElementById: (id) => (mountedModal?.id === id ? mountedModal : null),
    };

    const prevDoc = globalThis.document;
    globalThis.document = mockDoc;

    try {
        const customDossier = {
            meta: { systemKey: 'dnd5e', systemLabel: 'D&D 5e Standard' },
            protagonist: {
                name: 'Lyra Moon-Weaver',
                class: 'Astro-Mage',
                level: 1,
                hp: { current: 12, max: 12 },
                stats: { INT: 16, CON: 12 },
            },
        };

        // Create deferred blueprint promise
        let resolveBlueprint;
        const blueprintPromise = new Promise((resolve) => {
            resolveBlueprint = resolve;
        });

        // Open modal instantly with pending blueprintPromise
        openLevelUpModal({
            chatId: 'custom_astro_chat',
            dossier: customDossier,
            blueprint: null,
            blueprintPromise,
            targetLevel: 1,
            isRespec: true,
        });

        assert.ok(mountedModal, 'Modal must mount to DOM immediately without waiting for LLM');
        assert.ok(mountedModal.innerHTML.includes('mhc-blueprint-shimmer'), 'Modal must contain animated shimmer skeleton while generating');
        assert.ok(mountedModal.innerHTML.includes('Astro-Mage'), 'Modal must display the custom class name in the shimmer header');

        // Resolve blueprint asynchronously
        const mockBlueprint = {
            className: 'Astro-Mage',
            hitDie: 'd6',
            levels: {
                1: { features: ['Starlight Beam (1d8 radiant)', 'Cosmic Attunement'] },
            },
        };
        resolveBlueprint(mockBlueprint);

        // Allow microtasks to settle
        await new Promise((r) => setTimeout(r, 20));

        assert.ok(!mountedModal.innerHTML.includes('mhc-blueprint-shimmer'), 'Shimmer must be removed once blueprint resolves');
        closeLevelUpModal();
    } finally {
        globalThis.document = prevDoc;
    }
});

test('Level-Up & Respec System: Two-Stage Progression Architecture (Stage 1 Codex <-> Stage 2 Desk)', async () => {
    const { openLevelUpModal, closeLevelUpModal } = await import('../level-up-ui.js');
    const { formatBlueprintSummary } = await import('../level-up-blueprint.js');

    // Create an interactive mock DOM supporting two-stage elements
    let mountedModal = null;
    const elementsRegistry = new Map();

    function createMockElement(tag, id = '', className = '') {
        const listeners = {};
        const el = {
            tagName: tag.toUpperCase(),
            id,
            className,
            _innerHTML: '',
            style: { display: '' },
            value: '',
            textContent: '',
            set innerHTML(val) {
                this._innerHTML = val;
            },
            get innerHTML() {
                return this._innerHTML;
            },
            addEventListener: (event, cb) => {
                listeners[event] = listeners[event] || [];
                listeners[event].push(cb);
            },
            click: () => {
                if (listeners['click']) {
                    listeners['click'].forEach(cb => cb({ preventDefault: () => {}, stopPropagation: () => {} }));
                }
            },
            remove: () => {
                if (mountedModal === el) mountedModal = null;
            },
            querySelector: (sel) => {
                if (elementsRegistry.has(sel)) return elementsRegistry.get(sel);
                if (sel === '#mhc-blueprint-shimmer') {
                    return el._innerHTML.includes('mhc-blueprint-shimmer')
                        ? { remove: () => { el._innerHTML = el._innerHTML.replace(/<div class="mhc-blueprint-shimmer"[\s\S]*?<\/div>\s*<\/div>/i, ''); } }
                        : null;
                }
                const newEl = createMockElement('div');
                elementsRegistry.set(sel, newEl);
                return newEl;
            },
            querySelectorAll: () => [],
        };
        return el;
    }

    const mockDoc = {
        createElement: (tag) => {
            const el = createMockElement(tag);
            el.querySelector = (sel) => {
                if (sel === '#mhc-blueprint-shimmer') {
                    return el._innerHTML.includes('mhc-blueprint-shimmer')
                        ? { remove: () => { el._innerHTML = el._innerHTML.replace(/<div class="mhc-blueprint-shimmer"[\s\S]*?<\/div>\s*<\/div>/i, ''); } }
                        : null;
                }
                if (elementsRegistry.has(sel)) return elementsRegistry.get(sel);
                const subEl = createMockElement('div');
                if (sel.startsWith('#')) subEl.id = sel.slice(1);
                elementsRegistry.set(sel, subEl);
                return subEl;
            };
            return el;
        },
        body: {
            appendChild: (el) => {
                mountedModal = el;
            },
        },
        getElementById: (id) => {
            const hashId = `#${id}`;
            if (elementsRegistry.has(hashId)) return elementsRegistry.get(hashId);
            return mountedModal?.id === id ? mountedModal : null;
        },
    };

    const prevDoc = globalThis.document;
    globalThis.document = mockDoc;

    try {
        const customDossier = {
            meta: { systemKey: 'dnd5e', systemLabel: 'D&D 5e Standard' },
            protagonist: {
                name: 'Kaelen Swift-Strike',
                class: 'Tempest Weaver',
                level: 1,
                hp: { current: 10, max: 10 },
                stats: { STR: 10, DEX: 16, CON: 14, INT: 14, WIS: 10, CHA: 10 },
            },
        };

        const tempestBlueprint = {
            className: 'Tempest Weaver',
            hitDie: 'd8',
            levels: {
                1: { features: ['Storm Spark', 'Lightning Weave'], profBonus: 2 },
                2: { features: ['Gale Step'], profBonus: 2 },
                3: { features: ['Archetype: Eye of the Hurricane'], profBonus: 2 },
                4: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 2 },
                5: { features: ['Thunder Crash'], profBonus: 3 },
                6: { features: ['Static Shield'], profBonus: 3 },
                7: { features: ['Wind Strider'], profBonus: 3 },
                8: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 3 },
                9: { features: ['Chain Surge'], profBonus: 4 },
                10: { features: ['Maelstrom Aura'], profBonus: 4 },
                11: { features: ['Greater Tempest Surge'], profBonus: 4 },
                12: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 4 },
                13: { features: ['Ride the Lightning'], profBonus: 5 },
                14: { features: ['Thunderous Rebuke'], profBonus: 5 },
                15: { features: ['Stormform Ascension'], profBonus: 5 },
                16: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 5 },
                17: { features: ['Living Tempest'], profBonus: 6 },
                18: { features: ['Cataclysm Stance'], profBonus: 6 },
                19: { features: ['Ability Score Improvement or Feat'], asi: true, profBonus: 6 },
                20: { features: ['Avatar of the Primordial Storm'], profBonus: 6 },
            },
        };

        // 1. Test formatBlueprintSummary helper
        const summary = formatBlueprintSummary(tempestBlueprint);
        assert.ok(summary.includes('Level 1 (Prof +2): Storm Spark, Lightning Weave'));
        assert.ok(summary.includes('Level 3 (Prof +2): Archetype: Eye of the Hurricane'));
        assert.ok(summary.includes('Level 20 (Prof +6): Avatar of the Primordial Storm'));

        // 2. Test initial open with initialStage = 1 (First-time class definition)
        openLevelUpModal({
            chatId: 'tempest_test_chat',
            dossier: customDossier,
            blueprint: tempestBlueprint,
            targetLevel: 2,
            isRespec: false,
            initialStage: 1,
        });

        assert.ok(mountedModal, 'Modal must mount to DOM');
        assert.ok(mountedModal.innerHTML.includes('Stage 1: 1–20 Codex'), 'Modal must contain Stage 1 markup');
        assert.ok(mountedModal.innerHTML.includes('1–20 Progression Roadmap'), 'Modal must contain progression table title');

        const tableContainerEl = elementsRegistry.get('#mhc-blueprint-table-container');
        assert.ok(tableContainerEl, 'Table container must be wired');
        assert.ok(tableContainerEl.innerHTML.includes('Level 1'), 'Table must contain Level 1 row');
        assert.ok(tableContainerEl.innerHTML.includes('Archetype Specialization'), 'Table must flag Level 3 Archetype Specialization');
        assert.ok(tableContainerEl.innerHTML.includes('Avatar of the Primordial Storm'), 'Table must contain Level 20 Capstone');

        // 3. Test Stage 1 -> Stage 2 transition via "Proceed" button
        const proceedBtn = elementsRegistry.get('#mhc-proceed-to-stage2-btn');
        assert.ok(proceedBtn, 'Proceed button must exist in Stage 1');
        proceedBtn.click();

        const s1View = elementsRegistry.get('#mhc-stage-definition');
        const s2View = elementsRegistry.get('#mhc-stage-advancement');
        assert.strictEqual(s1View.style.display, 'none', 'Stage 1 view must be hidden after proceeding');
        assert.strictEqual(s2View.style.display, 'flex', 'Stage 2 view must be visible after proceeding');

        // 4. Test Stage 2 -> Stage 1 return transition via "Class Definition" button
        const switchBackBtn = elementsRegistry.get('#mhc-switch-to-stage1-btn');
        assert.ok(switchBackBtn, 'Class Definition & Roadmap button must exist in Stage 2');
        switchBackBtn.click();

        assert.strictEqual(s1View.style.display, 'flex', 'Stage 1 view must be restored after clicking switch back');
        assert.strictEqual(s2View.style.display, 'none', 'Stage 2 view must be hidden after returning to Stage 1');

        closeLevelUpModal();

        // 5. Test PbtA isolation (must never show Stage 1 or switch button)
        const pbtaDossier = {
            meta: { systemKey: 'pbta', systemLabel: 'PbtA Narrative Engine' },
            protagonist: {
                name: 'Silas the Ghost',
                playbook: 'The Wraith',
                harm: { current: 1, max: 4, armor: 1 },
                moves: ['Shadow Walk'],
            },
        };

        openLevelUpModal({
            chatId: 'pbta_test_chat',
            dossier: pbtaDossier,
            blueprint: null,
            targetLevel: null,
            isRespec: true,
        });

        assert.ok(!mountedModal.innerHTML.includes('mhc-btn-stage-switch'), 'PbtA must never render Stage 1 switch button');
        closeLevelUpModal();
    } finally {
        globalThis.document = prevDoc;
    }
});

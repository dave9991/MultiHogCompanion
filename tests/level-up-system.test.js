import assert from 'node:assert';
import { test } from 'node:test';
import {
    parseCharacterBlockFromMemo,
    parseAbilitiesBlockFromMemo,
    scaffoldDossierStubForChat,
    ensureChatDossier,
    persistCompanionDossier,
} from '../level-up-scaffold.js';
import {
    getCanonicalDndProgression,
    hasProgressionBlueprint,
    getTierPerks,
    parseBlueprintFromResponse,
    buildBlueprintPrompt,
} from '../level-up-blueprint.js';
import {
    evaluateLevelUpEligibility,
    formulateLevelUpProposal,
    applyLevelUpCommit,
    extractFeatureKey,
    deduplicateFeatures,
    ensureNamedFeature,
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
    assert.deepStrictEqual(parsed.features, ['Second Wind', 'Action Surge']);

    const stub = scaffoldDossierStubForChat('test_chat_001', rawMemo, 'The Valiant Saga');
    assert.strictEqual(stub.meta.chatId, 'test_chat_001');
    assert.strictEqual(stub.meta.title, 'The Valiant Saga');
    assert.strictEqual(stub.meta.systemKey, 'dnd5e');
    assert.strictEqual(stub.meta.isStub, true);
    assert.strictEqual(stub.protagonist.name, 'Marcus the Valiant');
    assert.deepStrictEqual(stub.protagonist.features, ['Second Wind', 'Action Surge']);
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
    assert.deepStrictEqual(parsedBarbarian.features, ['Unarmored Defense', 'Feral Instinct', 'Fast Movement']);

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
                    if (sel === '#mhc-stage1-chat-log') {
                        return {
                            set innerHTML(val) { el.innerHTML += val; },
                            get innerHTML() { return el.innerHTML; },
                        };
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
        assert.ok(mountedModal.innerHTML.includes('actively drafting and balancing'), 'Concierge must reinforce the waiting state while loading');

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
        assert.ok(mountedModal.innerHTML.includes('is ready!'), 'Concierge message must update to ready once blueprint resolves');
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

test('Level-Up & Respec System: Blueprint Persistence & Reopening Flow', async () => {
    const { ensureChatDossier, persistCompanionDossier } = await import('../level-up-scaffold.js');
    const { hasProgressionBlueprint } = await import('../level-up-blueprint.js');

    const chatId = 'smuggler_chat_persistence_test';
    const memo = `[CHARACTER]
Edmund Wilson (Smuggler): 15/15 HP
Stats: STR 10, DEX 16, CON 14, INT 12, WIS 14, CHA 12
Hit Die: 1d10
Features: Cunning Action, Quick Reflexes
Level: 1
[/CHARACTER]
[XP]
Level: 1 | XP: 0/300
[/XP]`;

    // Mock storage environments
    const mockCompanionSettings = {
        chatStates: {},
    };

    const mockCtx = {
        chatMetadata: {},
        saveMetadataDebounced: () => {},
        saveSettingsDebounced: () => {},
    };
    globalThis.SillyTavern = { getContext: () => mockCtx };

    try {
        // Initial scaffold
        const initialDossier = ensureChatDossier(chatId, mockCompanionSettings, { memo });
        assert.strictEqual(initialDossier.protagonist.name, 'Edmund Wilson');
        assert.strictEqual(initialDossier.protagonist.class, 'Smuggler');
        assert.strictEqual(hasProgressionBlueprint(initialDossier), false, 'Initially must not have blueprint');

        // Assign and persist blueprint
        initialDossier.progressionBlueprint = {
            className: 'Smuggler',
            hitDie: 'd10',
            levels: {
                1: { features: ['Black Market Contact'] },
                20: { features: ['Master of the Gray Market'] },
            },
        };

        persistCompanionDossier(chatId, initialDossier);

        assert.strictEqual(mockCtx.chatMetadata.mhc_dossier.progressionBlueprint.className, 'Smuggler');
        assert.strictEqual(mockCompanionSettings.chatStates[chatId].companionDossier.progressionBlueprint.className, 'Smuggler');

        // Simulate subsequent reopening on a fresh invocation
        const freshCompanionSettings = {
            chatStates: {
                [chatId]: {
                    companionDossier: mockCompanionSettings.chatStates[chatId].companionDossier,
                },
            },
        };

        const reloadedDossier = ensureChatDossier(chatId, freshCompanionSettings, { memo });
        assert.strictEqual(hasProgressionBlueprint(reloadedDossier), true, 'Reloaded dossier must retain progressionBlueprint');
        assert.strictEqual(reloadedDossier.progressionBlueprint.className, 'Smuggler');
        assert.strictEqual(reloadedDossier.progressionBlueprint.levels['20'].features[0], 'Master of the Gray Market');
    } finally {
        delete globalThis.SillyTavern;
    }
});

test('Level-Up System: Starting Trait Grounding & Non-Duplicating Respec Commit', () => {
    // 1. Verify buildBlueprintPrompt grounds prompt in established sheet traits
    const testChar = {
        name: 'Edmund Wilson',
        class: 'Eldritch Bounty Hunter',
        hitDie: 'd10',
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
        features: ['Arcane Tracking', 'Silver Tongue', 'Quick Draw'],
    };

    const prompt = buildBlueprintPrompt({ character: testChar, genre: 'grimdark fantasy' });
    assert.match(prompt, /ESTABLISHED STARTING TRAITS \/ AD-HOC ABILITIES:\s*Arcane Tracking, Silver Tongue, Quick Draw/);
    assert.match(prompt, /Starting Trait Integration: You MUST incorporate and honor the character's ESTABLISHED STARTING TRAITS/);

    // 2. Verify applyLevelUpCommit replaces rather than duplicates on Respec
    const initialMemo = `[CHARACTER]
Edmund Wilson (Eldritch Bounty Hunter): 12/12 HP
Stats: STR 16, DEX 14, CON 14, INT 10, WIS 12, CHA 8
Features: Arcane Tracking, Silver Tongue, Quick Draw
Level: 1
[/CHARACTER]
[XP]
Level: 1 | XP: 0/300
[/XP]`;

    const respecProposal1 = {
        characterName: 'Edmund Wilson',
        className: 'Eldritch Bounty Hunter',
        targetLevel: 1,
        currentLevel: 1,
        hitDie: 'd10',
        hpChange: { oldMax: 12, gain: 0, newMax: 12 },
        newFeatures: ['Arcane Tracking', 'Silver Tongue', 'Quick Draw', 'Eldritch Sense'],
        partyChanges: [],
    };

    // First respec commit
    const commit1 = applyLevelUpCommit({
        chatId: 'edmund_chat',
        currentMemo: initialMemo,
        proposal: respecProposal1,
        isRespec: true,
    });

    assert.strictEqual(commit1.success, true);
    assert.match(commit1.updatedMemo, /Features:\s*Arcane Tracking, Silver Tongue, Quick Draw, Eldritch Sense/);
    // Ensure no duplicate features line or repeated traits
    const matches1 = commit1.updatedMemo.match(/Arcane Tracking/g);
    assert.strictEqual(matches1.length, 1, 'Feature should only appear once after first respec');

    // Second respec commit (simulating user opening respec again and modifying traits)
    const respecProposal2 = {
        ...respecProposal1,
        newFeatures: ['Arcane Tracking', 'Eldritch Sense', 'Shadow Step'],
    };

    const commit2 = applyLevelUpCommit({
        chatId: 'edmund_chat',
        currentMemo: commit1.updatedMemo,
        proposal: respecProposal2,
        isRespec: true,
    });

    assert.strictEqual(commit2.success, true);
    assert.match(commit2.updatedMemo, /Features:\s*Arcane Tracking, Eldritch Sense, Shadow Step/);
    assert.doesNotMatch(commit2.updatedMemo, /Silver Tongue/);
    assert.doesNotMatch(commit2.updatedMemo, /Quick Draw/);
    const matches2 = commit2.updatedMemo.match(/Arcane Tracking/g);
    assert.strictEqual(matches2.length, 1, 'Feature should strictly appear once after second respec');

    // 3. Verify applyLevelUpCommit deduplicates new features on Level-Up
    const levelUpProposal = {
        characterName: 'Edmund Wilson',
        className: 'Eldritch Bounty Hunter',
        targetLevel: 2,
        currentLevel: 1,
        hitDie: 'd10',
        hpChange: { oldMax: 12, gain: 7, newMax: 19 },
        newFeatures: ['Arcane Tracking', 'Hunter\'s Mark'], // Arcane Tracking is already on sheet
        partyChanges: [],
    };

    const commitLevelUp = applyLevelUpCommit({
        chatId: 'edmund_chat',
        currentMemo: commit2.updatedMemo,
        proposal: levelUpProposal,
        isRespec: false,
    });

    assert.strictEqual(commitLevelUp.success, true);
    assert.match(commitLevelUp.updatedMemo, /Hunter's Mark/);
    const matchesLevelUp = commitLevelUp.updatedMemo.match(/Arcane Tracking/g);
    assert.strictEqual(matchesLevelUp.length, 1, 'Level-up should deduplicate already existing features');
});

test('Level-Up System: Passive Traits vs Active [ABILITIES] Dual-Block Persistence', () => {
    const rawSmugglerMemo = `[CHARACTER]
Edmund Wilson (Smuggler): 12/12 HP
Combat: BAB: +1 | Ranged (1 attack): +4 | Melee (1 attack): +2 | Base AC: 13 | Total AC: 16
Gear: "Gutter-Snipe" Revolver (2d8+1 Kinetic, +1 to hit) | Standard Combat Knife (1d4+1 Slashing) | Worn Synth-Leather Armor (+3 AC)
Proficiencies: Light Armor, Simple Firearms, Basic Melee Weapons
Attr: STR 12 (+1), DEX 16 (+3), CON 14 (+2), INT 15 (+2), WIS 10 (+0), CHA 14 (+2)
Saves: Fort +2 | Ref +5 | Will +2
Skills: Stealth +6, Persuasion +4
Traits: Street Rat (+2 to Stealth), Scavenger's Instinct (+2 to Survival), Bad Luck Bearer (reroll misfortune)
HD: d10 (10/10)
Status: Healthy
[/CHARACTER]

[INVENTORY]
Gear:
- ⚡ [Uncommon] [E] "Gutter-Snipe" Revolver (2d8+1 Kinetic, +1 to hit) (~150 CR)
- 🧥 [Common] Worn Synth-Leather Armor (+3 AC) (~40 CR)
[/INVENTORY]

[ABILITIES]
Underworld Broker (Forces an enemy to make a Ref DC 13 save or waste their next action, 1/1 per short rest)
Misfortune Gambit (Reroll a critical misfortune check, 1/1 per rest)
[/ABILITIES]

[XP]
Level: 1 | XP: 0/300
[/XP]`;

    // 1. Verify parseAbilitiesBlockFromMemo extracts abilities correctly
    const parsedAbilities = parseAbilitiesBlockFromMemo(rawSmugglerMemo);
    assert.strictEqual(parsedAbilities.length, 2);
    assert.match(parsedAbilities[0], /Underworld Broker/);
    assert.match(parsedAbilities[1], /Misfortune Gambit/);

    const parsedChar = parseCharacterBlockFromMemo(rawSmugglerMemo);
    assert.strictEqual(parsedChar.features.length, 3);
    assert.strictEqual(parsedChar.abilities.length, 2);

    // 2. Formulate proposal with options.currentMemo
    const proposal = formulateLevelUpProposal(null, null, 1, {
        isRespec: true,
        currentMemo: rawSmugglerMemo,
    });
    assert.strictEqual(proposal.activeAbilities.length, 2);
    assert.match(proposal.activeAbilities[0], /Underworld Broker/);

    // 3. Simulate Concierge audit & deduplication:
    // Remove duplicated 'Bad Luck Bearer' from passive traits, keep 'Misfortune Gambit' in active abilities,
    // and add a new active ability 'Smoke Bomb (1/1 per short rest)'.
    proposal.newFeatures = ["Street Rat (+2 to Stealth)", "Scavenger's Instinct (+2 to Survival)"];
    proposal.activeAbilities = [
        "Underworld Broker (Forces an enemy to make a Ref DC 13 save or waste their next action, 1/1 per short rest)",
        "Misfortune Gambit (Reroll a critical misfortune check, 1/1 per rest)",
        "Smoke Bomb (Concealment in 15ft radius, 1/1 per short rest)",
    ];

    const commitResult = applyLevelUpCommit({
        chatId: 'edmund_smuggler',
        currentMemo: rawSmugglerMemo,
        proposal,
        isRespec: true,
    });

    assert.strictEqual(commitResult.success, true);
    // [CHARACTER] must have the cleaned passive traits and NOT have Bad Luck Bearer
    assert.match(commitResult.updatedMemo, /Traits:\s*Street Rat \(\+2 to Stealth\), Scavenger's Instinct \(\+2 to Survival\)/);
    assert.doesNotMatch(commitResult.updatedMemo, /Bad Luck Bearer/);

    // [ABILITIES] must be cleanly updated with all 3 active abilities
    assert.match(commitResult.updatedMemo, /\[ABILITIES\][\s\S]*?Underworld Broker[\s\S]*?Smoke Bomb[\s\S]*?\[\/ABILITIES\]/);
    assert.match(commitResult.updatedMemo, /Smoke Bomb \(Concealment in 15ft radius, 1\/1 per short rest\)/);

    // Verify [INVENTORY] and [XP] blocks remain intact
    assert.match(commitResult.updatedMemo, /\[INVENTORY\][\s\S]*?\[\/INVENTORY\]/);
    assert.match(commitResult.updatedMemo, /\[XP\][\s\S]*?\[\/XP\]/);
});

test('Level-Up System: Feature Key Extraction & Smart Title-Based Deduplication', () => {
    // 1. Test extractFeatureKey
    assert.strictEqual(
        extractFeatureKey('Street Rat (+2 to Stealth and Deception rolls in urban underbelly districts)'),
        'street rat'
    );
    assert.strictEqual(
        extractFeatureKey('Street Rat (+2 Stealth/Deception in urban underbelly)'),
        'street rat'
    );
    assert.strictEqual(
        extractFeatureKey('Underworld Broker (Forces an enemy to make a Ref DC 13 save...)'),
        'underworld broker'
    );
    assert.strictEqual(
        extractFeatureKey('Underworld Broker (Force Ref DC 13 save or target wastes action)'),
        'underworld broker'
    );
    assert.strictEqual(
        extractFeatureKey('• Cunning Action: Dash, Disengage, or Hide'),
        'cunning action'
    );
    assert.strictEqual(
        extractFeatureKey('Darkvision'),
        'darkvision'
    );

    // 2. Test deduplicateFeatures
    const mixedTraits = [
        'Street Rat (+2 to Stealth and Deception rolls in urban underbelly districts)',
        'Scavenger\'s Instinct (+2 to Survival checks when navigating wrecked environments or scrap heaps)',
        'Bad Luck Bearer (Once per long rest, reroll a failed saving throw...)',
        'Street Rat (+2 Stealth/Deception in urban underbelly)',
        'Scavenger\'s Instinct (+2 Survival in wrecked environments)',
    ];
    const deduplicated = deduplicateFeatures(mixedTraits);
    assert.strictEqual(deduplicated.length, 3);
    assert.strictEqual(deduplicated[0], 'Street Rat (+2 to Stealth and Deception rolls in urban underbelly districts)');
    assert.strictEqual(deduplicated[1], 'Scavenger\'s Instinct (+2 to Survival checks when navigating wrecked environments or scrap heaps)');
    assert.strictEqual(deduplicated[2], 'Bad Luck Bearer (Once per long rest, reroll a failed saving throw...)');

    // 3. Test deduplication inside formulateLevelUpProposal with paraphrased blueprint features
    const mockBlueprint = {
        className: 'Smuggler',
        hitDie: 'd10',
        levels: {
            '1': {
                features: [
                    'Street Rat (+2 Stealth/Deception in urban underbelly)',
                    'Scavenger\'s Instinct (+2 Survival in wrecked environments)',
                ],
            },
        },
    };
    const mockChar = {
        name: 'Edmund Wilson',
        class: 'Smuggler',
        level: 1,
        features: [
            'Street Rat (+2 to Stealth and Deception rolls in urban underbelly districts)',
            'Scavenger\'s Instinct (+2 to Survival checks when navigating wrecked environments or scrap heaps)',
            'Bad Luck Bearer (Once per long rest, reroll a failed saving throw...)',
        ],
        abilities: [
            'Underworld Broker (Forces an enemy to make a Ref DC 13 save or waste their next action, 1/1 per short rest)',
        ],
    };

    const proposal = formulateLevelUpProposal(mockChar, mockBlueprint, 1, { isRespec: true });
    // Should contain exactly 3 traits (retaining established sheet descriptions), NOT 5
    assert.strictEqual(proposal.newFeatures.length, 3);
    assert.strictEqual(extractFeatureKey(proposal.newFeatures[0]), 'street rat');
    assert.strictEqual(extractFeatureKey(proposal.newFeatures[1]), 'scavenger\'s instinct');
    assert.strictEqual(extractFeatureKey(proposal.newFeatures[2]), 'bad luck bearer');
    assert.strictEqual(proposal.activeAbilities.length, 1);

    // 4. Test ensureNamedFeature name retention
    assert.strictEqual(
        ensureNamedFeature('Misfortune Gambit', 'Once per long rest, reroll a failed save; 1/1 per long rest'),
        'Misfortune Gambit (Once per long rest, reroll a failed save; 1/1 per long rest)'
    );
    assert.strictEqual(
        ensureNamedFeature('Misfortune Gambit', '(Once per long rest, reroll a failed save; 1/1 per long rest)'),
        'Misfortune Gambit (Once per long rest, reroll a failed save; 1/1 per long rest)'
    );
    assert.strictEqual(
        ensureNamedFeature('Misfortune Gambit', 'Misfortune Gambit (Once per long rest, reroll a failed save; 1/1 per long rest)'),
        'Misfortune Gambit (Once per long rest, reroll a failed save; 1/1 per long rest)'
    );
    assert.strictEqual(
        ensureNamedFeature('Street Rat', '+2 to Stealth and Deception in urban districts'),
        'Street Rat (+2 to Stealth and Deception in urban districts)'
    );
});

test('Level-Up System: Roadmap Declutter — HP/ASI/Slot bookkeeping is never a feature', async () => {
    const {
        classifyFeatureNoise,
        sanitizeFeatureList,
        normalizeBlueprint,
        normalizeLevelEntry,
    } = await import('../level-up-blueprint.js');

    // Classification
    assert.strictEqual(classifyFeatureNoise('HP Gain: 1d8 + CON'), 'hp');
    assert.strictEqual(classifyFeatureNoise('Hit Die: d10'), 'hp');
    assert.strictEqual(classifyFeatureNoise('Gain 1d8+2 hit points'), 'hp');
    assert.strictEqual(classifyFeatureNoise('Proficiency Bonus +3'), 'prof');
    assert.strictEqual(classifyFeatureNoise('Ability Score Improvement (or Feat)'), 'asi');
    assert.strictEqual(classifyFeatureNoise('Level 3 Spell Slots (2 slots)'), 'slots');
    assert.strictEqual(classifyFeatureNoise('Cantrip Learned'), 'cantrip');
    // Real features that merely mention HP are preserved
    assert.strictEqual(classifyFeatureNoise('Second Wind (1d10+Level HP 1/rest)'), null);
    assert.strictEqual(classifyFeatureNoise('Survivor (Regain 5+CON HP at start of turn if below half HP)'), null);

    assert.deepStrictEqual(
        sanitizeFeatureList(['Rage', 'HP Gain: 1d12+CON', 'rage', 'Proficiency Bonus +2', 'Reckless Attack']),
        ['Rage', 'Reckless Attack'],
    );

    // Level normalization extracts structured data
    const entry = normalizeLevelEntry({ features: ['Ability Score Improvement', 'Level 2 Spell Slots (3 slots)', 'Arcane Ward'] }, 4);
    assert.deepStrictEqual(entry.features, ['Arcane Ward']);
    assert.strictEqual(entry.asi, true);
    assert.deepStrictEqual(entry.spellSlots, { 2: 3 });
    assert.strictEqual(normalizeLevelEntry({ features: 'Single String Feature' }, 1).features[0], 'Single String Feature');

    // LLM output with HD noise on every level
    const noisy = {
        className: 'Void Monk',
        hitDie: '1d8',
        levels: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [String(i + 1), {
            features: [`Void Technique ${i + 1}`, `HP Gain: 1d8 + CON`, `Hit Die: 1d8`],
            profBonus: Math.floor(i / 4) + 2,
        }])),
    };
    const parsed = parseBlueprintFromResponse('```json\n' + JSON.stringify(noisy) + '\n```');
    assert.strictEqual(parsed.hitDie, 'd8');
    for (let i = 1; i <= 20; i++) {
        assert.deepStrictEqual(parsed.levels[String(i)].features, [`Void Technique ${i}`]);
    }
    // Idempotent
    assert.deepStrictEqual(normalizeBlueprint(parsed).levels, parsed.levels);

    // Canonical tables: no slot rows / ASI strings / cantrip rows in features
    const wizard = getCanonicalDndProgression('Wizard');
    for (let i = 1; i <= 20; i++) {
        for (const f of wizard.levels[String(i)].features) {
            assert.strictEqual(classifyFeatureNoise(f), null, `Level ${i} feature "${f}" should not be bookkeeping`);
        }
    }
    assert.strictEqual(wizard.levels['4'].asi, true);
    assert.ok(wizard.levels['3'].spellSlots, 'Wizard L3 slot grant moves to structured spellSlots');

    // getTierPerks sanitizes stored (legacy) blueprints too
    const legacy = { hitDie: 'd10', levels: { 5: { features: ['Extra Attack', 'HP Gain: 1d10+CON'], profBonus: 3 } } };
    assert.deepStrictEqual(getTierPerks(legacy, 5, 1).features, ['Extra Attack']);

    // Prompt forbids bookkeeping in features
    const prompt = buildBlueprintPrompt({ character: { name: 'A', class: 'Void Monk' } });
    assert.ok(!/HP gain via Hit Die/i.test(prompt));
    assert.ok(/DO NOT LIST/i.test(prompt));

    // Commit never writes bookkeeping into the sheet
    const memo = `[CHARACTER]\nHero (Fighter): 10/10 HP\nLevel: 1\nFeatures: Fighting Style\n[/CHARACTER]\n[XP]\nTotal: 300 / 300 XP (Level 1)\n[/XP]`;
    const res = applyLevelUpCommit({
        chatId: 'c',
        currentMemo: memo,
        proposal: { targetLevel: 2, hpChange: { newMax: 18 }, newFeatures: ['Action Surge', 'HP Gain: 1d10+2'] },
    });
    assert.ok(res.updatedMemo.includes('Action Surge'));
    assert.ok(!/HP Gain/i.test(res.updatedMemo));
});

test('Level-Up System: Phase 2 — XP table to 20, level cap, class-match, spell slot growth', async () => {
    const { XP_LEVEL_THRESHOLDS, blueprintMatchesClass } = await import('../level-up-blueprint.js');
    const { applySpellSlotGrowth } = await import('../level-up-runner.js');

    // Full 5e table
    assert.strictEqual(XP_LEVEL_THRESHOLDS.length, 20);
    assert.strictEqual(XP_LEVEL_THRESHOLDS[9], 64000);
    assert.strictEqual(XP_LEVEL_THRESHOLDS[10], 85000);
    assert.strictEqual(XP_LEVEL_THRESHOLDS[19], 355000);

    // Level 10 character is no longer instantly re-eligible (threshold is 85,000, not 64,000)
    const memoL10 = `[CHARACTER]\nLevel: 10\n[/CHARACTER]\n[XP]\nLevel: 10 | XP: 64000/0\n[/XP]`;
    const evalL10 = evaluateLevelUpEligibility(memoL10);
    assert.strictEqual(evalL10.maxThreshold, 85000);
    assert.strictEqual(evalL10.eligible, false);

    // Commit from 10 -> 11 sets the next threshold to level 12's (100,000)
    const commitMemo = `[CHARACTER]\nHero (Fighter): 80/80 HP\nLevel: 10\n[/CHARACTER]\n[XP]\nTotal: 85,000 / 85,000 XP (Level 10)\n[/XP]`;
    const committed = applyLevelUpCommit({
        chatId: 'c', currentMemo: commitMemo,
        proposal: { targetLevel: 11, hpChange: { newMax: 90 }, newFeatures: [] },
    });
    assert.ok(committed.updatedMemo.includes('/ 100,000 XP (Level 11)'), committed.updatedMemo);

    // Level cap: level 20 can never level up
    const memoL20 = `[CHARACTER]\nLevel: 20\n[/CHARACTER]\n[XP]\nTotal: 400,000 / 355,000 XP (Level 20)\n[/XP]`;
    assert.strictEqual(evaluateLevelUpEligibility(memoL20).eligible, false);

    // Blueprint/class matching
    assert.strictEqual(blueprintMatchesClass({ className: 'Rogue' }, 'Shadow Rogue'), true);
    assert.strictEqual(blueprintMatchesClass({ className: 'Cyber-Samurai' }, 'Cyber Samurai'), true);
    assert.strictEqual(blueprintMatchesClass({ className: 'Fighter' }, 'Wizard'), false);
    assert.strictEqual(blueprintMatchesClass({ className: 'Fighter' }, 'Adventurer'), true);
    assert.strictEqual(blueprintMatchesClass({ className: 'Fighter' }, ''), true);

    // Spell slot growth in [SPELLS]
    const spellMemo = `[CHARACTER]\nMira (Wizard): 20/20 HP\nLevel: 4\n[/CHARACTER]\n[SPELLS]\nCantrips: Fire Bolt\nLevel 1 (1/4): Shield\nLevel 2 (0/2): Misty Step\n[/SPELLS]`;
    const grown = applySpellSlotGrowth(spellMemo, { 2: 3, 3: 2 });
    assert.ok(grown.includes('Level 2 (1/3): Misty Step'), grown);
    assert.ok(grown.includes('Level 1 (1/4): Shield'), 'untouched levels remain');
    assert.ok(/Level 3 \(2\/2\):/.test(grown), 'newly unlocked slot level is added');
    assert.strictEqual(applySpellSlotGrowth('[CHARACTER]\nX\n[/CHARACTER]', { 2: 3 }), '[CHARACTER]\nX\n[/CHARACTER]');
    // maximums never shrink
    assert.ok(applySpellSlotGrowth(spellMemo, { 1: 2 }).includes('Level 1 (1/4): Shield'));

    // End-to-end via commit: wizard L5 grants Level 3 slots
    const wizardProg = getCanonicalDndProgression('Wizard');
    const proposal = formulateLevelUpProposal(
        { protagonist: { name: 'Mira', class: 'Wizard', stats: { CON: 12 }, hp: { max: 20 } } },
        wizardProg, 5,
    );
    assert.deepStrictEqual(proposal.spellSlots, { 3: 2 });
    const wizMemo = `[CHARACTER]\nMira (Wizard): 20/20 HP\nLevel: 4\n[/CHARACTER]\n[XP]\nTotal: 6,500 / 6,500 XP (Level 4)\n[/XP]\n[SPELLS]\nLevel 3 (0/0):\n[/SPELLS]`;
    const wizCommit = applyLevelUpCommit({ chatId: 'c', currentMemo: wizMemo, proposal });
    assert.ok(wizCommit.updatedMemo.includes('Level 3 (2/2)'), wizCommit.updatedMemo);

    // Respec never alters slots
    const respecProposal = formulateLevelUpProposal(
        { protagonist: { name: 'Mira', class: 'Wizard', stats: {}, hp: { max: 20 } } },
        wizardProg, 5, { isRespec: true },
    );
    assert.strictEqual(respecProposal.spellSlots, null);
});

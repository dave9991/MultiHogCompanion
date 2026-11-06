import test from 'node:test';
import assert from 'node:assert';
import { renderProgressionArchitect } from '../progression-architect-ui.js';
import { createEmptyDossier } from '../concierge-parser.js';
import { ensureChatDossier } from '../level-up-scaffold.js';
import { getCanonicalDndProgression } from '../level-up-blueprint.js';

// Minimal mock jQuery-like DOM helper for node test runner
function createMockElement() {
    const el = {
        _html: '',
        _emptyCalled: false,
        _events: {},
        _data: {},
        _classes: new Set(),
        _children: {},
        html(val) {
            if (val === undefined) return this._html;
            this._html = val;
            return this;
        },
        empty() {
            this._emptyCalled = true;
            this._html = '';
            return this;
        },
        find(selector) {
            if (!this._children[selector]) {
                this._children[selector] = createMockElement();
            }
            return this._children[selector];
        },
        on(event, handler) {
            this._events[event] = handler;
            return this;
        },
        attr(name, val) {
            if (val === undefined) return this._data[name];
            this._data[name] = val;
            return this;
        },
        val(val) {
            if (val === undefined) return this._val || '';
            this._val = val;
            return this;
        },
        addClass(cls) {
            this._classes.add(cls);
            return this;
        },
        removeClass(cls) {
            this._classes.delete(cls);
            return this;
        },
        length: 1,
    };
    return el;
}

if (!globalThis.$) {
    globalThis.$ = (el) => (el && typeof el.html === 'function' ? el : createMockElement());
}

test('Progression Codex: Renders D&D 5e 1–20 table and links canonical blueprint', () => {
    const dossier = createEmptyDossier('dnd5e');
    dossier.protagonist = {
        name: 'Kaelen',
        class: 'Fighter',
        level: 1,
        stats: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
        hp: { current: 12, max: 12 },
        hitDie: 'd10',
    };

    const mockContainer = createMockElement();
    let updateFired = false;
    renderProgressionArchitect(mockContainer, {
        dossier,
        ruleset: 'dnd5e',
        onUpdate: (updated) => { updateFired = true; },
    });

    const renderedHtml = mockContainer.html();
    assert.ok(renderedHtml.includes('1–20 Class Progression Codex'), 'Contains title');
    assert.ok(renderedHtml.includes('⚔️ Fighter'), 'Contains class name');
    assert.ok(renderedHtml.includes('Tier 1: Local Heroes'), 'Contains Tier 1 table');
    assert.ok(renderedHtml.includes('Second Wind'), 'Contains canonical Fighter feature');
    assert.ok(dossier.progressionBlueprint, 'Auto-seeded blueprint into dossier');
    assert.strictEqual(dossier.progressionBlueprint.hitDie, 'd10');
});

test('Progression Codex: Renders PbtA Playbook Moves and Advance Matrix', () => {
    const dossier = createEmptyDossier('pbta');
    dossier.protagonist = {
        name: 'Vanya',
        playbook: 'The Chosen',
        moves: ['Destiny Calls', 'Invulnerable'],
        stats: { Cool: 1, Tough: 2, Charm: -1, Sharp: 1, Weird: 0 },
        harm: { current: 0, max: 4, armor: 1 },
    };

    const mockContainer = createMockElement();
    renderProgressionArchitect(mockContainer, {
        dossier,
        ruleset: 'pbta',
    });

    const renderedHtml = mockContainer.html();
    assert.ok(renderedHtml.includes('PbtA Playbook &amp; Advances'), 'Contains PbtA title');
    assert.ok(renderedHtml.includes('The Chosen'), 'Contains playbook name');
    assert.ok(renderedHtml.includes('Starting Playbook Moves'), 'Contains starting moves section');
    assert.ok(renderedHtml.includes('Destiny Calls'), 'Contains custom move');
    assert.ok(renderedHtml.includes('Playbook Advances'), 'Contains advances section');
});

test('Progression Codex: Renders FAE Resource Pools, Positive Tags, and Milestone Desk', () => {
    const dossier = createEmptyDossier('fae');
    dossier.protagonist = {
        name: 'Lyra',
        archetype: 'Shadowblade Infiltrator',
        positiveTags: ['Acrobatic', 'Silent as Mist'],
        negativeTags: ['Wanted in Valoria'],
        pools: {
            Fate: { current: 3, max: 3 },
            Stress: { current: 0, max: 3 },
        },
        stats: { Careful: 1, Clever: 2, Flashy: 0, Forceful: 1, Quick: 3, Sneaky: 2 },
    };

    const mockContainer = createMockElement();
    renderProgressionArchitect(mockContainer, {
        dossier,
        ruleset: 'fae',
    });

    const renderedHtml = mockContainer.html();
    assert.ok(renderedHtml.includes('FAE Milestone &amp; Pools'), 'Contains FAE title');
    assert.ok(renderedHtml.includes('Shadowblade Infiltrator'), 'Contains archetype');
    assert.ok(renderedHtml.includes('Attrition Resource Pools'), 'Contains pools section');
    assert.ok(renderedHtml.includes('Positive Tags &amp; Leverage'), 'Contains tags section');
    assert.ok(renderedHtml.includes('Acrobatic'), 'Contains positive tag');
});

test('Level-Up Scaffold: ensureChatDossier automatically links canonical D&D blueprints on Turn 0', () => {
    const rogueMemo = `[CHARACTER]
Theron Nightshade (Rogue): 9/9 HP
Combat: BAB: +0 | Base AC: 11 | Total AC: 14
HD: d8 (9/9)
Attr: STR 10 (+0), DEX 16 (+3), CON 12 (+1), INT 14 (+2), WIS 12 (+1), CHA 14 (+2)
Traits: Sneak Attack (1d6), Thieves' Cant
[/CHARACTER]
[XP]
Level: 1 | XP: 0/300
[/XP]`;

    const mockSettings = { chatStates: { rogue_chat_01: {} }, currentMemo: rogueMemo };
    const ensured = ensureChatDossier('rogue_chat_01', mockSettings);

    assert.strictEqual(ensured.protagonist.name, 'Theron Nightshade');
    assert.strictEqual(ensured.protagonist.class, 'Rogue');
    assert.ok(ensured.progressionBlueprint, 'Blueprint automatically linked on Turn 0');
    assert.strictEqual(ensured.progressionBlueprint.className, 'Rogue');
    assert.strictEqual(ensured.progressionBlueprint.hitDie, 'd8');
    assert.ok(ensured.progressionBlueprint.levels[1].features.some(f => f.includes('Sneak Attack')), 'Contains Level 1 Sneak Attack');
});

test('Unified Wand Menu: Defaults to Concierge and switches to Level Up Available dynamically', async () => {
    const { evaluateLevelUpEligibility } = await import('../level-up-runner.js');

    // Normal state (under threshold)
    const normalMemo = `[CHARACTER]\nLevel: 1\n[/CHARACTER]\n[XP]\nTotal: 100 / 300 XP (Level 1)\n[/XP]`;
    const normalStatus = evaluateLevelUpEligibility(normalMemo, 'dnd5e');
    assert.strictEqual(normalStatus.eligible, false);

    // Wand menu should show Concierge in normal state
    const normalLabel = normalStatus.eligible ? '⬆ Level Up Available' : '🧙‍♂️ Concierge';
    assert.strictEqual(normalLabel, '🧙‍♂️ Concierge');

    // Level up available state
    const readyMemo = `[CHARACTER]\nLevel: 1\n[/CHARACTER]\n[XP]\nTotal: 350 / 300 XP (Level 1)\n[/XP]`;
    const readyStatus = evaluateLevelUpEligibility(readyMemo, 'dnd5e');
    assert.strictEqual(readyStatus.eligible, true);
    assert.strictEqual(readyStatus.currentLevel, 1);
    assert.strictEqual(readyStatus.nextLevel, 2);

    const readyLabel = readyStatus.eligible
        ? `⬆ Level Up Available (Lvl ${readyStatus.currentLevel} → ${readyStatus.nextLevel})`
        : '🧙‍♂️ Concierge';
    assert.strictEqual(readyLabel, '⬆ Level Up Available (Lvl 1 → 2)');
});

test('Progression Codex: Mathematical boundary hardening handles un-normalized CON and level scaling', () => {
    // 1. Un-normalized CON string e.g. "14 (+2)"
    const dossier = createEmptyDossier('dnd5e');
    dossier.protagonist = {
        name: 'Grom',
        class: 'Barbarian',
        level: 3,
        stats: { CON: '16 (+3)', STR: 18 },
        hitDie: 'd12',
        hp: { current: 35, max: 35 },
    };

    let updatedDossier = null;
    const mockContainer = createMockElement();

    renderProgressionArchitect(mockContainer, {
        dossier,
        ruleset: 'dnd5e',
        onUpdate: (u) => { updatedDossier = u; },
    });

    // Simulate Hit Die change event
    const hitDieSelect = mockContainer.find('#mhc_prog_dnd_hitdie');
    hitDieSelect.val('d10');
    const hdChangeHandler = hitDieSelect._events['change'];
    assert.ok(typeof hdChangeHandler === 'function', 'Change handler bound');

    // Trigger change
    hdChangeHandler.call(hitDieSelect);

    assert.ok(updatedDossier, 'onUpdate fired cleanly');
    assert.strictEqual(updatedDossier.protagonist.hitDie, 'd10');
    // CON 16 (+3) => conMod = 3
    // Level 3: base level 1 = 10 + 3 = 13. avgGain per level = Math.floor(10/2)+1+3 = 9.
    // Level 3 HP = 13 + (9 * 2) = 31. Not NaN!
    assert.ok(!Number.isNaN(updatedDossier.protagonist.hp.max), 'HP is not NaN');
    assert.strictEqual(updatedDossier.protagonist.hp.max, 31);
    assert.ok(updatedDossier.protagonist.hp.max >= 1, 'HP is strictly >= 1');
});



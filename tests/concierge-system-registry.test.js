/**
 * concierge-system-registry.test.js — MultiHog Companion
 *
 * Verifies Phase 2 Modular Game System Adapter Architecture:
 * 1. System Registry registration, lookup, and graceful fallback.
 * 2. Ruleset auto-detection (explicit meta, structural markers).
 * 3. Contract compliance for PbtaSystemAdapter and FaeSystemAdapter.
 * 4. Extensibility proof: adding a 3rd system (Mock FitD) dynamically without touching core files.
 */

import test from 'node:test';
import assert from 'node:assert';

import { ConciergeSystemAdapter } from '../concierge-system-base.js';
import { systemRegistry } from '../concierge-system-registry.js';
import '../concierge-system-pbta.js';
import '../concierge-system-fae.js';
import { createEmptyDossier, healAndNormalizeDossier } from '../concierge-parser.js';

test('1. System Registry provides registered adapters and graceful fallback', () => {
    const list = systemRegistry.list();
    const ids = list.map(s => s.id);

    assert.ok(ids.includes('pbta'), 'System registry must include pbta');
    assert.ok(ids.includes('fae'), 'System registry must include fae');

    const pbta = systemRegistry.get('pbta');
    assert.equal(pbta.id, 'pbta');
    assert.equal(pbta.label, 'Powered by the Apocalypse');
    assert.equal(pbta.diceEngine, '2d6 Moves & Harm');

    const fae = systemRegistry.get('fae');
    assert.equal(fae.id, 'fae');
    assert.equal(fae.label, 'Freeform Attrition Engine');
    assert.equal(fae.diceEngine, '4dF Pools & Leverage');

    // Case insensitivity
    assert.equal(systemRegistry.get('FAE').id, 'fae');
    assert.equal(systemRegistry.get('  pBtA  ').id, 'pbta');

    // Fallback for unknown ruleset
    const fallback = systemRegistry.get('non_existent_engine');
    assert.equal(fallback.id, 'pbta', 'Unknown ruleset must fall back to default (pbta)');
});

test('2. detectRuleset identifies active ruleset from explicit meta and structural markers', () => {
    // Explicit meta
    assert.equal(systemRegistry.detectRuleset({ meta: { ruleset: 'fae' } }), 'fae');
    assert.equal(systemRegistry.detectRuleset({ meta: { ruleset: 'pbta' } }), 'pbta');

    // Structural FAE markers (positiveTags, pools)
    const faeStructural1 = {
        protagonist: {
            positiveTags: ['Calm under pressure', 'Veteran Investigator'],
        },
    };
    assert.equal(systemRegistry.detectRuleset(faeStructural1), 'fae', 'Must detect FAE from positiveTags');

    const faeStructural2 = {
        protagonist: {
            pools: { sanity: { current: 5, max: 8 } },
        },
    };
    assert.equal(systemRegistry.detectRuleset(faeStructural2), 'fae', 'Must detect FAE from pools');

    // Structural PbtA markers (stats, startingMoves)
    const pbtaStructural1 = {
        protagonist: {
            stats: { Cool: 2, Hard: 1, Sharp: 1, Hot: 0, Weird: -1 },
        },
    };
    assert.equal(systemRegistry.detectRuleset(pbtaStructural1), 'pbta', 'Must detect PbtA from stats');

    const pbtaStructural2 = {
        protagonist: {
            startingMoves: ['Hack & Slash', 'Volley'],
        },
    };
    assert.equal(systemRegistry.detectRuleset(pbtaStructural2), 'pbta', 'Must detect PbtA from startingMoves');

    // Empty or blank
    assert.equal(systemRegistry.detectRuleset(null), 'pbta');
    assert.equal(systemRegistry.detectRuleset({}), 'pbta');
});

test('3. Extensibility Proof: dynamically registering a 3rd game system (FitD)', () => {
    // Define a 3rd hypothetical system adapter without touching any core Concierge code
    class MockFitdAdapter extends ConciergeSystemAdapter {
        id = 'fitd';
        label = 'Forged in the Dark';
        diceEngine = 'd6 Dice Pool (Position & Effect)';
        badgeIcon = '🗡️';

        getGenres() {
            return {
                scoundrels: { id: 'scoundrels', label: 'Victorian Heist (Duskwall)', stats: ['Insight', 'Prowess', 'Resolve'] },
            };
        }

        getDefaultGenre() {
            return 'scoundrels';
        }

        createEmptyProtagonist(genreKey) {
            return {
                name: '',
                playbook: 'Cutter',
                stress: { current: 0, max: 9 },
                trauma: [],
                stats: { Insight: 1, Prowess: 2, Resolve: 1 },
                specialAbilities: ['Battleborn'],
                gear: ['Fine heavy blade', 'Armor'],
            };
        }

        createEmptyConfig(genreKey) {
            return {
                playstyle: 'cyoa_5',
                position: 'Risky',
                effect: 'Standard',
            };
        }

        normalizeProtagonist(protagonist, genreKey, dossier) {
            protagonist.stress = protagonist.stress || { current: 0, max: 9 };
            protagonist.playbook = protagonist.playbook || 'Cutter';
        }

        normalizeMonsters(monsters, genreKey, dossier) {
            if (!Array.isArray(monsters)) return;
            monsters.forEach(m => {
                m.tier = m.tier || 2;
                m.clock = m.clock || '4-segment';
            });
        }

        getDefaultGear() {
            return ['Fine heavy blade', 'Standard heist kit'];
        }

        formatPcBio(p, names) {
            return `Species: Human\nBody: Lean and scarred scoundrel\nWorn Equipment: ${p.gear?.join(', ')}\nPersonality: Cautious\nBackground: Dockside orphan\nHabits & Behaviors: Checks rooftops\nStrengths:\n- Special Ability: Battleborn\nFlaws:\n- Wanted by Bluecoats`;
        }
    }

    // Register with registry
    const mockFitd = new MockFitdAdapter();
    systemRegistry.register(mockFitd);

    assert.ok(systemRegistry.has('fitd'), 'Registry must report fitd is registered');
    assert.equal(systemRegistry.get('fitd').label, 'Forged in the Dark');

    // 1. createEmptyDossier automatically supports the 3rd system!
    const fitdDossier = createEmptyDossier('fitd');
    assert.equal(fitdDossier.meta.ruleset, 'fitd');
    assert.equal(fitdDossier.meta.title, 'Untitled FITD Campaign');
    assert.equal(fitdDossier.protagonist.playbook, 'Cutter');
    assert.equal(fitdDossier.protagonist.stress.max, 9);
    assert.equal(fitdDossier.config.position, 'Risky');

    // 2. healAndNormalizeDossier delegates to the 3rd system!
    const normalized = healAndNormalizeDossier(fitdDossier);
    assert.equal(normalized.meta.ruleset, 'fitd');
    assert.equal(normalized.protagonist.stress.max, 9);
    assert.deepStrictEqual(normalized.protagonist.gear, ['Fine heavy blade', 'Armor']);

    // 3. Card formatting delegates to the 3rd system!
    const bio = mockFitd.formatPcBio(fitdDossier.protagonist);
    assert.match(bio, /Special Ability:\s*Battleborn/i);
    assert.match(bio, /Wanted by Bluecoats/i);
});

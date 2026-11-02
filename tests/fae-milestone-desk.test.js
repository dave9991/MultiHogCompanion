import assert from 'node:assert';
import { test } from 'node:test';
import {
    evaluateLevelUpEligibility,
    formulateLevelUpProposal,
    applyLevelUpCommit,
    buildFaeMilestoneOptions,
    applyFaeMilestoneSelection,
    resolveFaeGenreKey,
    extractConciergeDirectives,
    FAE_MILESTONE_CATALOG,
} from '../level-up-runner.js';
import { FAE_GENRES, isGodTag } from '../fae-ruleset.js';
import { openLevelUpModal, closeLevelUpModal } from '../level-up-ui.js';

const sampleFaeMemo = `[CHARACTER]
Eileen Vance (The Antiquarian): 8/8 HP | Pool: Health (8/8) | Scenes: 4/4 | XP: 4/4
((BAR:purple)) Sanity: 8/8 (Zero Debuff: Manic Dissociation | Recovery: haven_or_specialist)
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Ex-Military (Combat training and discipline), Service Revolver (Reliable sidearm with heavy stopping power)
((PILLS)) Scars & Debuffs: (-) Splintered Ribs (Bruised chest from brute impact)
Status: (-) Strained & Injured
[/CHARACTER]
[SCENE]
Current Location: The Whispering Study
Threat Level: 3 (Elite)
[/SCENE]`;

test('FAE Milestone Desk: evaluateLevelUpEligibility detects FAE memos and evaluates pacing', () => {
    // 1. Fully eligible FAE memo (Scenes: 4/4)
    const eligibleRes = evaluateLevelUpEligibility(sampleFaeMemo);
    assert.strictEqual(eligibleRes.eligible, true, 'Scenes 4/4 should be eligible for milestone');
    assert.strictEqual(eligibleRes.ruleset, 'fae');
    assert.strictEqual(eligibleRes.currentXp, 4);
    assert.strictEqual(eligibleRes.maxThreshold, 4);
    assert.strictEqual(eligibleRes.surplusXp, 0);

    // 2. Ineligible FAE memo (Scenes: 2/4)
    const underMemo = sampleFaeMemo.replace('Scenes: 4/4 | XP: 4/4', 'Scenes: 2/4 | XP: 2/4');
    const underRes = evaluateLevelUpEligibility(underMemo);
    assert.strictEqual(underRes.eligible, false, 'Scenes 2/4 should not be eligible');
    assert.strictEqual(underRes.ruleset, 'fae');
    assert.strictEqual(underRes.currentXp, 2);
    assert.strictEqual(underRes.maxThreshold, 4);

    // 3. Surplus scenes (Scenes: 6/4)
    const overMemo = sampleFaeMemo.replace('Scenes: 4/4 | XP: 4/4', 'Scenes: 6/4 | XP: 6/4');
    const overRes = evaluateLevelUpEligibility(overMemo);
    assert.strictEqual(overRes.eligible, true);
    assert.strictEqual(overRes.ruleset, 'fae');
    assert.strictEqual(overRes.currentXp, 6);
    assert.strictEqual(overRes.surplusXp, 2);

    // 4. Custom pacingScenes via options or memo denominator
    const memoWith5 = sampleFaeMemo.replace('Scenes: 4/4 | XP: 4/4', 'Scenes: 4/5 | XP: 4/5');
    const customRes = evaluateLevelUpEligibility(memoWith5);
    assert.strictEqual(customRes.eligible, false, 'Scenes 4/5 should not be eligible when target is 5');
    assert.strictEqual(customRes.maxThreshold, 5);

    // 4b. Fallback max when memo has no denominator
    const memoNoDenom = `[CHARACTER]
Roland (Gunslinger): 9/9 HP | Pool: Grit (9/9) | Scenes: 4
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Quick Draw (Fast reflex)
[/CHARACTER]`;
    const fallbackRes = evaluateLevelUpEligibility(memoNoDenom, 'fae', { pacingScenes: 5 });
    assert.strictEqual(fallbackRes.eligible, false);
    assert.strictEqual(fallbackRes.maxThreshold, 5);

    const fallbackEligible = evaluateLevelUpEligibility(memoNoDenom, 'fae', { pacingScenes: 4 });
    assert.strictEqual(fallbackEligible.eligible, true);
    assert.strictEqual(fallbackEligible.maxThreshold, 4);

    // 5. Fallback XP: X/Y line in FAE memo
    const xpOnlyMemo = `[CHARACTER]
Roland (Gunslinger): 9/9 HP | Pool: Grit (9/9) | XP: 4/4
FAE Knobs: Flee Grace: ON | Shift: +0 | Overflow: scar_and_ko
((PILLS)) Positive Tags: Quick Draw (Fast holster reflex)
[/CHARACTER]`;
    const xpRes = evaluateLevelUpEligibility(xpOnlyMemo);
    assert.strictEqual(xpRes.eligible, true);
    assert.strictEqual(xpRes.ruleset, 'fae');
    assert.strictEqual(xpRes.currentXp, 4);

    // 6. Non-FAE memos are not misidentified
    const dndMemo = `[CHARACTER]\nThorin: 25/25 HP\nLevel: 3\n[/CHARACTER]\n[XP]\nTotal: 1,200 / 2,700 XP (Level 3)\n[/XP]`;
    assert.strictEqual(evaluateLevelUpEligibility(dndMemo).ruleset, 'dnd5e');

    const pbtaMemo = `[CHARACTER]\nAelion: 4/4 HP | Harm: 0/4\nXP: 3/5\n[/CHARACTER]`;
    assert.strictEqual(evaluateLevelUpEligibility(pbtaMemo).ruleset, 'pbta');
});

test('FAE Milestone Desk: resolveFaeGenreKey resolves genre accurately from multiple vectors', () => {
    // 1. Direct meta.systemKey match
    assert.strictEqual(resolveFaeGenreKey({ meta: { systemKey: 'cyberpunk_noir' } }), 'cyberpunk_noir');
    assert.strictEqual(resolveFaeGenreKey({ meta: { systemKey: 'osr_dungeon' } }), 'osr_dungeon');

    // 2. Direct meta.genre match
    assert.strictEqual(resolveFaeGenreKey({ meta: { genre: 'survival_horror' } }), 'survival_horror');

    // 3. systemLabel heuristic
    assert.strictEqual(resolveFaeGenreKey({ meta: { systemLabel: 'Weird West Gunsmoke & Sorcery' } }), 'weird_west');
    assert.strictEqual(resolveFaeGenreKey({ meta: { systemLabel: 'Deep Space Derelict Isolation' } }), 'deep_space');
    assert.strictEqual(resolveFaeGenreKey({ meta: { systemLabel: 'Post-Apocalyptic Wasteland' } }), 'post_apocalyptic');

    // 4. Protagonist pools inspection
    const cosmicDossier = { protagonist: { pools: { sanity: { label: 'Sanity', max: 8 } } } };
    assert.strictEqual(resolveFaeGenreKey(cosmicDossier), 'cosmic_horror');

    const osrDossier = { protagonist: { pools: { torch_and_supplies: { label: 'Torches', max: 6 } } } };
    assert.strictEqual(resolveFaeGenreKey(osrDossier), 'osr_dungeon');

    // 5. Memo text pool inspection fallback
    assert.strictEqual(resolveFaeGenreKey(null, '((BAR:purple)) Sanity: 8/8'), 'cosmic_horror');
    assert.strictEqual(resolveFaeGenreKey(null, '((BAR:amber)) Torches & Supplies: 5/6'), 'osr_dungeon');
    assert.strictEqual(resolveFaeGenreKey(null, '((BAR:blue)) Oxygen & Power: 8/8'), 'deep_space');

    // 6. Global default
    assert.strictEqual(resolveFaeGenreKey({}), 'cosmic_horror');
});

test('FAE Milestone Desk: formulateLevelUpProposal constructs full structured FAE proposal', () => {
    const dossier = {
        meta: { systemKey: 'cosmic_horror', ruleset: 'fae' },
        config: { pacingScenes: 4 },
        protagonist: {
            name: 'Eileen Vance',
            archetype: 'The Antiquarian',
            pools: {
                health: { label: 'Health', current: 8, max: 8, barColor: 'green', zero_debuff: 'Crippled', recovery: 'camp' },
                sanity: { label: 'Sanity', current: 7, max: 8, barColor: 'purple', zero_debuff: 'Manic', recovery: 'haven' },
            },
            knobs: { flee_grace_toggle: true, base_attrition_shift: 0, overflow_default: 'scar_and_ko' },
            positiveTags: ['Ex-Military (Combat training)'],
            negativeTags: ['Splintered Ribs (Bruised)'],
        },
    };

    const proposal = formulateLevelUpProposal(dossier, null, null, {
        isRespec: false,
        currentMemo: sampleFaeMemo,
    });

    assert.strictEqual(proposal.isFae, true, 'Proposal must be flagged as FAE');
    assert.strictEqual(proposal.isPbta, false, 'Proposal must NOT be flagged as PbtA');
    assert.strictEqual(proposal.characterName, 'Eileen Vance');
    assert.strictEqual(proposal.className, 'The Antiquarian');
    assert.strictEqual(proposal.genreKey, 'cosmic_horror');
    assert.strictEqual(proposal.pacingScenes, 4);

    // Verify pools
    assert.ok(proposal.pools.health, 'Must contain health pool');
    assert.ok(proposal.pools.sanity, 'Must contain sanity pool');
    assert.strictEqual(proposal.pools.health.current, 8);
    assert.strictEqual(proposal.pools.health.max, 8);

    // Verify knobs
    assert.strictEqual(proposal.knobs.flee_grace_toggle, true);
    assert.strictEqual(proposal.knobs.base_attrition_shift, 0);
    assert.strictEqual(proposal.knobs.overflow_default, 'scar_and_ko');

    // Verify tags
    assert.ok(proposal.positiveTags.length >= 2, 'Should have parsed positive tags from memo');
    assert.ok(proposal.negativeTags.length >= 1, 'Should have parsed scars from memo');

    // Verify milestone options
    assert.ok(Array.isArray(proposal.milestoneOptions));
    assert.strictEqual(proposal.milestoneOptions.length, 3);
    const ids = proposal.milestoneOptions.map(o => o.id);
    assert.deepStrictEqual(ids, ['heal_scar', 'new_capability', 'hardened_reserve']);

    // Ensure zero D&D artifacts
    assert.strictEqual(proposal.hitDie, null, 'Must NOT have Hit Die in FAE');
    assert.strictEqual(proposal.currentLevel, null, 'Must NOT have D&D Level in FAE');
    assert.strictEqual(proposal.targetLevel, null, 'Must NOT have D&D Level in FAE');
});

test('FAE Milestone Desk: applyFaeMilestoneSelection & applyLevelUpCommit for all 3 rewards', () => {
    const dossier = {
        meta: { systemKey: 'cosmic_horror', ruleset: 'fae' },
        protagonist: {
            name: 'Eileen Vance',
            archetype: 'The Antiquarian',
            pools: {
                health: { key: 'health', label: 'Health', current: 8, max: 8, barColor: 'green', zero_debuff: 'Crippled', recovery: 'camp' },
                sanity: { key: 'sanity', label: 'Sanity', current: 8, max: 8, barColor: 'purple', zero_debuff: 'Manic', recovery: 'haven' },
            },
            positiveTags: ['Ex-Military (Combat training)'],
            negativeTags: ['Splintered Ribs (Bruised chest)'],
        },
    };

    // ─────────────────────────────────────────────────────────────
    // Reward 1: heal_scar
    // ─────────────────────────────────────────────────────────────
    const prop1 = formulateLevelUpProposal(dossier, null, null, {
        isRespec: false,
        currentMemo: sampleFaeMemo,
    });
    assert.strictEqual(prop1.negativeTags.length, 1);

    // Apply selection
    applyFaeMilestoneSelection(prop1, {
        type: 'heal_scar',
        scar: 'Splintered Ribs (Bruised chest from brute impact)',
    });
    assert.strictEqual(prop1.negativeTags.length, 0, 'Scar should be removed');
    assert.strictEqual(prop1.faeMilestone.applied, true);

    // Commit to state memo
    const res1 = applyLevelUpCommit({
        chatId: 'fae_chat_1',
        currentMemo: sampleFaeMemo,
        proposal: prop1,
        isRespec: false,
    });
    assert.strictEqual(res1.success, true);
    assert.ok(res1.updatedMemo.includes('((PILLS)) Scars & Debuffs: None'), 'Committed memo must show Scars & Debuffs: None');
    assert.ok(res1.updatedMemo.includes('Scenes: 0/4 | XP: 0/4'), 'Scenes completed must reset to 0/4');
    assert.ok(!res1.updatedMemo.includes('Splintered Ribs'), 'Healed scar must not appear in memo');

    // ─────────────────────────────────────────────────────────────
    // Reward 2: new_capability (with God Tag rejection verification)
    // ─────────────────────────────────────────────────────────────
    const prop2 = formulateLevelUpProposal(dossier, null, null, {
        isRespec: false,
        currentMemo: sampleFaeMemo,
    });

    // 2a. Reject blacklisted God Tag (e.g. "Lucky")
    assert.strictEqual(isGodTag('Lucky'), true);
    applyFaeMilestoneSelection(prop2, {
        type: 'new_capability',
        tag: 'Lucky (Always favored by fate)',
    });
    assert.strictEqual(prop2.faeMilestone.rejected, true);
    assert.strictEqual(prop2.positiveTags.some(t => /Lucky/i.test(t)), false, 'God tag must NOT be added');

    // 2b. Accept valid specific capability tag
    applyFaeMilestoneSelection(prop2, {
        type: 'new_capability',
        tag: 'Occult Cryptography (Decipher ancient cosmic ciphers and sigils)',
    });
    assert.strictEqual(prop2.faeMilestone.applied, true);
    assert.ok(prop2.positiveTags.some(t => t.includes('Occult Cryptography')));

    // Commit to state memo
    const res2 = applyLevelUpCommit({
        chatId: 'fae_chat_2',
        currentMemo: sampleFaeMemo,
        proposal: prop2,
        isRespec: false,
    });
    assert.strictEqual(res2.success, true);
    assert.ok(res2.updatedMemo.includes('Occult Cryptography'), 'New positive tag must appear in memo');
    assert.ok(!res2.updatedMemo.includes('Lucky'), 'God tag must never appear in memo');
    assert.ok(res2.updatedMemo.includes('Scenes: 0/4 | XP: 0/4'), 'Scenes completed must reset to 0/4');

    // ─────────────────────────────────────────────────────────────
    // Reward 3: hardened_reserve
    // ─────────────────────────────────────────────────────────────
    // 3a. Primary pool (Health 8/8 -> 9/9)
    const prop3a = formulateLevelUpProposal(dossier, null, null, {
        isRespec: false,
        currentMemo: sampleFaeMemo,
    });
    applyFaeMilestoneSelection(prop3a, {
        type: 'hardened_reserve',
        pool: 'health',
    });
    assert.strictEqual(prop3a.pools.health.max, 9);
    assert.strictEqual(prop3a.pools.health.current, 9);

    const res3a = applyLevelUpCommit({
        chatId: 'fae_chat_3a',
        currentMemo: sampleFaeMemo,
        proposal: prop3a,
        isRespec: false,
    });
    assert.strictEqual(res3a.success, true);
    assert.ok(res3a.updatedMemo.includes('9/9 HP | Pool: Health (9/9)'), 'Primary pool max must increase to 9/9 HP');
    assert.ok(res3a.updatedMemo.includes('Scenes: 0/4 | XP: 0/4'), 'Scenes must reset to 0/4');

    // 3b. Secondary pool (Sanity 8/8 -> 9/9)
    const prop3b = formulateLevelUpProposal(dossier, null, null, {
        isRespec: false,
        currentMemo: sampleFaeMemo,
    });
    applyFaeMilestoneSelection(prop3b, {
        type: 'hardened_reserve',
        pool: 'sanity',
    });
    assert.strictEqual(prop3b.pools.sanity.max, 9);
    assert.strictEqual(prop3b.pools.sanity.current, 9);

    const res3b = applyLevelUpCommit({
        chatId: 'fae_chat_3b',
        currentMemo: sampleFaeMemo,
        proposal: prop3b,
        isRespec: false,
    });
    assert.strictEqual(res3b.success, true);
    assert.ok(res3b.updatedMemo.includes('((BARPURPLE)) Sanity: 9/9'), 'Secondary pool Sanity must increase to 9/9');
    assert.ok(res3b.updatedMemo.includes('Scenes: 0/4 | XP: 0/4'), 'Scenes must reset to 0/4');

    // 3c. Cap enforcement at 12
    prop3b.pools.sanity.max = 12;
    prop3b.pools.sanity.current = 12;
    prop3b.faeMilestone = null;
    applyFaeMilestoneSelection(prop3b, {
        type: 'hardened_reserve',
        pool: 'sanity',
    });
    assert.strictEqual(prop3b.pools.sanity.max, 12, 'Pool capacity must not exceed 12 cap');
});

test('FAE Milestone Desk: extractConciergeDirectives extracts all FAE directives', () => {
    const rawReply = `I have updated your character's reserves and capabilities based on your investigation.

[ADD_TAG: Cryptography (Decipher cult ciphers and warding runes)]
[REMOVE_TAG: Outdated Map]
[ADD_SCAR: (-) Broken Arm (Severe compound fracture)]
[REMOVE_SCAR: Splintered Ribs]
[SET_POOL: sanity | 7/9]
[SET_KNOB: flee_grace | OFF]
[SET_KNOB: shift | +1]
[SET_KNOB: overflow | lethal]

Your mind remains steady, though your arm will require splinting before continuing into the ruins.`;

    const { directives, cleanedText } = extractConciergeDirectives(rawReply);

    assert.strictEqual(directives.length, 8);
    const tags = directives.map(d => d.tag);
    assert.deepStrictEqual(tags, [
        'ADD_TAG',
        'REMOVE_TAG',
        'ADD_SCAR',
        'REMOVE_SCAR',
        'SET_POOL',
        'SET_KNOB',
        'SET_KNOB',
        'SET_KNOB',
    ]);

    assert.strictEqual(directives[0].payload, 'Cryptography (Decipher cult ciphers and warding runes)');
    assert.strictEqual(directives[1].payload, 'Outdated Map');
    assert.strictEqual(directives[2].payload, '(-) Broken Arm (Severe compound fracture)');
    assert.strictEqual(directives[3].payload, 'Splintered Ribs');
    assert.strictEqual(directives[4].payload, 'sanity | 7/9');
    assert.strictEqual(directives[5].payload, 'flee_grace | OFF');
    assert.strictEqual(directives[6].payload, 'shift | +1');
    assert.strictEqual(directives[7].payload, 'overflow | lethal');

    assert.ok(!cleanedText.includes('[ADD_TAG:'), 'Directives must be stripped from cleaned text');
    assert.ok(cleanedText.includes('Your mind remains steady'), 'Narrative body must be preserved');
});

test('FAE Milestone Desk: openLevelUpModal isolates FAE interface with Stage 2 and Tuning Cards', () => {
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
                    if (sel === '#mhc-stage2-close-btn' || sel === '#mhc-confirm-apply-btn') {
                        return { addEventListener: () => {} };
                    }
                    if (sel === '#mhc-stage-definition') return { style: { display: 'none' } };
                    if (sel === '#mhc-stage-advancement') return { style: { display: 'flex' } };
                    if (sel === '#mhc-fae-pos-tags-list') {
                        return {
                            set innerHTML(val) { el._posTagsHtml = val; },
                            get innerHTML() { return el._posTagsHtml || ''; },
                            querySelectorAll: () => [],
                        };
                    }
                    if (sel === '#mhc-fae-neg-tags-list') {
                        return {
                            set innerHTML(val) { el._negTagsHtml = val; },
                            get innerHTML() { return el._negTagsHtml || ''; },
                            querySelectorAll: () => [],
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
        const faeDossier = {
            meta: { systemKey: 'cosmic_horror', ruleset: 'fae' },
            protagonist: {
                name: 'Eileen Vance',
                archetype: 'The Antiquarian',
                pools: {
                    health: { key: 'health', label: 'Health', current: 8, max: 8, barColor: 'green', zero_debuff: 'Crippled', recovery: 'camp' },
                },
            },
        };

        const mockSettings = { currentMemo: sampleFaeMemo };

        openLevelUpModal({
            chatId: 'fae_modal_chat',
            dossier: faeDossier,
            blueprint: null,
            targetLevel: null,
            isRespec: false,
            rpgSettings: mockSettings,
        });

        assert.ok(mountedModal, 'Modal must be mounted');
        const html = mountedModal.innerHTML;

        // Verify FAE Header & Badges
        assert.ok(html.includes('FAE Milestone Reward Desk'), 'Title must be FAE Milestone Reward Desk');
        assert.ok(html.includes('Genre: cosmic_horror'), 'Must display Genre subbadge');
        assert.ok(html.includes('Health: 8/8'), 'Must display primary pool badge');

        // Verify D&D Stage 1 switch button is suppressed
        assert.ok(!html.includes('mhc-btn-stage-switch'), 'FAE must never render Stage 1 switch button');

        // Verify FAE Milestone Picker & Tuning Cards
        assert.ok(html.includes('mhc-fae-milestone-picker-card'), 'Must render FAE Milestone Picker');
        assert.ok(html.includes('mhc-fae-pools-card'), 'Must render FAE Attrition Resource Pools Card');
        assert.ok(html.includes('mhc-fae-knobs-card'), 'Must render FAE Knobs Card');
        assert.ok(html.includes('mhc-fae-pos-tags-card'), 'Must render FAE Positive Tags Card');
        assert.ok(html.includes('mhc-fae-neg-tags-card'), 'Must render FAE Scars Card');

        closeLevelUpModal();
    } finally {
        globalThis.document = prevDoc;
    }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    DND_SUBFOOTER_OVERRIDE_ID,
    getDndAlignedFooterContent,
    getDndAlignedCyoaPrompt,
    isDndSubfooterAlignmentApplied,
    applyDndSubfooterAlignment,
    revertDndSubfooterAlignment,
} from '../dnd-fixes.js';
import {
    buildPbtAFooterContent,
    buildPbtACyoaPrompt,
} from '../pbta-ruleset.js';

test('D&D 5e & PbtA Unified Subfooter Alignment Protocol', async (t) => {
    await t.test('1. getDndAlignedFooterContent matches contract and contains zero prompt leakage', () => {
        const footer = getDndAlignedFooterContent();

        // Must match parent terminal contract
        assert.ok(footer.includes('ALWAYS end every narrative output with:'), 'Footer must contain standard anchor');
        assert.ok(
            footer.includes('(followed only by any active subfooters explicitly defined elsewhere in your instructions)'),
            'Footer must explicitly permit trailing subfooters'
        );
        assert.ok(footer.includes('*(Status: [HP]) | (XP: [current]/[next level]) | (Location: [Main, Sub, Sub-sub, etc])*'));

        // Zero prompt leakage when CYOA is off: NO mention of CYOA or choices
        assert.ok(!/cyoa/i.test(footer), 'Footer must never mention CYOA to prevent prompt leakage');
        assert.ok(!/choice/i.test(footer), 'Footer must never mention choices to prevent prompt leakage');
        assert.ok(!/button/i.test(footer), 'Footer must never mention buttons');

        // Time format support
        const footer24h = getDndAlignedFooterContent({ use24hTime: true });
        assert.ok(footer24h.includes('(24-hour clock, NO AM/PM)'));

        const footerDdMm = getDndAlignedFooterContent({ useDdMmYyFormat: true });
        assert.ok(footerDdMm.includes('[DD/MM/YYYY]'));
    });

    await t.test('2. getDndAlignedCyoaPrompt designates itself as subfooter and defines strict sequence', () => {
        const cyoa = getDndAlignedCyoaPrompt(5);

        assert.ok(cyoa.includes('[SUBFOOTER: INTERACTIVE CHOICES]'), 'CYOA must declare itself as subfooter');
        assert.ok(
            cyoa.includes('Immediately following the status footer, append exactly 5 choices for the user'),
            'Must command placement immediately after status footer'
        );
        assert.ok(
            cyoa.includes('Output sequence: (1) Scene narrative -> (2) Status footer -> (3) <choices> subfooter'),
            'Must establish unambiguous 1 -> 2 -> 3 generation sequence'
        );
        assert.ok(
            cyoa.includes('The <choices> block in (3) must immediately follow the status footer in (2) with NO story narration placed after them'),
            'Must prohibit post-choice narrative leakage'
        );

        // 3-choice count test
        const cyoa3 = getDndAlignedCyoaPrompt(3);
        assert.ok(cyoa3.includes('append exactly 3 choices'));
        assert.ok(cyoa3.includes('3. NARRATIVE-DECIDED'));
        assert.ok(!cyoa3.includes('4. NARRATIVE-DECIDED'));
    });

    await t.test('3. applyDndSubfooterAlignment populates native MultiHog settings cleanly', async () => {
        const mockRpgSettings = {
            customSyspromptLibrary: [
                { id: 'custom_lore_snippet', label: 'Custom Lore', content: 'Some lore' },
            ],
            cyoaConfig: {
                useCustomPrompt: false,
                customPromptText: '',
                slots: [{}, {}, {}, {}, {}],
            },
        };

        assert.strictEqual(isDndSubfooterAlignmentApplied(mockRpgSettings), false);

        const ok = await applyDndSubfooterAlignment({ rpgSettings: mockRpgSettings });
        assert.strictEqual(ok, true);
        assert.strictEqual(isDndSubfooterAlignmentApplied(mockRpgSettings), true);

        // Unrelated snippets preserved
        assert.ok(mockRpgSettings.customSyspromptLibrary.some(item => item.id === 'custom_lore_snippet'));

        // Footer override properly formatted
        const footerSnippet = mockRpgSettings.customSyspromptLibrary.find(item => item.id === DND_SUBFOOTER_OVERRIDE_ID);
        assert.ok(footerSnippet);
        assert.strictEqual(footerSnippet.origin, 'unlocked_base');
        assert.strictEqual(footerSnippet.baseTag, 'end_of_output_footer');
        assert.strictEqual(footerSnippet.enabled, true);
        assert.ok(footerSnippet.content.includes('(followed only by any active subfooters'));

        // CYOA properly formatted
        assert.strictEqual(mockRpgSettings.cyoaConfig.useCustomPrompt, true);
        assert.ok(mockRpgSettings.cyoaConfig.customPromptText.includes('[SUBFOOTER: INTERACTIVE CHOICES]'));
    });

    await t.test('4. revertDndSubfooterAlignment restores stock factory settings cleanly', async () => {
        const mockRpgSettings = {
            customSyspromptLibrary: [
                { id: 'custom_lore_snippet', label: 'Custom Lore', content: 'Some lore' },
                { id: DND_SUBFOOTER_OVERRIDE_ID, baseTag: 'end_of_output_footer', origin: 'unlocked_base' },
            ],
            cyoaConfig: {
                useCustomPrompt: true,
                customPromptText: getDndAlignedCyoaPrompt(5),
            },
        };

        assert.strictEqual(isDndSubfooterAlignmentApplied(mockRpgSettings), true);

        const ok = await revertDndSubfooterAlignment({ rpgSettings: mockRpgSettings });
        assert.strictEqual(ok, true);
        assert.strictEqual(isDndSubfooterAlignmentApplied(mockRpgSettings), false);

        // Subfooter override removed, other snippets preserved
        assert.ok(mockRpgSettings.customSyspromptLibrary.some(item => item.id === 'custom_lore_snippet'));
        assert.ok(!mockRpgSettings.customSyspromptLibrary.some(item => item.id === DND_SUBFOOTER_OVERRIDE_ID));

        // CYOA custom prompt deactivated
        assert.strictEqual(mockRpgSettings.cyoaConfig.useCustomPrompt, false);
        assert.strictEqual(mockRpgSettings.cyoaConfig.customPromptText, '');
    });

    await t.test('5. PbtA unified subfooter alignment verification', () => {
        const pbtaFooter = buildPbtAFooterContent(5, 5);
        assert.ok(
            pbtaFooter.includes('(followed only by any active subfooters explicitly defined elsewhere in your instructions)'),
            'PbtA footer must permit subfooters'
        );
        assert.ok(!/cyoa/i.test(pbtaFooter), 'PbtA footer must never mention CYOA');
        assert.ok(!/choice/i.test(pbtaFooter), 'PbtA footer must never mention choices');

        const pbtaCyoa = buildPbtACyoaPrompt('fantasy', { playstyle: 'cyoa_5' });
        assert.ok(pbtaCyoa.includes('[SUBFOOTER: INTERACTIVE CHOICE BUTTONS]'), 'PbtA CYOA must declare itself as subfooter');
        assert.ok(
            pbtaCyoa.includes('The <choices> block in (3) is the final subfooter and must immediately follow the status footer in (2)'),
            'PbtA CYOA must define the final subfooter sequence'
        );
    });
});

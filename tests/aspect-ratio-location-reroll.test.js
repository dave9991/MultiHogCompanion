import test from 'node:test';
import assert from 'node:assert';
import {
    markLocationRerollActive,
    clearActiveLocationReroll,
    isLocationRerollActive,
    getActiveCampaignLocation,
    isSceneGenerationRequest,
    wrapImagineCommand,
} from '../aspect-ratio-bridge.js';

test('Smart Aspect-Ratio & Crop Bridge — Location Reroll Interception', async (t) => {
    t.afterEach(() => {
        clearActiveLocationReroll();
    });

    await t.test('1. markLocationRerollActive and isLocationRerollActive manage TTL accurately', () => {
        clearActiveLocationReroll();
        assert.strictEqual(isLocationRerollActive(), false, 'Initially inactive');

        markLocationRerollActive('Condemned Slaughterhouse', 5000);
        assert.strictEqual(isLocationRerollActive(), true, 'Active immediately after marking');

        // Test expired TTL
        markLocationRerollActive('Condemned Slaughterhouse', -10);
        assert.strictEqual(isLocationRerollActive(), false, 'Expired reroll should be inactive');

        clearActiveLocationReroll();
        assert.strictEqual(isLocationRerollActive(), false, 'Cleared reroll should be inactive');
    });

    await t.test('2. getActiveCampaignLocation resolves location from active reroll or memo', () => {
        clearActiveLocationReroll();

        // From active reroll
        markLocationRerollActive('City :: Abandoned Factory');
        assert.strictEqual(getActiveCampaignLocation(), 'City :: Abandoned Factory');

        clearActiveLocationReroll();

        // From mock memo [LOCATION] block
        const mockCtxBlock = {
            extensionSettings: {
                rpg_tracker: {
                    currentMemo: '[LOCATION]\nCondemned Slaughterhouse\n[/LOCATION]\n[CHARACTER]\nEdmund: 10/10 HP\n[/CHARACTER]',
                },
            },
        };
        assert.strictEqual(getActiveCampaignLocation(mockCtxBlock), 'Condemned Slaughterhouse');

        // From mock memo inline Location:
        const mockCtxInline = {
            extensionSettings: {
                rpg_tracker: {
                    currentMemo: '*(Harm: 1/5) | (Location: Rusty Anchor Tavern)*',
                },
            },
        };
        assert.strictEqual(getActiveCampaignLocation(mockCtxInline), 'Rusty Anchor Tavern');
    });

    await t.test('3. isSceneGenerationRequest catches location rerolls without relying on "wide shot" keywords', () => {
        clearActiveLocationReroll();

        // Case A: Typical interior location prompt lacking any wide/landscape keywords
        const interiorPrompt = 'Derelict meat locker, rusted iron hooks dangling from ceiling rails, cracked blood-stained concrete, dim overhead mercury lamps, volumetric dust, atmospheric horror, cinematic lighting, photorealistic';

        // Without reroll state and without active location, interior prompt does not trigger scene
        assert.strictEqual(isSceneGenerationRequest(interiorPrompt), false);

        // Arm location reroll (simulating clicking "AI Generate" on "Set Location Image" modal)
        markLocationRerollActive('Condemned Slaughterhouse');
        assert.strictEqual(isSceneGenerationRequest(interiorPrompt), true, 'Must detect as scene when location reroll is active');

        clearActiveLocationReroll();

        // Case B: Active location name mentioned in prompt
        const mockCtx = {
            extensionSettings: {
                rpg_tracker: {
                    currentMemo: '[LOCATION]\nCondemned Slaughterhouse\n[/LOCATION]',
                },
            },
        };
        const promptWithLocation = 'Condemned slaughterhouse, rusted meat hooks, eerie silence, moody darkness';
        assert.strictEqual(isSceneGenerationRequest(promptWithLocation, mockCtx), true, 'Must detect as scene when prompt targets active campaign location');

        // Case C: Standard keyword heuristics still work
        assert.strictEqual(isSceneGenerationRequest('Mountain pass, winding stone trail, landscape, cinematic wide shot'), true);
        assert.strictEqual(isSceneGenerationRequest('Futuristic cityscape, establishing shot, neon skyscrapers'), true);

        // Case D: Character/NPC portrait prompt does NOT falsely match as scene
        const npcPrompt = 'Close-up portrait of Lyle Holloway, weathered detective, scarred jawline, stern gaze, woolen overcoat, dramatic portrait lighting, 8k';
        assert.strictEqual(isSceneGenerationRequest(npcPrompt, mockCtx), false, 'Character/NPC portrait must not be classified as scene');
    });

    await t.test('4. wrapImagineCommand wraps /imagine and injects 16:9 for rerolled locations', async () => {
        clearActiveLocationReroll();

        let executedArgs = null;
        const mockImagineCmd = {
            callback: async (args, trigger) => {
                executedArgs = { ...args };
                return 'http://example.com/generated.png';
            },
        };

        const mockCtx = {
            extensionSettings: {
                rpg_tracker: {
                    currentMemo: '[LOCATION]\nCondemned Slaughterhouse\n[/LOCATION]',
                },
            },
        };

        const getSettings = () => ({
            enableAspectRatioBridge: true,
            sceneWidth: 672,
            sceneHeight: 384,
            portraitWidth: 512,
            portraitHeight: 512,
        });

        wrapImagineCommand(mockImagineCmd, getSettings, mockCtx);

        // 1. NPC Portrait generation via MultiHog signature (quiet=true, gallery=false, extend=false)
        const portraitArgs = { quiet: 'true', gallery: 'false', extend: 'false' };
        await mockImagineCmd.callback(portraitArgs, 'Close-up portrait of Lyle Holloway, detective, fedora');
        assert.strictEqual(executedArgs.width, 512, 'NPC portrait must receive 1:1 square width (512)');
        assert.strictEqual(executedArgs.height, 512, 'NPC portrait must receive 1:1 square height (512)');

        // 2. Location reroll via MultiHog modal (arm reroll)
        markLocationRerollActive('Condemned Slaughterhouse');
        const rerollArgs = { quiet: 'true', gallery: 'false', extend: 'false' };
        const interiorRerollPrompt = 'Condemned slaughterhouse interior, rusted meat hooks, blood-stained concrete, eerie lighting';
        await mockImagineCmd.callback(rerollArgs, interiorRerollPrompt);
        assert.strictEqual(executedArgs.width, 672, 'Location reroll must receive 16:9 wide width (672)');
        assert.strictEqual(executedArgs.height, 384, 'Location reroll must receive 16:9 wide height (384)');

        // 3. User override preserved
        const explicitArgs = { quiet: 'true', gallery: 'false', extend: 'false', width: 1024, height: 1024 };
        await mockImagineCmd.callback(explicitArgs, interiorRerollPrompt);
        assert.strictEqual(executedArgs.width, 1024, 'Explicit user width override must be preserved');
        assert.strictEqual(executedArgs.height, 1024, 'Explicit user height override must be preserved');
    });
});

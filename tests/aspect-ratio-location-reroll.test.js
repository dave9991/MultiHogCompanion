import test from 'node:test';
import assert from 'node:assert';
import {
    markLocationRerollActive,
    clearActiveLocationReroll,
    isLocationRerollActive,
    getActiveCampaignLocation,
    isSceneGenerationRequest,
    wrapImagineCommand,
    setActiveImagineChatId,
    resetImagineQueue,
} from '../aspect-ratio-bridge.js';

test('Smart Aspect-Ratio & Crop Bridge — Location Reroll Interception & Concurrency Mutex', async (t) => {
    t.afterEach(() => {
        clearActiveLocationReroll();
        resetImagineQueue();
        setActiveImagineChatId(null);
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

    await t.test('3. getActiveCampaignLocation resolves location from D&D 5e recent chat message footers', () => {
        clearActiveLocationReroll();

        // D&D 5e campaigns do not store [LOCATION] in currentMemo.
        // Instead, MultiHog appends footers like *(Location: ...)* or (Location: ...) to narrator messages.
        const mockDndCtx = {
            chat: [
                { mes: 'You begin your journey in Waterdeep.' },
                { mes: 'The rain beats down upon the cobblestones.\n\n*(Location: Condemned Slaughterhouse)*' },
            ],
            extensionSettings: {
                rpg_tracker: {
                    currentMemo: '[PARTY]\nLyle: 20/20 HP\nEli: 18/18 HP\n[/PARTY]',
                },
            },
        };

        const resolved = getActiveCampaignLocation(mockDndCtx);
        assert.strictEqual(resolved, 'Condemned Slaughterhouse', 'Must resolve location from chat message footer');

        // Verify with hierarchy
        const mockDndHierarchyCtx = {
            chat: [
                { mes: 'A mysterious patron gestures from the corner.\n\n(Location: Neverwinter :: The Moonstone Mask)' },
            ],
            extensionSettings: { rpg_tracker: { currentMemo: '' } },
        };
        assert.strictEqual(getActiveCampaignLocation(mockDndHierarchyCtx), 'Neverwinter :: The Moonstone Mask');
    });

    await t.test('4. isSceneGenerationRequest catches location rerolls and auto-locations without relying on "wide shot" keywords', () => {
        clearActiveLocationReroll();

        // Case A: Typical interior location prompt lacking any wide/landscape keywords
        const interiorPrompt = 'Derelict meat locker, rusted iron hooks dangling from ceiling rails, cracked blood-stained concrete, dim overhead mercury lamps, volumetric dust, atmospheric horror, cinematic lighting, photorealistic';

        // Without reroll state and without active location, interior prompt does not trigger scene
        assert.strictEqual(isSceneGenerationRequest(interiorPrompt), false);

        // Arm location reroll (simulating clicking "AI Generate" on "Set Location Image" modal)
        markLocationRerollActive('Condemned Slaughterhouse');
        assert.strictEqual(isSceneGenerationRequest(interiorPrompt), true, 'Must detect as scene when location reroll is active');

        clearActiveLocationReroll();

        // Case B: Active location name mentioned in prompt via D&D 5e chat footer
        const mockDndCtx = {
            chat: [
                { mes: 'You step inside the abandoned facility.\n\n*(Location: Condemned Slaughterhouse)*' },
            ],
            extensionSettings: { rpg_tracker: { currentMemo: '' } },
        };
        const promptWithLocation = 'Condemned slaughterhouse, rusted meat hooks, eerie silence, moody darkness';
        assert.strictEqual(isSceneGenerationRequest(promptWithLocation, mockDndCtx), true, 'Must detect as scene when prompt targets D&D 5e active location');

        // Case C: Standard keyword heuristics still work
        assert.strictEqual(isSceneGenerationRequest('Mountain pass, winding stone trail, landscape, cinematic wide shot'), true);
        assert.strictEqual(isSceneGenerationRequest('Futuristic cityscape, establishing shot, neon skyscrapers'), true);

        // Case D: Character/NPC portrait prompt does NOT falsely match as scene
        const npcPrompt = 'Close-up portrait of Lyle Holloway, weathered detective, scarred jawline, stern gaze, woolen overcoat, dramatic portrait lighting, 8k';
        assert.strictEqual(isSceneGenerationRequest(npcPrompt, mockDndCtx), false, 'Character/NPC portrait must not be classified as scene');
    });

    await t.test('5. wrapImagineCommand injects 16:9 and faces=false for scenes', async () => {
        clearActiveLocationReroll();

        let executedArgs = null;
        const mockImagineCmd = {
            callback: async (args) => {
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

        // 1. NPC Portrait generation via MultiHog signature
        const portraitArgs = { quiet: 'true', gallery: 'false', extend: 'false' };
        await mockImagineCmd.callback(portraitArgs, 'Close-up portrait of Lyle Holloway, detective, fedora');
        assert.strictEqual(executedArgs.width, 512, 'NPC portrait must receive 1:1 square width (512)');
        assert.strictEqual(executedArgs.height, 512, 'NPC portrait must receive 1:1 square height (512)');

        // 2. Location reroll via MultiHog modal
        markLocationRerollActive('Condemned Slaughterhouse');
        const rerollArgs = { quiet: 'true', gallery: 'false', extend: 'false' };
        const interiorRerollPrompt = 'Condemned slaughterhouse interior, rusted meat hooks, blood-stained concrete, eerie lighting';
        await mockImagineCmd.callback(rerollArgs, interiorRerollPrompt);
        assert.strictEqual(executedArgs.width, 672, 'Location reroll must receive 16:9 wide width (672)');
        assert.strictEqual(executedArgs.height, 384, 'Location reroll must receive 16:9 wide height (384)');
        assert.strictEqual(executedArgs.faces, false, 'Scene must explicitly set faces=false to prevent 1.5x face height multiplier');

        // 3. User override preserved
        const explicitArgs = { quiet: 'true', gallery: 'false', extend: 'false', width: 1024, height: 1024 };
        await mockImagineCmd.callback(explicitArgs, interiorRerollPrompt);
        assert.strictEqual(executedArgs.width, 1024, 'Explicit user width override must be preserved');
        assert.strictEqual(executedArgs.height, 1024, 'Explicit user height override must be preserved');
    });

    await t.test('6. Sequential FIFO Mutex Queue serializes concurrent /imagine executions', async () => {
        resetImagineQueue();

        const executionLog = [];
        let runningCount = 0;
        let maxConcurrent = 0;

        const mockImagineCmd = {
            callback: async (args, trigger) => {
                runningCount++;
                maxConcurrent = Math.max(maxConcurrent, runningCount);
                executionLog.push(`start:${trigger}`);
                // Simulate async generation delay (e.g. ComfyUI)
                await new Promise((resolve) => setTimeout(resolve, 25));
                runningCount--;
                executionLog.push(`end:${trigger}`);
                return `http://example.com/${trigger}.png`;
            },
        };

        const getSettings = () => ({ enableAspectRatioBridge: false });
        wrapImagineCommand(mockImagineCmd, getSettings, null);

        // Fire 3 concurrent /imagine requests simultaneously
        const p1 = mockImagineCmd.callback({}, 'job_1');
        const p2 = mockImagineCmd.callback({}, 'job_2');
        const p3 = mockImagineCmd.callback({}, 'job_3');

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        assert.strictEqual(r1, 'http://example.com/job_1.png');
        assert.strictEqual(r2, 'http://example.com/job_2.png');
        assert.strictEqual(r3, 'http://example.com/job_3.png');

        assert.strictEqual(maxConcurrent, 1, 'Max concurrent generations must never exceed 1');
        assert.deepStrictEqual(
            executionLog,
            ['start:job_1', 'end:job_1', 'start:job_2', 'end:job_2', 'start:job_3', 'end:job_3'],
            'Jobs must execute in strict FIFO order without overlapping'
        );
    });

    await t.test('7. Chat switch cleanly drops stale queued /imagine jobs', async () => {
        resetImagineQueue();

        let activeChat = 'chat_A';
        const ctx = {
            get chatId() {
                return activeChat;
            },
        };

        const executionLog = [];
        const mockImagineCmd = {
            callback: async (args, trigger) => {
                executionLog.push(`run:${trigger}`);
                await new Promise((resolve) => setTimeout(resolve, 30));
                return `url:${trigger}`;
            },
        };

        const getSettings = () => ({ enableAspectRatioBridge: false });
        wrapImagineCommand(mockImagineCmd, getSettings, ctx);

        // Queue job 1 and job 2 on chat_A
        const p1 = mockImagineCmd.callback({}, 'job_chat_A_1');
        const p2 = mockImagineCmd.callback({}, 'job_chat_A_2');

        // Let job 1 start running
        await new Promise((resolve) => setTimeout(resolve, 5));

        // While job 1 is running, user switches to chat_B
        activeChat = 'chat_B';
        setActiveImagineChatId('chat_B');

        // Queue job 3 on chat_B
        const p3 = mockImagineCmd.callback({}, 'job_chat_B_3');

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        // Job 1 had already started, so it finishes
        assert.strictEqual(r1, 'url:job_chat_A_1');
        // Job 2 was waiting in line for chat_A; when it wakes up, it detects chat changed to chat_B and aborts
        assert.strictEqual(r2, '', 'Stale job 2 must return empty string');
        // Job 3 was queued on chat_B and matches active chat, so it runs
        assert.strictEqual(r3, 'url:job_chat_B_3');

        assert.deepStrictEqual(
            executionLog,
            ['run:job_chat_A_1', 'run:job_chat_B_3'],
            'Job 2 must have been discarded without executing'
        );
    });
});

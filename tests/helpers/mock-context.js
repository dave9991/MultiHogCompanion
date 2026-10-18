/**
 * MultiHog Companion - Standardized Test Mock Harness
 *
 * Provides isolated, resettable mock environments for SillyTavern runtime globals,
 * DOM environment placeholders, and fetch mocks.
 */

const originalGlobals = {
    SillyTavern: globalThis.SillyTavern,
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    $: globalThis.$,
    jQuery: globalThis.jQuery,
};

/**
 * Creates a default SillyTavern context mock.
 * @param {object} [overrides={}]
 * @returns {object}
 */
export function createMockSillyTavernContext(overrides = {}) {
    return {
        chatId: 'test_chat_001',
        characters: [{ name: 'TestHero', avatar: 'hero.png' }],
        characterId: 0,
        chat: [],
        extensionSettings: {
            rpg_tracker: {
                enabled: true,
                syspromptModules: {},
                customSyspromptLibrary: [],
                syspromptSnippetDatabase: [],
                setupSnapshots: {},
                currentMemo: '',
            },
            multihog_companion: {},
        },
        ...overrides,
    };
}

/**
 * Sets up globalThis.SillyTavern with an isolated context.
 * @param {object} [contextOverrides={}]
 * @returns {object} The mock context object
 */
export function setupMockSillyTavern(contextOverrides = {}) {
    const ctx = createMockSillyTavernContext(contextOverrides);
    globalThis.SillyTavern = {
        getContext: () => ctx,
    };
    return ctx;
}

/**
 * Sets up globalThis.fetch with an arbitrary mock implementation.
 * @param {Function} fetchImpl
 */
export function setupMockFetch(fetchImpl) {
    globalThis.fetch = fetchImpl;
}

/**
 * Sets up minimal DOM stubs on globalThis (window/document/$) for tests requiring them.
 * @param {object} [opts={}]
 */
export function setupMockDom(opts = {}) {
    globalThis.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        location: { href: 'http://localhost:8000/' },
        ...opts.window,
    };
    globalThis.document = {
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        ...opts.document,
    };
    globalThis.$ = opts.$ || (() => ({
        on: () => {},
        val: () => '',
        prop: () => false,
        find: () => [],
        text: () => '',
        html: () => '',
    }));
    globalThis.jQuery = globalThis.$;
}

/**
 * Restores all modified globals to their initial state before tests ran.
 */
export function resetMockGlobals() {
    for (const [key, val] of Object.entries(originalGlobals)) {
        if (val === undefined) {
            delete globalThis[key];
        } else {
            globalThis[key] = val;
        }
    }
}

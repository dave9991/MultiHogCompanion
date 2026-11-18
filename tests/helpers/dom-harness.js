/**
 * MultiHog Companion — Stateful DOM / jQuery Test Harness
 *
 * Lightweight, dependency-free stateful jQuery & DOM mock for unit-testing
 * UI rendering and event delegation behavior without a headless browser.
 */

function createElementRecord(selector) {
    return {
        selector,
        textContent: '',
        htmlContent: '',
        innerHTML: '',
        value: '',
        className: '',
        visible: true,
        style: {},
        scrollTop: 0,
        scrollHeight: 0,
        css: {},
        attrs: {},
        props: {},
        dataset: {},
        classes: new Set(),
        childrenHtml: [],
        domChildren: [],
        handlers: new Map(),
        domListeners: new Map(),
        addEventListener(ev, fn) {
            if (typeof fn !== 'function') return;
            if (!this.domListeners.has(ev)) this.domListeners.set(ev, []);
            this.domListeners.get(ev).push(fn);
        },
        removeEventListener(ev, fn) {
            const list = this.domListeners.get(ev);
            if (!list) return;
            const idx = list.indexOf(fn);
            if (idx >= 0) list.splice(idx, 1);
        },
        appendChild(child) {
            this.domChildren.push(child);
            const html = typeof child === 'string'
                ? child
                : (child?.innerHTML || child?.htmlContent || '');
            if (html) {
                this.childrenHtml.push(html);
                this.htmlContent += html;
                this.innerHTML += html;
            }
            return child;
        },
    };
}

function createMemoryStorage() {
    const store = new Map();
    return {
        getItem(key) { return store.has(String(key)) ? store.get(String(key)) : null; },
        setItem(key, value) { store.set(String(key), String(value)); },
        removeItem(key) { store.delete(String(key)); },
        clear() { store.clear(); },
    };
}

/**
 * Creates a stateful jQuery-compatible mock (`$`) backed by an in-memory map of selector records.
 *
 * @returns {{
 *   $: Function & Record<string, any>,
 *   elements: Map<string, ReturnType<typeof createElementRecord>>,
 *   getElement: (selector: string) => ReturnType<typeof createElementRecord> | undefined,
 *   reset: () => void,
 * }}
 */
export function createStatefulJQueryMock() {
    const elements = new Map();

    function ensureRecord(selector) {
        const key = String(selector ?? '');
        if (!elements.has(key)) {
            elements.set(key, createElementRecord(key));
        }
        return elements.get(key);
    }

    function createWrapper(target) {
        const isExistingWrapper = target && typeof target === 'object' && target.__isMockJQueryWrapper;
        if (isExistingWrapper) return target;

        const key = typeof target === 'string'
            ? target
            : (target && typeof target === 'object' && target.selector) ? target.selector : '[object]';
        const record = ensureRecord(key);

        const wrapper = {
            __isMockJQueryWrapper: true,
            selector: key,
            length: 1,
            text(val) {
                if (arguments.length === 0) return record.textContent;
                record.textContent = String(val ?? '');
                return wrapper;
            },
            html(val) {
                if (arguments.length === 0) return record.htmlContent;
                const str = String(val ?? '');
                record.htmlContent = str;
                record.childrenHtml = str ? [str] : [];
                return wrapper;
            },
            val(val) {
                if (arguments.length === 0) return record.value;
                record.value = val ?? '';
                return wrapper;
            },
            css(propOrObj, val) {
                if (propOrObj && typeof propOrObj === 'object') {
                    Object.assign(record.css, propOrObj);
                    return wrapper;
                }
                if (arguments.length >= 2) {
                    record.css[propOrObj] = val;
                    return wrapper;
                }
                return record.css[propOrObj] ?? '';
            },
            attr(name, val) {
                if (arguments.length === 1) return record.attrs[name];
                record.attrs[name] = val;
                return wrapper;
            },
            prop(name, val) {
                if (arguments.length === 1) return Boolean(record.props[name]);
                record.props[name] = val;
                return wrapper;
            },
            data(keyName, val) {
                if (arguments.length === 1) return record.dataset[keyName];
                record.dataset[keyName] = val;
                return wrapper;
            },
            empty() {
                record.textContent = '';
                record.htmlContent = '';
                record.innerHTML = '';
                record.childrenHtml = [];
                record.domChildren = [];
                return wrapper;
            },
            append(content) {
                const str = String(content ?? '');
                record.childrenHtml.push(str);
                record.htmlContent += str;
                return wrapper;
            },
            show() {
                record.visible = true;
                record.css.display = '';
                return wrapper;
            },
            hide() {
                record.visible = false;
                record.css.display = 'none';
                return wrapper;
            },
            toggle(state) {
                const next = typeof state === 'boolean' ? state : !record.visible;
                record.visible = next;
                record.css.display = next ? '' : 'none';
                return wrapper;
            },
            fadeIn() {
                return wrapper.show();
            },
            fadeOut() {
                return wrapper.hide();
            },
            slideToggle() {
                return wrapper.toggle();
            },
            addClass(cls) {
                for (const name of String(cls || '').split(/\s+/).filter(Boolean)) {
                    record.classes.add(name);
                }
                return wrapper;
            },
            removeClass(cls) {
                for (const name of String(cls || '').split(/\s+/).filter(Boolean)) {
                    record.classes.delete(name);
                }
                return wrapper;
            },
            toggleClass(cls, state) {
                for (const name of String(cls || '').split(/\s+/).filter(Boolean)) {
                    const add = typeof state === 'boolean' ? state : !record.classes.has(name);
                    if (add) record.classes.add(name);
                    else record.classes.delete(name);
                }
                return wrapper;
            },
            hasClass(cls) {
                return record.classes.has(cls);
            },
            on(eventName, selectorOrHandler, maybeHandler) {
                const delegateSelector = typeof selectorOrHandler === 'string' ? selectorOrHandler : null;
                const handler = typeof selectorOrHandler === 'function' ? selectorOrHandler : maybeHandler;
                if (typeof handler === 'function') {
                    for (const ev of String(eventName).split(/\s+/).filter(Boolean)) {
                        if (!record.handlers.has(ev)) record.handlers.set(ev, []);
                        record.handlers.get(ev).push({ delegateSelector, handler });
                    }
                }
                return wrapper;
            },
            off(eventName) {
                if (!eventName) {
                    record.handlers.clear();
                } else {
                    for (const ev of String(eventName).split(/\s+/).filter(Boolean)) {
                        record.handlers.delete(ev);
                    }
                }
                return wrapper;
            },
            trigger(eventName, data) {
                const list = record.handlers.get(eventName) || [];
                const eventObj = {
                    type: eventName,
                    currentTarget: wrapper,
                    target: wrapper,
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    stopImmediatePropagation: () => {},
                };
                for (const entry of list) {
                    entry.handler.call(wrapper, eventObj, data);
                }
                return wrapper;
            },
            find(subSelector) {
                return createWrapper(`${key} ${String(subSelector ?? '').trim()}`);
            },
        };

        return wrapper;
    }

    function $(selector) {
        return createWrapper(selector);
    }

    return {
        $,
        elements,
        getElement(selector) {
            return elements.get(String(selector ?? ''));
        },
        reset() {
            elements.clear();
        },
    };
}

/**
 * Installs a stateful jQuery/DOM harness onto `globalThis` (`$`, `jQuery`, `window`, `document`)
 * and returns a `cleanup()` function restoring the previous globals.
 *
 * @param {{ window?: Record<string, any>, document?: Record<string, any> }} [opts={}]
 */
export function installDomHarness(opts = {}) {
    const prev = {
        $: globalThis.$,
        jQuery: globalThis.jQuery,
        window: globalThis.window,
        document: globalThis.document,
        localStorage: globalThis.localStorage,
        sessionStorage: globalThis.sessionStorage,
    };

    const jq = createStatefulJQueryMock();

    globalThis.$ = jq.$;
    globalThis.jQuery = jq.$;
    globalThis.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        location: { href: 'http://localhost:8000/' },
        ...opts.window,
    };
    globalThis.document = {
        createElement: (tag) => createElementRecord(String(tag || 'div')),
        getElementById: (id) => jq.getElement(`#${id}`) || null,
        querySelector: (sel) => jq.getElement(sel) || null,
        querySelectorAll: (sel) => {
            const rec = jq.getElement(sel);
            return rec ? [rec] : [];
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        ...opts.document,
    };
    if (opts.localStorage !== undefined) {
        globalThis.localStorage = opts.localStorage;
    } else if (globalThis.localStorage === undefined) {
        globalThis.localStorage = createMemoryStorage();
    }
    if (opts.sessionStorage !== undefined) {
        globalThis.sessionStorage = opts.sessionStorage;
    } else if (globalThis.sessionStorage === undefined) {
        globalThis.sessionStorage = createMemoryStorage();
    }

    return {
        $: jq.$,
        elements: jq.elements,
        getElement: jq.getElement,
        reset: jq.reset,
        cleanup() {
            for (const [k, v] of Object.entries(prev)) {
                if (v === undefined) delete globalThis[k];
                else globalThis[k] = v;
            }
        },
    };
}

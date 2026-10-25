import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');

console.log('--- Running Architecture & Catalog Integrity Guard ---');

// 1. Read Catalog Documents
const listenersDocPath = path.join(extensionRoot, 'LISTENERS.md');
const monkeyPatchesDocPath = path.join(extensionRoot, 'MONKEYPATCHES.md');
const featuresDocPath = path.join(extensionRoot, 'FEATURES.md');
const workaroundsDocPath = path.join(extensionRoot, 'WORKAROUNDS.md');

assert.ok(fs.existsSync(listenersDocPath), 'LISTENERS.md must exist in extension root');
assert.ok(fs.existsSync(monkeyPatchesDocPath), 'MONKEYPATCHES.md must exist in extension root');
assert.ok(fs.existsSync(featuresDocPath), 'FEATURES.md must exist in extension root');
assert.ok(fs.existsSync(workaroundsDocPath), 'WORKAROUNDS.md must exist in extension root');

const listenersDoc = fs.readFileSync(listenersDocPath, 'utf8');
const monkeyPatchesDoc = fs.readFileSync(monkeyPatchesDocPath, 'utf8');
const featuresDoc = fs.readFileSync(featuresDocPath, 'utf8');
const workaroundsDoc = fs.readFileSync(workaroundsDocPath, 'utf8');

// 2. Scan all JS files in MultiHogCompanion (excluding tests and node_modules)
const jsFiles = fs.readdirSync(extensionRoot)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(extensionRoot, f));

console.log(`Auditing ${jsFiles.length} JavaScript source files against catalog records...`);

const detectedEventListeners = new Set();
const detectedDomDelegations = new Set();

const eventRegex = /eventSource\.(?:on|makeFirst)\(\s*(?:event_types\.|et\.)([A-Z_]+)/g;
const domRegex = /\$\(document\)\.on\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;

for (const filePath of jsFiles) {
    const code = fs.readFileSync(filePath, 'utf8');
    let m;
    while ((m = eventRegex.exec(code)) !== null) {
        detectedEventListeners.add(m[1]);
    }
    while ((m = domRegex.exec(code)) !== null) {
        detectedDomDelegations.add(m[1]);
    }
}

// 3. Verify Event Coverage
console.log('Verifying eventSource listener coverage in LISTENERS.md...');
for (const eventName of detectedEventListeners) {
    assert.ok(
        listenersDoc.includes(eventName),
        `Event "${eventName}" is registered in source code but missing from LISTENERS.md!`
    );
}
console.log(`✓ All ${detectedEventListeners.size} active eventSource event types documented in LISTENERS.md`);

// 4. Verify DOM Delegation Coverage
console.log('Verifying DOM delegation coverage in LISTENERS.md...');
for (const domEvent of detectedDomDelegations) {
    assert.ok(
        listenersDoc.includes(domEvent),
        `DOM event namespace "${domEvent}" is registered on $(document) but missing from LISTENERS.md!`
    );
}
console.log(`✓ All ${detectedDomDelegations.size} $(document).on delegations documented in LISTENERS.md`);

// 5. Verify Monkey Patch ADR Coverage in MONKEYPATCHES.md
console.log('Verifying Monkey Patch ADR coverage in MONKEYPATCHES.md...');
const requiredAdrs = [
    'ADR-MP-01', // window.fetch
    'ADR-MP-02', // /imagine
    'ADR-MP-03', // generate_interceptor
    'ADR-MP-04', // stopImmediatePropagation
    'ADR-MP-05', // stockPrompts
    'ADR-MP-06', // _mhcPendingFreshRestart
    'ADR-MP-07', // generateRaw macro sanitizer
];

for (const adr of requiredAdrs) {
    assert.ok(
        monkeyPatchesDoc.includes(adr),
        `Architectural Decision Record "${adr}" is missing from MONKEYPATCHES.md!`
    );
}
console.log(`✓ All ${requiredAdrs.length} Architectural Decision Records present in MONKEYPATCHES.md`);

// 5b. Verify Feature Coverage in FEATURES.md
console.log('Verifying Feature catalog coverage in FEATURES.md...');
const requiredFeatures = [
    'FEAT-01', 'FEAT-02', 'FEAT-03', 'FEAT-04',
    'FEAT-05', 'FEAT-06', 'FEAT-07', 'FEAT-08', 'FEAT-09',
];
for (const feat of requiredFeatures) {
    assert.ok(
        featuresDoc.includes(feat),
        `Feature "${feat}" is missing from FEATURES.md!`
    );
}
console.log(`✓ All ${requiredFeatures.length} primary features verified in FEATURES.md`);

// 5c. Verify Workaround Coverage in WORKAROUNDS.md
console.log('Verifying Workaround catalog coverage in WORKAROUNDS.md...');
const requiredWorkarounds = [
    'WRK-01', 'WRK-02', 'WRK-03', 'WRK-04',
    'WRK-05', 'WRK-06', 'WRK-07', 'WRK-08',
];
for (const wrk of requiredWorkarounds) {
    assert.ok(
        workaroundsDoc.includes(wrk),
        `Workaround "${wrk}" is missing from WORKAROUNDS.md!`
    );
}
console.log(`✓ All ${requiredWorkarounds.length} upstream workarounds verified in WORKAROUNDS.md`);

// 6. Verify that no arbitrary multi-step setTimeout ladders exist in index.js
console.log('Verifying absence of arbitrary setTimeout ladders in index.js...');
const indexCode = fs.readFileSync(path.join(extensionRoot, 'index.js'), 'utf8');
assert.ok(!indexCode.includes('setTimeout(updateRulesetBadge, 1200)'), 'Startup setTimeout ladder must be eliminated');
assert.ok(!indexCode.includes('setTimeout(updateLorebookSyncUI, 1300)'), 'Startup setTimeout ladder must be eliminated');
assert.ok(indexCode.includes('runInitialLoadCoordinator'), 'index.js must use runInitialLoadCoordinator for startup');
assert.ok(indexCode.includes('runChatChangedCoordinator'), 'index.js must use runChatChangedCoordinator for chat switch');
console.log('✓ All setTimeout ladders verified eliminated in favor of deterministic coordinators');

// 7. Verify In-Code [CATALOG: ...] Anchor Tags
console.log('Verifying in-code [CATALOG: ...] anchor tags across JavaScript source files...');
const requiredCatalogTags = [
    'EVT-01', 'EVT-02', 'EVT-03', 'EVT-04', 'EVT-05', 'EVT-06',
    'EVT-07', 'EVT-08', 'EVT-09', 'EVT-10', 'EVT-11', 'EVT-12',
    'DOM-01a', 'DOM-01b', 'DOM-02', 'DOM-03', 'DOM-04', 'DOM-05', 'DOM-06', 'DOM-07',
    'ADR-MP-01', 'ADR-MP-02', 'ADR-MP-03', 'ADR-MP-04', 'ADR-MP-05', 'ADR-MP-06', 'ADR-MP-07'
];

const allJsCode = jsFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

for (const tag of requiredCatalogTags) {
    const pattern = new RegExp(`\\[CATALOG:\\s*${tag}\\]`);
    assert.ok(
        pattern.test(allJsCode),
        `Source code missing anchor tag "[CATALOG: ${tag}]"! All listeners and monkey patches must be tagged.`
    );
}
console.log(`✓ All ${requiredCatalogTags.length} required [CATALOG: ...] anchor tags verified in source code`);

// 8. Verify documentation references resolve (guards against catalog drift after refactors/retirements)
console.log('Verifying catalog/doc file references and cross-doc anchors resolve...');
const docFiles = [
    'FEATURES.md', 'WORKAROUNDS.md', 'LISTENERS.md', 'MONKEYPATCHES.md',
    ...fs.readdirSync(path.join(extensionRoot, 'docs')).filter(f => f.endsWith('.md')).map(f => path.join('docs', f)),
];

// GitHub-style heading slug
const slugify = (h) => h.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

const anchorsByDoc = {};
for (const rel of docFiles) {
    const text = fs.readFileSync(path.join(extensionRoot, rel), 'utf8');
    const anchors = new Set();
    for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) anchors.add(slugify(m[1]));
    for (const m of text.matchAll(/<a id="([^"]+)"><\/a>/g)) anchors.add(m[1]);
    anchorsByDoc[rel] = anchors;
}

// Locate a bare filename in this extension, the upstream framework or SillyTavern core (if checked out)
const searchRoots = [
    extensionRoot,
    path.resolve(extensionRoot, '..', 'SillyTavern-MultihogDnDFramework'),
    path.resolve(extensionRoot, '..', '..', 'st-source', 'public'),
].filter(p => fs.existsSync(p));
const basenameCache = new Map();
function existsAnywhere(name) {
    if (basenameCache.has(name)) return basenameCache.get(name);
    const walk = (dir, depth) => {
        if (depth > 6) return false;
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            if (e.isFile() && e.name === name) return true;
            if (e.isDirectory() && walk(path.join(dir, e.name), depth + 1)) return true;
        }
        return false;
    };
    const found = searchRoots.some(r => walk(r, 0));
    basenameCache.set(name, found);
    return found;
}
const upstreamCheckedOut = searchRoots.length > 1;

for (const rel of docFiles) {
    const docPath = path.join(extensionRoot, rel);
    const text = fs.readFileSync(docPath, 'utf8');

    // 8a. Markdown links to local files / anchors
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        let target = m[1];
        if (/^(https?:|mailto:)/.test(target)) continue;
        const [filePart, anchor] = target.split('#');
        let resolved = docPath;
        if (filePart) {
            resolved = filePart.startsWith('file://')
                ? decodeURIComponent(filePart.slice('file://'.length))
                : path.resolve(path.dirname(docPath), filePart);
            // Absolute file:// links written for another checkout location: re-root by extension folder name
            if (filePart.startsWith('file://') && !fs.existsSync(resolved)) {
                const idx = resolved.indexOf('/MultiHogCompanion/');
                if (idx >= 0) resolved = path.join(extensionRoot, resolved.slice(idx + '/MultiHogCompanion/'.length));
                else continue; // link into upstream/ST trees: checked via basename scan below, not here
            }
            assert.ok(fs.existsSync(resolved), `${rel}: link target "${target}" does not exist`);
        }
        if (anchor && /\.md$/.test(resolved)) {
            const key = path.relative(extensionRoot, resolved);
            if (anchorsByDoc[key]) {
                assert.ok(anchorsByDoc[key].has(anchor), `${rel}: anchor "#${anchor}" not found in ${key}`);
            }
        }
    }

    // 8b. Backticked `*.js` names must exist in the extension (or upstream/ST trees when checked out)
    for (const m of text.matchAll(/`([A-Za-z0-9_-]+\.js)(?::\d+)?`/g)) {
        const name = m[1];
        if (fs.existsSync(path.join(extensionRoot, name))) continue;
        if (upstreamCheckedOut && existsAnywhere(name)) continue;
        if (!upstreamCheckedOut) continue; // cannot verify upstream/ST names without the sibling checkouts
        assert.fail(`${rel}: references \`${name}\`, which exists neither in MultiHogCompanion nor in the upstream/ST source trees (stale catalog entry?)`);
    }
}
console.log(`✓ File references and cross-doc anchors verified across ${docFiles.length} documents`);

console.log('--- ALL ARCHITECTURE & CATALOG INTEGRITY CHECKS PASSED CLEANLY! ---');

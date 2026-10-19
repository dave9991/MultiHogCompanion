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

assert.ok(fs.existsSync(listenersDocPath), 'LISTENERS.md must exist in extension root');
assert.ok(fs.existsSync(monkeyPatchesDocPath), 'MONKEYPATCHES.md must exist in extension root');

const listenersDoc = fs.readFileSync(listenersDocPath, 'utf8');
const monkeyPatchesDoc = fs.readFileSync(monkeyPatchesDocPath, 'utf8');

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
];

for (const adr of requiredAdrs) {
    assert.ok(
        monkeyPatchesDoc.includes(adr),
        `Architectural Decision Record "${adr}" is missing from MONKEYPATCHES.md!`
    );
}
console.log(`✓ All ${requiredAdrs.length} Architectural Decision Records present in MONKEYPATCHES.md`);

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
    'DOM-01a', 'DOM-01b', 'DOM-02', 'DOM-03', 'DOM-04', 'DOM-05', 'DOM-06',
    'ADR-MP-01', 'ADR-MP-02', 'ADR-MP-03', 'ADR-MP-04', 'ADR-MP-05', 'ADR-MP-06'
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

console.log('--- ALL ARCHITECTURE & CATALOG INTEGRITY CHECKS PASSED CLEANLY! ---');

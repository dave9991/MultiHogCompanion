import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running Upstream Repository Integrity Guard ---');

const REPOS_TO_CHECK = [
  {
    name: 'SillyTavern-MultihogDnDFramework',
    relPath: '../../SillyTavern-MultihogDnDFramework',
    companionDir: 'extensions/MultiHogCompanion'
  },
  {
    name: 'st-source (Core SillyTavern)',
    relPath: '../../../st-source',
    companionDir: 'extensions/MultiHogCompanion'
  }
];

let hasFailures = false;

for (const repo of REPOS_TO_CHECK) {
  const fullPath = path.resolve(__dirname, repo.relPath);
  try {
    const gitStatus = execSync('git status --porcelain', {
      cwd: fullPath,
      encoding: 'utf8'
    }).trim();

    if (gitStatus.length > 0) {
      hasFailures = true;
      console.error('\n' + '='.repeat(80));
      console.error(`🚨 FATAL INTEGRITY ERROR: Unauthorized modifications in upstream repository!`);
      console.error(`Repository: ${repo.name} (${fullPath})`);
      console.error('Modified / Untracked files detected:');
      console.error(gitStatus);
      console.error('-'.repeat(80));
      console.error('REMEDIATION INSTRUCTIONS:');
      console.error(`1. Upstream code must remain 100% PRISTINE to prevent merge conflicts.`);
      console.error(`2. NEVER modify files directly in ${repo.name}.`);
      console.error(`3. All custom features, UI extensions, PbtA systems, and fixes belong in '${repo.companionDir}'.`);
      console.error(`4. Revert upstream changes now:`);
      console.error(`   cd ${fullPath}`);
      console.error(`   git checkout -- .`);
      console.error(`   git clean -fd`);
      console.error('='.repeat(80) + '\n');
    } else {
      console.log(`✓ Upstream repository '${repo.name}' is clean and unmodified.`);
    }
  } catch (err) {
    console.warn(`[WARN] Could not inspect git status for ${repo.name}: ${err.message}`);
  }
}

if (hasFailures) {
  console.error('❌ UPSTREAM INTEGRITY CHECK FAILED: Revert modifications before proceeding!');
  process.exit(1);
} else {
  console.log('--- ALL UPSTREAM INTEGRITY CHECKS PASSED CLEANLY! ---');
}

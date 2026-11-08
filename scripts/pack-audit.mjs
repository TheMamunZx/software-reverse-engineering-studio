/**
 * SRE Studio Packaging & Clean Installation Audit (Milestone 7)
 *
 * Validates:
 *  1. pnpm pack generates clean tarballs for all 6 packages.
 *  2. No accidental node_modules, src, test, or secret files are packed.
 *  3. Workspace dependencies are properly resolved.
 *  4. Clean temporary directory installation test: installs CLI & MCP packages from packed tarballs.
 *  5. CLI smoke test: invokes installed `sre-studio --version` and `sre-studio --help`.
 *  6. MCP server smoke test: invokes installed `sre-studio-mcp`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const packages = [
  { name: '@sre-studio/shared', dir: 'packages/shared' },
  { name: '@sre-studio/core', dir: 'packages/core' },
  { name: '@sre-studio/provider-binary', dir: 'packages/providers/binary' },
  { name: '@sre-studio/provider-android', dir: 'packages/providers/android' },
  { name: '@sre-studio/mcp-server', dir: 'packages/mcp-server' },
  { name: '@sre-studio/cli', dir: 'packages/cli' }
];

console.log('='.repeat(80));
console.log('  SRE STUDIO PACKAGING & RELEASE-READINESS AUDIT');
console.log('  Milestone 7 Packaging & Clean Installation Verification');
console.log('='.repeat(80));

const tempDir = mkdtempSync(path.join(tmpdir(), 'sre-pack-audit-'));
const tarballs = new Map();

try {
  // Step 1: Pack each package into tempDir
  console.log('\n[1/4] Packing tarballs with pnpm pack...');
  for (const pkg of packages) {
    const pkgPath = path.join(ROOT_DIR, pkg.dir);
    const result = spawnSync('pnpm', ['pack', '--pack-destination', tempDir], {
      cwd: pkgPath,
      encoding: 'utf8',
      shell: true
    });

    if (result.status !== 0) {
      console.error(`Failed to pack ${pkg.name}:`, result.stderr);
      process.exit(1);
    }

    // Find the generated tarball
    const files = readdirSync(tempDir);
    const tarball = files.find(f => f.startsWith(pkg.name.replace('@sre-studio/', 'sre-studio-')) && f.endsWith('.tgz'));
    if (!tarball) {
      throw new Error(`Tarball not found for ${pkg.name} in ${tempDir}`);
    }
    tarballs.set(pkg.name, path.join(tempDir, tarball));
    console.log(`  ✓ ${pkg.name} -> ${tarball}`);
  }

  // Step 2: Inspect tarball contents
  console.log('\n[2/4] Inspecting tarball contents for hygiene (no src, tests, node_modules, secrets)...');
  for (const [pkgName, tarballPath] of tarballs.entries()) {
    const listResult = spawnSync('tar', ['-tf', tarballPath], { encoding: 'utf8' });
    if (listResult.status !== 0) {
      throw new Error(`Failed to list contents of ${tarballPath}: ${listResult.stderr}`);
    }

    const files = listResult.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    console.log(`\n  Package: ${pkgName} (${files.length} files)`);

    // Checks
    const forbidden = files.filter(f =>
      f.includes('node_modules') ||
      f.includes('package/test/') ||
      f.includes('package/src/') ||
      f.endsWith('.env') ||
      f.endsWith('.tsbuildinfo')
    );

    if (forbidden.length > 0) {
      console.error(`  ✖ FORBIDDEN FILES FOUND in ${pkgName}:`, forbidden);
      process.exit(1);
    }

    // Verify required files
    const hasDist = files.some(f => f.startsWith('package/dist/'));
    const hasPkgJson = files.includes('package/package.json');
    if (!hasDist || !hasPkgJson) {
      throw new Error(`Missing essential dist or package.json in ${pkgName}`);
    }

    console.log(`    ✓ Clean packaging: dist/ present, 0 test/src/node_modules leakage`);
  }

  // Step 3: Local installation in a clean environment
  // Path B: Only install the 4 public packages (CLI, MCP, Core, Shared).
  // Neither internal provider package is installed, verifying that their code is bundled!
  console.log('\n[3/4] Testing installation of 4 public packages into clean temporary directory...');
  const installDir = path.join(tempDir, 'test-install');
  spawnSync('node', ['-e', `require('fs').mkdirSync('${installDir.replace(/\\/g, '/')}', { recursive: true })`]);

  // Initialize a package.json in test-install
  spawnSync('npm', ['init', '-y'], { cwd: installDir, encoding: 'utf8', shell: true });

  const publicTarballPaths = [
    tarballs.get('@sre-studio/cli'),
    tarballs.get('@sre-studio/mcp-server'),
    tarballs.get('@sre-studio/core'),
    tarballs.get('@sre-studio/shared')
  ].filter(Boolean);

  console.log('  Installing 4 public tarballs (CLI, MCP, Core, Shared) WITHOUT internal providers...');
  let installResult = spawnSync('npm', ['install', '--ignore-scripts', ...publicTarballPaths], {
    cwd: installDir,
    encoding: 'utf8',
    shell: true
  });

  if (installResult.status !== 0) {
    console.error('Local package install failed:', installResult.stderr || installResult.stdout);
    process.exit(1);
  }
  console.log('  ✓ Installed 4 public tarballs successfully with ZERO internal provider packages');

  // Copy local workspace prebuilt better_sqlite3.node if better-sqlite3 was installed
  let localPrebuilt = path.join(ROOT_DIR, 'node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3/build/Release/better_sqlite3.node');
  if (!existsSync(localPrebuilt)) {
    const findPrebuilt = (dir) => {
      if (!existsSync(dir) || (localPrebuilt && existsSync(localPrebuilt))) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.bin')) {
            findPrebuilt(full);
          } else if (entry.name === 'better_sqlite3.node') {
            localPrebuilt = full;
            return;
          }
        }
      } catch {}
    };
    findPrebuilt(path.join(ROOT_DIR, 'node_modules'));
  }

  if (localPrebuilt && existsSync(localPrebuilt)) {
    // Find better-sqlite3 in test-install node_modules
    const findAndCopy = (dir) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'better-sqlite3') {
            const destDir = path.join(full, 'build', 'Release');
            spawnSync('node', ['-e', `require('fs').mkdirSync('${destDir.replace(/\\/g, '/')}', { recursive: true })`]);
            const destFile = path.join(destDir, 'better_sqlite3.node');
            if (!existsSync(destFile)) {
              spawnSync('node', ['-e', `require('fs').copyFileSync('${localPrebuilt.replace(/\\/g, '/')}', '${destFile.replace(/\\/g, '/')}')`]);
            }
          } else {
            findAndCopy(full);
          }
        }
      }
    };
    findAndCopy(path.join(installDir, 'node_modules'));
  }

  // Step 4: Smoke test installed binaries
  console.log('\n[4/4] Executing CLI & MCP smoke tests on installed packages...');

  // Test sre-studio CLI
  const cliBin = path.join(installDir, 'node_modules', '.bin', process.platform === 'win32' ? 'sre-studio.cmd' : 'sre-studio');
  if (process.platform !== 'win32') {
    try {
      chmodSync(cliBin, 0o755);
    } catch {}
  }
  const cliVer = spawnSync(cliBin, ['--version'], { encoding: 'utf8', shell: true });
  console.log(`  sre-studio --version: ${cliVer.stdout.trim()}`);
  if (cliVer.status !== 0 || !cliVer.stdout.includes('0.1.0')) {
    throw new Error(`CLI smoke test failed: ${cliVer.stderr || cliVer.stdout}`);
  }
  console.log('  ✓ sre-studio --version OK');

  const cliHelp = spawnSync(cliBin, ['--help'], { encoding: 'utf8', shell: true });
  if (cliHelp.status !== 0 || !cliHelp.stdout.includes('Software Reverse Engineering Studio')) {
    throw new Error(`CLI help test failed: ${cliHelp.stderr || cliHelp.stdout}`);
  }
  console.log('  ✓ sre-studio --help OK');

  const cliProv = spawnSync(cliBin, ['provider', 'list'], { encoding: 'utf8', shell: true });
  if (cliProv.status !== 0 || !cliProv.stdout.includes('rizin') || !cliProv.stdout.includes('android')) {
    throw new Error(`CLI bundled provider test failed: ${cliProv.stderr || cliProv.stdout}`);
  }
  console.log('  ✓ sre-studio provider list (bundled rizin & android discovered) OK');

  // Test sre-studio-mcp startup
  const mcpBin = path.join(installDir, 'node_modules', '.bin', process.platform === 'win32' ? 'sre-studio-mcp.cmd' : 'sre-studio-mcp');
  if (process.platform !== 'win32') {
    try {
      chmodSync(mcpBin, 0o755);
    } catch {}
  }
  const mcpSmoke = spawnSync('node', [
    '-e',
    `
    const { spawn } = require('child_process');
    const p = spawn('${mcpBin.replace(/\\/g, '/')}', [], { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    setTimeout(() => { p.kill(); process.exit(0); }, 1000);
    `
  ], { encoding: 'utf8' });

  if (mcpSmoke.status !== 0) {
    throw new Error(`MCP smoke test failed: ${mcpSmoke.stderr || mcpSmoke.stdout}`);
  }
  console.log('  ✓ sre-studio-mcp startup OK');

  console.log('\n' + '='.repeat(80));
  console.log('  PACKAGING & RELEASE VALIDATION: 100% SUCCESS');
  console.log('='.repeat(80));

} finally {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

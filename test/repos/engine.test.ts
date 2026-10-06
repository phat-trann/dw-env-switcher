import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { DEFAULT_REPO_TOOLS, discoverSiteRepos, resolveRepoTools, validateRepoTools } from '../../src/repos/config';
import { validateConfig } from '../../src/config/model';
const script = path.resolve('scripts/update-repos.sh');
let root: string; let env: NodeJS.ProcessEnv;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (name: string, content: string) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content); };
beforeEach(() => {
 root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-repos-test-'));
 write('nvm/nvm.sh', 'nvm() { return 0; }\n');
 write('bin/npm', `#!/bin/bash
printf '%s|%s\n' "$(basename "$PWD")" "$*" >> "$TRACE"
for repo in a b; do
 if [ -d "$FIXTURE/$repo/.git" ] && [ "$CHECK_BARRIER" = 1 ]; then
  [ "$(git -C "$FIXTURE/$repo" branch --show-current)" = v3.3.0 ] || exit 9
 fi
done
echo raw-command-output-hidden
if [ "$(basename "$PWD")" = "$FAIL_NPM" ]; then exit 1; fi
if [ "$1" = install ]; then mkdir -p node_modules; fi
`);
 fs.chmodSync(path.join(root, 'bin/npm'), 0o755);
 env = { ...process.env, PATH: path.join(root, 'bin') + ':' + process.env.PATH, NVM_DIR: path.join(root, 'nvm'), TRACE: path.join(root, 'trace'), FIXTURE: root, CHECK_BARRIER: '0', LOG_FILE: path.join(root, '.dw-update-log.json'), SKIP_GIT: '0', SKIP_NPM: '0', SKIP_BUILD: '0', CHANGED_ONLY: '0' };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function repo(name: string, cart: string, scripts: Record<string, string> = { 'compile:scss': 'stub', 'compile:js': 'stub' }) {
 const dir = path.join(root, name); fs.mkdirSync(dir);
 git(dir, 'init', '-b', 'master'); git(dir, 'config', 'user.email', 'test@example.invalid'); git(dir, 'config', 'user.name', 'Fixture');
 write(name + '/cartridges/' + cart + '/.keep', ''); write(name + '/package.json', JSON.stringify({ scripts }));
 write(name + '/.gitignore', 'node_modules/\n'); write(name + '/tracked', 'original');
 git(dir, 'add', '.'); git(dir, 'commit', '-m', 'fixture');
 git(dir, 'branch', 'v3.3.0'); git(dir, 'clone', '--bare', dir, path.join(root, name + '-origin'));
 git(dir, 'remote', 'add', 'origin', path.join(root, name + '-origin'));
 return dir;
}
function run(action: string, settings: any = {}, cartridgePath = 'app_a:app_b') {
 const config = { site: { id: 'site', name: 'Fixture', cartridgesPath: cartridgePath }, repoTools: { ...DEFAULT_REPO_TOOLS, skipRepos: {}, ...settings } };
 write('snapshot.json', JSON.stringify(config));
 return spawnSync('bash', [script, '--site-config', path.join(root, 'snapshot.json'), '--root', root, '--action', action], { env, encoding: 'utf8', timeout: 30000 });
}
const trace = () => fs.existsSync(path.join(root, 'trace')) ? fs.readFileSync(path.join(root, 'trace'), 'utf8') : '';
const state = () => JSON.parse(fs.readFileSync(path.join(root, '.dw-update-log.json'), 'utf8'));
describe('Site repository engine (temporary repositories only)', () => {
 it('switches to the first available origin branch, resets edits, waits for all Git and does not touch dw.json', () => {
  const a = repo('a', 'app_a'); repo('b', 'app_b'); repo('excluded', 'other');
  write('a/tracked', 'dirty'); write('a/untracked', 'discard'); write('dw.json', '{malformed and unused');
  env.CHECK_BARRIER = '1'; const result = run('all');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(git(a, 'branch', '--show-current')).toBe('v3.3.0'); expect(git(path.join(root, 'b'), 'branch', '--show-current')).toBe('v3.3.0');
  expect(fs.readFileSync(path.join(a, 'tracked'), 'utf8')).toBe('original'); expect(fs.existsSync(path.join(a, 'untracked'))).toBe(false);
  expect(trace()).toContain('a|install'); expect(trace()).toContain('b|run compile:js'); expect(trace()).not.toContain('excluded');
  expect(result.stdout).not.toContain('raw-command-output-hidden'); expect(fs.readFileSync(path.join(root, 'dw.json'), 'utf8')).toBe('{malformed and unused');
  expect(fs.existsSync(path.join(root, '.dw-update.lock'))).toBe(false);
 });
 it('Git-only has no npm steps; missing priority branch does not discard local edits', () => {
  const a = repo('a', 'app_a'); write('a/tracked', 'keep');
  const failed = run('git', { priorityBranches: ['missing'] }); expect(failed.status).toBe(1);
  expect(fs.readFileSync(path.join(a, 'tracked'), 'utf8')).toBe('keep'); expect(trace()).toBe('');
  expect(run('git').status).toBe(0); expect(trace()).toBe('');
 });
 it('failed Git repo is excluded while other repos finish install/compile', () => {
  const a = repo('a', 'app_a'); repo('b', 'app_b'); git(a, 'remote', 'set-url', 'origin', path.join(root, 'missing-origin'));
  const result = run('all'); expect(result.status).toBe(1); expect(trace()).not.toContain('a|'); expect(trace()).toContain('b|install');
  expect(result.stdout).toContain('FAIL');
 });
 it('force reinstall removes modules; smart install reuses fresh state and expires after 30 days', () => {
  repo('a', 'app_a'); expect(run('install-compile').status).toBe(0); write('a/node_modules/sentinel', 'keep'); write('trace', '');
  expect(run('install-compile').status).toBe(0); expect(trace()).not.toContain('|install');
  const stale = state(); stale.repos.a.last_install_epoch = Date.now()/1000 - 31*86400; write('.dw-update-log.json', JSON.stringify(stale));
  expect(run('install-compile').status).toBe(0); expect(fs.existsSync(path.join(root, 'a/node_modules/sentinel'))).toBe(false);
  write('a/node_modules/sentinel', 'remove'); expect(run('reinstall').status).toBe(0); expect(fs.existsSync(path.join(root, 'a/node_modules/sentinel'))).toBe(false);
  write('trace', ''); expect(run('install').status).toBe(0); expect(trace()).toContain('a|install'); expect(trace()).not.toContain('compile');
 });
 it('honors config skips, remembers missing scripts, and invalidates the cache on package changes', () => {
  repo('a', 'app_a', { 'compile:js': 'stub' }); repo('b', 'app_b');
  const settings = { skipRepos: { b: { skipInstall: true, skipCompile: true } } };
  expect(run('install-compile', settings).status).toBe(0); expect(trace()).not.toContain('b|');
  expect(state().repos.a.compile_scripts.skipped['compile:scss']).toBe('no_script');
  write('a/package.json', JSON.stringify({ scripts: { 'compile:scss': 'stub', 'compile:js': 'stub' } })); write('trace', '');
  expect(run('scss', settings).status).toBe(0); expect(trace()).toContain('a|run compile:scss'); expect(trace()).not.toContain('compile:js'); expect(state().repos.a.build_status).toBe('partial');
 });
 it('blocks compile after install failure and prevents concurrent root runs', () => {
  repo('a', 'app_a'); env.FAIL_NPM='a'; expect(run('install-compile').status).toBe(1); expect(trace()).not.toContain('compile:'); expect(state().repos.a.build_status).toBe('blocked');
  fs.mkdirSync(path.join(root, '.dw-update.lock')); expect(run('compile').status).toBe(1); expect(fs.existsSync(path.join(root, '.dw-update.lock'))).toBe(true);
 });
 it('changed-only reuses a successful build and CLI manager mode runs the requested Site without dw.json', () => {
  repo('a', 'app_a'); env.DW_RUN_ID = 'first'; expect(run('all').status).toBe(0); write('trace', '');
  env.DW_RUN_ID = 'second'; expect(run('changed').status).toBe(0); expect(trace()).toBe('');
  expect(state().repos.a.build_status).toBe('ok'); expect(state().repos.a.activity_steps).toMatchObject({ git: 'ok', install: 'skipped', compile: 'skipped' });
  const config = { schemaVersion: 2, environments: [], sites: [{ id: 'chosen', name: 'Chosen', cartridgesPath: 'app_a' }], repoTools: { ...DEFAULT_REPO_TOOLS, priorityBranches: ['master'], skipRepos: {} } };
  write('manager.json', JSON.stringify(config));
  const result = spawnSync('bash', [script, '--manager-config', path.join(root, 'manager.json'), '--site-id', 'chosen', '--root', root, '--action', 'git'], { env, encoding: 'utf8', timeout: 30000 });
  expect(result.status, result.stdout + result.stderr).toBe(0); expect(git(path.join(root, 'a'), 'branch', '--show-current')).toBe('master');
  expect(fs.existsSync(path.join(root, 'dw.json'))).toBe(false);
 });
 it('discovers each matching repo once, excludes symlinks and validates compatible overrides', () => {
  repo('a', 'app_a'); fs.symlinkSync(path.join(root, 'a'), path.join(root, 'linked'));
  expect(discoverSiteRepos(root, { id: 's', name: 'Store', cartridgesPath: 'app_a:app_a' })).toEqual(['a']);
  expect(resolveRepoTools(root, { nodeVersion: '18.20.8' }, { gitJobs: 2 })).toMatchObject({ nodeVersion: '18.20.8', gitJobs: 2 });
  for (const bad of [{ gitJobs: 0 }, { priorityBranches: [] }, { nodeVersion: '$(bad)' }, { skipRepos: { a: { skipCompile: 'true' } } }]) expect(() => validateRepoTools(bad)).toThrow();
  expect(() => validateConfig({ schemaVersion: 2, environments: [], sites: [{ id: 's', name: 'Store', cartridgesPath: 'app_a', repoTools: { repoJobs: 2 } }], repoTools: { nodeVersion: '8.17.0' } })).not.toThrow();
 });
});

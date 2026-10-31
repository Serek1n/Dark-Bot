// scripts/update.sh against a real git repository with main and beta branches. npm and pm2 are fakes: "pm2 restart" plays
// the bot by writing data/status.json — unless the checked-out code contains a file BROKEN (a version that does not start).
const fs = require('fs'); const path = require('path'); const os = require('os'); const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');

const results = []; let failed = 0;
function test(name, fn) { try { fn(); results.push(`✅ ${name}`); } catch (e) { failed++; results.push(`❌ ${name}\n   ${String(e.stack || e).split('\n').slice(0, 4).join(' | ')}`); } }

const project = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dark-update-'));
const remote = path.join(tmp, 'remote.git'); const work = path.join(tmp, 'work'); const server = path.join(tmp, 'server'); const bin = path.join(tmp, 'bin');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();

// fake npm and pm2 (the "bot" writes data/status.json on restart unless the code is BROKEN)
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho "npm $*" >> "$PWD/data/calls.log"\nexit 0\n', { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'pm2'), `#!/bin/sh
echo "pm2 $*" >> "$PWD/data/calls.log"
case "$1" in
  describe) [ -f "$PWD/data/pm2-started" ] && exit 0 || exit 1 ;;
  restart|start)
    touch "$PWD/data/pm2-started"
    if [ ! -f "$PWD/BROKEN" ]; then node -e "require('fs').writeFileSync('data/status.json', JSON.stringify({pid:1,readyAt:Date.now()+5,bot:'x',panel:'x',channel:'release',tag:'Dark#1',guilds:1}))"; fi ;;
esac
exit 0
`, { mode: 0o755 });

// the project on GitHub: main, and beta with one more commit
git(tmp, 'init', '-q', '--bare', remote);
fs.mkdirSync(work); git(work, 'init', '-q', '-b', 'main'); git(work, 'remote', 'add', 'origin', remote);
fs.mkdirSync(path.join(work, 'scripts'));
fs.copyFileSync(path.join(project, 'scripts', 'update.sh'), path.join(work, 'scripts', 'update.sh'));
fs.copyFileSync(path.join(project, 'scripts', 'backup-db.js'), path.join(work, 'scripts', 'backup-db.js'));
fs.writeFileSync(path.join(work, '.gitignore'), 'data/\n.env\n');
fs.writeFileSync(path.join(work, 'package-lock.json'), '{"v":"main"}\n');
fs.writeFileSync(path.join(work, 'VERSION'), 'main-1\n');
git(work, 'add', '-A'); git(work, 'commit', '-qm', 'main 1'); git(work, 'push', '-q', 'origin', 'main');
git(work, 'checkout', '-qb', 'beta'); fs.writeFileSync(path.join(work, 'VERSION'), 'beta-1\n'); git(work, 'commit', '-qam', 'beta 1'); git(work, 'push', '-q', 'origin', 'beta');

// the server: a clone of main with a database and .env that must survive everything
git(tmp, 'clone', '-q', '-b', 'main', remote, server);
fs.mkdirSync(path.join(server, 'data'));
fs.writeFileSync(path.join(server, '.env'), 'DATABASE_PATH=./data/dark.sqlite\n');
execFileSync('node', ['-e', `const s=require('sqlite3');const d=new s.Database('${path.join(server, 'data', 'dark.sqlite')}');d.exec('CREATE TABLE t(x);INSERT INTO t VALUES(42)',()=>d.close())`], { env: { ...process.env, NODE_PATH: path.join(project, 'node_modules') } });

const run = (...args) => spawnSync('bash', ['scripts/update.sh', ...args], { cwd: server, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_PATH: path.join(project, 'node_modules'), UPDATE_WAIT: '3' } });
const version = () => fs.readFileSync(path.join(server, 'VERSION'), 'utf8').trim();
const branch = () => git(server, 'rev-parse', '--abbrev-ref', 'HEAD');

test('switch to beta: the beta code runs, a copy of the database is made, .env and data stay', () => {
  fs.writeFileSync(path.join(server, 'package-lock.json'), '{"changed":"by npm on the server"}\n'); // the old "git pull" blocker
  const r = run('beta');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert(version() === 'beta-1' && branch() === 'beta', version());
  assert(fs.existsSync(path.join(server, '.env')) && fs.readdirSync(path.join(server, 'data', 'backups')).some((f) => f.includes('before-beta')), 'backup');
  assert(/npm ci --omit=dev/.test(fs.readFileSync(path.join(server, 'data', 'calls.log'), 'utf8')), 'dependencies installed');
  assert(fs.readFileSync(path.join(server, 'data', '.last-good'), 'utf8').startsWith('beta '), 'remembered as working');
});

test('back to main, and "update" without an argument follows the current branch', () => {
  assert.strictEqual(run('main').status, 0); assert(version() === 'main-1' && branch() === 'main');
  git(work, 'checkout', '-q', 'main'); fs.writeFileSync(path.join(work, 'VERSION'), 'main-2\n'); git(work, 'commit', '-qam', 'main 2'); git(work, 'push', '-q', 'origin', 'main');
  const r = run(); assert.strictEqual(r.status, 0, r.stdout + r.stderr); assert.strictEqual(version(), 'main-2');
});

test('a version that does not start is rolled back automatically to the one that worked', () => {
  git(work, 'checkout', '-q', 'beta'); fs.writeFileSync(path.join(work, 'BROKEN'), 'x'); fs.writeFileSync(path.join(work, 'VERSION'), 'beta-broken\n'); git(work, 'add', '-A'); git(work, 'commit', '-qm', 'broken'); git(work, 'push', '-q', 'origin', 'beta');
  const r = run('beta');
  assert.notStrictEqual(r.status, 0);
  assert(/не запустилась/.test(r.stdout) && /прежней версии/.test(r.stdout), r.stdout);
  assert(version() === 'main-2' && branch() === 'main', 'previous version is back: ' + version());
});

test('rollback and status commands; unknown branch refused', () => {
  const s = run('status'); assert(s.status === 0 && /Ветка: main/.test(s.stdout) && /Последняя рабочая версия: main/.test(s.stdout), s.stdout);
  assert.strictEqual(run('rollback').status, 0); assert.strictEqual(version(), 'main-2');
  const bad = run('nope'); assert(bad.status !== 0 && /Неизвестная команда/.test(bad.stdout));
});

test('the database copy is a real, readable SQLite file', () => {
  const dir = path.join(server, 'data', 'backups'); const f = fs.readdirSync(dir)[0];
  const out = execFileSync('node', ['-e', `const s=require('sqlite3');const d=new s.Database('${path.join(dir, f)}');d.get('SELECT x FROM t',(e,r)=>{console.log(r&&r.x);d.close()})`], { env: { ...process.env, NODE_PATH: path.join(project, 'node_modules') } }).toString().trim();
  assert.strictEqual(out, '42');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(results.join('\n')); console.log(`\nИтого: ${results.length - failed}/${results.length} прошли успешно`);
process.exit(failed ? 1 : 0);

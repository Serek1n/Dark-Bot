// Versions shown in the web panel. version.json holds the bot's and the panel's own version numbers (raised with every
// release); git adds the exact build: branch and commit. Everything is read once, at start.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const startedAt = new Date();
let cached = null;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch { return {}; }
}

/** Branch, short commit and its date. Uses the git command if there is one, otherwise reads .git by hand (no date then). */
function gitInfo() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%h|%cI|%D'], { cwd: ROOT, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const [commit, date, refs] = out.split('|');
    const branch = (refs || '').match(/HEAD -> ([^,]+)/)?.[1] || null;
    if (commit) return { commit, date: date ? new Date(date) : null, branch };
  } catch { /* no git command: read the files */ }
  try {
    const head = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref: (refs\/heads\/(.+))$/);
    if (!ref) return { commit: head.slice(0, 7), date: null, branch: null };
    let sha = null;
    try { sha = fs.readFileSync(path.join(ROOT, '.git', ref[1]), 'utf8').trim(); } catch {
      const packed = fs.readFileSync(path.join(ROOT, '.git', 'packed-refs'), 'utf8');
      sha = packed.split('\n').find((l) => l.endsWith(' ' + ref[1]))?.split(' ')[0] || null;
    }
    return { commit: sha ? sha.slice(0, 7) : null, date: null, branch: ref[2] };
  } catch {
    return { commit: null, date: null, branch: null }; // no .git folder (e.g. Docker)
  }
}

function versionInfo() {
  if (!cached) {
    const v = readJson('version.json');
    const pkg = readJson('package.json');
    const lock = readJson('package-lock.json');
    const dep = (name) => lock.packages?.[`node_modules/${name}`]?.version || pkg.dependencies?.[name] || null;
    cached = {
      bot: v.bot || pkg.version || '0.0.0',
      panel: v.panel || pkg.version || '0.0.0',
      ...gitInfo(),
      node: process.versions.node,
      discordJs: dep('discord.js'),
      startedAt
    };
  }
  return { ...cached, uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000) };
}

/** "2 д 3 ч", "5 ч 12 мин", "4 мин". */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${m} мин`;
  return `${Math.max(1, m)} мин`;
}

/** For tests. */
function resetVersion() { cached = null; }

module.exports = { versionInfo, formatUptime, resetVersion };

// Which version of the bot is running: the beta build or the release. Decided by the git branch the code was taken from
// (branch "beta" = beta build, anything else = release), or set by hand with BOT_CHANNEL=beta | release in .env
// (needed where there is no .git folder, e.g. in Docker). Beta features exist only in the beta build.
const fs = require('fs');
const path = require('path');

let cached = null;

function fromEnv() {
  const v = String(process.env.BOT_CHANNEL || '').trim().toLowerCase();
  if (v === 'beta') return 'beta';
  if (v === 'release' || v === 'main' || v === 'stable') return 'release';
  return null;
}

function fromGit() {
  try {
    const head = fs.readFileSync(path.join(__dirname, '..', '..', '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    return m && m[1].toLowerCase().startsWith('beta') ? 'beta' : 'release';
  } catch {
    return 'release'; // no .git folder: the release
  }
}

/** 'beta' or 'release' (decided once, when first asked). */
function channel() {
  if (cached === null) cached = fromEnv() || fromGit();
  return cached;
}

const isBetaBuild = () => channel() === 'beta';

/** For tests: forget the decision. */
function resetChannel() { cached = null; }

module.exports = { channel, isBetaBuild, resetChannel };

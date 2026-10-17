// Start-up checks of the panel's secrets.
const WEAK = new Set(['change-me', 'changeme', 'secret', 'password', '']);

/** Throws when the session secret is missing, a known placeholder or too short to be safe. */
function requireSessionSecret(env = process.env) {
  const s = String(env.SESSION_SECRET || '').trim();
  if (WEAK.has(s.toLowerCase()) || s.length < 24) {
    throw new Error('SESSION_SECRET не задан или слишком простой. Укажите в .env случайную строку от 24 символов, например: openssl rand -hex 32');
  }
  return s;
}

module.exports = { requireSessionSecret };

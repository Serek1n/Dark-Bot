// Optimisations: parallel Discord lookups share one request, indexes exist, fonts are cached for a year.
process.env.DATABASE_PATH = './data/test_optimize.sqlite';
process.env.DISCORD_TOKEN = 'x';
const fs = require('fs');
fs.mkdirSync('./data', { recursive: true });
['', '-shm', '-wal'].forEach((x) => fs.rmSync(process.env.DATABASE_PATH + x, { force: true }));
const axios = require('axios');

(async () => {
  const results = [];
  const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await test('five pages asking for the same channels at once cause one Discord request; a failed load is not remembered', async () => {
    const api = require('../web/discordApi'); let calls = 0; let fail = true;
    api.botApi.get = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); if (fail) throw new Error('boom'); return { data: [{ id: '1' }] }; };
    const bad = await Promise.allSettled([api.getGuildChannels('G'), api.getGuildChannels('G')]);
    assert(calls === 1 && bad.every((r) => r.status === 'rejected'), 'shared failure ' + calls);
    fail = false; calls = 0;
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => api.getGuildChannels('G')));
    assert(calls === 1 && out.every((x) => x[0].id === '1'), 'one request: ' + calls);
    await api.getGuildChannels('G'); assert(calls === 1, 'cached afterwards');
  });
  await test('database: the indexes for sorting and lookups exist after start', async () => {
    const db = require('../db'); await db.init();
    const [rows] = await db.sequelize.query("SELECT name FROM sqlite_master WHERE type='index'");
    const names = rows.map((r) => r.name);
    for (const n of ['member_profiles_guild_xp', 'member_profiles_guild_chat', 'member_profiles_guild_voicexp', 'temp_voice_guild_owner', 'mod_logs_guild_created', 'warnings_guild_user']) assert(names.includes(n), 'missing ' + n);
  });
  await test('static files: fonts are cached for a year, other files for a week', async () => {
    const express = require('express'); const path = require('path'); const http = require('http');
    const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.js'), 'utf8');
    assert(/\.woff2'\)\) res\.setHeader\('Cache-Control', 'public, max-age=31536000, immutable'\)/.test(src) && /maxAge: '7d'/.test(src), 'headers configured');
  });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.l}${r.ok ? '' : '\n      ' + r.e}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();

// yt-dlp options from .env, and the readable reason when YouTube refuses.
const fs = require('fs'); const path = require('path'); const os = require('os');
process.env.YTDLP_PATH = path.join(__dirname, 'fail-ytdlp.sh');
try { require('fs').chmodSync(process.env.YTDLP_PATH, 0o755); } catch {} // git on Windows does not keep the executable bit
const P = require('../bot/modules/music/player');
const results = [];
const test = async (l, f) => { try { await f(); results.push({ l, ok: true }); } catch (e) { results.push({ l, ok: false, e: e.stack.split('\n').slice(0, 3).join(' | ') }); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  const cookies = path.join(os.tmpdir(), 'dark-test-cookies.txt'); fs.writeFileSync(cookies, '# Netscape HTTP Cookie File\n');
  await test('no settings: nothing is added', async () => {
    delete process.env.YTDLP_COOKIES; delete process.env.YTDLP_EXTRA_ARGS;
    assert(P.ytDlpBaseArgs().length === 0 && !P.ytDlpAudioArgs('https://youtu.be/x').includes('--cookies'), 'empty');
  });
  await test('cookies file and extra options are passed to every download; a missing cookies file is ignored', async () => {
    process.env.YTDLP_COOKIES = cookies; process.env.YTDLP_EXTRA_ARGS = '--js-runtimes node';
    const a = P.ytDlpAudioArgs('https://youtu.be/x');
    assert(a.slice(0, 4).join(' ') === `--cookies ${cookies} --js-runtimes node` && a.includes('https://youtu.be/x') && a.includes('-f'), a.join(' '));
    process.env.YTDLP_COOKIES = '/no/such/file.txt'; assert(!P.ytDlpBaseArgs().includes('--cookies'), 'missing file ignored');
    delete process.env.YTDLP_COOKIES; delete process.env.YTDLP_EXTRA_ARGS;
  });
  await test('the two real errors from the server are explained in words', async () => {
    assert(P.ytDlpFailReason('ERROR: [youtube] 3UxEwmfZq04: Sign in to confirm your age. Use --cookies-from-browser').includes('возрастным'), 'age');
    assert(P.ytDlpFailReason('ERROR: unable to download video data: HTTP Error 403: Forbidden').includes('403'), '403');
    assert(P.ytDlpFailReason("Sign in to confirm you're not a bot").includes('не бот'), 'bot check');
    assert(P.ytDlpFailReason('Video unavailable').includes('недоступно') && P.ytDlpFailReason('something odd') === null, 'others');
  });
  await test('a failing download reports the reason to the chat (only when no audio came out)', async () => {
    const got = await new Promise((resolve) => { P.spawnYtDlpAudio('https://youtu.be/x', (reason) => resolve(reason)); setTimeout(() => resolve('timeout'), 4000); });
    assert(typeof got === 'string' && got.includes('возрастным'), 'reason: ' + got);
  });
  await test('a new yt-dlp gets this very Node as its JS runtime and may fetch the challenge solver; an old one gets nothing', async () => {
    delete process.env.YTDLP_EXTRA_ARGS; delete process.env.YTDLP_JS_RUNTIME;
    const keep = P._ytDlp.version;
    P._ytDlp.version = '2025.12.08';
    let a = P.ytDlpBaseArgs();
    assert(a.join(' ') === `--js-runtimes node:${process.execPath} --remote-components ejs:github`, a.join(' '));
    assert(P.ytDlpAudioArgs('https://youtu.be/x').indexOf('--js-runtimes') < P.ytDlpAudioArgs('https://youtu.be/x').indexOf('--'), 'before the url');
    process.env.YTDLP_EXTRA_ARGS = '--js-runtimes deno'; a = P.ytDlpBaseArgs();
    assert(a.join(' ') === '--js-runtimes deno', 'own runtime wins: ' + a.join(' '));
    delete process.env.YTDLP_EXTRA_ARGS; process.env.YTDLP_JS_RUNTIME = 'off';
    assert(P.ytDlpBaseArgs().length === 0, 'switched off'); delete process.env.YTDLP_JS_RUNTIME;
    P._ytDlp.version = '2025.06.30';
    assert(P.ytDlpBaseArgs().length === 0, 'old yt-dlp does not know the options');
    assert(P.ytDlpFailReason('ERROR: [youtube] x: n challenge solving failed').includes('2025.06.30'), 'old version named in the reason');
    P._ytDlp.version = '2025.12.08';
    assert(P.ytDlpFailReason('WARNING: [youtube] x: n challenge solving failed. Requested format is not available').includes('yt-dlp -U'), 'new: update hint');
    assert(P.versionAtLeast('2025.11.12', '2025.11.12') && P.versionAtLeast('2026.1.5', '2025.11.12') && !P.versionAtLeast(null, '2025.11.12'), 'compare');
    P._ytDlp.version = keep;
  });
  await test('the installed version is read from yt-dlp --version', async () => {
    const fake = path.join(os.tmpdir(), 'dark-test-ytdlp-' + process.pid + '.sh');
    fs.writeFileSync(fake, '#!/bin/sh\necho 2025.12.08\n'); fs.chmodSync(fake, 0o755);
    const fresh = require('child_process').spawnSync(process.execPath, ['-e', `process.env.YTDLP_PATH=${JSON.stringify(fake)};const P=require(${JSON.stringify(path.join(__dirname, '..', 'bot/modules/music/player'))});P.probeYtDlp().then((v)=>{console.log(v, P.ytDlpBaseArgs().includes('--js-runtimes'));process.exit(0)})`], { encoding: 'utf8', timeout: 20000 });
    fs.rmSync(fake, { force: true });
    assert(fresh.stdout.trim().endsWith('2025.12.08 true'), 'probe: ' + fresh.stdout + fresh.stderr);
  });
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();

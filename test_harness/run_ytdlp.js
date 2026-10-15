// yt-dlp options from .env, and the readable reason when YouTube refuses.
const fs = require('fs'); const path = require('path'); const os = require('os');
process.env.YTDLP_PATH = path.join(__dirname, 'fail-ytdlp.sh');
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
  results.forEach((r) => console.log(r.ok ? '✅' : '❌', r.l, r.ok ? '' : '\n   ' + r.e));
  console.log(`\nИтого: ${results.filter((r) => r.ok).length}/${results.length} прошли успешно`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();

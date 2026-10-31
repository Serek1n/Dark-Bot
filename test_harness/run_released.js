// There is one version of the bot (the release): every feature follows only its own switch, no beta switch or tags exist.
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const F = require('../bot/utils/features');
assert.strictEqual(F.FEATURES.filter((f) => f.beta).length, 0, 'no feature is marked beta');
assert(!('betaPages' in F), 'no beta menu tags');
assert.strictEqual(F.isEnabled({ webhooksEnabled: true }, 'webhooks'), true);
assert.strictEqual(F.isEnabled({ webhooksEnabled: false }, 'webhooks'), false, 'the normal switch works');
assert(!fs.existsSync(path.join(__dirname, '..', 'bot', 'utils', 'channel.js')), 'no beta/release channel module');
assert(!fs.existsSync(path.join(__dirname, '..', '.github', 'workflows', 'promote.yml')), 'no beta → main workflow');
const views = ['web/views/partials/sidebar.ejs', 'web/views/dashboard/features.ejs', 'web/views/guilds.ejs', 'web/views/dashboard/overview.ejs', 'web/public/css/style.css'];
views.forEach((v) => assert(!/beta|бета/i.test(fs.readFileSync(path.join(__dirname, '..', v), 'utf8')), v + ' mentions beta'));
const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'update.sh'), 'utf8');
assert(!/update\.sh beta/.test(sh), 'update.sh has no beta mode');
console.log('released OK');

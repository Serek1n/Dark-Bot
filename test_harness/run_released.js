// Webhooks are released: on by default, for every server and in every build, no beta switch needed.
process.env.BOT_CHANNEL = 'release';
const assert = require('assert');
const F = require('../bot/utils/features');
const w = F.FEATURES.find((x) => x.key === 'webhooks');
assert(w && !w.beta, 'not marked beta');
assert(!F.betaPages.includes('webhooks'), 'no beta tag in the menu');
assert.strictEqual(F.FEATURES.filter((f) => f.beta).length, 0, 'no feature is in beta at the moment');
assert.strictEqual(F.isEnabled({ webhooksEnabled: true, betaEnabled: false }, 'webhooks'), true);
assert.strictEqual(F.isEnabled({ webhooksEnabled: false }, 'webhooks'), false, 'the normal switch still works');
console.log('released OK');

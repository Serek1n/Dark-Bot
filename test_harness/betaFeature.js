// The beta mechanism is tested with a feature that is marked beta ON PURPOSE: the webhooks were released, so no real feature is in beta now.
const F = require('../bot/utils/features');
const f = F.FEATURES.find((x) => x.key === 'webhooks');
f.beta = true;
if (!F.betaPages.includes(f.page)) F.betaPages.push(f.page);
module.exports = F;

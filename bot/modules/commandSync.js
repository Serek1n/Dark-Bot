// Registers the slash commands at start, but only when their set has changed since the last registration: after an
// update with new commands nobody has to remember `npm run deploy-commands`. The fingerprint of the registered set is
// kept in data/commands.hash. COMMAND_SYNC=off leaves registration to the manual script.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const file = path.join(__dirname, '..', '..', 'data', 'commands.hash');

function commandBodies(commands) {
  const { localizeCommand } = require('../../i18n/discord');
  return [...commands.values()].map((c) => localizeCommand({ ...c.data.toJSON(), ...(c.dmAllowed ? {} : { contexts: [0] }) }));
}
const fingerprint = (bodies) => crypto.createHash('sha256').update(JSON.stringify(bodies)).digest('hex');

async function syncCommands(client) {
  if (String(process.env.COMMAND_SYNC || '').toLowerCase() === 'off') return false;
  if (!client?.application?.commands?.set || !client.commands?.size) return false;
  const bodies = commandBodies(client.commands);
  const hash = fingerprint(bodies);
  let known = '';
  try { known = fs.readFileSync(file, 'utf8').trim(); } catch { /* first start */ }
  if (known === hash) return false;
  await client.application.commands.set(bodies);
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, hash); } catch (err) { logger.warn(`commands.hash not written: ${err.message}`); }
  logger.info(`Slash commands registered: ${bodies.length} (the set changed since the last start).`);
  return true;
}

module.exports = { syncCommands, commandBodies, fingerprint };

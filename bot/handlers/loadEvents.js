const fs = require('fs');
const path = require('path');

function loadEvents(client) {
  const eventsDir = path.join(__dirname, '..', 'events');

  for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
    const loaded = require(path.join(eventsDir, file));
    // A file may export one event or a list of them (the log events live in one file).
    for (const event of Array.isArray(loaded) ? loaded : [loaded]) {
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
    }
  }
}

module.exports = { loadEvents };

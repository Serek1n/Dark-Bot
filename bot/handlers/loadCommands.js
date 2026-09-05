const fs = require('fs');
const path = require('path');

function loadCommands() {
  const commands = new Map();
  const commandsDir = path.join(__dirname, '..', 'commands');

  for (const category of fs.readdirSync(commandsDir)) {
    const categoryPath = path.join(commandsDir, category);
    if (!fs.statSync(categoryPath).isDirectory()) continue;

    for (const file of fs.readdirSync(categoryPath).filter((f) => f.endsWith('.js'))) {
      const command = require(path.join(categoryPath, file));
      if (!command?.data?.name) continue;
      command.category = category;
      commands.set(command.data.name, command);
    }
  }

  return commands;
}

module.exports = { loadCommands };

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
      // One module can expose several flat slash commands ("variants"): each one runs the module's
      // execute() with a fixed internal subcommand, so /profile and /top share one implementation.
      for (const v of command?.variants || []) {
        commands.set(v.data.name, {
          data: v.data,
          category,
          execute: (interaction) => {
            interaction.options.getSubcommand = () => v.sub;
            return command.execute(interaction);
          }
        });
      }
      if (command?.variants) continue; // the module's own grouped `data` is not registered
      if (!command?.data?.name) continue;
      command.category = category;
      commands.set(command.data.name, command);
    }
  }

  return commands;
}

module.exports = { loadCommands };

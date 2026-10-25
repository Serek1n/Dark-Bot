// "Профиль" in the member's right-click menu (Polaris' "View XP"): the same card as /profile, visible only to the one who asked.
const { ContextMenuCommandBuilder, ApplicationCommandType } = require('discord.js');
const profile = require('./profile');

module.exports = {
  data: new ContextMenuCommandBuilder().setName('Profile').setNameLocalizations({ ru: 'Профиль' }).setType(ApplicationCommandType.User),
  async execute(interaction) {
    const target = interaction.targetUser;
    interaction.options = { ...interaction.options, getSubcommand: () => 'view', getUser: () => target };
    interaction.privateAnswer = true;
    return profile.execute(interaction);
  }
};

// /appeal — «Мои наказания и апелляции»: works in the bot's DMs too (a banned person has no server to type it on).
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  dmAllowed: true,
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Мои наказания и апелляции: обжаловать наказание прямо здесь')
    .setDMPermission(true),
  async execute(interaction) {
    return require('../../modules/appealDm').mine(interaction);
  }
};

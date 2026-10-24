const { AttachmentBuilder } = require('discord.js');
const { getOrCreateSettings } = require('../modules/leveling');
const logger = require('../utils/logger');
const { renderWelcomeCard } = require('../modules/welcomeCard');
const { restoreMember } = require('../modules/memberRestore');

/** {user} {name} {server} {count} -> text. `mention` is false for people who already left (no ping). */
function fillTemplate(template, member, mention = true) {
  const name = member.displayName || member.user?.username || 'участник';
  return String(template || '')
    .replaceAll('{user}', mention ? `<@${member.id}>` : name)
    .replaceAll('{name}', name)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount ?? ''));
}

module.exports = {
  name: 'guildMemberAdd',
  fillTemplate,
  async execute(member) {
    await restoreMember(member); // returning member: roles and nickname come back (works even when the welcome message is off)
    const settings = await getOrCreateSettings(member.guild.id);
    if (!settings || !settings.welcomeEnabled) return;

    if (settings.autoRoleId) {
      const role = member.guild.roles.cache.get(settings.autoRoleId);
      if (role) member.roles.add(role).catch((err) => logger.warn('Failed to add autorole:', err.message));
    }

    if (settings.welcomeChannelId) {
      const channel = await member.guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
      if (channel) {
        const payload = { content: fillTemplate(settings.welcomeMessage, member), allowedMentions: { users: [member.id] } };
        if (settings.welcomeCard) {
          try {
            const png = await renderWelcomeCard({
              username: member.displayName || member.user?.username || 'участник',
              avatarURL: member.user?.displayAvatarURL?.({ extension: 'png', size: 256 }),
              serverName: member.guild.name,
              memberCount: member.guild.memberCount
            });
            payload.files = [new AttachmentBuilder(png, { name: 'welcome.png' })];
          } catch (err) {
            logger.warn('Welcome card failed:', err.message); // the text still goes out
          }
        }
        channel.send(payload).catch(() => {});
      }
    }
  }
};

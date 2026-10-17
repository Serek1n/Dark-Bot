// Reminders: "remind me in 2 hours to ...". A timer checks the table every 15 seconds.
const { Op } = require('sequelize');
const { Reminder } = require('../../db');
const logger = require('../utils/logger');

const MAX_PENDING = 25;
const MIN_MS = 10_000;
const MAX_MS = 365 * 24 * 60 * 60 * 1000;

async function deliver(client, reminder) {
  const text = `⏰ <@${reminder.userId}>, напоминание: ${reminder.text}`;
  let sent = false;
  if (reminder.channelId) {
    const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
    if (channel) sent = Boolean(await channel.send({ content: text, allowedMentions: { users: [reminder.userId] } }).catch(() => null));
  }
  if (!sent) {
    const user = await client.users.fetch(reminder.userId).catch(() => null);
    await user?.send?.(`⏰ Напоминание: ${reminder.text}`).catch(() => {});
  }
}

async function tick(client) {
  const due = await Reminder.findAll({ where: { remindAt: { [Op.lte]: new Date() } }, order: [['remindAt', 'ASC']], limit: 50 });
  for (const reminder of due) {
    try {
      await reminder.destroy(); // first, so a slow send can never fire the same reminder twice
      await deliver(client, reminder);
    } catch (err) {
      logger.error(`Reminder ${reminder.id} failed:`, err.message);
    }
  }
}

let timer = null;
function startReminderScheduler(client) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(client).catch((err) => logger.error('Reminder tick failed:', err.message)), 15_000);
  timer.unref?.();
  tick(client).catch(() => {});
}

module.exports = { startReminderScheduler, tick, deliver, MAX_PENDING, MIN_MS, MAX_MS };

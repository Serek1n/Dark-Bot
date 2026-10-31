// The embed part of the message editor (partials/embed-editor.ejs) arrives as fields "<prefix>_title", "<prefix>_color"…
// Turns them into the stored JSON, or null when the embed is switched off.
const { parseEmbed } = require('../../bot/utils/messageBuilder');

function embedFromBody(body, prefix) {
  const f = (k) => body[`${prefix}_${k}`];
  if (f('on') !== 'on') return null;
  const e = parseEmbed({ on: true, title: f('title'), description: f('description'), color: f('color'), image: f('image'), thumbnail: f('thumbnail'), footer: f('footer'), timestamp: f('timestamp') === 'on' });
  if (!e) return null;
  if (e.image && !/^(https?:\/\/|\{)/i.test(e.image.trim())) e.image = ''; // a link, or a template that gives one
  return JSON.stringify(e);
}

module.exports = { embedFromBody };

// One message editor for every text the bot sends from a server's settings (welcome, farewell, level-up, custom commands):
// the plain text plus an optional embed. Every text part of the embed takes the same templates as the message itself.
// Stored as JSON: { on, title, description, color, image, thumbnail: ''|'avatar'|'icon', footer, timestamp }.
const { EmbedBuilder } = require('discord.js');

const LIMITS = { title: 256, description: 4000, footer: 2048, image: 500 };
const HEX = /^#?[0-9a-f]{6}$/i;
const httpUrl = (u) => { try { const x = new URL(String(u).trim()); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

/** Whatever was stored (JSON text, object, null) → a clean embed description, or null when there is no embed. */
function parseEmbed(raw) {
  let e = raw;
  if (typeof raw === 'string') { try { e = JSON.parse(raw); } catch { return null; } }
  if (!e || typeof e !== 'object' || !e.on) return null;
  const s = (v, n) => String(v ?? '').slice(0, n);
  return {
    on: true,
    title: s(e.title, LIMITS.title),
    description: s(e.description, LIMITS.description),
    color: HEX.test(String(e.color || '')) ? `#${String(e.color).replace('#', '').toLowerCase()}` : '',
    image: s(e.image, LIMITS.image),
    thumbnail: ['avatar', 'icon'].includes(e.thumbnail) ? e.thumbnail : '',
    footer: s(e.footer, LIMITS.footer),
    timestamp: Boolean(e.timestamp)
  };
}

/** Is there anything to show in this embed at all? */
const hasBody = (e) => Boolean(e && (e.title.trim() || e.description.trim() || e.image.trim() || e.footer.trim()));

/**
 * Builds { content, embeds } for sending. `fill(text)` works out the templates; `images` gives the member avatar and the server
 * icon for the thumbnail; `attachmentImage` (e.g. "attachment://welcome.png") is shown as the embed picture when set.
 * The content is never empty when there is no embed (the default text stays).
 */
function buildMessage({ text, embed, fill: rawFill = (t) => t, images = {}, attachmentImage = null, defaultColor = 0x8b7cf6 }) {
  const fill = (t) => (String(t || '').trim() ? String(rawFill(t) ?? '') : ''); // empty parts stay empty (no default texts)
  const e = parseEmbed(embed);
  const content = String(fill(text || '') || '').slice(0, 2000);
  if (!e || !hasBody(e)) return { content, embeds: [] };
  const b = new EmbedBuilder().setColor(e.color ? parseInt(e.color.slice(1), 16) : defaultColor);
  const title = fill(e.title).trim().slice(0, LIMITS.title);
  const description = fill(e.description).trim().slice(0, LIMITS.description);
  const footer = fill(e.footer).trim().slice(0, LIMITS.footer);
  if (title) b.setTitle(title);
  if (description) b.setDescription(description);
  if (footer) b.setFooter({ text: footer });
  const image = attachmentImage || httpUrl(fill(e.image));
  if (image) b.setImage(image);
  const thumb = e.thumbnail === 'avatar' ? images.avatar : e.thumbnail === 'icon' ? images.icon : null;
  if (thumb && httpUrl(thumb)) b.setThumbnail(thumb);
  if (e.timestamp) b.setTimestamp(new Date());
  if (!title && !description && !image && !footer) return { content, embeds: [] };
  return { content, embeds: [b] };
}

/** Do the template parts of this message need the heavy context (level, full replacers)? */
const usesTemplates = (text, embed) => {
  const e = parseEmbed(embed);
  const all = [text, e?.title, e?.description, e?.footer, e?.image].filter(Boolean).join('\n');
  return { full: /\{\s*[a-z_]+\.|\{-/.test(all), level: all.includes('level.'), all };
};

module.exports = { parseEmbed, buildMessage, hasBody, usesTemplates, LIMITS };

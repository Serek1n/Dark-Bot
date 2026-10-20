// Downloading a picture from a link an admin typed in: https only, never an internal address (SSRF protection).
const axios = require('axios');
const https = require('https');
const net = require('net');

const MAX_AVATAR = 8 * 1024 * 1024;

// Addresses a webhook picture must never be fetched from: this machine, private networks, link-local, multicast.
const blocked = new net.BlockList();
for (const [addr, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) blocked.addSubnet(addr, bits, 'ipv6');

function isPrivateIp(ip) {
  let addr = String(ip).replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr); // IPv4 hidden inside an IPv6 address
  if (mapped) addr = mapped[1];
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
  if (hexMapped) { const hi = parseInt(hexMapped[1], 16); const lo = parseInt(hexMapped[2], 16); addr = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`; }
  const family = net.isIPv6(addr) ? 'ipv6' : net.isIPv4(addr) ? 'ipv4' : null;
  return !family || blocked.check(addr, family); // anything that is not an address at all is refused too
}

/**
 * A DNS lookup that checks the address it is about to connect to. Used by the HTTP client itself, so the
 * address that was checked is the address that is used (a name that answers "public" first and "internal"
 * a moment later - DNS rebinding - cannot slip through).
 */
function safeLookup(lookup = require('dns').lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
const agent = new https.Agent({ lookup: safeLookup() });

/** Downloads a picture the admin pointed to and returns it as a data URI. Only https, never an internal address. */
async function fetchAvatar(url) {
  let u; try { u = new URL(url); } catch { throw new Error('Ссылка на картинку некорректна.'); }
  if (u.protocol !== 'https:') throw new Error('Ссылка на картинку должна начинаться с https://');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(u.hostname)) throw new Error('По этой ссылке нельзя загрузить картинку.'); // an address written in the link skips DNS
  const res = await axios.get(u.href, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: MAX_AVATAR, maxRedirects: 0, httpsAgent: agent, validateStatus: (s) => s === 200 }).catch(() => { throw new Error('Не удалось скачать картинку по ссылке (или адрес недопустим).'); });
  const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) throw new Error('Аватарка должна быть PNG, JPG, GIF или WebP.');
  return `data:${type};base64,${Buffer.from(res.data).toString('base64')}`;
}

module.exports = { MAX_AVATAR, isPrivateIp, safeLookup, fetchAvatar };

/** { field: id } of the settings that point to a channel or a role the server no longer has (js/ui.js marks the field). */
function goneRefs(settings, channels, roles) {
  const ch = new Set(channels.map((c) => c.id)); const ro = new Set(roles.map((r) => r.id));
  const out = {};
  const values = settings.dataValues || settings;
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== 'string' || !/^\d{15,25}$/.test(v)) continue;
    if (/ChannelId$/.test(k) && !ch.has(v)) out[k] = { id: v, kind: 'channel' };
    else if (/RoleId$/.test(k) && !ro.has(v)) out[k] = { id: v, kind: 'role' };
  }
  return out;
}

module.exports = goneRefs;

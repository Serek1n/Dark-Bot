// For panel tests without a bot client: Discord REST answers as if the signed-in user ("OWNER") owns the server, so the
// role guard (web/utils/roles.js) lets ordinary roles through, the same way it does in production for the owner.
function ownerGet(guildId, roleIds) {
  const roles = [{ id: guildId, position: 0, permissions: '0' }, { id: 'BOTROLE', position: 99, permissions: '0' }, ...roleIds.map((id, i) => ({ id, position: i + 1, permissions: '0', managed: false }))];
  return async (url) => {
    if (url === `/guilds/${guildId}`) return { data: { id: guildId, owner_id: 'OWNER', roles } };
    if (url.startsWith(`/guilds/${guildId}/members/`)) return { data: { roles: url.endsWith('/OWNER') ? [] : ['BOTROLE'] } };
    return { data: {} };
  };
}
const asOwner = (req, res, next) => { req.user = req.user || { id: 'OWNER', username: 'owner' }; next(); };
module.exports = { ownerGet, asOwner };

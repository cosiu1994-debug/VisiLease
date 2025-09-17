// utils/permission-manager.js
const NodeCache = require('node-cache');
const axios = require('axios');

const cache = new NodeCache({ stdTTL: 300 }); // 5分钟缓存
const PDAC_BASE_URL = 'http://localhost:4001';

// 写入权限缓存
function setPermissions(userId, permissionMap) {
  const cacheKey = `permissions:${userId}`;
  cache.set(cacheKey, permissionMap);
}

// 获取权限缓存
function getPermissions(userId) {
  const cacheKey = `permissions:${userId}`;
  return cache.get(cacheKey);
}

// 拉取权限并缓存
async function fetchPermissionsFromPDAC(userId) {
  const cached = getPermissions(userId);
  if (cached) return cached;

  try {
    const res = await axios.get(`${PDAC_BASE_URL}/permissions/user/${userId}`);
    const permissions = res.data;
    setPermissions(userId, permissions);
    return permissions;
  } catch (err) {
    console.error('fetchPermissionsFromPDAC 错误：', err.message);
    return {};
  }
}

// 权限校验
async function hasPermission(userId, permKey, requiredScope = 'any') {
  const permissions = await fetchPermissionsFromPDAC(userId);
  const perm = permissions[permKey];

  if (!perm) return { ok: false, reason: 'NO_PERMISSION' };
  if (requiredScope !== 'any' && perm.scope !== requiredScope) {
    return { ok: false, reason: 'SCOPE_LIMIT', actualScope: perm.scope };
  }

  return {
    ok: true,
    scope: perm.scope || 'own',
    constraints: perm.constraints || {},
  };
}

module.exports = {
  setPermissions,
  getPermissions,
  hasPermission,
  fetchPermissionsFromPDAC,
  cache, // 如果需要主动清理
};

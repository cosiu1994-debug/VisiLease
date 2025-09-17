require('dotenv').config();

const { createClient } = require('redis');
const axios = require('axios');

// 从环境变量读取配置
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT, 10) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD
const PDAC_BASE_URL = process.env.PDAC_BASE_URL || 'http://localhost:4001';
console.log("mima:"+REDIS_PASSWORD);
console.log("port:"+REDIS_PORT);
console.log("host:"+REDIS_HOST);
// 初始化 Redis 客户端
const redisClient = createClient({
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT
  },
  password:REDIS_PASSWORD
});

redisClient.connect().catch(console.error);

// 生成缓存键
function getCacheKey(userId) {
  return `permissions:${userId}`;
}

// 写入权限缓存
async function setPermissions(userId, permissionMap, ttl) {
  console.log('[Redis Set]', { userId, ttl });
  const cacheKey = getCacheKey(userId);
  await redisClient.set(cacheKey, JSON.stringify(permissionMap), {
    EX: ttl,
  });
}

// 获取权限缓存
async function getPermissions(userId) {
  const cacheKey = getCacheKey(userId);
  const data = await redisClient.get(cacheKey);
  if (!data) return null;

  try {
    return JSON.parse(data);
  } catch (err) {
    console.warn('Redis 权限缓存解析失败:', err);
    return null;
  }
}

// 拉取权限并缓存
async function fetchPermissionsFromPDAC(userId) {
  const cached = await getPermissions(userId);
  if (cached) return cached;

  try {
    const res = await axios.get(`${PDAC_BASE_URL}/permissions/user/${userId}`);
    const permissions = res.data;
    await setPermissions(userId, permissions);
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
  redisClient,
  setPermissions,
  getPermissions,
  fetchPermissionsFromPDAC,
  hasPermission,
};

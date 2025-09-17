// checkPermissionMiddleware.js
const { hasPermission } = require('../utils/permission-manager-redis');

function checkPermissionMiddleware(permissionKey) {
    return async (req, res, next) => {
        const userId = req.user.id;
        const result = await hasPermission(userId, permissionKey);
        if (!result.ok) {
            return res.status(403).json({ message: '无权限访问' });
        }
        // 把权限 scope 挂载在 req 上，供后续业务逻辑使用
        req.permissionScope = result.scope;
        req.permissionConstraints = result.constraints || {};
        next();
    };
}

module.exports = checkPermissionMiddleware;

const express = require('express');
const router = express.Router();
const controller = require('../controllers/rolePermissionController');

// 角色权限绑定相关
router.post('/:id/permissions', controller.bindPermissions);
router.get('/:id/permissions', controller.listRolePermissions);
router.delete('/:id/permissions/:code', controller.unbindPermission);

module.exports = router;
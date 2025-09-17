const express = require('express');
const router = express.Router();
const controller = require('../controllers/roleController');

// 角色相关
router.post('/create', controller.createRole);
router.get('/', controller.listRoles);

module.exports = router;
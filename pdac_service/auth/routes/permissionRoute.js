const express = require('express');
const router = express.Router();
const controller = require('../controllers/permissionController');

router.post('/register', controller.registerPermission);
router.get('/', controller.listPermissions);
router.delete('/:code', controller.deletePermission);
router.get('/user/:userId', controller.getUserPermissions);
router.put('/edit', controller.editPermission);
module.exports = router;

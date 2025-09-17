const express = require('express');
const router = express.Router();
const controller = require('../controllers/userController');

//用户相关
router.post('/regist', controller.regist);
router.get('/user_list', controller.usersList);
router.post('/:id/roles/bind', controller.bindUserRoles);
router.get('/:id/roles', controller.getUserRoles);

module.exports = router;

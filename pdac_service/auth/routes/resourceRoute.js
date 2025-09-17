// pdac_service/routes/resourceRoute.js
const express = require('express');
const router = express.Router();
const resourceController = require('../controllers/resourceController');

router.post('/register', resourceController.registerResourceWithPermissions);
router.get('/list', resourceController.listResources);
module.exports = router;

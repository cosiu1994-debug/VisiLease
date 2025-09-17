const express = require("express");
const router = express.Router();
const workflowInstanceController = require("../controllers/workflowInstanceController");

router.post("/create_workflowInstance", workflowInstanceController.createWorkflowInstance);
router.get("/user_instances", workflowInstanceController.getUserWorkflowInstance);

module.exports = router;

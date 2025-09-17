const express = require("express");
const router = express.Router();

const workflowTaskController = require("../controllers/workflowTaskController");

router.post("/approveTask", workflowTaskController.approveTask);
router.get("/logs/:instanceId", workflowTaskController.getWorkflowLogs);
router.get("/logs/business/:businessKey", workflowTaskController.getWorkflowLogsByBusinessKey);
router.get('/pendingTasks', workflowTaskController.getPendingTasksByUser);

module.exports = router;
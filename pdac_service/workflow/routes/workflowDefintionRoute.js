const express = require("express");
const router = express.Router();
const workflowDefinitionController = require("../controllers/workflowDefinitionController");

// 创建流程定义模板
router.post("/definitions", workflowDefinitionController.createWorkflowDefinition);

router.get("/definitions_list", workflowDefinitionController.getWorkflowDefinitionList);

router.get("/definition/:id", workflowDefinitionController.getWorkflowDefinitionById);


module.exports = router;

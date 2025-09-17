const db = require("../../utils/db");
const { fetchWorkflowDefinitionById } = require("./workflowDefinitionController");
const FlowEngine = require("../../utils/flowEngine");
const FlowRunner = require('../../utils/flowRunner');

exports.createWorkflowInstance = async (req, res) => {
    const { workflow_definition_id, business_key, started_by, context = {} } = req.body;

    if (!workflow_definition_id || !business_key || !started_by) {
        return res.status(400).json({ success: false, message: "缺少必要字段" });
    }

    try {
        // 1. 获取流程定义
        const definitionRow = await fetchWorkflowDefinitionById(workflow_definition_id);
        if (!definitionRow) {
            return res.status(404).json({ success: false, message: "流程定义不存在" });
        }

        const template = JSON.parse(definitionRow.definition_json);
        const baseContext = template.base_context || {};
        const mergedContext = { ...baseContext, ...context };

        console.log("模板结构:", template);
        console.log("合并后的 context:", mergedContext);

        // 2. 创建流程实例
        const [instanceResult] = await db.query(
            `INSERT INTO workflow_instances 
             (workflow_definition_id, business_key, status, started_by, started_at, current_node, context_json)
             VALUES (?, ?, 'RUNNING', ?, NOW(), NULL, ?)`,
            [workflow_definition_id, business_key, started_by, JSON.stringify(mergedContext)]
        );
        const instanceId = instanceResult.insertId;
        console.log("创建流程实例 ID:", instanceId);

        // 3. 初始化 FlowEngine + FlowRunner
        const engine = new FlowEngine(template, mergedContext);
        console.log("==== FlowEngine 初始化 ====");
        console.log("模板节点数量:", template.nodes.length);
        console.log("初始上下文:", mergedContext);

        const runner = new FlowRunner(engine, {
            completedNodes: [],
            pendingTasks: [],
            context: mergedContext
        });

        // 4. 推进 start 节点
        const startNode = engine.getStartNode();
        console.log("Start 节点:", startNode);

        if (startNode) {
            await runner.completeTask(startNode.id);
        }

        const pendingTasks = runner.getPendingTasks();
        console.log("生成初始待办任务对象数组:", pendingTasks);

        // 5. 写入数据库
        // 5.1 记录 start 节点为已处理
        if (startNode) {
            await db.query(
                `INSERT INTO workflow_tasks 
                 (workflow_instance_id, node_code, node_name, status, acted_by, acted_at, assigned_at, comment)
                 VALUES (?, ?, ?, 'PROCESSED', ?, NOW(), NOW(), '流程发起')`,
                [instanceId, startNode.id, startNode.name, started_by]
            );
        }

        // 5.2 写入待办任务
        for (const node of pendingTasks) {
            const roleId = node.role || null;
            const roleText = node.roleText || null;

            // 避免重复插入
            const [[exists]] = await db.query(
                `SELECT 1 FROM workflow_tasks WHERE workflow_instance_id = ? AND node_code = ?`,
                [instanceId, node.nodeId]   // <- 改这里
            );
            if (!exists) {
                await db.query(
                    `INSERT INTO workflow_tasks
                     (workflow_instance_id, node_code, node_name, assignee_role, assignee_role_id, status, assigned_at)
                     VALUES (?, ?, ?, ?, ?, 'PENDING', NOW())`,
                    [instanceId, node.nodeId, node.name, roleText, roleId]
                );
            }
        }

        // 6. 更新实例 current_node 为第一个待办
        const currentNode = pendingTasks.length > 0 ? pendingTasks[0].id : null;
        await db.query(
            `UPDATE workflow_instances SET current_node = ? WHERE id = ?`,
            [currentNode, instanceId]
        );

        // 7. 更新合同状态为审批中
        await db.query(
            `UPDATE contracts SET status = 'approve_pending' WHERE id = ?`,
            [business_key]
        );

        // 8. 返回前端
        return res.json({
            success: true,
            message: "流程实例创建成功",
            instance_id: instanceId,
            current_node: currentNode,
            tasks: pendingTasks,
            context: mergedContext
        });

    } catch (error) {
        console.error("创建流程实例失败:", error);
        return res.status(500).json({ success: false, message: "服务器错误" });
    }
};

// 查询指定用户发起的流程实例
exports.getUserWorkflowInstance = async (req, res) => {
    try {
        // 从 query 获取 userId
        const userId = req.query.userId;
        if (!userId) {
            return res.status(400).json({ success: false, message: "缺少 userId" });
        }

        // 从 query 获取分页和状态参数
        const status = req.query.status;        // 可选
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // 构造 SQL 条件
        const whereClause = [`started_by = ?`];
        const params = [userId];

        if (status) {
            whereClause.push(`status = ?`);
            params.push(status);
        }

        const sql = `
            SELECT id, workflow_definition_id, business_key, status, current_node, started_by, context_json, started_at
            FROM workflow_instances
            WHERE ${whereClause.join(' AND ')}
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
        `;
        params.push(limit, offset);

        const [instances] = await db.query(sql, params);

        return res.json({
            success: true,
            user_id: userId,
            page,
            limit,
            count: instances.length,
            instances
        });

    } catch (err) {
        console.error("获取用户发起的流程失败:", err);
        return res.status(500).json({ success: false, message: "服务器错误" });
    }
};





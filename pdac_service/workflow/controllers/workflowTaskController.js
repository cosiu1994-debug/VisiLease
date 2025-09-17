const db = require("../../utils/db");
const { fetchWorkflowDefinitionById } = require("./workflowDefinitionController");
const FlowEngine = require("../../utils/flowEngine");
const FlowRunner = require('../../utils/flowRunner');
const unitSyncService = require('../../../mq_services/unitSyncService');

/**
 * 审批任务接口（同意 / 拒绝）
 * POST /api/workflow/approveTask
 */
exports.approveTask = async (req, res) => {
    const { task_id, approved_by, decision, comments, context_update = {} } = req.body;

    if (!task_id || !approved_by || !decision) {
        return res.status(400).json({ success: false, message: "缺少必要字段" });
    }

    try {
        // 1. 查询任务
        const [[task]] = await db.query(`SELECT * FROM workflow_tasks WHERE id = ?`, [task_id]);
        if (!task || task.status !== 'PENDING') {
            return res.status(400).json({ success: false, message: "任务无效或已处理" });
        }

        // 2. 查询流程实例和模板
        const [[instance]] = await db.query(`SELECT * FROM workflow_instances WHERE id = ?`, [task.workflow_instance_id]);
        const templateRow = await fetchWorkflowDefinitionById(instance.workflow_definition_id);
        const template = JSON.parse(templateRow.definition_json);

        // 3. 合并上下文
        let currentContext = instance.context_json;
        if (typeof currentContext === 'string') currentContext = JSON.parse(currentContext);
        const newContext = { ...currentContext, ...context_update };

        // 4. 更新当前任务状态
        await db.query(`
            UPDATE workflow_tasks SET
                status = ?,
                comment = ?,
                acted_at = NOW(),
                acted_by = ?
            WHERE id = ?`,
            [decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', comments || null, approved_by, task_id]
        );

        // 5. 如果拒绝，立即终止流程
        if (decision === 'REJECT') {
            await db.query(`
                UPDATE workflow_instances SET 
                    status = 'REJECTED', 
                    current_node = NULL, 
                    context_json = ? 
                WHERE id = ?`,
                [JSON.stringify(newContext), instance.id]
            );
            await db.query(`
                UPDATE workflow_tasks SET 
                    status = 'SKIPPED' 
                WHERE workflow_instance_id = ? AND id != ? AND status = 'PENDING'`,
                [instance.id, task_id]
            );

            return res.json({ success: true, message: "流程已被拒绝并终止", next_tasks: [] });
        }

        // 6. 恢复 FlowRunner 状态
        const [allTasks] = await db.query(`
            SELECT node_code, status FROM workflow_tasks WHERE workflow_instance_id = ?`,
            [instance.id]
        );
        const completedNodes = allTasks.filter(t => ['APPROVED', 'REJECTED', 'SKIPPED'].includes(t.status)).map(t => t.node_code);
        const pendingNodes = allTasks.filter(t => t.status === 'PENDING').map(t => t.node_code);

        const engine = new FlowEngine(template, newContext);
        const runner = new FlowRunner(engine, {
            context: newContext,
            instanceId: instance.id,
            persistHook: async (state) => {
                // 可选：把最新状态写入 DB（异步安全）
                await db.query(`
                    UPDATE workflow_instances SET context_json = ?, status = ?
                    WHERE id = ?`,
                    [JSON.stringify(state.context), state.finished ? 'APPROVED' : 'RUNNING', instance.id]
                );
            }
        });

        // 恢复历史状态
        await runner.restoreState({
            completed: completedNodes,
            pending: pendingNodes.map(id => ({ nodeId: id })), // FlowRunner 需要对象数组
            context: newContext,
            finished: instance.status === 'APPROVED'
        });

        // 7. 完成当前节点
        await runner.completeTask(task.node_code);
        console.log("盖章之后的完成节点：", Array.from(runner.completedNodes));
        // 打印所有 end 节点
        const endNodes = runner.engine.nodes.filter(n => n.type === 'end');
        console.log('[DEBUG] end nodes:', endNodes.map(n => n.id));

        // 逐个检查 end 节点是否在 completedNodes
        endNodes.forEach(n => {
            console.log(`End node ${n.id} in completedNodes?`, runner.completedNodes.has(n.id));
        });

        // 8. 获取新的待办任务
        let pendingTasks = runner.getPendingTasks().map(t => ({
            nodeId: t.nodeId,
            name: t.name,
            roleId: t.role || null
        }));

        // 去重
        const uniqueTasksMap = {};
        pendingTasks.forEach(t => { if (!uniqueTasksMap[t.nodeId]) uniqueTasksMap[t.nodeId] = t; });
        pendingTasks = Object.values(uniqueTasksMap);

        // 9. 写入数据库新任务
        for (const node of pendingTasks) {
            const [[exists]] = await db.query(
                `SELECT 1 FROM workflow_tasks WHERE workflow_instance_id = ? AND node_code = ?`,
                [instance.id, node.nodeId]
            );
            if (!exists) {
                await db.query(`
                    INSERT INTO workflow_tasks
                    (workflow_instance_id, node_code, node_name, assignee_role_id, status, assigned_at)
                    VALUES (?, ?, ?, ?, 'PENDING', NOW())`,
                    [instance.id, node.nodeId, node.name, node.roleId]
                );
            }
        }

        // 10. 更新流程实例状态
        const isFinished = runner.finished;
        await db.query(`
            UPDATE workflow_instances SET 
                context_json = ?, 
                status = ?, 
                current_node = ?
            WHERE id = ?`,
            [
                JSON.stringify(newContext),
                isFinished ? 'APPROVED' : 'RUNNING',
                isFinished ? null : pendingTasks[0]?.nodeId || null,
                instance.id
            ]
        );

        // 11. 同步合同状态
        if (isFinished) {
            await db.query(`UPDATE contracts SET status = 'active' WHERE id = ?`, [instance.business_key]);
            await unitSyncService.publishChange(instance.business_key, 'active');
        }

        return res.json({
            success: true,
            message: `任务审批成功，流程${isFinished ? "已完成" : "已流转"}`,
            next_tasks: pendingTasks
        });

    } catch (err) {
        console.error("审批任务失败:", err);
        return res.status(500).json({ success: false, message: "服务器错误" });
    }
};

/**
 * 获取指定流程实例的审批日志
 * GET /api/workflow/logs/:instanceId
 */
exports.getWorkflowLogs = async (req, res) => {
    const instanceId = req.params.instanceId;

    if (!instanceId) {
        return res.status(400).json({ success: false, message: "缺少流程实例 ID" });
    }

    try {
        // 查询流程实例是否存在
        const [[instance]] = await db.query(
            `SELECT * FROM workflow_instances WHERE id = ?`,
            [instanceId]
        );

        if (!instance) {
            return res.status(404).json({ success: false, message: "流程实例不存在" });
        }

        // 查询审批任务日志（排除未处理的任务）
        const [logs] = await db.query(
            `SELECT 
            node_name,
            assignee_role,
            status,
            acted_by,
            acted_at,
            comment,
            assigned_at
        FROM workflow_tasks
        WHERE workflow_instance_id = ?
            AND status IN ('APPROVED', 'REJECTED', 'SKIPPED', 'RETURNED')
        ORDER BY acted_at ASC`,
            [instanceId]
        );

        return res.json({
            success: true,
            instance_id: instance.id,
            business_key: instance.business_key,
            status: instance.status,
            logs
        });

    } catch (error) {
        console.error("获取流程日志失败:", error);
        return res.status(500).json({ success: false, message: "服务器错误" });
    }
};

exports.getWorkflowLogsByBusinessKey = async (req, res) => {
    const businessKey = req.params.businessKey;

    if (!businessKey) {
        return res.status(400).json({ success: false, message: "缺少业务编码" });
    }

    try {
        // 1️⃣ 查询流程实例
        const [[instance]] = await db.query(
            `SELECT id, workflow_definition_id, business_key, status, current_node, started_by, context_json
             FROM workflow_instances
             WHERE business_key = ?`,
            [businessKey]
        );

        if (!instance) {
            return res.status(404).json({ success: false, message: "未找到流程实例" });
        }

        // 2️⃣ 查询发起人姓名
        let startedByName = null;
        if (instance.started_by) {
            const [[user]] = await db.query(
                `SELECT name FROM sales_channels WHERE id = ?`,
                [instance.started_by]
            );
            startedByName = user?.name || null;
        }

        // 3️⃣ 获取实例上下文
        const context = instance.context_json || {};

        // 4️⃣ 查询流程定义
        const [[definition]] = await db.query(
            `SELECT definition_json 
             FROM workflow_definitions 
             WHERE id = ?`,
            [instance.workflow_definition_id]
        );

        if (!definition) {
            return res.status(500).json({ success: false, message: "流程定义缺失" });
        }

        const definitionJson = JSON.parse(definition.definition_json);
        const nodes = definitionJson.nodes || [];
        const transitions = definitionJson.transitions || [];

        // 5️⃣ 查询任务
        const [tasks] = await db.query(
            `SELECT node_code, node_name, assignee_role, status, acted_by, acted_at, comment, assigned_at
             FROM workflow_tasks
             WHERE workflow_instance_id = ?`,
            [instance.id]
        );

        // 6️⃣ 下游映射
        const downstreamMap = {};
        transitions.forEach(t => {
            if (!downstreamMap[t.from]) downstreamMap[t.from] = [];
            downstreamMap[t.from].push(t.to);
        });

        // 7️⃣ 递归裁剪流程树 + parallel_group 修正
        const visited = new Set();
        const SKIPPED_NODES = new Set();

        function traverse(nodeId, parentParallelId = null, isFirstLevelParallel = false) {
            if (visited.has(nodeId)) return [];
            visited.add(nodeId);

            const node = nodes.find(n => n.id === nodeId);
            if (!node) return [];

            const flowNodes = [];
            const isBusinessNode = node.type !== 'condition' && node.type !== 'parallel';

            if (isBusinessNode) {
                const task = tasks.find(t => String(t.node_code) === String(node.id));
                const isCurrent = String(instance.current_node) === String(node.id);

                let status;
                if (task) status = task.status; // 使用数据库实际状态
                else if (isCurrent) status = 'CURRENT';
                else status = 'UNREACHED';

                flowNodes.push({
                    node_code: node.id,
                    node_name: node.name,
                    type: node.type,
                    role: node.role ?? null,
                    status,
                    assignee_role: task?.assignee_role ?? node.role ?? null,
                    acted_by: task?.acted_by ?? null,
                    acted_at: task?.acted_at ?? null,
                    assigned_at: task?.assigned_at ?? null,
                    comment: task?.comment ?? null,
                    is_current: isCurrent,
                    downstream: downstreamMap[node.id] ?? [],
                    parallel_group: isFirstLevelParallel ? parentParallelId : null
                });
            }

            const nextTransitions = transitions.filter(t => t.from === nodeId);

            if (node.splitMode === 'exclusive' && node.conditions) {
                const matchedCondition = node.conditions.find(c => {
                    try {
                        const fn = new Function(...Object.keys(context), `return ${c.expression}`);
                        return fn(...Object.values(context));
                    } catch (e) {
                        console.error('条件表达式计算失败', e);
                        return false;
                    }
                });

                for (const t of nextTransitions) {
                    const nextNode = nodes.find(n => n.id === t.to);
                    if (!nextNode) continue;

                    if (matchedCondition && matchedCondition.target === t.to) {
                        flowNodes.push(...traverse(t.to, parentParallelId, false));
                    } else if (nextNode.type !== 'condition' && nextNode.type !== 'parallel') {
                        SKIPPED_NODES.add(nextNode.id);
                    }
                }
            } else if (node.type === 'parallel') {
                // 并行节点：下游第一层属于 parallel_group
                const childFlows = nextTransitions.map(t => traverse(t.to, node.id, true));
                let i = 0;
                while (childFlows.some(f => i < f.length)) {
                    for (const f of childFlows) {
                        if (i < f.length) flowNodes.push(f[i]);
                    }
                    i++;
                }
            } else {
                for (const t of nextTransitions) {
                    flowNodes.push(...traverse(t.to, parentParallelId, false));
                }
            }

            return flowNodes;
        }

        const flow = traverse('node_1').filter(n => n.type !== 'end');; // start 节点并过滤end节点

        // 8️⃣ 标记被裁剪掉的分支为 SKIPPED
        flow.forEach(n => {
            if (SKIPPED_NODES.has(n.node_code)) {
                n.status = 'SKIPPED';
            }
        });

        // 9️⃣ 返回结果
        return res.json({
            success: true,
            instance_id: instance.id,
            business_key: instance.business_key,
            status: instance.status,
            current_node: instance.current_node,
            started_by_name: startedByName,
            flow
        });

    } catch (error) {
        console.error("获取流程任务失败:", error);
        return res.status(500).json({ success: false, message: "服务器错误" });
    }
};

// GET /workflow/pendingTasks?userId=1&contractId=24
exports.getPendingTasksByUser = async (req, res) => {
    const { userId, contractId } = req.query;

    if (!userId) {
        return res.status(400).json({ success: false, message: "缺少 userId" });
    }

    try {
        let sql = `
            SELECT 
                t.id, 
                t.node_code, 
                t.node_name, 
                t.status,
                t.assignee_role_id, 
                t.workflow_instance_id,
                t.assigned_at,
                i.business_key AS contract_id,
                c.contract_number
            FROM workflow_tasks t
            JOIN workflow_instances i ON t.workflow_instance_id = i.id
            JOIN contracts c ON i.business_key = c.id
            WHERE t.status = 'PENDING'
              AND t.assignee_role_id IN (
                  SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = ?
              )
        `;
        const params = [userId];

        if (contractId) {
            sql += ` AND i.business_key = ?`;
            params.push(contractId);
        }

        sql += ` ORDER BY t.assigned_at DESC`;

        const [tasks] = await db.query(sql, params);

        res.json({ success: true, data: tasks });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "服务器错误" });
    }
};

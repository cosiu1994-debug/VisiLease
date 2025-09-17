const db = require("../../utils/db");

exports.createWorkflowDefinition = async (req, res) => {
    const { code, name, description, definition, created_by } = req.body;

    if (!code || !name || !definition || !created_by) {
        return res.status(400).json({ success: false, message: "缺少必要字段" });
    }

    try {
        // 校验 JSON 结构
        if (!Array.isArray(definition.nodes) || !Array.isArray(definition.transitions)) {
            return res.status(400).json({ success: false, message: "流程定义结构不合法" });
        }

        // 检查 code 是否唯一
        const [exist] = await db.query("SELECT * FROM workflow_definitions WHERE code = ?", [code]);
        if (exist.length > 0) {
            return res.status(409).json({ success: false, message: "该流程编码已存在" });
        }

        // 插入流程定义
        await db.query(
            `INSERT INTO workflow_definitions 
                (code, name, description, version, definition_json, created_by) 
            VALUES (?, ?, ?, 1, ?, ?)`,
            [code, name, description || "", JSON.stringify(definition), created_by]
        );

        return res.json({ success: true, message: "流程模板创建成功" });
    } catch (error) {
        console.error("创建流程模板失败:", error);
        return res.status(500).json({ success: false, message: "服务器内部错误" });
    }
};

exports.getWorkflowDefinitionList = async (req, res) => {
    const { name, code, page = 1, page_size = 10 } = req.query;
    const offset = (page - 1) * page_size;

    let where = 'WHERE 1=1';
    const params = [];

    if (name) {
        where += ' AND name LIKE ?';
        params.push(`%${name}%`);
    }

    if (code) {
        where += ' AND code LIKE ?';
        params.push(`%${code}%`);
    }

    try {
        const [list] = await db.query(
            `SELECT id, code, name, description, version, created_by, created_at
             FROM workflow_definitions 
             ${where}
             ORDER BY id DESC 
             LIMIT ? OFFSET ?`,
            [...params, parseInt(page_size), parseInt(offset)]
        );

        const [[{ total }]] = await db.query(
            `SELECT COUNT(*) AS total FROM workflow_definitions ${where}`,
            params
        );

        return res.json({
            success: true,
            data: list,
            pagination: {
                total,
                page: parseInt(page),
                page_size: parseInt(page_size),
                total_pages: Math.ceil(total / page_size)
            }
        });
    } catch (error) {
        console.error("获取流程定义列表失败:", error);
        return res.status(500).json({ success: false, message: "服务器内部错误" });
    }
};

exports.getWorkflowDefinitionById = async function (req, res) {
    const id = Number(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ success: false, message: "非法的 ID 参数" });
    }

    try {
        const [[row]] = await db.query(
            `SELECT id, code, name, description, version, definition_json 
             FROM workflow_definitions 
             WHERE id = ?`,
            [id]
        );

        if (!row) {
            return res.status(404).json({ success: false, message: "流程模板不存在" });
        }

        const definition = JSON.parse(row.definition_json);

        return res.json({
            success: true,
            data: {
                ...row,
                definition
            }
        });
    } catch (error) {
        console.error("获取流程定义失败:", error);
        return res.status(500).json({ success: false, message: "服务器内部错误" });
    }
};

// 内部调用
exports.fetchWorkflowDefinitionById = async function (id) {
    if (isNaN(id)) throw new Error("非法的 ID 参数");
    const [[row]] = await db.query(
        `SELECT id, code, name, description, version, definition_json 
       FROM workflow_definitions 
       WHERE id = ?`,
        [id]
    );
    if (!row) return null;
    return { ...row, definition: JSON.parse(row.definition_json) };
}
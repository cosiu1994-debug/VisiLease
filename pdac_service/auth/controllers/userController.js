const db = require('../../utils/db');

/**
 * 注册新的用户
 * @param {*} req 
 * @param {*} res 
 */
// 注册
exports.regist = async (req, res) => {
    const { name, user_type, status } = req.body;

    if (!name) {
        return res.status(400).json({ success: false, message: '名称不能为空' });
    }

    try {
        const [rows] = await db.query('SELECT * FROM sales_channels WHERE name = ?', [name]);
        if (rows.length > 0) {
            return res.status(400).json({ success: false, message: '名称已存在' });
        }

        await db.query(
            `INSERT INTO sales_channels (name, user_type, status) VALUES (?, ?, ?)`,
            [
                name,
                user_type || null,
                status === 0 ? 0 : 1, // 默认启用
            ]
        );

        res.json({ success: true, message: '注册成功' });
    } catch (err) {
        console.error('注册渠道失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
};

exports.usersList = async (req, res) => {
    try {
        const roleId = req.query.roleId;
        const params = [];
        let sql = `
            SELECT u.id, u.name, u.user_type, u.status, u.created_at, u.updated_at
            FROM sales_channels u
        `;

        if (roleId) {
            sql += `
                JOIN user_roles ur ON ur.user_id = u.id
                WHERE ur.role_id = ?
            `;
            params.push(roleId);
        }

        sql += ` ORDER BY u.id DESC`;

        const [rows] = await db.query(sql, params);

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('获取用户列表失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
};

//获取用户绑定了的角色
exports.getUserRoles = async (req, res) => {
    const userId = req.params.id;

    if (!userId) {
        return res.status(400).json({ success: false, message: '用户ID不能为空' });
    }

    try {
        const sql = `
      SELECT r.id, r.code, r.name, r.description
      FROM roles r
      INNER JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
    `;
        const [rows] = await db.query(sql, [userId]);

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('获取用户角色失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    }
};

//用户绑定角色
exports.bindUserRoles = async (req, res) => {
    const userId = req.params.id;
    const { role_ids } = req.body;

    if (!userId) {
        return res.status(400).json({ success: false, message: '用户ID不能为空' });
    }
    if (!Array.isArray(role_ids)) {
        return res.status(400).json({ success: false, message: 'role_ids 应为数组' });
    }

    // 获取数据库连接，假设你用的db是mysql2的Promise连接池
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 删除该用户现有绑定
        await connection.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);

        // 如果有新角色绑定，批量插入
        if (role_ids.length > 0) {
            const values = role_ids.map(roleId => [userId, roleId]);
            await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES ?', [values]);
        }

        await connection.commit();

        res.json({ success: true, message: '绑定成功' });
    } catch (err) {
        await connection.rollback();
        console.error('绑定用户角色失败:', err);
        res.status(500).json({ success: false, message: '服务器错误' });
    } finally {
        connection.release();
    }
};

const db = require('../../utils/db');

// 角色绑定权限
exports.bindPermissions = async (req, res) => {
  const roleId = req.params.id;
  const permissions = req.body.permissions;

  if (!Array.isArray(permissions)) {
    return res.status(400).json({ success: false, message: '缺少 permissions 参数或格式错误' });
  }

  try {
    // 1. 检查角色是否存在
    const [roles] = await db.query('SELECT * FROM roles WHERE id = ?', [roleId]);
    if (roles.length === 0) {
      return res.status(404).json({ success: false, message: '角色不存在' });
    }

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      // 2. 清空原权限绑定
      await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);

      // 3. 获取权限 code -> id 映射
      const [allPerms] = await conn.query('SELECT id, code FROM permissions');
      const codeToIdMap = {};
      allPerms.forEach(p => {
        codeToIdMap[p.code] = p.id;
      });

      // 4. 批量写入
      for (const p of permissions) {
        const permissionId = codeToIdMap[p.code];
        if (!permissionId) continue;

        const scope = ['own', 'org', 'all'].includes(p.scope) ? p.scope : null;
        const constraints = p.constraints_json ? JSON.stringify(p.constraints_json) : null;

        await conn.query(
          `INSERT INTO role_permissions (role_id, permission_id, scope, constraints_json)
           VALUES (?, ?, ?, ?)`,
          [roleId, permissionId, scope, constraints]
        );
      }

      await conn.commit();
      res.json({ success: true, message: '权限绑定已更新' });
    } catch (e) {
      await conn.rollback();
      console.error('权限绑定事务失败', e);
      res.status(500).json({ success: false, message: '权限绑定失败（事务）' });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('绑定权限失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

// 查询角色绑定的权限列表（返回 code、description、scope、constraints_json）
exports.listRolePermissions = async (req, res) => {
  const roleId = req.params.id;
  try {
    const [rows] = await db.query(
      `SELECT 
         p.id, 
         p.code, 
         p.type,
         p.description, 
         r.name AS resource_name,
         rp.scope,
         rp.constraints_json
       FROM permissions p
       INNER JOIN role_permissions rp ON p.id = rp.permission_id
       LEFT JOIN resources r ON p.resource_id = r.id
       WHERE rp.role_id = ?
       ORDER BY r.name ASC, p.code ASC`,
      [roleId]
    );

    // 若需要将 constraints_json 字段解析为对象
    const parsedRows = rows.map(row => {
      let constraints = row.constraints_json;
      if (typeof constraints === 'string') {
        try {
          constraints = JSON.parse(constraints);
        } catch (e) {
          constraints = null;
        }
      }
      return {
        ...row,
        constraints_json: constraints
      };
    });

    res.json({ success: true, data: parsedRows });
  } catch (err) {
    console.error('查询角色权限失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

// 解绑角色某个权限（通过 permission_code）
exports.unbindPermission = async (req, res) => {
  const roleId = req.params.id;
  const code = req.params.code;

  try {
    // 查出 permission_id
    const [permissions] = await db.query(`SELECT id FROM permissions WHERE code = ?`, [code]);
    if (permissions.length === 0) {
      return res.status(404).json({ success: false, message: '权限不存在' });
    }
    const permissionId = permissions[0].id;

    await db.query(
      `DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
      [roleId, permissionId]
    );

    res.json({ success: true, message: '权限解绑成功' });
  } catch (err) {
    console.error('解绑权限失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};


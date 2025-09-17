const db = require('../../utils/db');

// 注册权限
exports.registerPermission = async (req, res) => {
  const { code, description, resource_id, type } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, message: '权限 code 不能为空' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM permissions WHERE code = ?', [code]);
    if (rows.length > 0) {
      return res.status(400).json({ success: false, message: '权限已存在' });
    }

    await db.query(
      'INSERT INTO permissions (code, description, resource_id, type) VALUES (?, ?, ?, ?)',
      [code, description || '', resource_id, type || null]
    );

    res.json({ success: true, message: '注册成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

//监听权限
exports.listPermissions = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM permissions ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

//删除权限
exports.deletePermission = async (req, res) => {
  const code = req.params.code;

  try {
    await db.query('DELETE FROM permissions WHERE code = ?', [code]);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

// 查询某个用户的所有权限（支持多角色）
exports.getUserPermissions = async (req, res) => {
  const userId = req.params.userId;

  try {
    // 1. 获取用户绑定的所有角色（来自 user_roles 表）
    const [roleRows] = await db.query(
      'SELECT role_id FROM user_roles WHERE user_id = ?',
      [userId]
    );

    if (!roleRows.length) {
      return res.status(404).json({ success: false, message: '用户未分配任何角色' });
    }

    const roleIds = roleRows.map(row => row.role_id);

    // 2. 查询这些角色的所有权限（联表查 permissions 表获取 code）
    const [permissions] = await db.query(`
      SELECT p.code, rp.scope, rp.constraints_json
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id IN (?)
    `, [roleIds]);

    // 3. 整理权限结果，按 code 聚合权限（如果多个角色有相同权限）
    const result = {};

    permissions.forEach(({ code, scope, constraints_json }) => {
      let parsedConstraints = {};

      // 尝试解析 constraints_json 字段
      if (constraints_json) {
        try {
          parsedConstraints = typeof constraints_json === 'string'
            ? JSON.parse(constraints_json)
            : constraints_json;
        } catch (e) {
          console.warn(`权限 ${code} 的 constraints_json 解析失败:`, constraints_json);
        }
      }

      if (!result[code]) {
        // 初次出现该权限，直接记录
        result[code] = {
          scope,
          constraints: parsedConstraints
        };
      } else {
        // 合并已有权限（可根据需要自定义合并策略）
        result[code] = {
          scope: Math.max(result[code].scope, scope), // 权限等级取最大
          constraints: {
            ...result[code].constraints,
            ...parsedConstraints  // 简单合并，不冲突覆盖
          }
        };
      }
    });

    console.log(`用户 ${userId} 权限查询结果：`, result);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('PDAC: 获取用户权限失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

// 编辑权限
exports.editPermission = async (req, res) => {
  const { id, code, description, resource_id, type } = req.body;

  if (!id) {
    return res.status(400).json({ success: false, message: '权限 ID 不能为空' });
  }

  if (!code) {
    return res.status(400).json({ success: false, message: '权限 code 不能为空' });
  }

  const validTypes = ['action', 'data', 'ui_control'];

  // 如果提供了 type，检查它是否在有效范围内
  if (type) {
    const typeArray = type.split(',');

    const invalidTypes = typeArray.filter(t => !validTypes.includes(t));

    if (invalidTypes.length > 0) {
      return res.status(400).json({ success: false, message: '无效的类型: ' + invalidTypes.join(', ') });
    }
  }

  try {
    // 检查权限 ID 是否存在
    const [existingPermission] = await db.query('SELECT * FROM permissions WHERE id = ?', [id]);
    if (existingPermission.length === 0) {
      return res.status(404).json({ success: false, message: '权限未找到' });
    }

    // 检查是否修改了 code，若修改了 code，需要确保新 code 不重复
    if (existingPermission[0].code !== code) {
      const [rows] = await db.query('SELECT * FROM permissions WHERE code = ?', [code]);
      if (rows.length > 0) {
        return res.status(400).json({ success: false, message: '权限 code 已存在' });
      }
    }

    // 更新权限信息
    await db.query(
      'UPDATE permissions SET code = ?, description = ?, resource_id = ?, type = ? WHERE id = ?',
      [code, description || '', resource_id, type || null, id]
    );

    res.json({ success: true, message: '编辑成功' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};




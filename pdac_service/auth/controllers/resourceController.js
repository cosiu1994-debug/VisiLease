// pdac_service/controllers/resourceController.js
const db = require('../../utils/db');

//注册新的资源
exports.registerResourceWithPermissions = async (req, res) => {
  const { resource, permissions } = req.body;
  if (!resource || !resource.code || !resource.name) {
    return res.status(400).json({ success: false, message: '资源信息不完整' });
  }
  if (!Array.isArray(permissions) || permissions.length === 0) {
    return res.status(400).json({ success: false, message: '权限列表不能为空' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1. 查询资源是否存在
    let [rows] = await conn.query('SELECT id FROM resources WHERE code = ?', [resource.code]);
    let resourceId;
    if (rows.length === 0) {
      // 插入资源
      const [result] = await conn.query('INSERT INTO resources (code, name) VALUES (?, ?)', [
        resource.code,
        resource.name,
      ]);
      resourceId = result.insertId;
    } else {
      resourceId = rows[0].id;
    }

    // 2. 查出已有权限code集合，减少重复插入
    const permissionCodes = permissions.map(p => p.code);
    const [existingPerms] = await conn.query(
      `SELECT code FROM permissions WHERE code IN (?)`,
      [permissionCodes]
    );
    const existingCodes = existingPerms.map(p => p.code);

    // 3. 插入不存在权限
    for (const perm of permissions) {
      if (!existingCodes.includes(perm.code)) {
        await conn.query(
          'INSERT INTO permissions (code, description, resource_id) VALUES (?, ?, ?)',
          [perm.code, perm.description || '', resourceId]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, message: '资源及权限注册成功', resource_id: resourceId });
  } catch (err) {
    await conn.rollback();
    console.error('资源注册失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    conn.release();
  }
};

// 资源分类列表接口
exports.listResources = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, description
       FROM resources
       ORDER BY name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('查询资源分类失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

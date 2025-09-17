const db = require('../../utils/db');

// 创建角色
exports.createRole = async (req, res) => {
  const { code, name, description } = req.body;

  if (!code) {
    return res.status(400).json({ success: false, message: '角色 code 不能为空' });
  }

  try {
    const [existing] = await db.query('SELECT * FROM roles WHERE code = ?', [code]);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '角色已存在' });
    }

    await db.query(
      'INSERT INTO roles (code, name, description) VALUES (?, ?, ?)',
      [code, name || null, description || null]
    );

    res.json({ success: true, message: '角色创建成功' });
  } catch (err) {
    console.error('创建角色失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

// 查询所有角色
exports.listRoles = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM roles ORDER BY id DESC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('查询角色失败', err);
    res.status(500).json({ success: false, message: '服务器错误' });
  }
};

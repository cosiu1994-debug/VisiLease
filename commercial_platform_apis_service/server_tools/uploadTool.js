const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sanitizeFilename = require('sanitize-filename');
const db = require('../db_tools/db');
/**
 * 尝试修复浏览器上传时文件名乱码问题
 * - 有些浏览器 form-data 里的文件名会被编码成 latin1
 */
/**
 * 多种尝试修复浏览器上传时文件名乱码问题
 */
function tryDecodeOriginalName(name) {
    if (!name) return 'file';

    const candidates = new Set();
    candidates.add(name);

    try {
        candidates.add(Buffer.from(name, 'latin1').toString('utf8'));
    } catch (e) { }
    try {
        candidates.add(Buffer.from(name, 'utf8').toString('latin1'));
    } catch (e) { }
    try {
        const once = Buffer.from(name, 'latin1').toString('utf8');
        candidates.add(Buffer.from(once, 'latin1').toString('utf8'));
    } catch (e) { }

    // 选择最佳结果
    let best = name;
    let bestScore = -Infinity;

    for (const s of candidates) {
        if (!s) continue;

        // 评分：中文字符越多越好，替换符越少越好
        const cjkCount = (s.match(/[\u4E00-\u9FFF]/g) || []).length;
        const replCount = (s.match(/\uFFFD/g) || []).length;
        const score = cjkCount * 10 - replCount * 20;

        if (score > bestScore) {
            best = s;
            bestScore = score;
        }
    }

    return best.trim();
}

/**
 * @param {Object} options 
 * @param {string} options.uploadDir 上传目录（默认 ./uploads）
 * @param {boolean} options.unique 是否给文件名加唯一后缀防止覆盖（默认 true）
 * @returns multer 实例
 */
function createUploader(options = {}) {
    const uploadDir = path.resolve(
        options.uploadDir || path.join(__dirname, '../uploads')
    );

    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: function (req, file, cb) {
            let original = tryDecodeOriginalName(file.originalname);
            const extname = path.extname(original) || '';
            let basename = path.basename(original, extname) || 'file';

            // 清理非法字符
            basename = sanitizeFilename(basename) || 'file';
            basename = basename.substring(0, 200); // 限长

            // 是否加唯一后缀
            if (options.unique !== false) {
                const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
                cb(null, `${basename}-${unique}${extname}`);
            } else {
                cb(null, `${basename}${extname}`);
            }
        }
    });

    return multer({ storage });
}

/**
 * 保存文件信息到数据库
 * @param {Object} file multer 生成的 file 对象
 * @param {Object} extra 额外字段 { business_id, uploader_id ... }
 */
async function saveFileRecord(file, extra = {}, uploadDir = './uploads') {
    const sql = `
      INSERT INTO files 
      (file_name, file_type, file_size, storage_path, relative_path, business_id, uploader_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        file.originalname,                  // 对应 file_name
        path.extname(file.originalname).slice(1),  // 对应 file_type
        file.size,                          // 对应 file_size
        file.path,                          // 对应 storage_path
        path.relative(uploadDir, file.path),// 对应 relative_path
        extra.business_id || null,
        extra.uploader_id || null
    ];

    const [result] = await db.execute(sql, params);
    return result.insertId;
}

/**
 * 删除文件（磁盘 + 数据库）
 */
async function deleteFile(fileId) {
    const [rows] = await db.execute(`SELECT * FROM files WHERE id = ?`, [fileId]);
    if (rows.length === 0) return false;

    const file = rows[0];
    try {
        if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
    } catch (e) {
        console.error('删除磁盘文件失败', e);
    }

    await db.execute(`DELETE FROM files WHERE id = ?`, [fileId]);
    return true;
}

/**
 * 获取文件 URL（假设你用 express.static('/uploads') 提供访问）
 */
function getFileUrl(file) {
    return `/uploads/${path.basename(file.path)}`;
}

module.exports = {
    createUploader,
    saveFileRecord,
    deleteFile,
    getFileUrl
};

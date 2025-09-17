const db = require('../utils/db');
const permissionsToInsert = require('../auth/config/permissions.config.json');
const cliProgress = require('cli-progress');

const ADMIN_ROLE = {
    code: 'admin',
    name: '系统管理员',
    description: '拥有系统所有权限的管理员角色'
};

async function initPermissions() {
    try {
        const [rows] = await db.query(
            'SELECT code FROM permissions WHERE code IN (?)',
            [permissionsToInsert.map(p => p.code)]
        );
        const existingCodes = new Set(rows.map(row => row.code));

        const bar = new cliProgress.SingleBar({
            format: '权限初始化 [{bar}] {percentage}% | {value}/{total} | 当前: {currentCode}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
        });
        bar.start(permissionsToInsert.length, 0, { currentCode: '' });

        let insertedCount = 0;
        for (const perm of permissionsToInsert) {
            bar.update(bar.value, { currentCode: perm.code });
            if (existingCodes.has(perm.code)) {
                // 打印跳过信息
                console.log(`检测到已存在权限: ${perm.code} (${perm.description})`);
            } else {
                try {
                    await db.query(
                        'INSERT INTO permissions (resource_id, code, description, type, module) VALUES (?, ?, ?, ?, ?)',
                        [perm.resource_id, perm.code, perm.description, perm.type, perm.module]
                    );
                    console.log(`成功导入权限: ${perm.code} (${perm.description})`);
                    insertedCount++;
                } catch (insertErr) {
                    console.error(`导入权限失败: ${perm.code} (${perm.description})，错误：`, insertErr);
                }
            }
            bar.increment();
        }
        bar.stop();
        console.log(`权限初始化完成，成功导入 ${insertedCount} 条权限，跳过 ${permissionsToInsert.length - insertedCount} 条`);
    } catch (err) {
        console.error('初始化权限失败:', err);
        throw err;
    }
}

async function initAdminRole() {
    try {
        // 查询是否存在 admin 角色（用 code 字段）
        const [roles] = await db.query('SELECT * FROM roles WHERE code = ?', [ADMIN_ROLE.code]);
        let roleId;

        if (roles.length === 0) {
            const [result] = await db.query(
                'INSERT INTO roles (code, name, description) VALUES (?, ?, ?)',
                [ADMIN_ROLE.code, ADMIN_ROLE.name, ADMIN_ROLE.description]
            );
            roleId = result.insertId;
            console.log(`管理员角色已创建，ID: ${roleId}`);
        } else {
            roleId = roles[0].id;
            console.log(`管理员角色已存在，ID: ${roleId}`);
        }

        // 查询所有权限id
        const [permissions] = await db.query('SELECT id FROM permissions');
        const permissionIds = permissions.map(p => p.id);

        // 查询该角色已有权限，避免重复绑定
        const [existing] = await db.query(
            'SELECT permission_id FROM role_permissions WHERE role_id = ?',
            [roleId]
        );
        const existingPermissionIds = new Set(existing.map(e => e.permission_id));

        // 过滤出未绑定权限
        const toBind = permissionIds.filter(id => !existingPermissionIds.has(id));
        if (toBind.length === 0) {
            console.log('管理员角色已绑定全部权限，无需重复绑定');
            return;
        }

        // 批量插入绑定关系
        const values = toBind.map(permission_id => [roleId, permission_id]);
        await db.query(
            'INSERT INTO role_permissions (role_id, permission_id) VALUES ?',
            [values]
        );

        console.log(`成功绑定 ${toBind.length} 个权限到管理员角色`);
    } catch (err) {
        console.error('初始化管理员角色及权限绑定失败:', err);
        throw err;
    }
}

exports.initAll = async function initAll() {
    try {
        await initPermissions();
        await initAdminRole();
        console.log('权限和管理员角色初始化完成');
    } catch (err) {
        console.error('初始化过程发生错误:', err);
        process.exit(1);
    }
};

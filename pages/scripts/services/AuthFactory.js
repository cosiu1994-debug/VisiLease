app.factory('AuthFactory', ['$http', function ($http) {
    let permissionMap = {};

    return {
        // 从接口加载权限并初始化映射
        loadPermissionsByRoleId: function (roleId) {
            return $http.get(`http://host:4001/roles_permissions/${roleId}/permissions`)
                .then(res => {
                    const permissions = res.data.data || [];
                    permissionMap = {};

                    permissions.forEach(p => {
                        const types = (p.type || '').split(',').map(t => t.trim()).filter(Boolean);
                        permissionMap[p.code] = types;
                    });

                    return permissionMap;  // 返回映射，方便链式调用
                });
        },

        // 也支持直接初始化权限列表（备用）
        init: function (permissions) {
            permissionMap = {};
            permissions.forEach(p => {
                const types = (p.type || '').split(',').map(t => t.trim()).filter(Boolean);
                permissionMap[p.code] = types;
            });
        },

        // 权限判断函数
        has: function (code, type) {
            const types = permissionMap[code];
            return types && types.includes(type);
        },

        // 获取所有权限映射（调试用）
        getMap: function () {
            return permissionMap;
        }
    };
}]);

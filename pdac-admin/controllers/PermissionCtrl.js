app.controller('PermissionCtrl', ['$scope', '$http', function ($scope, $http) {
    $scope.permissionGroups = []; // 分组后的权限
    $scope.newPermission = {};
    $scope.resourceOptions = []; // 资源下拉用

    // 加载所有资源和权限列表
    $scope.loadPermissions = function () {
        $http.get('http://host:4001/resource/list').then(resResources => {
            if (!resResources.data.success) {
                alert('资源加载失败: ' + resResources.data.message);
                return;
            }

            const resourceMap = {};
            resResources.data.data.forEach(r => {
                resourceMap[r.id] = r.name;
            });
            $scope.resourceOptions = resResources.data.data;

            // 然后加载权限列表
            $http.get('http://host:4001/permissions').then(resPerms => {
                if (!resPerms.data.success) {
                    alert('权限加载失败: ' + resPerms.data.message);
                    return;
                }

                const grouped = {};
                resPerms.data.data.forEach(p => {
                    const resourceName = resourceMap[p.resource_id] || '未分类';
                    if (!grouped[resourceName]) grouped[resourceName] = [];
                    grouped[resourceName].push(p);
                });

                // 转换为数组形式
                $scope.permissionGroups = Object.keys(grouped).map(resourceName => ({
                    category: resourceName,
                    permissions: grouped[resourceName]
                }));
            });
        });
    };

    // 打开新增权限 Modal
    $scope.openAddPermissionModal = function () {
        $scope.newPermission = {};
        const modal = new bootstrap.Modal(document.getElementById('addPermissionModal'));
        modal.show();
    };

    // 新增权限
    $scope.addPermission = function () {
        const types = [];

        // 添加主类型（action 或 data）
        if ($scope.newPermission.mainType) {
            types.push($scope.newPermission.mainType);
        }

        // 如果勾选了
        if ($scope.newPermission.uiControl) {
            types.push('ui_control');
        }

        const payload = {
            code: $scope.newPermission.code,
            description: $scope.newPermission.description || '',
            resource_id: $scope.newPermission.resource_id || null,
            type: types.join(',')
        };

        $http.post('http://host:4001/permissions/register', payload).then(res => {
            if (res.data.success) {
                alert('新增成功');
                $scope.loadPermissions();
                bootstrap.Modal.getInstance(document.getElementById('addPermissionModal')).hide();
            } else {
                alert('新增失败: ' + res.data.message);
            }
        }, () => alert('提交失败'));
    };

    // 删除权限
    $scope.deletePermission = function (perm) {
        if (!confirm(`确认删除权限「${perm.code}」吗？`)) return;
        $http.delete(`http://host:4001/permissions/${perm.code}`).then(res => {
            if (res.data.success) {
                alert('删除成功');
                $scope.loadPermissions();
            } else {
                alert('删除失败: ' + res.data.message);
            }
        }, () => alert('删除请求失败'));
    };

    $scope.loadPermissions();

    // 模态框编辑权限对象，初始化为 null
    $scope.editingPermission = null;

    // 触发编辑权限的操作
    $scope.editPermission = function (perm) {
        // 克隆权限对象，避免直接修改原数据
        $scope.editingPermission = angular.copy(perm);

        // 显示模态框，使用原生 JavaScript
        var modal = new bootstrap.Modal(document.getElementById('editPermissionModal'));
        modal.show();
    };

    // 在提交权限更新前，确保 type 格式正确
    $scope.submitEditPermission = function () {
        // 如果 type 是数组，将其转换为逗号分隔的字符串
        if (Array.isArray($scope.editingPermission.type)) {
            $scope.editingPermission.type = $scope.editingPermission.type.join(',');
        }

        // 发起 API 请求更新权限
        $http.put('/permissions/edit', $scope.editingPermission)
            .then(function (response) {
                if (response.data.success) {
                    // 更新成功后，刷新权限列表或更新UI
                    alert('权限更新成功');
                    // 关闭编辑表单
                    $scope.editingPermission = null;
                    $scope.loadPermissions();
                    // 使用原生 Bootstrap 5 API 隐藏模态框
                    var modal = bootstrap.Modal.getInstance(document.getElementById('editPermissionModal'));
                    modal.hide(); // 隐藏模态框
                } else {
                    alert('权限更新失败：' + response.data.message);
                }
            })
            .catch(function (error) {
                console.error(error);
                alert('服务器错误，更新失败');
            });
    };

    $scope.cancelEdit = function () {
        $scope.editingPermission = null;
        var modal = bootstrap.Modal.getInstance(document.getElementById('editPermissionModal'));
        modal.hide();
    };
}]);

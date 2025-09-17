app.controller('RoleCtrl', ['$scope', '$http', function ($scope, $http) {
  $scope.roles = [];
  $scope.selectedRole = null;
  $scope.permissionGroups = [];
  $scope.newRole = {};

  // 初始化 constraint 模板映射
  $scope.constraintTemplates = {};

  // 加载角色列表
  $scope.loadRoles = function () {
    $http.get('http://host:4001/roles').then(res => {
      if (res.data.success) {
        $scope.roles = res.data.data;
      } else {
        alert('获取角色失败：' + res.data.message);
      }
    }, () => alert('请求角色失败'));
  };

  // 选择角色
  $scope.selectRole = function (role) {
    $scope.selectedRole = role;
    $scope.loadPermissions(role.id);
  };

  // 加载权限 + 资源分组
  $scope.loadPermissions = function (roleId) {
    // 先请求资源列表，构建 resourceId -> name 映射
    $http.get('http://host:4001/resource/list').then(resResources => {
      if (!resResources.data.success) {
        alert('获取资源列表失败：' + resResources.data.message);
        return;
      }

      const resourceMap = {};
      resResources.data.data.forEach(r => {
        resourceMap[r.id] = r.name;
      });

      // 请求角色绑定权限和约束
      $http.get(`http://host:4001/roles_permissions/${roleId}/permissions`).then(resRolePerm => {
        if (!resRolePerm.data.success) {
          alert('获取角色权限失败: ' + resRolePerm.data.message);
          $scope.permissionGroups = [];
          return;
        }

        // 建立 code -> 绑定权限对象 映射
        const boundPermsMap = {};
        resRolePerm.data.data.forEach(p => {
          boundPermsMap[p.code] = p;
        });

        // 请求所有权限列表
        $http.get('http://host:4001/permissions').then(resAllPerm => {
          if (!resAllPerm.data.success) {
            alert('获取权限列表失败: ' + resAllPerm.data.message);
            $scope.permissionGroups = [];
            return;
          }

          // 结合绑定状态和约束初始化权限列表
          const allPerms = resAllPerm.data.data.map(p => {
            const bound = boundPermsMap[p.code];

            p.checked = !!bound;
            p.resource_name = resourceMap[p.resource_id] || '未分类';

            // 处理约束JSON和启用开关
            if (bound && bound.constraints_json && Object.keys(bound.constraints_json).length > 0) {
              p.constraints_enabled = true;
              p.constraints = bound.constraints_json;
              p.constraints_json_raw = JSON.stringify(bound.constraints_json, null, 2);
            } else {
              p.constraints_enabled = false;
              p.constraints = {};
              p.constraints_json_raw = '';
            }

            //  添加 scope 绑定
            p.scope = bound?.scope || 'all';

            return p;
          });

          // 按资源名分组
          const grouped = {};
          allPerms.forEach(p => {
            if (!grouped[p.resource_name]) grouped[p.resource_name] = [];
            grouped[p.resource_name].push(p);
          });

          $scope.permissionGroups = Object.keys(grouped).map(resourceName => ({
            category: resourceName,
            permissions: grouped[resourceName]
          }));
        });
      });
    });
  };

  // 保存角色绑定的权限
  $scope.savePermissions = function () {
    const payload = [];

    $scope.permissionGroups.forEach(group => {
      group.permissions.forEach(perm => {
        if (perm.checked) {
          let constraints = null;
          if (perm.constraints_enabled && perm.constraints_json_raw) {
            try {
              constraints = JSON.parse(perm.constraints_json_raw);
            } catch (e) {
              alert(`权限 ${perm.code} 的约束 JSON 格式错误，请检查`);
              throw e;
            }
          }

          payload.push({
            code: perm.code,
            constraints_json: constraints,
            scope: perm.scope || 'all'
          });
        }
      });
    });

    $http.post(`/roles_permissions/${$scope.selectedRole.id}/permissions`, { permissions: payload })
      .then(res => {
        if (res.data.success) {
          alert('权限保存成功');
        } else {
          alert('权限保存失败：' + res.data.message);
        }
      })
      .catch(() => alert('保存请求失败'));
  };

  // 新增角色
  $scope.newRole = { code: '', name: '', description: '' };

  $scope.addRole = function () {
    if (!$scope.newRole.code) return alert('请填写角色标识（code）');

    $http.post('http://host:4001/roles/create', $scope.newRole).then(res => {
      if (res.data.success) {
        alert('角色创建成功');
        $scope.newRole = {};
        bootstrap.Modal.getInstance(document.getElementById('addRoleModal')).hide();
        $scope.loadRoles();
      } else {
        alert(res.data.message || '创建失败');
      }
    }).catch(() => {
      alert('请求失败');

    });
  };

  // 判断是否数组约束
  $scope.isArrayConstraint = function (perm, field) {
    const tmpl = $scope.constraintTemplates[perm.code]?.constraints_json || {};
    return Array.isArray(tmpl[field]);
  };

  $scope.isValidJson = function (jsonStr) {
    if (!jsonStr) return true; // 空字符串认为合法（无约束）
    try {
      JSON.parse(jsonStr);
      return true;
    } catch (e) {
      return false;
    }
  };

  // 初始化
  $scope.loadRoles();

}]);

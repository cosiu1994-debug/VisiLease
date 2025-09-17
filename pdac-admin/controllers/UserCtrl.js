app.controller('UserCtrl', ['$scope', '$http', function ($scope, $http) {
    $scope.users = [];
    $scope.roles = [];
    $scope.selectedUser = null;
    $scope.saving = false;

    // 加载用户列表
    $scope.loadUsers = function () {
        $http.get('http://host:4001/users/user_list').then(function (res) {
            if (res.data.success) {
                $scope.users = res.data.data;
            } else {
                alert('加载用户失败');
            }
        }).catch(() => alert('服务器错误'));
    };

    // 加载角色列表
    $scope.loadRoles = function () {
        $http.get('http://host:4001/roles').then(function (res) {
            if (res.data.success) {
                $scope.roles = res.data.data;
            } else {
                alert('加载角色失败');
            }
        }).catch(() => alert('服务器错误'));
    };

    // 选择用户，加载该用户绑定角色状态
    $scope.selectUser = function (user) {
        $scope.selectedUser = user;

        // 先全部取消勾选
        $scope.roles.forEach(role => role.checked = false);

        // 请求用户已绑定的角色ID列表
        $http.get(`http://host:4001/users/${user.id}/roles`).then(function (res) {
            if (res.data.success) {
                const boundRoleIds = res.data.data.map(r => r.id);
                $scope.roles.forEach(role => {
                    role.checked = boundRoleIds.includes(role.id);
                });
            } else {
                alert('加载用户角色失败');
            }
        }).catch(() => alert('服务器错误'));
    };

    // 保存用户角色绑定
    $scope.saveUserRoles = function () {
        if (!$scope.selectedUser) return;

        const selectedRoleIds = $scope.roles
            .filter(r => r.checked)
            .map(r => r.id);

        $scope.saving = true;

        $http.post(`http://host:4001/users/${$scope.selectedUser.id}/roles/bind`, {
            role_ids: selectedRoleIds
        }).then(function (res) {
            $scope.saving = false;
            if (res.data.success) {
                alert('绑定成功');
            } else {
                alert('绑定失败：' + (res.data.message || '未知错误'));
            }
        }).catch(() => {
            $scope.saving = false;
            alert('服务器错误');
        });
    };

    // 初始化
    $scope.loadUsers();
    $scope.loadRoles();

    $scope.newUser = {
        name: '',
        user_type: '',
        status: 1 // 默认启用
    };

    $scope.addUser = function () {
        if (!$scope.newUser.name) {
            alert('名称不能为空');
            return;
        }

        $http.post('http://host:4001/users/regist', $scope.newUser).then(function (res) {
            if (res.data.success) {
                alert('注册成功');
                $scope.newUser = {}; // 清空表单
                bootstrap.Modal.getInstance(document.getElementById('addUserModal')).hide(); // 关闭模态框
                $scope.loadUsers?.(); // 可选：刷新列表
            } else {
                alert(res.data.message || '注册失败');
            }
        }).catch(function () {
            alert('请求失败');
        });
    };
}])
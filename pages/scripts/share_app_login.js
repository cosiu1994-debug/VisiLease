app.controller('LoginController', function ($http, $state, $window) {
    var vm = this;
    const host = 'http://localhost:3001';
    vm.credentials = { group: '', ID: '' };

    vm.login = function () {
        // 验证权限组和 ID
        if (!vm.credentials.group || !vm.credentials.ID) {
            alert('请填写权限组和ID');
            return;
        }

        $http.post(host + '/login', {
            group: vm.credentials.group,
            id: vm.credentials.ID
        }).then(function (response) {
            if (response.data.success) {
                // 登录成功，保存 token
                $window.localStorage.setItem('token', response.data.token);
                $state.go('reports');  // 跳转到主页面
            } else {
                alert(response.data.message);
            }
        }).catch(function (error) {
            alert('登录失败：' + error.message);
        });
    };
});

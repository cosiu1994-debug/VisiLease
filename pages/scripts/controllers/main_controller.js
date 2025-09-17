app.controller('ReportController', ['$http', '$window', function ($http, $window) {
    const vm = this;

    // 从 localStorage 获取用户信息
    const user = JSON.parse($window.localStorage.getItem('user'));
    console.log(user);
    if (!user) {
        alert('你还没登录，请先登录');
        $window.location.href = '/pages/templates/share_login.html';
        return;
    }

    // 用户信息
    vm.user = user;

    // 用户权限数组
    vm.permissions = user.permissions || [];

    // 简单权限判断函数（扁平权限架构）
    vm.hasPermission = function(permissionCode) {
        return vm.permissions.includes(permissionCode);
    };
    
    // 页面默认选项
    vm.defaultTab = 'newCustomer';
    vm.newCustomer = vm.newCustomer || {};
    vm.newCustomer.sales_channel_id = Number(vm.user.id);
    vm.newReport = vm.newReport || {};
    vm.newReport.sales_channel_id = Number(vm.user.id);
    vm.user.rolesText = vm.user.roles.map(role => role.name).join(', ');
    // 设置全局 axios/HTTP 头部
    $http.defaults.headers.common['Authorization'] = 'Bearer ' + vm.user.token;

    // 登出逻辑
    vm.logout = function () {
        const logoutText = document.getElementById('logoutText');
        if (logoutText) logoutText.textContent = '退出登录中...';
        localStorage.clear();
        $window.location.href = '/pages/templates/share_login.html';
    };
}]);

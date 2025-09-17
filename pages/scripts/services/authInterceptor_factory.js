angular.module('reportApp').factory('authInterceptor', function ($q, $location, $window, $rootScope) {
    return {
        // 请求拦截
        request: function (config) {
            // 允许公开接口
            const publicPaths = [
                '/',
                '/login',
                '/pages/templates/share_login.html',
                '/pages/templates/reports.html',
                '/pages/scripts/shared_app.js',
                '/pages'
            ];

            // 如果是公共路径，直接放行
            if (publicPaths.includes(config.url) || config.url.startsWith('/pages/')) {
                return config;
            }

            // 获取本地存储中的用户信息
            const user = $window.localStorage.getItem('user');
            if (user) {
                const parsedUser = JSON.parse(user);
                if (parsedUser.token) {
                    // 在请求头中添加 Token
                    config.headers['Authorization'] = 'Bearer ' + parsedUser.token;
                }
            }
            return config;
        },

        // 响应拦截
        responseError: function (rejection) {
            if (rejection.status === 401) {
                if (rejection.data && rejection.data.message === "认证失败: Token 无效或已过期") {
                    alert("登录信息已过期，请重新登录！");
                }
                $window.localStorage.removeItem('user');
                $window.location.href = '/pages/templates/share_login.html'
            }
            return $q.reject(rejection);
        }
    };
});

// 配置应用的 HTTP 拦截器
angular.module('reportApp').config(function ($httpProvider) {
    $httpProvider.interceptors.push('authInterceptor');
});

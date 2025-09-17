const app = angular.module('pdac-app', ['ui.router'])

// 路由配置
app.config(['$stateProvider', '$urlRouterProvider', function ($stateProvider, $urlRouterProvider) {

    $urlRouterProvider.otherwise('/roles')

    $stateProvider
        .state('roles', {
            url: '/roles',
            templateUrl: 'templates/roles.html',
            controller: 'RoleCtrl'
        })
        .state('users', {
            url: '/users',
            templateUrl: 'templates/users.html',
            controller: 'UserCtrl'
        })
        .state('permissions', {
            url: '/permissions',
            templateUrl: 'templates/permissions.html',
            controller: 'PermissionCtrl'
        })
        .state('workflow_definitions', {
            url: '/workflow_definitions',
            templateUrl: 'templates/workflow.html',
            controller: 'WorkflowDefinitionCtrl'
        })
        .state('workflow_definition_detail', {
            url: '/workflow_definitions/:id',
            templateUrl: 'templates/workflow_definition_detail.html',
            controller: 'WorkflowDefinitionDetailCtrl'
        })
        .state('workflow_builder',{
            url: '/workflow_builder',
            templateUrl: 'templates/workflow_definition_builder.html',
            controller: 'WorkflowBuilderCtrl'
        });
}])

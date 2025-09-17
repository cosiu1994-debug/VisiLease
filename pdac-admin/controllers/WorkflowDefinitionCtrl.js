app.controller('WorkflowDefinitionCtrl', function ($scope, $http, $state) {
    $scope.definitions = [];
    $scope.loading = true;

    $http.get('/workflow/definitions_list')
        .then(function (res) {
            if (res.data.success) {
                $scope.definitions = res.data.data;
            } else {
                alert('加载失败：' + res.data.message);
            }
        })
        .catch(function (err) {
            alert('请求失败');
        })
        .finally(function () {
            $scope.loading = false;
        });

    $scope.view = function (id) {
        $state.go('workflow_definition_detail', { id: id });
    };
});

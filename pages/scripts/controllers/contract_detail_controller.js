app.controller('contract_detail_controller', ['$stateParams', '$http', '$scope', '$state','AuthFactory', function ($stateParams, $http, $scope, $state,AuthFactory) {
    var cdm = this;
    var contractId = $stateParams.id;
    // 获取用户ID
    const userStr = localStorage.getItem('user');
    let userId = null;
    let roleId = null;
    if (userStr) {
        try {
            const userObj = JSON.parse(userStr);
            userId = userObj.id;
            roleId = userObj.roles[0]?.id;
        } catch (e) {
            console.error('解析用户信息失败', e);
        }
    }

    cdm.loading = true;
    cdm.contract = null;
    cdm.error = null;

    // 模态框控制
    cdm.showSubmitApprovalModal = false;
    cdm.showApprovalProgressModal = false;

    // 提交审批备注
    cdm.submitApprovalComments = '';

    // 审批进度列表
    cdm.approvalTasks = [];

    // 加载合同详情
    $http.get('/api/contracts/' + contractId).then(function (response) {
        cdm.contract = response.data;
    }).catch(function (err) {
        cdm.error = '加载合同详情失败';
    }).finally(function () {
        cdm.loading = false;
    });

    // 提交审批功能
    cdm.openSubmitApprovalModal = function () {
        var contract = cdm.contract.contract;
        if (contract.status !== 'draft') {
            alert("该合同不处于草稿状态，无法提交审批！");
            return;
        }

        cdm.submitApprovalComments = '';
        cdm.templates = [];
        cdm.selectedTemplateId = null;
        cdm.loadingTemplates = true;

        // 显示模态框
        cdm.showSubmitApprovalModal = true;

        // 获取模板列表
        $http.get('http://host:4001/workflow/definitions_list')
            .then(function (resp) {
                cdm.loadingTemplates = false;
                if (resp.data && resp.data.success && Array.isArray(resp.data.data)) {
                    cdm.templates = resp.data.data;

                    if (cdm.templates.length === 1) {
                        // 自动选择唯一模板
                        cdm.selectedTemplateId = cdm.templates[0].id;
                    }
                } else {
                    cdm.templates = [];
                    alert("未获取到可用的审批模板，请联系管理员配置！");
                }
            })
            .catch(function () {
                cdm.loadingTemplates = false;
                alert("获取审批模板列表失败，请稍后重试");
            });
    };

    cdm.closeSubmitApprovalModal = function () {
        cdm.showSubmitApprovalModal = false;
    };

    cdm.confirmSubmitApproval = function () {
        if (!cdm.contract || !cdm.contract.contract.id) {
            alert("合同信息缺失");
            return;
        }

        cdm.submitting = true;
        const currentUser = JSON.parse(localStorage.getItem('user'));
        const userId = currentUser ? currentUser.id : null;
        const payload = {
            workflow_definition_id: cdm.selectedTemplateId,
            business_key: cdm.contract.contract.id,
            started_by: userId,
            context: {
                contract_id: cdm.contract.contract.id,
                contract_number: cdm.contract.contract.contract_number,
                remarks: cdm.submitApprovalComments || "",
                building_name: cdm.contract.units[0].building_name
            }
        };

        $http.post('http://host:4001/workflow_instances/create_workflowInstance', payload).then(function (resp) {
            cdm.submitting = false;
            console.log(payload);
            if (resp.data.success) {
                alert("合同已提交审批，流程实例ID：" + resp.data.instance_id);
                cdm.closeSubmitApprovalModal();
                location.reload();
            } else {
                alert("提交失败：" + resp.data.message);
            }
        })
            .catch(function (err) {
                cdm.submitting = false;
                alert("提交失败：" + (err.data?.message || "服务器错误"));
            });
    };

    // 打开审批进度弹窗
    cdm.openApprovalProgressModal = function () {
        cdm.showApprovalProgressModal = true;

        $http.get(`http://host:4001/task/logs/business/` + contractId)
            .then(function (response) {
                if (response.data && response.data.flow) {
                    cdm.instance_started_by = response.data.started_by_name;
                    cdm.workflowStatus = response.data.status;
                    cdm.workflow = {
                        instance_id: response.data.instance_id,
                        business_key: response.data.business_key,
                        current_node: response.data.current_node,
                        flow: response.data.flow
                    };

                    // 不再过滤 start 和 end，保留原始顺序
                    cdm.workflowNodes = cdm.workflow.flow;
                } else {
                    cdm.workflowStatus = null;
                    cdm.workflow = { flow: [] };
                    cdm.workflowNodes = [];
                }
            })
            .catch(function (error) {
                console.error('获取审批进度失败:', error);
                cdm.workflowStatus = null;
                cdm.workflow = { flow: [] };
                cdm.workflowNodes = [];
            });
    };

    // 关闭模态框
    cdm.closeApprovalProgressModal = function () {
        cdm.showApprovalProgressModal = false;
    };

    cdm.closeApprovalProgressModal = function () { cdm.showApprovalProgressModal = false; };

    cdm.loadApprovalTaskStatus = function () {
        $http.get('http://host:4001/task/pendingTasks', {
            params: {
                userId: userId,
                contractId: contractId
            }
        }).then(res => {
            if (res.data.success) {
                const tasks = res.data.data || [];
                cdm.showApprovalButton = tasks.length > 0;

                // 如果有任务，默认选第一个任务
                cdm.currentTask = tasks.length > 0 ? tasks[0] : null;
            } else {
                cdm.showApprovalButton = false;
                cdm.currentTask = null;
            }
        }).catch(err => {
            console.error('检查审批任务失败', err);
            cdm.showApprovalButton = false;
            cdm.currentTask = null;
        });
    };

    cdm.loadApprovalTaskStatus();

    // 打开审批模态框
    cdm.openApprovalModal = function (task) {
        cdm.currentTask = task || cdm.currentTask;
        cdm.approvalComment = '';
        var modalElement = document.getElementById('approvalModal');
        var modal = new bootstrap.Modal(modalElement);
        modal.show();
    };

    cdm.submitApproval = function (decision) {
        if (!cdm.currentTask) return;
        cdm.approvalLoading = true;  // 禁用按钮 & 显示加载状态
        const payload = {
            task_id: cdm.currentTask.id,
            approved_by: cdm.currentUserId || 1,  // 当前用户 ID
            decision: decision,                   // 'APPROVE' 或 'REJECT'
            comments: cdm.approvalComment || '',
            context_update: {}                    // 可根据需要更新流程上下文
        };

        $http.post('http://host:4001/task/approveTask', payload).then(function (res) {
            cdm.approvalLoading = false;

            if (res.data.success) {
                alert(res.data.message || '审批成功');

                var modalElement = document.getElementById('approvalModal');
                var modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
                cdm.approvalComment = '';
                cdm.loadApprovalTaskStatus();
                if (cdm.showApprovalProgressModal) {
                    cdm.loadWorkflowProgress();
                }
            } else {
                alert(res.data.message || '审批失败，请重试');
            }
        })
            .catch(function (err) {
                console.error('审批接口调用失败', err);
                cdm.approvalLoading = false;
                alert('审批失败，请稍后重试');
            });
    };

    $scope.$watch('cdm.workflow.flow', function (newFlow) {
        if (!newFlow) return;
        $scope.groupedFlow = $scope.getGroupedFlow(newFlow);
    }, true);

    $scope.getGroupedFlow = function (flow) {
        if (!flow || !Array.isArray(flow)) return []; // 防止 undefined

        const groups = [];
        const visited = new Set();

        flow.forEach(node => {
            if (visited.has(node.node_code)) return;

            if (node.parallel_group) {
                // 找到同一组的节点
                const parallelNodes = flow.filter(n => n.parallel_group === node.parallel_group);
                parallelNodes.forEach(n => visited.add(n.node_code));
                groups.push(parallelNodes);
            } else {
                visited.add(node.node_code);
                groups.push([node]);
            }
        });

        return groups;
    };

    // 调用鉴权工厂加载权限
    AuthFactory.loadPermissionsByRoleId(roleId).then(() => {
        console.log(roleId);
        console.log('当前权限：', AuthFactory.permissions);
    }).catch(err => {
        console.error('权限加载失败', err);
    });

    // 视图鉴权函数
    $scope.hasPermission = function (code, type) {
        const result = AuthFactory.has(code, type);
        console.log(`检查权限 [${code}]：`, result);
        return result;
    };
}]);

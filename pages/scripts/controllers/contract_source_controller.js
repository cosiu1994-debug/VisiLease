app.controller('contracts_controller', ['$http', '$state', '$scope', '$filter', 'AuthFactory', function ($http, $state, $scope, $filter, AuthFactory) {
    const cm = this;
    cm.activeView = 'contracts_list';
    cm.contracts = [];

    const userStr = localStorage.getItem('user');
    let roleId = null;
    let userId = null;
    cm.contractId = null;
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            roleId = user.roles[0]?.id;
            userId = user.id;
        } catch (e) {
            console.error('解析用户信息失败', e);
        }
    }

    if (!roleId) {
        console.warn('未找到角色ID，权限加载失败');
        return;
    }

    // 调用鉴权工厂加载权限
    AuthFactory.loadPermissionsByRoleId(roleId).then(() => {
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

    cm.navigateTo = function (view) {
        cm.activeView = view;
    };

    function formatDateToYMD(dateInput) {
        if (!dateInput) return null;

        // 传入可能是字符串或 Date 对象，先转成 Date 对象
        const date = new Date(dateInput);

        // 处理无效日期
        if (isNaN(date.getTime())) return null;

        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    // 1. 初始化查询参数
    cm.query = {
        page: 1,
        page_size: 10,
        status: 'draft',
        contract_number: ''
    };

    // 2. 总页数计算
    cm.totalPages = function () {
        return Math.ceil((cm.total || 0) / (cm.query.page_size || 10));
    };

    // 3. 切换页码
    cm.changePage = function (page) {
        if (page < 1 || page > cm.totalPages()) return;
        cm.query.page = page;
        cm.searchContracts();
    };

    // 4. 加载合同列表
    cm.loadContracts = function () {
        const params = {
            page: cm.query.page,
            page_size: cm.query.page_size
        };

        $http.get('/api/contractsList', { params })
            .then(function (res) {
                const raw = res.data.data || [];
                cm.contracts = raw.map(item => {
                    function stripTime(str) {
                        return str && str.indexOf(' ') > 0 ? str.split(' ')[0] : str;
                    }

                    return {
                        ...item,
                        sign_date: stripTime(item.sign_date),
                        start_date: stripTime(item.start_date),
                        end_date: stripTime(item.end_date)
                    };
                });

                // 3. 总数
                cm.total = (res.data.pagination && res.data.pagination.total) || 0;

                // 4. 重新生成页码数组
                const tp = cm.totalPages();
                cm.pages = [];
                for (let i = 1; i <= tp; i++) {
                    cm.pages.push(i);
                }
            })
            .catch(function (err) {
                console.error('加载合同失败:', err);
            });
    };

    //筛选合同
    cm.searchContracts = function () {
        if (!cm.query.page) {
            cm.query.page = 1;
        }

        // 组装请求参数
        const params = {
            contract_number: cm.query.contract_number || undefined,
            tenant_name: cm.query.tenant_name || undefined,
            status: cm.query.status || undefined,
            sign_date_start: formatDateToYMD(cm.query.start_date) || undefined,
            sign_date_end: formatDateToYMD(cm.query.end_date) || undefined,
            building_id: cm.query.building_id || undefined,
            building_name: cm.query.building_name || undefined,
            page: cm.query.page || 1,
            page_size: cm.query.page_size || 10,
        };

        // 过滤掉空值
        Object.keys(params).forEach(key => {
            if (!params[key]) {
                delete params[key];
            }
        });

        $http.get('/api/contractsList', { params })
            .then(function (res) {
                const raw = res.data.data || [];
                function stripTime(str) {
                    return str && str.indexOf(' ') > 0 ? str.split(' ')[0] : str;
                }

                cm.contracts = raw.map(item => ({
                    ...item,
                    sign_date: stripTime(item.sign_date),
                    start_date: stripTime(item.start_date),
                    end_date: stripTime(item.end_date)
                }));

                // 总数与分页
                const pagination = res.data.pagination || {};
                cm.total = pagination.total || 0;

                const totalPages = cm.totalPages();
                cm.pages = [];
                for (let i = 1; i <= totalPages; i++) {
                    cm.pages.push(i);
                }

                cm.query.page = pagination.page || 1;
            })
            .catch(function (err) {
                console.error('查询合同列表失败:', err);
            });
    };

    // 初始加载
    cm.loadContracts();

    // 5. 视图跳转
    cm.viewContract = function (contract) {
        $state.go('contract_detail', { id: contract.id });
    };

    // 表单数据结构
    cm.formData = {
        contract: {},
        units: [],
        termOptions: {
            splitMode: 'NATURAL_MONTH',
            increaseRules: [],
            freePeriods: []
        },
        uploadedFiles: []
    };

    // 初始化状态
    cm.buildings = [];
    cm.selectedBuilding = null;

    cm.floors = [];
    cm.selectedFloor = null;

    cm.availableUnits = [];
    cm.unitsLoaded = false;

    // 加载楼栋列表
    cm.loadBuildings = function () {
        $http.get('/api/buildings').then(res => {
            cm.buildings = res.data.data;
        });
    };

    // 当楼栋变更时，加载对应楼层
    cm.onBuildingChange = function () {
        cm.selectedFloor = null;
        cm.floors = [];
        cm.availableUnits = [];
        cm.unitsLoaded = false;   // 重置标志
        if (!cm.selectedBuilding?.id) return;
    
        $http.get(`/api/buildings/${cm.selectedBuilding.id}/floors`).then(res => {
            cm.floors = res.data.data;
        });
    };
    
    // 当楼层变更时，加载可选单元
    cm.loadUnits = function () {
        if (!cm.selectedBuilding?.id || !cm.selectedFloor?.level) return;
    
        cm.unitsLoaded = false;  // 每次加载前先重置
    
        $http.get('/api/units', {
            params: {
                building_id: cm.selectedBuilding.id,
                floor: cm.selectedFloor.level,
                status: 'vacant'
            }
        }).then(res => {
            cm.availableUnits = (res.data.units || []).map(u => ({
                ...u,
                selected: false,
                deal_unit_price: u.rent_unit_price || 0,
                deal_management_fee_per_sqm: 20
            }));
            cm.unitsLoaded = true;  // 接口返回后标记为已加载
        });
    };    

    // 添加选中的单元到合同中
    cm.addSelectedUnits = function () {
        if (!cm.formData.units) {
            cm.formData.units = [];
        }

        const selected = cm.availableUnits.filter(u => u.selected);
        console.log(selected);
        selected.forEach(u => {
            if (!cm.formData.units.some(x => x.unit_id === u.id)) {
                cm.formData.units.push({
                    unit_id: u.id,
                    unit_code: u.code,
                    lease_area: Number(u.lease_area) || 0,
                    rent_unit_price: Number(u.rent_unit_price) || 0,
                    deal_unit_price: null, // 默认值
                    deal_management_fee_per_sqm: Number(u.management_fee_per_sqm),
                    remarks: ''
                });
            }
            console.table(cm.formData.units.map(u => u.unit_id));
        });

        cm.availableUnits.forEach(u => u.selected = false);

        console.log('添加后 units:', cm.formData.units);
    };

    // 是否有选中的单元，用于按钮禁用
    cm.hasSelectedUnits = function () {
        return cm.availableUnits && cm.availableUnits.some(u => u.selected);
    };

    // 初始化加载
    cm.loadBuildings();

    //新建合同 
    cm.pre_contract = {
        tenant: null,
        tenant_id: null,
        lessor: null,
        lessor_id: null
    };

    // 删除合同
    cm.deleteContract = function (contract) {
        if (!contract || !contract.id) return;
        // 二次确认
        if (!confirm(`确定要删除合同【${contract.contract_number}】吗？`)) {
            return;
        }

        $http
            .delete(`/api/contracts/${contract.id}`)
            .then(function (res) {
                alert(res.data.message || '删除成功');
                // 从当前列表移除已删合同
                cm.contracts = cm.contracts.filter(c => c.id !== contract.id);
            })
            .catch(function (err) {
                console.error('删除合同失败', err);
                alert(
                    (err.data && err.data.message) || '删除失败，请稍后重试'
                );
            });
    };

    cm.tenantSearch = '';
    cm.filteredTenants = [];
    cm.showTenantDropdown = false;
    cm.loadingTenants = false;

    cm.filterTenants = function () {
        const keyword = cm.tenantSearch.trim();
        if (!keyword) {
            cm.filteredTenants = [];
            return;
        }

        cm.loadingTenants = true;

        $http.get('/api/tenants/dropdown', { params: { q: keyword } })
            .then(function (response) {
                cm.filteredTenants = response.data.tenants || [];
            })
            .catch(function (err) {
                console.error('获取租户失败', err);
            })
            .finally(function () {
                cm.loadingTenants = false;
            });
    };

    // 用户点击租户选项
    cm.selectTenant = function (tenant) {
        cm.pre_contract.tenant = tenant;
        cm.pre_contract.tenant_id = tenant.id;
        cm.tenantSearch = tenant.name;
        cm.showTenantDropdown = false;
    };

    // 处理输入框失焦（稍作延迟，避免误触）
    cm.handleTenantBlur = function () {
        setTimeout(() => {
            cm.showTenantDropdown = false;
        }, 200);
    };

    cm.lessorSearch = '';
    cm.showLessorDropdown = false;
    cm.filteredLessors = [];
    cm.loadingLessors = false;
    cm.pre_contract.lessor = null;

    // 延迟隐藏下拉（防止 blur 后立即点击）
    cm.handleLessorBlur = function () {
        setTimeout(() => cm.showLessorDropdown = false, 200);
    };

    cm.filterLessors = function () {
        const keyword = cm.lessorSearch;
        if (!keyword) {
            cm.filteredLessors = [];
            return;
        }

        cm.loadingLessors = true;
        $http.get('/api/lessors/dropdown', { params: { q: keyword } })
            .then(res => {
                cm.filteredLessors = res.data.lessors || [];
            })
            .catch(err => {
                console.error('获取出租人失败:', err);
            })
            .finally(() => {
                cm.loadingLessors = false;
            });
    };

    cm.selectLessor = function (lessor) {
        cm.pre_contract.lessor = lessor;
        cm.pre_contract.lessor_id = lessor.id;
        cm.lessorSearch = lessor.name;
        cm.showLessorDropdown = false;
    };

    // 添加递增规则
    cm.termOptions = cm.termOptions || {};
    cm.termOptions.increaseRules = cm.termOptions.increaseRules || [];

    cm.addIncreaseRule = function () {
        cm.termOptions.increaseRules = cm.termOptions.increaseRules || [];
        cm.termOptions.increaseRules.push({
            type: 'ANNIVERSARY',
            anchorDate: '',
            effectiveDate: '',
            rate: null
        });
    };

    //删除递增规则
    cm.removeIncreaseRule = function (index) {
        if (cm.termOptions && cm.termOptions.increaseRules && index >= 0 && index < cm.termOptions.increaseRules.length) {
            cm.termOptions.increaseRules.splice(index, 1);
        }
    };

    cm.contract = cm.contract || {};
    cm.contract.remarks = cm.contract.remarks || '';
    cm.generateIncreaseRuleClause = function () {
        const rules = cm.termOptions.increaseRules || [];
        if (!rules.length) return '';

        const parts = rules.map(rule => {
            const ratePercent = (rule.rate * 100).toFixed(2).replace(/\.00$/, '') + '%';

            if (rule.type === 'ANNIVERSARY') {
                return `租金自 ${$filter('localDate')(rule.anchorDate)} 起，每年在同日起按 ${ratePercent} 比例递增`;
            } else if (rule.type === 'POINT') {
                return `自 ${$filter('localDate')(rule.effectiveDate)} 起，额外上调 ${ratePercent}`;
            }
            return '';
        });

        return parts.join('；') + '。';
    };

    cm.generateFreePeriodClause = function () {
        const periods = cm.termOptions.freePeriods || [];
        if (!periods.length) return '';

        const parts = periods.map((free, index) => {
            const start = $filter('localDate')(free.startDate);
            const end = $filter('localDate')(free.endDate);
            return `第 ${index + 1} 段免租期为 ${start} 至 ${end}`;
        });

        return parts.join('；') + '。';
    };

    cm.appendIncreaseRuleToRemarks = function () {
        const clause = cm.generateIncreaseRuleClause();
        if (clause) {
            cm.contract.remarks = (cm.contract.remarks || '') + '\n' + clause;
        }
    };

    cm.appendFreePeriodClause = function () {
        const freeClause = cm.generateFreePeriodClause();
        if (!freeClause) return;

        if (!cm.contract.remarks) {
            cm.contract.remarks = freeClause;
        } else if (!cm.contract.remarks.includes(freeClause)) {
            cm.contract.remarks = cm.contract.remarks.trim().replace(/。?$/, '；') + ' ' + freeClause;
        }
    };

    // 删除已选单元
    cm.removeUnitById = function (unitId) {
        // 找到 unit_id 等于传入 unitId 的索引
        const index = cm.formData.units.findIndex(u => u.unit_id === unitId);
        if (index !== -1) {
            cm.formData.units.splice(index, 1);  // 从数组中删除该元素
        }
    };

    // 免租期
    cm.addFreePeriod = function () {
        if (!cm.termOptions) {
            cm.termOptions = {};
        }
        if (!cm.termOptions.freePeriods) {
            cm.termOptions.freePeriods = [];
        }
        cm.termOptions.freePeriods.push({
            startDate: null,
            endDate: null
        });
    };

    cm.removeFreePeriod = function (index) {
        if (cm.termOptions && cm.termOptions.freePeriods && index >= 0 && index < cm.termOptions.freePeriods.length) {
            cm.termOptions.freePeriods.splice(index, 1);
        }
    };

    cm.openPreview = function () {
        var modalEl = document.getElementById('contractPreviewModal');
        var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
        console.log(cm.pre_contract.lessor.name);
    };

    cm.submitContract = function () {
        // 1. 构造 contract 部分
        const contract = {
            contract_number: cm.contract.contract_number,
            lessor_id: cm.pre_contract.lessor_id || null,
            tenant_id: cm.pre_contract.tenant?.id || null,
            sign_date: formatDateToYMD(cm.contract.sign_date),
            payment_cycle: cm.contract.payment_cycle,
            start_date: formatDateToYMD(cm.contract.start_date),
            end_date: formatDateToYMD(cm.contract.end_date),
            deposit_amount: cm.contract.deposit_amount,
            remarks: (cm.contract.remarks || '') + '\n' + cm.generateIncreaseRuleClause()
        };

        // 2. 构造 units 数组
        const units = cm.formData.units.map(unit => ({
            unit_id: unit.unit_id,
            lease_area: parseFloat(unit.lease_area),          // 转为数字
            rent_unit_price: parseFloat(unit.rent_unit_price),
            deal_unit_price: unit.deal_unit_price,
            deal_management_fee_per_sqm: parseFloat(unit.deal_management_fee_per_sqm),
            remarks: unit.remarks || ''
        }));

        // 3. 计算总面积 area
        const totalArea = units.reduce((sum, u) => sum + (isNaN(u.lease_area) ? 0 : u.lease_area), 0);

        // 4. 构造 termOptions
        const termOptions = {
            baseRentRate: cm.termOptions.baseRentRate,
            serviceRate: cm.termOptions.serviceRate,
            area: totalArea,
            splitMode: cm.termOptions.splitMode,
            increaseRules: (cm.termOptions.increaseRules || []).map(r => {
                const rule = { type: r.type, rate: r.rate };
                if (r.type === 'ANNIVERSARY') rule.anchorDate = formatDateToYMD(r.anchorDate);
                else if (r.type === 'POINT') rule.effectiveDate = formatDateToYMD(r.effectiveDate);
                return rule;
            }),
            freePeriods: (cm.termOptions.freePeriods || []).map(fp => ({
                startDate: formatDateToYMD(fp.startDate),
                endDate: formatDateToYMD(fp.endDate)
            }))
        };

        // 5. 上传文件 ID（从最新指令绑定的 uploadedFiles 获取）
        const uploadedFileIds = (cm.formData.uploadedFiles || []).map(f => f.id);

        // 6. 构造 payload
        const payload = { contract, units, termOptions, fileIds: uploadedFileIds };

        function showToast(message, type = 'success') {
            const toastEl = document.getElementById('appToast');
            const toastBody = toastEl.querySelector('.toast-body');
            toastBody.textContent = message;
            toastEl.className = `toast align-items-center text-white bg-${type} border-0`;
            const toast = new bootstrap.Toast(toastEl);
            toast.show();
        }

        // 7. 发起请求
        $http.post('/api/contracts', payload)
            .then(function (response) {
                cm.contractId = response.data.contractId;
                showToast('合同创建成功！合同ID：' + response.data.contractId, 'success');
                setTimeout(() => {
                    $state.go('contract_detail', { id: response.data.contractId });
                }, 1000);
            })
            .catch(function (error) {
                const message = error?.data?.message || '未知错误';
                const detail = error?.data?.error || '';
                showToast(`合同创建失败：${message}${detail ? '（' + detail + '）' : ''}`, 'danger');
            });
    };

    $scope.$watch(
        () => cm.formData.units.length > 0 ? cm.formData.units[0].deal_unit_price : null,
        function (newVal) {
            if (newVal != null && !isNaN(newVal)) {
                cm.termOptions.baseRentRate = newVal;
            }
        }
    );

    // 保证金计算
    cm.depositOption = '2'; // 默认2押

    cm.updateDeposit = function () {
        if (cm.depositOption === 'custom') return;
        const rent = +cm.termOptions.baseRentRate || 0;
        const service = +cm.termOptions.serviceRate || 0;
        const totalArea = cm.formData.units.reduce((sum, unit) => {
            return sum + (+unit.lease_area || 0);
        }, 0);
        const multiple = +cm.depositOption;
        const deposit = (rent + service) * totalArea * multiple;
        cm.contract.deposit_amount = Math.round(deposit); // 可选：保留整数
    };

    $scope.$watchGroup([
        'cm.termOptions.baseRentRate',
        'cm.termOptions.serviceRate',
        'cm.unit.lease_area'
    ], function () {
        if (cm.depositOption !== 'custom') {
            cm.updateDeposit();
        }
    });

    $scope.$watchCollection('cm.formData.units', function () {
        if (cm.depositOption !== 'custom') {
            cm.updateDeposit();
        }
    });

    $scope.$watch('cm.termOptions.baseRentRate', function (newVal) {
        if (newVal !== undefined) {
            angular.forEach($scope.cm.formData.units, function (unit) {
                unit.deal_unit_price = newVal;
            });
        }
    });

    // 合同主体列表
    cm.lessors = [];
    cm.lessorPage = 1;
    cm.lessorPageSize = 10;
    cm.lessorTotalPages = 1;

    cm.loadLessors = function () {
        $http.get('/api/lessors/list', { params: { page: cm.lessorPage, size: cm.lessorPageSize } })
            .then(res => {
                cm.lessors = res.data.lessors;
                cm.lessorTotalPages = res.data.totalPages;
                console.log(res.data);
            });
    };

    cm.changeLessorPage = function (page) {
        if (page < 1 || page > cm.lessorTotalPages) return;
        cm.lessorPage = page;
        cm.loadLessors();
    };

    // 新增/编辑
    cm.editingLessor = {};
    cm.openLessorModal = function (lessor) {
        cm.editingLessor = lessor ? angular.copy(lessor) : {};
        new bootstrap.Modal(document.getElementById('lessorModal')).show();
    };

    cm.saveLessor = function () {
        const req = cm.editingLessor.id
            ? $http.put(`/api/lessors/${cm.editingLessor.id}`, cm.editingLessor)
            : $http.post('/api/lessors', cm.editingLessor);
        req.then(() => {
            bootstrap.Modal.getInstance(document.getElementById('lessorModal')).hide();
            cm.loadLessors();
        });
    };

    // 删除
    cm.deleteLessor = function (id) {
        if (confirm('确认删除该出租人？')) {
            $http.delete(`/api/lessors/${id}`).then(() => cm.loadLessors());
        }
    };

    // 初始化
    cm.loadLessors();

    // 获取待办任务
    cm.loadPendingTasks = function () {
        if (!userId) return;

        $http.get(`http://host:4001/task/pendingTasks?userId=${userId}`)
            .then(function (res) {
                if (res.data.success) {
                    cm.pendingTasks = res.data.data || [];
                    cm.pendingTasksCount = cm.pendingTasks.length;
                }
            })
            .catch(function (err) {
                console.error('加载待办任务失败', err);
            });
    };

    cm.goTasks = function () {
        console.log('待办任务数量:', cm.pendingTasksCount);
        console.log('待办任务列表:', cm.pendingTasks);

        // 获取模态框元素
        const modalEl = document.getElementById('pendingTasksModal');
        if (!modalEl) return console.warn('未找到待办任务模态框');

        // 使用 Bootstrap 5 Modal API 打开模态框
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }

    cm.goToTask = function (task) {
        if (task.contract_id) {
            const modalElement = document.getElementById('pendingTasksModal');
            const modalInstance = bootstrap.Modal.getInstance(modalElement);

            if (modalInstance) {
                modalInstance.hide();
            }

            setTimeout(function () {
                cm.viewContract({ id: task.contract_id });
            }, 300);
        } else {
            alert('无法找到关联合同');
        }
    };

    cm.loadPendingTasks();

    cm.workflows = [];

    cm.loadUserWorkflows = function () {
        const url = 'http://host:4001/workflow_instances/user_instances';
        const params = {
            userId: userId,
            page: 1,
            limit: 20,
        };

        $http.get(url, { params })
            .then(res => {
                if (res.data.success) {
                    cm.workflows = res.data.instances.map(i => {
                        const context = i.context_json || {};
                        return {
                            ...i,
                            name: context.contract_name || i.business_key,  // 可以用业务字段作为显示名称
                            contract_name: context.contract_name || '-',
                            project_name: context.project_name || '-',
                            amount: context.amount || '-',
                            // 可以根据 context_json 里的其他字段继续扩展
                        };
                    });
                } else {
                    cm.workflows = [];
                    console.error('获取流程失败', res.data.message);
                }
            })
            .catch(err => {
                cm.workflows = [];
                console.error('获取流程异常', err);
            });
    };

    cm.viewWorkflow = function (flow) {
        alert('查看流程：' + flow.business_key);
        // 可以弹窗或跳转到流程详情页
    };

    // 页面加载时自动请求
    cm.loadUserWorkflows();
}]);
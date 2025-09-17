app.controller('contract_edit_controller', function ($stateParams, $http, $timeout, $scope, $state, $filter) {
    var cem = this;
    console.log('Contract ID:', $stateParams.id);

    // 构造合同编辑formdata
    cem.formdata = {
        contract: {},
        units: [],
        termOptions: {},
        fileName: '',
        uploadedFiles: []
    };

    // 解析日期
    function parseDate(dateStr) {
        if (!dateStr) return null;
        const [datePart, timePart] = dateStr.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        let hours = 0, minutes = 0, seconds = 0;
        if (timePart) {
            [hours, minutes, seconds] = timePart.split(':').map(Number);
        }
        return new Date(year, month - 1, day, hours, minutes, seconds);
    }

    // 提交前使用
    function parseDateForSubmit(dateInput) {
        if (!dateInput) return null;

        let dateObj;
        if (typeof dateInput === 'string') {
            // 转成 Date 对象
            dateObj = new Date(dateInput);
        } else if (dateInput instanceof Date) {
            dateObj = dateInput;
        } else {
            return null;
        }

        if (isNaN(dateObj)) return null;

        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');

        return `${yyyy}-${mm}-${dd}`; // MySQL DATE 格式
    }

    // ---------- 出租人 ----------
    cem.lessorSearch = cem.formdata.contract.lessor_name || ''; // 初始值
    cem.showLessorDropdown = false;
    cem.filteredLessors = [];
    cem.loadingLessors = false;
    cem.formdata.contract.lessor_id = cem.formdata.contract.lessor?.id || null;
    cem.fileName = null;
    cem.uploadedFiles = null;
    // 输入框失焦，延迟隐藏下拉
    cem.handleLessorBlur = function () {
        setTimeout(() => cem.showLessorDropdown = false, 200);
    };

    // 过滤出租人
    cem.filterLessors = function () {
        const keyword = (cem.lessorSearch || '').trim();
        if (!keyword) {
            cem.filteredLessors = [];
            return;
        }
        cem.loadingLessors = true;
        $http.get('/api/lessors/dropdown', { params: { q: keyword } })
            .then(res => {
                cem.filteredLessors = res.data.lessors || [];
                cem.showLessorDropdown = true;
            })
            .catch(err => console.error('获取出租人失败:', err))
            .finally(() => cem.loadingLessors = false);
    };

    // 用户选择出租人
    cem.selectLessor = function (lessor) {
        cem.formdata.contract.lessor = lessor.name;
        cem.formdata.contract.lessor_id = lessor.id;
        cem.lessorSearch = lessor.name;
        cem.showLessorDropdown = false;
    };

    // ---------- 承租人 ----------
    cem.tenantSearch = cem.formdata.contract.tenant_name || '';
    cem.showTenantDropdown = false;
    cem.filteredTenants = [];
    cem.loadingTenants = false;
    cem.formdata.contract.tenant_id = cem.formdata.contract.tenant_id || null;

    cem.handleTenantBlur = function () {
        setTimeout(() => cem.showTenantDropdown = false, 200);
    };

    cem.filterTenants = function () {
        const keyword = (cem.tenantSearch || '').trim();
        if (!keyword) {
            cem.filteredTenants = [];
            return;
        }

        cem.loadingTenants = true;
        $http.get('/api/tenants/dropdown', { params: { q: keyword } })
            .then(res => {
                cem.filteredTenants = res.data.tenants || [];
                cem.showTenantDropdown = true;
            })
            .catch(err => console.error('获取租户失败:', err))
            .finally(() => cem.loadingTenants = false);
    };

    cem.selectTenant = function (tenant) {
        cem.formdata.contract.tenant = tenant.name;
        cem.formdata.contract.tenant_id = tenant.id;
        cem.tenantSearch = tenant.name;
        cem.showTenantDropdown = false;
    };

    // ---------------------- 加载楼栋 ----------------------
    cem.loadBuildings = function () {
        $http.get('/api/buildings').then(res => {
            cem.buildings = res.data.data || [];
        });
    };

    // ---------------------- 楼栋变更 ----------------------
    cem.onBuildingChange = function () {
        cem.selectedFloor = null;
        cem.floors = [];
        cem.availableUnits = [];

        if (!cem.selectedBuilding?.id) return;

        $http.get(`/api/buildings/${cem.selectedBuilding.id}/floors`).then(res => {
            cem.floors = res.data.data || [];
        });
    };

    // ---------------------- 楼层变更 ----------------------
    cem.loadUnits = function () {
        if (!cem.selectedBuilding?.id || !cem.selectedFloor?.id) return;

        $http.get('/api/units', {
            params: {
                building_id: cem.selectedBuilding.id,
                floor: cem.selectedFloor.floor,
                status: 'vacant'
            }
        }).then(res => {
            cem.availableUnits = (res.data.units || []).map(u => ({
                ...u,
                selected: false,
                deal_unit_price: Number(u.deal_unit_price || u.rent_unit_price) || 0,
                deal_management_fee_per_sqm: Number(u.deal_management_fee_per_sqm || 20)
            }));
        });
    };

    // ---------------------- 添加选中单元 ----------------------
    cem.addSelectedUnits = function () {
        const selected = cem.availableUnits.filter(u => u.selected);
        selected.forEach(u => {
            if (!cem.formdata.units.some(x => x.unit_id === u.id)) {
                cem.formdata.units.push({
                    unit_id: u.id,
                    unit_code: u.unit_code || u.code || '',
                    lease_area: Number(u.lease_area) || 0,
                    rent_unit_price: Number(u.rent_unit_price) || 0,
                    deal_unit_price: Number(u.deal_unit_price || u.rent_unit_price) || 0,
                    deal_management_fee_per_sqm: Number(u.deal_management_fee_per_sqm) || 20,
                    remarks: u.remarks || ''
                });
            }
        });

        // 清空可选单元选中状态
        cem.availableUnits.forEach(u => u.selected = false);
    };

    cem.hasSelectedUnits = function () {
        return cem.availableUnits.some(u => u.selected);
    };

    cem.removeUnitById = function (unitId) {
        cem.formdata.units = cem.formdata.units.filter(u => u.unit_id !== unitId);
    };

    // ---------------------- 初始化 ----------------------
    cem.loadBuildings();

    // ---------------------- 加载合同 ----------------------
    $http.get('http://host:3001/api/contracts/' + $stateParams.id).then(function (resp) {
        const contract = resp.data.contract;

        // ---------- 合同信息 ----------
        cem.formdata.contract.contract_number = contract.contract_number;
        cem.formdata.contract.sign_date = parseDate(contract.sign_date);
        cem.formdata.contract.start_date = parseDate(contract.start_date);
        cem.formdata.contract.end_date = parseDate(contract.end_date);
        cem.formdata.contract.deposit_amount = contract.deposit_amount;
        cem.formdata.contract.payment_cycle = contract.payment_cycle;
        cem.formdata.contract.remarks = contract.remarks;
        cem.lessorSearch = contract.lessor_name;
        cem.tenantSearch = contract.tenant_name;
        cem.formdata.contract.lessor_id = contract.lessor_id;
        cem.formdata.contract.tenant_id = contract.tenant_id;
        cem.formdata.deposit_amount = parseFloat(contract.deposit_amount);
        cem.formdata.serviceRate = parseFloat(resp.data.terms[0].service_rate);

        // ---------- 加载已选单元 ----------
        cem.formdata.units = (resp.data.units || []).map(u => ({
            unit_id: u.unit_id,
            unit_code: u.unit_code,
            lease_area: Number(u.lease_area) || 0,
            rent_unit_price: Number(u.rent_unit_price) || 0,
            deal_unit_price: Number(u.deal_unit_price) || 0,
            deal_management_fee_per_sqm: Number(u.deal_management_fee_per_sqm) || 20,
            remarks: u.remarks || '',
            building_name: u.building_name
        }));

        // ---------- 还原租期 ----------
        restoreTenant();
        restoreLessor();
        cem.restoreTermsFromSegments(resp.data.terms);
        $timeout(cem.restoreSelectedUnits, 200);

        // ---------- 初始化文件 ----------
        cem.uploadedFiles = (resp.data.files || []).map(f => ({
            id: f.id,
            name: f.name,
            url: f.url
        }));
        cem.fileName = cem.uploadedFiles.map(f => f.name).join(', ');
    });

    $scope.$watch('cem.formdata.units', function (newUnits) {
        if (newUnits && newUnits.length > 0) {
            cem.formdata.baseRentRate = newUnits[0].deal_unit_price;
        }
    }, true);

    // 初始化条款选项
    cem.formdata.termOptions = {
        increaseRules: [], // 递增规则数组
        freePeriods: []    // 免租期数组
    };

    // ---- 租金递增 ----
    cem.addIncreaseRule = function () {
        cem.formdata.termOptions.increaseRules.push({
            type: 'ANNIVERSARY',
            anchorDate: null,
            effectiveDate: null,
            rate: null
        });
    };

    cem.removeIncreaseRule = function (index) {
        cem.formdata.termOptions.increaseRules.splice(index, 1);
    };

    cem.generateIncreaseRuleClause = function () {
        const rules = cem.formdata.termOptions.increaseRules || [];
        if (!rules.length) return '';

        return rules.map(function (rule) {
            var ratePercent = ((rule.rate || 0) * 100).toFixed(2).replace(/\.00$/, '') + '%';
            if (rule.type === 'ANNIVERSARY') {
                return '租金自 ' + $filter('localDate')(rule.anchorDate) + ' 起，每年在同日起按 ' + ratePercent + ' 比例递增';
            } else if (rule.type === 'POINT') {
                return '自 ' + $filter('localDate')(rule.effectiveDate) + ' 起，额外上调 ' + ratePercent;
            }
            return '';
        }).join('；') + '。';
    };

    cem.appendIncreaseRuleToRemarks = function () {
        var clause = cem.generateIncreaseRuleClause();
        if (clause) {
            cem.formdata.contract.remarks = (cem.formdata.contract.remarks || '') + '\n' + clause;
        }
    };

    // ---- 免租期 ----
    cem.addFreePeriod = function () {
        cem.formdata.termOptions.freePeriods.push({
            startDate: null,
            endDate: null
        });
    };

    cem.removeFreePeriod = function (index) {
        cem.formdata.termOptions.freePeriods.splice(index, 1);
    };

    cem.generateFreePeriodClause = function () {
        var periods = cem.formdata.termOptions.freePeriods || [];
        if (!periods.length) return '';

        return periods.map(function (free, i) {
            return '第 ' + (i + 1) + ' 段免租期为 ' + $filter('localDate')(free.startDate) + ' 至 ' + $filter('localDate')(free.endDate);
        }).join('；') + '。';
    };

    cem.appendFreePeriodToRemarks = function () {
        var freeClause = cem.generateFreePeriodClause();
        if (!freeClause) return;
        if (!cem.formdata.contract.remarks) {
            cem.formdata.contract.remarks = freeClause;
        } else if (!cem.formdata.contract.remarks.includes(freeClause)) {
            cem.formdata.contract.remarks = cem.formdata.contract.remarks.trim().replace(/。?$/, '；') + ' ' + freeClause;
        }
    };

    // ---------------------- 恢复已选单元 ----------------------
    cem.restoreSelectedUnits = function () {
        if (!cem.formdata.units.length) return;

        const firstUnit = cem.formdata.units[0];

        // 1. 找到楼栋
        cem.selectedBuilding = cem.buildings.find(b => b.name === firstUnit.building_name);
        if (!cem.selectedBuilding) return;

        // 2. 加载楼层
        $http.get(`/api/buildings/${cem.selectedBuilding.id}/floors`).then(res => {
            cem.floors = res.data.data || [];

            // 3. 确定楼层
            cem.selectedFloor = cem.floors.find(f => f.floor === firstUnit.floor) || cem.floors[0];

            if (!cem.selectedFloor) return;

            // 4. 加载可选单元（只加载当前楼层）
            $http.get('/api/units', {
                params: {
                    building_id: cem.selectedBuilding.id,
                    floor: cem.selectedFloor.floor,
                    status: 'vacant'
                }
            }).then(res => {
                cem.availableUnits = (res.data.units || []).map(u => ({
                    ...u,
                    selected: cem.formdata.units.some(fu => fu.unit_id === u.id),
                    deal_unit_price: Number(u.deal_unit_price || u.rent_unit_price) || 0,
                    deal_management_fee_per_sqm: Number(u.deal_management_fee_per_sqm) || 20
                }));
            });
        });
    };

    // ---------------------- 初始化还原承租人 ----------------------
    function restoreTenant() {
        const tenantId = cem.formdata.contract.tenant_id;
        if (!tenantId) return;

        cem.loadingTenants = true;
        $http.get('/api/tenants/dropdown', { params: { id: tenantId } })
            .then(res => {
                const tenants = res.data.tenants || [];
                if (tenants.length > 0) {
                    const selected = tenants[0];
                    cem.pre_contract = cem.pre_contract || {};
                    cem.pre_contract.tenant = selected;
                    cem.formdata.contract.tenant = selected.name;
                    cem.tenantSearch = selected.name;
                }
            })
            .finally(() => {
                cem.loadingTenants = false;
            });
    }

    // ---------------------- 初始化还原出租人 ----------------------
    function restoreLessor() {
        const lessorId = cem.formdata.contract.lessor_id;
        if (!lessorId) return;

        cem.loadingLessors = true;
        $http.get('/api/lessors/dropdown', { params: { id: lessorId } })
            .then(res => {
                const lessors = res.data.lessors || [];
                if (lessors.length > 0) {
                    const selected = lessors[0];
                    cem.pre_contract = cem.pre_contract || {};
                    cem.pre_contract.lessor = selected;
                    cem.formdata.contract.lessor = selected.name;
                    cem.lessorSearch = selected.name;
                }
            })
            .finally(() => {
                cem.loadingLessors = false;
            });
    }

    cem.restoreTermsFromSegments = function (terms) {
        if (!terms || !terms.length) return;

        cem.formdata.termOptions = {
            freePeriods: [],
            increaseRules: [],
            splitMode: 'NATURAL_MONTH'
        };

        // -------------------------------
        // 2. 回填免租期
        // -------------------------------
        cem.formdata.termOptions.freePeriods = terms
            .filter(term => term.is_rent_free == 1)
            .map(term => ({
                startDate: parseDate(term.term_start),
                endDate: parseDate(term.term_end)
            }));

        console.log('回填免租期 freePeriods:', cem.formdata.termOptions.freePeriods);

        // -------------------------------
        // 3. 回填递增规则
        // -------------------------------
        let lastRate = 1.0;
        let anniversaryRuleAdded = false;
        cem.formdata.termOptions.increaseRules = [];

        terms.forEach(term => {
            const rateNum = parseFloat(term.applied_increase_rate);
            if (rateNum !== lastRate) {
                const rate = parseFloat((rateNum / lastRate - 1).toFixed(4));
                lastRate = rateNum;

                const isAnniversary = term.remark && term.remark.startsWith('周年递增');

                if (isAnniversary && !anniversaryRuleAdded) {
                    // 只提取第一条周年递增规则
                    cem.formdata.termOptions.increaseRules.push({
                        type: 'ANNIVERSARY',
                        anchorDate: parseDate(term.term_start), // 起始日期
                        rate: rate
                    });
                    anniversaryRuleAdded = true;
                } else if (!isAnniversary) {
                    // 逐条提取指定日期递增
                    cem.formdata.termOptions.increaseRules.push({
                        type: 'POINT',
                        effectiveDate: parseDate(term.term_start),
                        rate: rate
                    });
                }
            }
        });

        console.log('回填递增规则 increaseRules:', cem.formdata.termOptions.increaseRules);

        // -------------------------------
        // 4. 拆分方式
        // -------------------------------
        cem.formdata.splitMode = 'NATURAL_MONTH';

        // -------------------------------
        // 5. 刷新 AngularJS 视图
        // -------------------------------
        if (!$scope.$$phase) $scope.$applyAsync();
    };

    // 计算每月租金总额
    function getMonthlyRent() {
        var total = 0;
        if (cem.formdata.units && cem.formdata.units.length > 0) {
            cem.formdata.units.forEach(function (unit) {
                var dealPrice = parseFloat(unit.deal_unit_price) || 0;
                var managePrice = parseFloat(unit.deal_management_fee_per_sqm) || 0;
                var area = parseFloat(unit.lease_area) || 0;
                total += (dealPrice + managePrice) * area;
            });
        }
        return total;
    }

    // 根据倍数计算保证金金额
    cem.updateDepositAmount = function () {
        var multiple = parseFloat(cem.formdata.deposit_multiple);
        if (!isNaN(multiple)) {
            var monthlyRent = getMonthlyRent();
            cem.formdata.deposit_amount = parseFloat((monthlyRent * multiple).toFixed(2));
        }
    };

    cem.updateDepositMultiple = function () {
        var depositAmount = parseFloat(cem.formdata.deposit_amount);
        if (!isNaN(depositAmount)) {
            var monthlyRent = getMonthlyRent();
            if (monthlyRent > 0) {
                var multiple = depositAmount / monthlyRent;
                var rounded = Math.round(multiple);
                if ([1, 2, 3].includes(rounded)) {
                    cem.formdata.deposit_multiple = String(rounded);
                } else {
                    cem.formdata.deposit_multiple = 'custom';
                }
            }
        }
    };

    // 更新单元成交价或管理费时触发
    cem.updateUnitPrice = function (unit) {
        if (unit) {
            unit.deal_management_fee_per_sqm = parseFloat(cem.formdata.serviceRate) || 0;
        } else {
            // 如果 unit 未传，说明修改的是全局 serviceRate，需要同步到每个单元
            const serviceRate = parseFloat(cem.formdata.serviceRate) || 0;
            (cem.formdata.units || []).forEach(u => {
                u.deal_management_fee_per_sqm = serviceRate;
            });
        }

        // 同步更新押金
        cem.updateDepositAmount();
    };

    // 等接口数据加载完成后执行初始化计算
    $scope.$watch('cem.formdata.units', function (newVal) {
        if (newVal && newVal.length > 0) {
            if (cem.formdata.deposit_amount) {
                // 如果接口返回了保证金金额 → 反推倍数
                cem.updateDepositMultiple();
            } else if (cem.formdata.deposit_multiple) {
                // 如果接口返回了倍数 → 计算金额
                cem.updateDepositAmount();
            }
        }
    }, true);

    cem.submit_contract_editing = function () {
        if (!cem.formdata.contract) {
            alert('合同信息缺失');
            return;
        }

        // 先组装 payload
        const payload = {
            contract: {
                id: $stateParams.id,
                contract_number: cem.formdata.contract.contract_number ?? null,
                tenant_id: cem.formdata.contract.tenant_id ?? null,
                lessor_id: cem.formdata.contract.lessor_id ?? null,
                parent_contract_id: cem.formdata.contract.parent_contract_id ?? null,
                sign_date: parseDateForSubmit(cem.formdata.contract.sign_date),
                start_date: parseDateForSubmit(cem.formdata.contract.start_date),
                end_date: parseDateForSubmit(cem.formdata.contract.end_date),
                deposit_amount: cem.formdata.deposit_amount ?? null,
                payment_cycle: cem.formdata.contract.payment_cycle ?? null,
                remarks: cem.formdata.contract.remarks ?? null,
                version: cem.formdata.contract.version ?? null
            },

            units: (cem.formdata.units || []).map(u => ({
                unit_id: u.unit_id ?? null,
                lease_area: u.lease_area ?? null,
                rent_unit_price: u.rent_unit_price ?? null,
                deal_unit_price: u.deal_unit_price ?? null,
                deal_management_fee_per_sqm: u.deal_management_fee_per_sqm ?? null,
                remarks: u.remarks ?? null
            })),

            termOptions: {
                baseRentRate: cem.formdata.baseRentRate ?? null,
                serviceRate: cem.formdata.serviceRate ?? null,
                splitMode: cem.formdata.splitMode ?? 'NATURAL_MONTH',
                increaseRules: (cem.formdata.termOptions?.increaseRules || []).map(r => ({
                    type: r.type ?? 'ANNIVERSARY',
                    rate: r.rate ?? null,
                    anchorDate: r.type === 'ANNIVERSARY' ? parseDateForSubmit(r.anchorDate) : null,
                    effectiveDate: r.type === 'POINT' ? parseDateForSubmit(r.effectiveDate) : null
                })),
                freePeriods: (cem.formdata.termOptions?.freePeriods || []).map(f => ({
                    startDate: parseDateForSubmit(f.startDate),
                    endDate: parseDateForSubmit(f.endDate)
                }))
            },
            files: (cem.uploadedFiles || []).map(f => ({
                id: f.id,
                name: f.name
            }))
        };

        // 递归检查 undefined 字段，统一转换为 null
        function checkUndefined(obj, path = '') {
            for (let key in obj) {
                if (obj[key] === undefined) {
                    console.warn(`Warning: ${path}${key} is undefined, converting to null`);
                    obj[key] = null;
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    checkUndefined(obj[key], path + key + '.');
                }
            }
        }

        checkUndefined(payload);

        console.log('提交 payload:', payload);

        cem.loading = true;
        $http.put('/api/contracts/' + $stateParams.id, payload)
            .then(function (response) {
                cem.loading = false;
                if (response.data && response.data.message) {
                    alert('合同编辑成功');
                    setTimeout(function () {
                        $state.go('contract_detail', { id: $stateParams.id });
                    }, 1000);
                }
            })
            .catch(function (error) {
                cem.loading = false;
                if (error.status === 409) {
                    alert('版本冲突，合同已被其他人修改，请刷新页面');
                } else {
                    alert('保存失败：' + (error.data?.message || '服务器错误'));
                }
            });
    };
});

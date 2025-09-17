app.controller('CRMController', ['$http', '$sce', '$window', function ($http, $sce, $window) {
    const ccm = this;
    var user = JSON.parse($window.localStorage.getItem('user'));
    if (user) {
        ccm.user = user;
        ccm.defaultTab = 'newCustomer';
        $http.defaults.headers.common['Authorization'] = 'Bearer ' + user.token;
        ccm.newCustomer = ccm.newCustomer || {};
        ccm.newCustomer.sales_channel_id = Number(ccm.user.id);
        ccm.newReport = ccm.newReport || {};
        ccm.newReport.sales_channel_id = Number(ccm.user.id);
    } else {
        alert('你还没登录，请先登录');
        window.location.href = '/pages/templates/share_login.html';
    }

    const host = 'http://host:3001';
    ccm.currentPage = 1;
    ccm.itemsPerPage = 4;
    ccm.reports = [];
    ccm.totalItems = 0;
    ccm.totalPages = 1;
    ccm.pageRange = [];
    ccm.reportData = null;
    ccm.errorMessage = '';
    ccm.textReport = '';
    const now = new Date();
    ccm.minDateTime = now.toISOString().slice(0, 16);
    // 查询条件初始化（汇总及历史查询使用）
    ccm.salesChannelId = '';  // 查询汇总数据时使用
    ccm.startDate = '';
    ccm.endDate = '';
    ccm.query = {
        startDate: '',
        endDate: '',
        sales_channel_id: '',
        platform: '全平台'
    };

    // 定义动态表单字段（仅新建日报用）
    ccm.reportFields = [
        { label: '招商ID', model: 'sales_channel_id', type: 'number', required: true, disabled: true, placeholder: '系统自动填充',hidden: true},
        { label: '日期', model: 'report_date', type: 'date', required: true, placeholder: '请选择报告日期' },
        { label: '询盘数', model: 'inquiries', type: 'number', required: true, placeholder: '请输入询盘数量' },
        { label: '新客户数', model: 'new_customers', type: 'number', required: true, placeholder: '请输入新增客户数量' },
        { label: '中介拜访数', model: 'agency_visits', type: 'number', required: true, placeholder: '请输入中介拜访次数' },
        { label: '拜访详情', model: 'describe_of_visits', type: 'textarea', placeholder: '请描述具体拜访情况' },
        { label: '群活动数', model: 'groups_activities', type: 'number', placeholder: '请输入举办的群活动次数' },
        { label: '活动详情', model: 'describe_of_groups_activities', type: 'textarea', placeholder: '请描述群活动内容' },
        { label: '新中介数', model: 'new_agencies', type: 'number', placeholder: '请输入今日新增中介数量' },
        { label: '中介总人数', model: 'total_agency_of_have', type: 'number', required: true, placeholder: '请输入目前总中介人数' },
        { label: '成交客户数', model: 'done_customers', type: 'number', placeholder: '请输入今日成交客户数' },
        { label: '成交工位数', model: 'done_workstations', type: 'number', placeholder: '请输入成交工位数' },
        { label: '跟进客户数', model: 'customers_under_following', type: 'number', placeholder: '请输入跟进中的客户数量' },
        { label: '问题反馈', model: 'question_for_feedback', type: 'textarea', placeholder: '请输入需要反馈的问题' },
        { label: '小红书', model: 'XHS', type: 'number', placeholder: '请输入小红书发文数' },
        { label: '抖音', model: 'DY', type: 'number', placeholder: '请输入抖音发文数' },
        { label: '视频号', model: 'SPH', type: 'number', placeholder: '请输入视频号发文数' },
        { label: '大众点评', model: 'DZDP', type: 'number', placeholder: '请输入大众点评发文数' },
        { label: '社交媒体发布详情', model: 'social_media_describe', type: 'textarea', placeholder: '请输入社交媒体发布内容或摘要' }
    ];

    // 提交新日报报告
    ccm.submitReport = function () {
        const localDate = ccm.formatDate(new Date(ccm.newReport.report_date));
        const reportData = angular.copy(ccm.newReport);
        reportData.report_date = localDate;
        $http.post(`${host}/report`, reportData)
            .then(() => {
                alert('提交成功！');
                ccm.newReport = ''
            })
            .catch(err => {
                console.log(reportData);
                alert('提交失败: ' + (err.data?.message || '服务器错误'));
                console.error('提交失败：', err);
            });
    };

    // 加载报告列表，支持动态传递查询参数
    function loadReports(sales_channel_id, start_date, end_date) {
        const params = {
            page: ccm.currentPage,
            page_size: ccm.itemsPerPage,
            sales_channel_id: sales_channel_id,
            start_date: start_date,
            end_date: end_date
        };
        $http.get(`${host}/report`, { params })
            .then(response => {
                ccm.reports = response.data.data;
                ccm.totalItems = response.data.total;
                ccm.totalPages = Math.ceil(ccm.totalItems / ccm.itemsPerPage);
                ccm.updatePageRange();
            })
            .catch(err => {
                console.error('加载报告列表失败:', err);
            });
    }

    // 分页功能
    ccm.updatePageRange = function () {
        const rangeSize = 5;
        let start = Math.max(1, ccm.currentPage - Math.floor(rangeSize / 2));
        let end = Math.min(ccm.totalPages, start + rangeSize - 1);
        start = Math.max(1, end - rangeSize + 1);

        // 生成新数组
        const newPageRange = [];
        for (let i = start; i <= end; i++) newPageRange.push(i);

        // 检查新旧数组内容是否一致，避免重复触发 digest
        if (angular.equals(ccm.pageRange, newPageRange)) return;

        // 仅当内容不同时更新
        ccm.pageRange = newPageRange;
    };

    ccm.gotoPage = function (n) {
        if (n !== ccm.currentPage && n > 0 && n <= ccm.totalPages) {
            ccm.currentPage = n;
            loadReports(ccm.query.sales_channel_id, ccm.formatDate(new Date(ccm.query.startDate)), ccm.formatDate(new Date(ccm.query.endDate)));
        }
    };

    ccm.prevPage = function () {
        ccm.gotoPage(ccm.currentPage - 1);
    };

    ccm.nextPage = function () {
        ccm.gotoPage(ccm.currentPage + 1);
    };

    // 根据传入日期对象格式化字符串，若为空则返回空字符串
    ccm.formatDate = function (date) {
        if (!date || !(date instanceof Date)) return '';
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0'); // 补零
        const day = date.getDate().toString().padStart(2, '0'); // 补零
        return `${year}-${month}-${day}`;
    };

    // 查询日报数据
    ccm.fetchReport = function () {
        ccm.reportData = null;
        ccm.errorMessage = '';
        const startDateFormatted = ccm.formatDate(new Date(ccm.startDate));
        const endDateFormatted = ccm.formatDate(new Date(ccm.endDate));

        // 检查查询条件是否与上一次相同
        const currentQuery = {
            salesChannelId: ccm.salesChannelId,
            startDate: startDateFormatted,
            endDate: endDateFormatted
        };

        if (angular.equals(ccm.lastQueryParams, currentQuery)) {
            return; // 查询条件未变化，直接返回
        }

        ccm.lastQueryParams = currentQuery; // 保存当前查询参数

        const url = `${host}/report_by_date?sales_channel_id=${ccm.salesChannelId}&start_date=${startDateFormatted}&end_date=${endDateFormatted}`;

        $http.get(url)
            .then(response => {
                if (response.data.success) {
                    // 检查数据是否实际变化
                    if (angular.equals(ccm.reportData, response.data)) return;
                    ccm.reportData = response.data;
                } else {
                    ccm.errorMessage = response.data.message || '查询失败';
                }
            })
            .catch(error => {
                ccm.errorMessage = '请求失败，请检查网络或接口地址';
            });
    };

    // 将汇总数据转换为数组，便于展示
    ccm.getSummaryItems = function () {
        if (!ccm.reportData || !ccm.reportData.summaryData || ccm.reportData.summaryData.length === 0) {
            ccm.cachedSummaryItems = [];
            return ccm.cachedSummaryItems;
        }

        const summary = ccm.reportData.summaryData[0];
        const newSummaryItems = [
            { label: '招商ID', value: summary.sales_channel_id },
            { label: '姓名', value: summary.sales_channel_name },
            { label: '累计询盘数', value: summary.total_inquiries + '次' },
            { label: '累计新客户数', value: summary.total_new_customers + '台' },
            { label: '累计中介拜访数', value: summary.total_agency_visits + '次' },
            { label: '累计群活动次数', value: summary.total_groups_activities + '次' },
            { label: '累计新中介数', value: summary.total_new_agencies + '人' },
            { label: '累计成交客户数', value: summary.total_done_customers + '台' },
            // { label: '累计跟进客户数', value: summary.total_customers_under_following + '台' },
            { label: '累计成交工位数', value: summary.total_done_workstations + '个' },
            { label: '小红书', value: summary.total_XHS + '条' },
            { label: '抖音', value: summary.total_DY + '条' },
            { label: '视频号', value: summary.total_SPH + '条' },
            { label: '大众点评', value: summary.total_DZDP + '条' }
        ];
        if (angular.equals(ccm.cachedSummaryItems, newSummaryItems)) {
            return ccm.cachedSummaryItems;
        }
        ccm.cachedSummaryItems = newSummaryItems;
        return ccm.cachedSummaryItems;
    };

    //卡片点击事件
    ccm.handleCardClick = function (item) {
        if (item.label === '累计新客户数') {
            ccm.resetCustomerStatus();
            window.location.hash = '#customerList';
            ccm.salesChannelId_c = ccm.salesChannelId;
            ccm.startDate_c = ccm.startDate;
            ccm.endDate_c = ccm.endDate;
            loadCustomers(ccm.salesChannelId_c, ccm.formatDate(ccm.startDate_c), ccm.formatDate(ccm.endDate_c));
            var tab = new bootstrap.Tab(document.querySelector('a[href="#customerList"]'));
            tab.show();
        } else if (item.label === '累计成交客户数') {
            ccm.resetCustomerStatus();
            window.location.hash = '#customerList';
            ccm.salesChannelId_c = ccm.salesChannelId;
            ccm.customerStatus_c = '1';
            ccm.startDate_c = ccm.startDate;
            ccm.endDate_c = ccm.endDate;
            loadCustomers(ccm.salesChannelId_c, ccm.formatDate(ccm.startDate_c), ccm.formatDate(ccm.endDate_c), ccm.customerStatus_c);
            var tab = new bootstrap.Tab(document.querySelector('a[href="#customerList"]'));
            tab.show();
        }
    };

    // 在Controller中新增分类方法
    ccm.getWorkloadItems = function () {
        return (ccm.getSummaryItems() || []).filter(item => [
            '姓名',
            '累计中介拜访数',
            '累计群活动次数',
            '累计新中介数',
            '累计跟进客户数',
            '小红书',
            '抖音',
            '视频号',
            '大众点评'
        ].includes(item.label));
    };

    ccm.getResultItems = function () {
        return (ccm.getSummaryItems() || []).filter(item => [
            '累计成交客户数',
            '累计成交工位数',
            '累计新客户数',
            '累计询盘数'
        ].includes(item.label));
    };

    // 查询报告（历史报告页使用）
    ccm.searchReports = function () {
        const startDateStr = ccm.formatDate(new Date(ccm.query.startDate));
        const endDateStr = ccm.formatDate(new Date(ccm.query.endDate));
        const url = '/api/proxy';
        const params = {
            endpoint: 'report',
            sales_channel_id: ccm.query.sales_channel_id,
            start_date: startDateStr,
            end_date: endDateStr,
            page: 1,
            page_size: 4
        };

        $http.get(url, { params })
            .then(function (response) {
                ccm.reports = response.data.data;
                ccm.totalItems = response.data.total;
                ccm.totalPages = Math.ceil(ccm.totalItems / ccm.itemsPerPage);
                ccm.updatePageRange();
            })
            .catch(function (err) {
                console.error('加载报告列表失败:', err);
            });
    };

    // 根据一条报告数据生成文字报告（模板根据报告数据替换相应字段）
    ccm.generateTextReportFor = function (report) {
        var text =
            "一、渠道开拓展：" + report.agency_visits + "次\n" +
            "1. 线下拜访：" + report.agency_visits + "次，详情：" + (report.describe_of_visits || "-") + "\n" +
            "2. 线上发布：" + report.XHS + "条小红书，" + report.DY + "条抖音，" + report.DZDP + "条大众点评，" + report.SPH + "条视频号\n" +
            "3. 群活动及管理：" + report.groups_activities + "场，详情：" + (report.describe_of_groups_activities || "-") + "\n" +
            "4. 添加新中介（加好友）：" + report.new_agencies + "个，累计" + report.total_agency_of_have + "人\n" +
            "\n二、成果汇报：\n" +
            "1. 询盘：" + report.inquiries + "次\n" +
            "2. 新收客：" + report.new_customers + "台\n" +
            "3. 带看客：-\n" +
            "4. 成交客：" + report.done_customers + "台\n" +
            "5. 客户跟进问题反馈：" + (report.question_for_feedback || "-") + "\n" +
            "6. 在跟进客户：" + report.customers_under_following + "台\n" +
            "7. 成交工位数：" + report.done_workstations + "个";
        return text;
    };

    ccm.toggleReportText = function (report) {
        if (!report.showTextReport) {
            console.log("生成报告，报告数据：", report);
            report.textReport = ccm.generateTextReportFor(report);
            report.showTextReport = true;
        } else {
            report.showTextReport = false;
        }
    };

    ccm.copy_report = function (report) {
        if (!report) {
            console.error("Report is undefined!");
            return;
        }
        copyToWechat(ccm.generateTextReportFor(report));
    };

    ccm.currentPage_c = 1;
    ccm.itemsPerPage_c = 4;
    ccm.customers = [];
    ccm.totalItems_c = 0;
    ccm.totalPages_c = 1;
    ccm.pageRange_c = [];

    function loadCustomers(sales_channel_id, start_date, end_date, customer_status) {
        const params = {
            page: ccm.currentPage_c,
            page_size: ccm.itemsPerPage_c,
            sales_channel_id: sales_channel_id,
            start_date: start_date,
            end_date: end_date,
            customer_status: customer_status
        };

        $http.get(`${host}/customer`, { params })
            .then(response => {
                ccm.customers = response.data.data;
                ccm.totalItems_c = response.data.total;
                ccm.totalPages_c = Math.ceil(ccm.totalItems_c / ccm.itemsPerPage_c);
                ccm.updatePageRange_c();
            })
            .catch(err => {
                console.error('加载报告列表失败:', err);
            });
    }

    // 客户分页逻辑
    ccm.updatePageRange_c = function () {
        const rangeSize = 5;
        let start = Math.max(1, ccm.currentPage_c - Math.floor(rangeSize / 2));
        let end = Math.min(ccm.totalPages_c, start + rangeSize - 1);
        start = Math.max(1, end - rangeSize + 1);
        const newPageRange = [];
        for (let i = start; i <= end; i++) newPageRange.push(i);
        if (angular.equals(ccm.pageRange_c, newPageRange)) return;
        ccm.pageRange_c = newPageRange;
    };

    // 查询客户信息列表
    ccm.fetchClients = function () {
        const startDateStr = ccm.formatDate(new Date(ccm.startDate_c));
        const endDateStr = ccm.formatDate(new Date(ccm.endDate_c));
        const url = '/api/proxy';
        const params = {
            endpoint: 'customer',
            sales_channel_id: ccm.salesChannelId_c,
            customer_status: ccm.customerStatus_c,
            start_date: startDateStr,
            end_date: endDateStr,
            page: 1,
            page_size: 4
        };

        console.log('Fetch Clients Params:', params);
        $http.get(url, { params })
            .then(function (response) {
                ccm.customers = response.data.data;
                ccm.totalItems_c = response.data.total;
                ccm.totalPages_c = Math.ceil(ccm.totalItems_c / ccm.itemsPerPage_c);
                ccm.updatePageRange_c();
            })
            .catch(function (err) {
                console.error('加载客户列表失败:', err);
            });
    };

    ccm.resetCustomerStatus = function () {
        // 如果选择了 "请选择状态"，设置 customerStatus_c 为 undefined
        if (ccm.customerStatus_c === "") {
            ccm.customerStatus_c = undefined;
        }
    };

    ccm.gotoPage_c = function (n) {
        console.log(ccm.customerStatus_c);
        console.log(n)
        if (n !== ccm.currentPage_c && n > 0 && n <= ccm.totalPages_c) {
            ccm.currentPage_c = n;
            loadCustomers(ccm.salesChannelId_c, ccm.formatDate(new Date(ccm.startDate_c)), ccm.formatDate(new Date(ccm.endDate_c)), ccm.customerStatus_c);
        }
    };

    // 处理上一页
    ccm.prevPage_c = function () {
        ccm.gotoPage_c(ccm.currentPage_c - 1);
    };

    // 处理下一页
    ccm.nextPage_c = function () {
        ccm.gotoPage_c(ccm.currentPage_c + 1);
    };

    //打开客户详情模态框
    ccm.viewCustomerDetails = function (customer) {
        ccm.selectedCustomer = angular.copy(customer);
        var customerModal = new bootstrap.Modal(document.getElementById('customerDetailsModal'));
        customerModal.show();
    };

    //打开新增记录模态框并加载跟进记录
    ccm.addFollowingInfo = function (customer) {
        ccm.selectedCustomer = angular.copy(customer);
        ccm.followUpRecords = [];
        var addFollowingInfoModal = new bootstrap.Modal(document.getElementById('addFollowingInfoModal'));
        addFollowingInfoModal.show();
        console.log(ccm.selectedCustomer);
        $http.get(`/get-followup-records?customer_id=${ccm.selectedCustomer.id}`)
            .then(function (response) {
                ccm.followUpRecords = response.data;
                console.log(ccm.followUpRecords);
            })
            .catch(function (error) {
                console.log('加载跟进记录失败: ' + (error.data.message || error.statusText));
            });
        $http.get(`/get-deal-report?customer_info_id=${ccm.selectedCustomer.id}&sales_channel_id=${ccm.selectedCustomer.sales_channel_id}`)
            .then(function (response) {
                console.log(response.data);
                ccm.selectedCustomer.deal_report = response.data
            })
            .catch(function (error) {
                console.log('加载成交报告失败: ' + (error.data.message || error.statusText));
            });
    };

    //更新客户状态
    ccm.changeCustomerStatus = function (status) {
        console.log(ccm.selectedCustomer);
        var customerId = ccm.selectedCustomer.id;
        $http.patch(`${host}/update-customer-status`, {
            customerId: customerId,
            customerStatus: status
        }).then(function (response) {
            ccm.selectedCustomer.customer_status = status;
            loadCustomers(ccm.salesChannelId_c, ccm.formatDate(new Date(ccm.startDate_c)), ccm.formatDate(new Date(ccm.endDate_c)), ccm.customerStatus_c);
        }).catch(function (error) {
            alert('状态更新失败: ' + error.data.error);
        });
    };

    ccm.saveForm = function () {
        if (ccm.selectedCustomer.customer_status === 1 && !ccm.selectedCustomer.deal_report_id) {
            // 如果客户已成交且没有成交报告，调用新增成交报告接口
            ccm.saveDealReport();
        } else if (ccm.selectedCustomer.customer_status === 0) {
            ccm.saveFollowUp();
        }
    };

    function adjustDateToChinaStandardTime(date) {
        // 将日期转换为中国标准时间
        var localDate = new Date(date);
        localDate.setHours(localDate.getHours() + 8);  // 
        return localDate.toISOString().slice(0, 19).replace('T', ' ');
    }

    // 新增成交报告
    ccm.saveDealReport = function () {
        var localDate = new Date();
        // 将时间调整为中国标准时间（UTC+8）
        localDate.setHours(localDate.getHours() + 8);

        var dealReportData = {
            deal_project: ccm.dealReport.deal_project,
            deal_unit: ccm.dealReport.deal_unit,
            deal_workstations: ccm.dealReport.deal_workstations,
            sign_date: adjustDateToChinaStandardTime(ccm.dealReport.sign_date),
            sign_company: ccm.dealReport.sign_company,
            client_source: ccm.dealReport.client_source,
            client_contact: ccm.dealReport.client_contact,
            client_contact_position: ccm.dealReport.client_contact_position,
            client_contact_phone: ccm.dealReport.client_contact_phone,
            sales_channel_id: ccm.selectedCustomer.sales_channel_id,
            delivery_date: adjustDateToChinaStandardTime(ccm.dealReport.delivery_date),
            contract_duration: ccm.dealReport.contract_duration,
            deposit: ccm.dealReport.deposit,
            delivery_standard: ccm.dealReport.delivery_standard,
            payment_method: ccm.dealReport.payment_method,
            discount_conditions: ccm.dealReport.discount_conditions,
            customer_info_id: ccm.selectedCustomer.id,
            signed_amount: ccm.dealReport.signed_amount,
            remarks: ccm.dealReport.remarks
        };

        // 调用新增成交报告接口
        $http.post('/add-deal-report', dealReportData)
            .then(function (response) {
                alert('成交报告已添加');
                ccm.dealReport = {};
                loadCustomers(ccm.salesChannelId_c, ccm.formatDate(new Date(ccm.startDate_c)), ccm.formatDate(new Date(ccm.endDate_c)), ccm.customerStatus_c);
            })
            .catch(function (error) {
                alert('添加成交报告失败: ' + error.data.message);
            });
    };

    // 新增跟进记录
    ccm.saveFollowUp = function () {
        var localDate = new Date();
        // 将时间调整为中国标准时间（UTC+8）
        localDate.setHours(localDate.getHours() + 8);
        var followUpData = {
            customer_id: ccm.selectedCustomer.id,
            follow_up_date: localDate.toISOString().slice(0, 19).replace('T', ' '),
            follow_up_content: ccm.followUp.details,
            sales_channel_id: ccm.user.id
        };

        // 调用新增跟进记录接口
        $http.post('/add-customer-followup', followUpData)
            .then(function (response) {
                alert('跟进记录已成功添加');
                ccm.followUp.details = '';
                loadCustomers(ccm.salesChannelId_c, ccm.formatDate(new Date(ccm.startDate_c)), ccm.formatDate(new Date(ccm.endDate_c)), ccm.customerStatus_c);
            })
            .catch(function (error) {
                alert('添加跟进记录失败: ' + error.data.message);
            });
    };

    // 切换显示生成的客户报告
    ccm.toggleCustomerReportText = function (customer) {
        customer.showTextReport = !customer.showTextReport;
        if (customer.showTextReport && !customer.textReport) {
            customer.textReport = generateCustomerTextReport(customer);
        }
    };

    // 生成客户文字报告函数，按照指定格式生成报告
    function generateCustomerTextReport(customer) {
        return "一、客户情况 \n" +
            "1，客户名称：" + (customer.customer_name || '') + "\n" +
            "2，项目：" + (customer.project_name || '') + "\n" +
            "3，客户来源：" + (customer.customer_source || '') + "\n" +
            "4，公司情况：" + (customer.company_info || '') + "\n" +
            "5，使用原因：" + (customer.move_status || '') + "\n" +
            "6，空间功能：" + (customer.space_feature || '') + "\n" +
            "7，家具需求：" + (customer.furniture_requirement || '') + "\n" +
            "8，特殊需求：" + (customer.special_requirement || '') + "\n" +
            "9，预算需求：" + (customer.budget || '') + "\n" +
            "10，选址进度：" + (customer.site_selection_progress || '') + "\n" +
            "11，对比盘情况：" + (customer.comparison_info || '') + "\n" +
            "12，对会议室配套及服务配套的评估：" + (customer.meeting_room_assessment || '') + "\n\n" +
            "二、跟进情况：\n" + (customer.on_site_feedback || '') + "\n\n" +
            "三、下一步安排：\n" +
            "1，执行时间：" + (customer.next_action_time ? customer.next_action_time.split('T')[0] : '') + "\n" +
            "2，执行内容：" + (customer.next_action_content || '');
    }

    function copyToWechat(text) {
        if (!navigator.clipboard) {
            console.error("Clipboard API is not supported in this browser.");
            alert('复制成功！');
            fallbackCopyTextToClipboard(text);  // 使用备用方案
            return;
        }

        navigator.clipboard.writeText(text).then(function () {
            console.log("Text successfully copied to clipboard!");
            alert('复制成功！');
        }).catch(function (error) {
            console.error("Error copying text: ", error);
            fallbackCopyTextToClipboard(text);  // 使用备用方案
        });
    }

    // 备用方案：使用 document.execCommand
    function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);

        // 选中文本并执行复制命令
        textArea.select();
        textArea.setSelectionRange(0, 99999);  // 兼容移动设备

        try {
            const successful = document.execCommand('copy');
            if (successful) {
                console.log("Text successfully copied using fallback method.");
            } else {
                console.error("Failed to copy text using fallback method.");
            }
        } catch (err) {
            console.error("Error copying text with fallback method: ", err);
        }

        // 清理
        document.body.removeChild(textArea);
    }

    ccm.copy_client_report = function (customer) {
        if (!customer) {
            console.error("Customer is undefined!");
            return;
        }
        copyToWechat(generateCustomerTextReport(customer));
    };

    ccm.newCustomer = {
        customer_name: '',
        project_name: '',
        visit_unit: '',
        customer_source: '',
        company_info: '',
        move_status: '',
        space_feature: '',
        furniture_requirement: '',
        special_requirement: '',
        budget: '',
        site_selection_progress: '',
        comparison_info: '',
        meeting_room_assessment: '',
        visit_details: '',
        evaluator: '',
        on_site_feedback: '',
        next_action_time: '',
        next_action_content: '',
        sales_channel_id: Number(ccm.user.id)
    };

    // 提交新客户档案
    ccm.submitNewCustomer = function () {
        // 校验必填项
        if (!ccm.newCustomer.customer_name || !ccm.newCustomer.project_name || !ccm.newCustomer.visit_unit || !ccm.newCustomer.customer_source || !ccm.newCustomer.next_action_time || !ccm.newCustomer.next_action_content || !ccm.newCustomer.sales_channel_id) {
            alert('请填写所有必填项');
            return;
        }

        // 发送 POST 请求
        $http.post(`${host}/customer`, ccm.newCustomer)
            .then(response => {
                alert('客户信息新增成功！');
                // 清空表单
                ccm.newCustomer = {
                    customer_name: '',
                    project_name: '',
                    visit_unit: '',
                    customer_source: '',
                    company_info: '',
                    move_status: '',
                    space_feature: '',
                    furniture_requirement: '',
                    special_requirement: '',
                    budget: '',
                    site_selection_progress: '',
                    comparison_info: '',
                    meeting_room_assessment: '',
                    visit_details: '',
                    evaluator: '',
                    on_site_feedback: '',
                    next_action_time: '',
                    next_action_content: '',
                    sales_channel_id: Number(ccm.user.id)
                };
            })
            .catch(error => {
                alert('新增客户失败: ' + error.message);
                console.error('新增客户失败:', error);
            });
    };

    ccm.logout = function () {
        const logoutButton = document.getElementById('logoutBtn');
        const logoutText = document.getElementById('logoutText');
        logoutText.textContent = '退出登录中...';
        localStorage.clear();
        $window.location.href = 'share_login.html';
    };

    ccm.reportGenrator = function () {
        ccm.loading = true;
        const context = {
            question: `            
                    ### 数据表生成规则（请严格遵守）
                    1. **表头与列对齐规则**
                    - 表格必须包含表头、分隔线、数据行三部分
                    - 分隔线中的管道符数量必须与表头完全一致
                    - 每行的列数必须严格等于表头列数

                    2. **表格1：账号数据表**
                    - 字段顺序：账号名称 | 平台 | 环球Ninespace发布量 | 珠控NT发布量 | 潭村NT发布量 | 浏览量 | 总询盘量 | 到访次数 | 成交工位数 | 成交客户数 | 月份
                    - 汇总行处理：
                        * 平台/月份字段用"–"占位
                        * 数值字段进行累加汇总
                        * 示例格式：
                        | 汇总 | – | 12 | 8 | 5 | 5023 | 12 | 8 | 5 | 3 | – |

                    3. **表格2：转化率表**
                    - 字段顺序：账号名称 | 成交量/询盘量 | 成交量/到访量 | 总成交/总询盘 | 总成交/总到访
                    - 单账号行：
                        * 前两列展示当前账号转化率
                        * 后两列用"–"占位
                    - 汇总行：
                        * 前两列用"–"占位
                        * 后两列计算全局转化率
                    - 转化率格式：数据类型要求是百分比并保留两位小数，如 12.34%

                    4. **格式校验要求**
                    - 表头与数据行必须用"|"严格分隔
                    - 每列最小宽度为5个字符
                    - 数值右对齐，文本居中对齐
                    - 使用以下模板确保格式正确：
                        \`\`\`
                        | Header1   | Header2   |
                        |-----------|-----------|
                        | Content1  | Content2  |
                        \`\`\`
                    5. **针对每个账户运营给出文字建议（运营建议）**
                    6. **针对整体运营给出总结和文字建议（总结）给出专业运营的建议**

                    请根据上述规则生成严格符合格式要求的Markdown运营报告
                    `,
            data: {
                summary: ccm.socialMediaTotal || {},
                details: ccm.socialMediaReports || []
            }
        };

        $http.post(`${host}/ask`, context).then(function (response) {
            console.log(context);
            const markdown = response.data.answer || '暂无内容';
            const renderedHtml = marked.parse(markdown);
            document.getElementById("markdownContent").innerHTML = renderedHtml;
            // 顯示模態框
            const modalElement = document.getElementById('reportModal');
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        }).catch(function (error) {
            console.error('AI报告生成失败:', error);
            alert('AI报告生成失败，请稍后重试。');
        }).finally(function () {
            ccm.loading = false; // 結束 loading（成功或失敗都會執行）
        });
    };

    ccm.summaryReport_txt = function () {
        const data = ccm.reportData && ccm.reportData.success && ccm.reportData.summaryData && ccm.reportData.summaryData[0];
        if (!data) {
            ccm.errorMessage = "查询结果为空，无法生成文字报告。";
            return;
        }

        const start = ccm.formatDate(ccm.startDate) || "-";
        const end = ccm.formatDate(ccm.endDate) || "-";

        let report = `汇总日期（${start} - ${end}）\n`;
        report += `一、渠道开拓展：\n`;
        report += `1.线下拜访：${data.total_agency_visits || 0}次（详情:xxxxx）\n`;

        const platformList = [];
        if (+data.total_XHS > 0) platformList.push(`${data.total_XHS}条小红书`);
        if (+data.total_DZDP > 0) platformList.push(`${data.total_DZDP}条大众点评`);
        if (+data.total_DY > 0) platformList.push(`${data.total_DY}条抖音`);
        if (+data.total_SPH > 0) platformList.push(`${data.total_SPH}条视频号`);
        const onlinePosts = platformList.length > 0 ? platformList.join("，") : "0条";

        report += `2.线上发布：${onlinePosts}\n`;
        report += `3.群活动（次数）及管理：${data.total_groups_activities || 0}次（详情:xxxxx）\n`;
        report += `4.添加新渠道（加好友）：${data.total_new_agencies || 0} 个，累计(自己填写)个\n`;

        report += `二、成果汇报：\n`;
        report += `1. 询盘：${data.total_inquiries || 0}\n`;
        report += `2. 新收客：${data.total_new_customers || 0}\n`;
        report += `3. 带看客：（自己填写）\n`;
        report += `4. 成交客：${data.total_done_customers || 0}\n`;
        report += `5. 客戶跟进問题反馈: （自己填写）\n`;
        report += `6. 在跟进客户数量：（动态变化的数据累计无意义，请自己填写）\n`;
        report += `7. 成交工位数量：${data.total_done_workstations || 0}个`;

        ccm.generatedReportText = report;
    };

    // 过滤器变量
    ccm.filters = { report: { month: '', platform: '', project_code: '' } };
    ccm.platforms = ['小红书', '抖音', '微博'];

    // 数据与配置
    ccm.fields = [];
    ccm.fieldMap = {};
    ccm.reportList = [];
    ccm.summaryData = null;

    // 新增记录 & 字段
    ccm.newRecord = { fields: {} };
    ccm.newField = { field_key: '', label: '', unit: '', sort_order: 0 };

    // 获取字段配置
    ccm.fetchFields = function () {
        $http.get('/api/social_media_reports/fields').then(res => {
            if (res.data.success) {
                ccm.fields = res.data.data;
                ccm.fieldMap = {};
                ccm.fields.forEach(f => ccm.fieldMap[f.field_key] = f);
            }
        });
    };

    // 创建新字段
    ccm.createField = function () {
        const payload = angular.copy(ccm.newField);
        $http.post('/api/social_media_reports/fields', payload).then(res => {
            if (res.data.success) {
                alert('字段添加成功');
                ccm.newField = { field_key: '', label: '', unit: '', sort_order: 0 };
                ccm.fetchFields();
            } else {
                alert(res.data.message || '添加失败');
            }
        });
    };

    // 软删除字段
    ccm.softDeleteField = function (key) {
        if (!confirm('确认删除字段 "' + key + '" 吗？此操作将不可恢复。')) return;
        $http.delete('/api/social_media_reports/fields/' + key).then(res => {
            if (res.data.success) {
                alert('字段已删除');
                ccm.fetchFields();
            } else {
                alert(res.data.message || '删除失败');
            }
        }).catch(() => alert('请求失败'));
    };

    ccm.pagination = {
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 0
    };

    ccm.loadSocialReports = function () {
        const params = angular.copy(ccm.filters.report);
        params.page = ccm.pagination.page;
        params.pageSize = ccm.pagination.pageSize;

        // 加载列表
        $http.get('/api/social_media_reports', { params }).then(res => {
            if (res.data.success) {
                ccm.reportList = res.data.data;
                ccm.pagination = res.data.pagination || ccm.pagination;
            } else {
                ccm.reportList = [];
            }
        });

        // 汇总接口不需要分页参数
        const summaryParams = angular.copy(ccm.filters.report);
        $http.get('/api/social_media_reports/summary', { params: summaryParams }).then(res => {
            if (res.data.success) ccm.summaryData = res.data.data;
        });
    };

    ccm.changePage = function (newPage) {
        if (newPage < 1 || newPage > ccm.pagination.totalPages) return;
        ccm.pagination.page = newPage;
        ccm.loadSocialReports();
    };

    // 提交新记录
    ccm.submitRecord = function () {
        const payload = angular.copy(ccm.newRecord);
        $http.post('/api/social_media_reports/submit', payload).then(res => {
            if (res.data.success) {
                alert('提交成功');
                ccm.loadSocialReports();
                ccm.newRecord = { fields: {} };
            } else {
                alert(res.data.message || '提交失败');
            }
        });
    };

    // 初始化
    ccm.fetchFields();
    ccm.loadSocialReports();
}]);
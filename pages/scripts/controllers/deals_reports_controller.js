app.controller('deals_analysis_controller', ['$http', '$window', '$scope', function ($http, $window, $scope) {
    const dm = this;
    const host = 'http://host:3001';
    var user = JSON.parse($window.localStorage.getItem('user'));
    dm.user = user;
    $http.defaults.headers.common['Authorization'] = 'Bearer ' + user.token;
    dm.formatDate = function (date) {
        if (!date) return '';
        // 如果是字符串，转为 Date 对象
        if (!(date instanceof Date)) {
            date = new Date(date);
        }
        if (isNaN(date.getTime())) return ''; // 非法日期防护

        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');

        return `${year}-${month}-${day}`;
    };

    function loadDealChart(line_startDate, end_sign_date) {
        const chart = echarts.init(document.getElementById('lineChart'));
        const params = {
            start_sign_date: line_startDate,
            end_sign_date: end_sign_date
        };

        $http.get(host + '/get-deal-report-list', { params })
            .then(response => {
                const data = response.data.data;
                const grouped = {};

                data.forEach(item => {
                    const date = dm.formatDate(item.sign_date);
                    const amount = parseFloat(item.signed_amount) || 0;
                    grouped[date] = grouped[date] || { amount: 0, count: 0 };
                    grouped[date].amount += amount;
                    grouped[date].count += 1;
                });

                const dates = Object.keys(grouped).sort();
                const amounts = dates.map(date => grouped[date].amount);
                const counts = dates.map(date => grouped[date].count);

                const option = {
                    tooltip: {
                        trigger: 'axis'
                    },
                    legend: {
                        data: ['成交金额', '成交单数']
                    },
                    xAxis: {
                        type: 'category',
                        data: dates
                    },
                    yAxis: [
                        {
                            type: 'value',
                            name: '成交金额',
                            position: 'left',
                            axisLabel: {
                                formatter: '¥{value}'
                            }
                        },
                        {
                            type: 'value',
                            name: '成交单数（单）',
                            position: 'right',
                            axisLabel: {
                                formatter: '{value} 单'
                            }
                        }
                    ],
                    series: [
                        {
                            name: '成交金额',
                            type: 'line',
                            data: amounts,
                            smooth: true,
                            areaStyle: {}
                        },
                        {
                            name: '成交单数',
                            type: 'line',
                            yAxisIndex: 1,
                            data: counts,
                            smooth: true
                        }
                    ],
                    title: {
                        text: '',
                        left: 'center'
                    }
                };

                chart.setOption(option);
                window.addEventListener('resize', () => chart.resize());
            })
            .catch(err => {
                console.error('加载图表数据失败:', err);
            });
    }
    //按项目查询图表
    function loadProjectPieChart(startDate, endDate) {
        const chart = echarts.init(document.getElementById('pieChartProject'));
        const params = {
            start_sign_date: startDate,
            end_sign_date: endDate
        };

        $http.get(host + '/get-deal-report-list', { params })
            .then(response => {
                const data = response.data.data;
                const grouped = {};

                data.forEach(item => {
                    const project = item.deal_project || '未指定项目';
                    const amount = parseFloat(item.signed_amount) || 0;

                    if (!grouped[project]) {
                        grouped[project] = { amount: 0, count: 0 };
                    }

                    grouped[project].amount += amount;
                    grouped[project].count += 1;
                });

                const chartData = Object.entries(grouped).map(([project, value]) => ({
                    name: project,
                    value: value.amount,
                    count: value.count
                }));

                const option = {
                    tooltip: {
                        trigger: 'item',
                        formatter: params => {
                            return `
                                ${params.name}<br/>
                                成交金额：¥${params.value.toFixed(2)}<br/>
                                成交单数：${params.data.count} 单
                            `;
                        }
                    },
                    legend: {
                        orient: 'vertical',
                        left: 'left'
                    },
                    series: [
                        {
                            name: '',
                            type: 'pie',
                            radius: '70%',
                            data: chartData,
                            emphasis: {
                                itemStyle: {
                                    shadowBlur: 10,
                                    shadowOffsetX: 0,
                                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                                }
                            }
                        }
                    ],
                    title: {
                        text: '',
                        left: 'center'
                    }
                };

                chart.setOption(option);
                window.addEventListener('resize', () => chart.resize());
            })
            .catch(err => {
                console.error('加载项目饼图失败:', err);
            });
    }
    //按获客渠道查询图表
    function loadSourceBarChart(startDate, endDate) {
        const chart = echarts.init(document.getElementById('BarChartSource'));
        const params = {
            start_sign_date: startDate,
            end_sign_date: endDate
        };

        $http.get(host + '/get-deal-report-list', { params })
            .then(response => {
                const data = response.data.data;
                const grouped = {};

                data.forEach(item => {
                    const source = item.client_source || '未知来源';
                    const amount = parseFloat(item.signed_amount) || 0;

                    if (!grouped[source]) {
                        grouped[source] = { amount: 0, count: 0 };
                    }

                    grouped[source].amount += amount;
                    grouped[source].count += 1;
                });

                const sources = Object.keys(grouped);
                const amounts = sources.map(source => grouped[source].amount);
                const counts = sources.map(source => grouped[source].count);

                const option = {
                    tooltip: {
                        trigger: 'axis',
                        axisPointer: { type: 'shadow' },
                        formatter: params => {
                            const amount = params.find(p => p.seriesName === '成交金额')?.value || 0;
                            const count = params.find(p => p.seriesName === '成交单数')?.value || 0;
                            return `
                                ${params[0].name}<br/>
                                成交金额：¥${amount.toFixed(2)}<br/>
                                成交单数：${count} 单
                            `;
                        }
                    },
                    legend: {
                        data: ['成交金额', '成交单数']
                    },
                    xAxis: {
                        type: 'category',
                        data: sources
                    },
                    yAxis: [
                        {
                            type: 'value',
                            name: '金额（元）',
                            position: 'left'
                        },
                        {
                            type: 'value',
                            name: '成交单数（单）',
                            position: 'right'
                        }
                    ],
                    series: [
                        {
                            name: '成交金额',
                            type: 'bar',
                            data: amounts,
                            yAxisIndex: 0,
                            itemStyle: { color: '#5470c6' }
                        },
                        {
                            name: '成交单数',
                            type: 'bar',
                            data: counts,
                            yAxisIndex: 1,
                            itemStyle: { color: '#91cc75' }
                        }
                    ],
                    title: {
                        text: '',
                        left: 'center'
                    }
                };

                chart.setOption(option);
                window.addEventListener('resize', () => chart.resize());
            })
            .catch(err => {
                console.error('加载客户来源图表失败:', err);
            });
    }
    //根据人员查询图表
    function loadStaffBarChart(startDate, endDate) {
        const chart = echarts.init(document.getElementById('barChart'));
        const params = {
            start_sign_date: startDate,
            end_sign_date: endDate
        };

        $http.get(host + '/get-deal-report-list', { params })
            .then(response => {
                const data = response.data.data;
                const grouped = {};

                data.forEach(item => {
                    const staff = item.sales_channel_name || '未知人员';
                    const amount = parseFloat(item.signed_amount) || 0;

                    if (!grouped[staff]) {
                        grouped[staff] = { amount: 0, count: 0 };
                    }

                    grouped[staff].amount += amount;
                    grouped[staff].count += 1;
                });

                const staffs = Object.keys(grouped);
                const amounts = staffs.map(name => grouped[name].amount);
                const counts = staffs.map(name => grouped[name].count);

                const option = {
                    tooltip: {
                        trigger: 'axis',
                        axisPointer: { type: 'shadow' },
                        formatter: params => {
                            const amount = params.find(p => p.seriesName === '成交金额')?.value || 0;
                            const count = params.find(p => p.seriesName === '成交单数')?.value || 0;
                            return `
                                ${params[0].name}<br/>
                                成交金额：¥${amount.toFixed(2)}<br/>
                                成交单数：${count} 单
                            `;
                        }
                    },
                    legend: {
                        data: ['成交金额', '成交单数']
                    },
                    xAxis: {
                        type: 'category',
                        data: staffs,
                        axisLabel: {
                            interval: 0,
                            rotate: 30
                        }
                    },
                    yAxis: [
                        {
                            type: 'value',
                            name: '金额（元）',
                            position: 'left'
                        },
                        {
                            type: 'value',
                            name: '成交单数（单）',
                            position: 'right'
                        }
                    ],
                    series: [
                        {
                            name: '成交金额',
                            type: 'bar',
                            data: amounts,
                            yAxisIndex: 0,
                            itemStyle: {
                                color: '#5470C6'
                            }
                        },
                        {
                            name: '成交单数',
                            type: 'bar',
                            data: counts,
                            yAxisIndex: 1,
                            itemStyle: {
                                color: '#91cc75'
                            }
                        }
                    ],
                    title: {
                        text: '',
                        left: 'center'
                    }
                };

                chart.setOption(option);
                window.addEventListener('resize', () => chart.resize());
            })
            .catch(err => {
                console.error('加载按人员柱状图失败:', err);
            });
    }

    loadDealChart('2025-04-01', '2025-04-30');
    loadProjectPieChart('2025-04-01', '2025-04-30');
    loadSourceBarChart('2025-04-01', '2025-04-30');
    loadStaffBarChart('2025-04-01', '2025-04-30');

    dm.updateLoadDealChart = function () {
        const start = dm.formatDate(dm.line_startDate);
        const end = dm.formatDate(dm.line_endDate);
        if (start && end) {
            loadDealChart(start, end);
        }
    };

    dm.updateLoadProjectPieChart = function () {
        const start = dm.formatDate(dm.project_startDate);
        const end = dm.formatDate(dm.project_endDate);
        if (start && end) {
            loadProjectPieChart(start, end);
        }
    };

    dm.updateLoadSourceBarChart = function () {
        const start = dm.formatDate(dm.source_startDate);
        const end = dm.formatDate(dm.source_endDate);
        if (start && end) {
            loadSourceBarChart(start, end);
        }
    };

    dm.updateloadStaffBarChart = function () {
        const start = dm.formatDate(dm.staff_startDate);
        const end = dm.formatDate(dm.staff_endDate);
        if (start && end) {
            loadStaffBarChart(start, end);
        }
    };

    dm.currentPage = 1;   // 初始页码
    dm.limit = 10;        // 每页显示的条数
    dm.pageRange = [];     // 页码范围
    dm.queryDealsReports = function () {
        params = {
            start_sign_date: dm.formatDate(dm.filter.start_dealDate),
            end_sign_date: dm.formatDate(dm.filter.end_dealDate),
            sales_channel_id: dm.filter.sales_channel_id,
            client_source: dm.filter.client_source,
            deal_project: dm.filter.deal_project,
        };

        $http.get(host + '/get-deal-report-list', { params })
            .then(response => {
                console.log(response.data);
                dm.dealReports = response.data.data;
                dm.totalItems = response.data.pagination.total;
                dm.totalPages = response.data.pagination.totalPages
                dm.pageRange = [];
                for (let i = 1; i <= dm.totalPages; i++) {
                    dm.pageRange.push(i);
                }
            })
            .catch(err => {
                console.error('加载报告列表失败:', err);
            });
    }

    dm.loadDealsReports = function () {
        const params = {
            start_sign_date: dm.formatDate(dm.filter.start_dealDate),
            end_sign_date: dm.formatDate(dm.filter.end_dealDate),
            sales_channel_id: dm.filter.sales_channel_id,
            client_source: dm.filter.client_source,
            deal_project: dm.filter.deal_project,
            page: dm.currentPage || 1,  // 使用当前页码
            limit: dm.limit || 10      // 每页显示的条数
        };

        $http.get(host + '/get-deal-report-list', { params })
            .then(response => {
                console.log(response.data);
                dm.dealReports = response.data.data;
                dm.totalItems = response.data.pagination.total;
                dm.totalPages = response.data.pagination.totalPages;

                // 生成页码范围
                dm.pageRange = [];
                for (let i = 1; i <= dm.totalPages; i++) {
                    dm.pageRange.push(i);
                }
            })
            .catch(err => {
                console.error('加载报告列表失败:', err);
            });
    };

    dm.gotoPage = function (page) {
        if (page !== dm.currentPage) {
            dm.currentPage = page;
            dm.loadDealsReports();
        }
    };

    dm.prevPage = function () {
        if (dm.currentPage > 1) {
            dm.currentPage--;
            dm.loadDealsReports();
        }
    };

    dm.nextPage = function () {
        if (dm.currentPage < dm.totalPages) {
            dm.currentPage++;
            dm.loadDealsReports();
        }
    };

    dm.showReportDetail = function (report) {
        dm.selectedReport = report;
        const modal = new bootstrap.Modal(document.getElementById('dealDetailModal'));
        modal.show();
    };

    dm.getTotalWorkstations = function () {
        if (!Array.isArray(dm.dealReports)) return 0;
        return dm.dealReports.reduce(function (total, report) {
            return total + (parseInt(report.deal_workstations) || 0);
        }, 0);
    };

    dm.getTotalAmount = function () {
        if (!Array.isArray(dm.dealReports)) return 0;
        return dm.dealReports.reduce(function (total, report) {
            return total + (parseFloat(report.signed_amount) || 0);
        }, 0);
    };
}])
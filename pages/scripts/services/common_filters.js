app.filter('unitStatusLabel', function () {
  const map = {
    unpartitioned: '待分割',
    vacant: '空置',
    leased: '已出租',
    reserved: '已预定'
  };
  return function (statusCode) {
    return map[statusCode] || statusCode || '—';
  };
});

app.filter('unitStatusColor', function () {
  return function (status) {
    switch (status) {
      case 'vacant':
        return 'success';       // 绿色
      case 'leased':
        return 'secondary';     // 灰色
      case 'reserved':
        return 'warning';       // 黄色
      case 'unpartitioned':
        return 'info';          // 蓝色
      default:
        return 'light';         // 兜底：浅灰
    }
  };
});

app.filter('formatDate', function () {
  return function (input) {
    if (!input) return '';

    if (typeof input !== 'string') return input;

    // 先用空格拆分，取第一个部分作为日期
    var datePart = input.split(' ')[0];

    var match = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return input;

    var yyyy = match[1];
    var mm = match[2].padStart(2, '0');
    var dd = match[3].padStart(2, '0');

    return yyyy + '-' + mm + '-' + dd;
  };
});

app.filter('monthEquivalentToDays', function () {
  return function (monthEquivalent, termStart) {
    if (!monthEquivalent || !termStart) return '';

    if (monthEquivalent >= 1) {
      // 直接显示整数部分，不保留小数
      return Math.floor(monthEquivalent);
    }

    var d = new Date(termStart);
    if (isNaN(d.getTime())) return monthEquivalent;

    // 获取当月天数
    var daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

    var days = Math.round(monthEquivalent * daysInMonth);
    return days + '天';
  };
});


app.filter('paymentCycleText', function () {
  return function (value) {
    const map = {
      'monthly': '月付',
      'quarterly': '季付',
      'yearly': '年付',
      'one_time': '一次性付款'
    };
    return map[value] || value;
  };
});

app.filter('localDate', function () {
  return function (input) {
    if (!input) return '';

    let date;
    if (typeof input === 'string' || typeof input === 'number') {
      date = new Date(input);
    } else if (input instanceof Date) {
      date = input;
    } else {
      return '';
    }

    if (isNaN(date)) return '';

    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);

    return `${year}-${month}-${day}`;
  };
});

app.filter('statusLabel', function () {
  const statusMap = {
    active: '生效中',
    draft: '草稿',
    approve_pending: '审核中',
    terminated: '已终止'
  };

  return function (input) {
    return statusMap[input] || input;
  };
});

// 任务状态过滤器
app.filter('taskStatusLabel', function () {
  return function (input) {
    if (!input) return '';
    switch (input.toUpperCase()) {
      case 'PENDING':
        return '待处理';
      case 'APPROVED':
        return '已通过';
      case 'REJECTED':
        return '已驳回';
      default:
        return input; // 未知状态原样输出
    }
  };
});

app.filter('highlight', function ($sce) {
  return function (text, phrase) {
    if (phrase) {
      const regex = new RegExp('(' + phrase + ')', 'gi');
      text = text.replace(regex, '<mark>$1</mark>');
    }
    return $sce.trustAsHtml(text);
  };
});

app.filter('contractStatusLabel', function () {
  const map = {
    active: '生效中',
    expired: '已到期',
    terminated: '已终止'
    // 按实际状态补充
  };

  return function (status) {
    if (!status) return '-';
    return map[status] || status;
  };
});




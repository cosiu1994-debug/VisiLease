app.directive('flatpickrDate', flatpickrDate);

function flatpickrDate() {
    return {
        restrict: 'E',
        scope: {
            ngModel: '=',           // 绑定的日期
            placeholder: '@?',      // 占位符
            options: '<?'           // flatpickr 配置
        },
        template:
            '<input type="text" class="form-control form-control-sm" ' +
            'placeholder="{{placeholder || \'请选择日期\'}}">',

        link: function (scope, element) {
            var input = element.find('input')[0];

            // 默认选项
            var defaultOpts = {
                dateFormat: 'Y-m-d',
                locale: flatpickr.l10ns.zh
            };

            var opts = angular.extend({}, defaultOpts, scope.options || {});

            // 初始化 flatpickr
            var picker = flatpickr(input, angular.extend({}, opts, {
                onChange: function (selectedDates, dateStr) {
                    scope.ngModel = dateStr;
                    scope.$applyAsync();
                }
            }));

            // 监听外部 model 变化
            scope.$watch('ngModel', function (v) {
                if (v && v !== picker.input.value) {
                    picker.setDate(v, false);
                }
            });

            scope.$on('$destroy', function () {
                picker.destroy();
            });
        }
    };
}

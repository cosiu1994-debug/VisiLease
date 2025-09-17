app.directive('flatpickrRange', flatpickrRange);
flatpickrRange.$inject = [];

function flatpickrRange() {
    return {
        restrict: 'E',
        scope: {
            startModel: '=',
            endModel: '=',
            placeholderStart: '@?',
            placeholderEnd: '@?',
            options: '<?'
        },
        template:
            '<div class="input-group input-group-sm">' +
            '<input type="text" class="form-control" ' +
            'placeholder="{{placeholderStart || \'开始日期\'}}" />' +
            '<span class="input-group-text">至</span>' +
            '<input type="text" class="form-control" ' +
            'placeholder="{{placeholderEnd || \'结束日期\'}}" />' +
            '</div>',
        link: function (scope, element) {
            var inputs = element.find('input');
            var startInput = inputs[0];
            var endInput = inputs[1];

            var defaultOptions = {
                dateFormat: 'Y-m-d',
                locale: flatpickr.l10ns.zh
            };
            var opts = angular.extend({}, defaultOptions, scope.options || {});

            // 初始化开始日期
            var startPicker = flatpickr(startInput, angular.extend({}, opts, {
                onChange: function (sel, str) {
                    scope.startModel = str;
                    if (endPicker) {
                        endPicker.set('minDate', str || null);
                    }
                    scope.$applyAsync();
                }
            }));

            // 初始化结束日期
            var endPicker = flatpickr(endInput, angular.extend({}, opts, {
                onChange: function (sel, str) {
                    scope.endModel = str;
                    if (startPicker) {
                        startPicker.set('maxDate', str || null);
                    }
                    scope.$applyAsync();
                }
            }));

            // 监听外部 model 改变
            scope.$watch('startModel', function (v) {
                if (v && v !== startPicker.input.value) {
                    startPicker.setDate(v, false);
                    endPicker.set('minDate', v);
                }
            });
            scope.$watch('endModel', function (v) {
                if (v && v !== endPicker.input.value) {
                    endPicker.setDate(v, false);
                    startPicker.set('maxDate', v);
                }
            });

            scope.$on('$destroy', function () {
                startPicker.destroy();
                endPicker.destroy();
            });
        }
    };
}

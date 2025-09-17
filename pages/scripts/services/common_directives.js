app.directive('monthInput', function () {
    return {
        require: 'ngModel',
        link: function (scope, element, attrs, ngModelCtrl) {
            // 用户输入 -> 模型值
            ngModelCtrl.$parsers.push(function (viewValue) {
                if (!viewValue) return viewValue;

                // 处理 Date 对象或字符串
                if (viewValue instanceof Date) {
                    const year = viewValue.getFullYear();
                    const month = String(viewValue.getMonth() + 1).padStart(2, '0');
                    return `${year}-${month}`;
                }

                if (typeof viewValue === 'string') {
                    return viewValue.substring(0, 7);
                }

                return viewValue; // fallback
            });

            // 模型值 -> 视图值
            ngModelCtrl.$formatters.push(function (modelValue) {
                if (!modelValue) return modelValue;

                if (typeof modelValue === 'string') {
                    return modelValue.length > 7 ? modelValue.substring(0, 7) : modelValue;
                }

                return modelValue; // fallback
            });
        }
    };
});

app.directive('fileUpload', function ($http, $timeout) {
    return {
        restrict: 'E',
        scope: {
            fileName: '=',        // 显示文件名
            uploadedFiles: '='    // 文件对象数组
        },
        template: `
            <div class="card shadow-sm border-0 mb-4">
                <div class="card-body">
                    <h5 class="mb-3 text-primary fw-semibold">上传合同文件</h5>
                    <div class="input-group">
                        <input type="text" class="form-control" placeholder="请选择文件..." ng-model="fileName" readonly>
                        <button type="button" class="btn btn-outline-secondary" ng-click="triggerFile()" ng-disabled="uploading">
                            <i class="fas fa-upload me-1"></i>选择文件
                        </button>
                    </div>
                    <small class="text-muted d-block mt-2">支持 PDF、DOC、DOCX 文件，可多选</small>
                    <input type="file" style="display:none" multiple>
                    <div class="progress mt-2" ng-show="uploading">
                        <div class="progress-bar" role="progressbar" style="width: {{uploadProgress}}%" 
                            aria-valuenow="{{uploadProgress}}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <div class="mt-3" ng-show="uploadedFiles.length > 0">
                        <p class="text-success fw-semibold">已上传文件：</p>
                        <ul class="list-group">
                            <li class="list-group-item d-flex justify-content-between align-items-center"
                                ng-repeat="f in uploadedFiles track by $index">
                                <span>{{ f.name }}</span>
                                <div>
                                    <button type="button" class="btn btn-sm btn-outline-primary me-2" ng-click="previewFile(f)" ng-disabled="uploading">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-warning me-2" ng-click="replaceFile(f, $index)" ng-disabled="uploading">
                                        <i class="fas fa-sync-alt"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-danger" ng-click="deleteFile(f, $index)" ng-disabled="uploading">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        `,
        link: function (scope, element) {
            const fileInput = element[0].querySelector('input[type=file]');
            scope.uploading = false;
            scope.uploadProgress = 0;
            if (!scope.uploadedFiles) scope.uploadedFiles = [];

            function decodeFileName(name) {
                try { return decodeURIComponent(escape(name)); } catch { return name; }
            }

            let fileInputMode = 'add'; // 'add' | 'replace'
            let replaceIndex = null;

            // 初始化已有文件
            scope.initFiles = function (files) {
                scope.uploadedFiles = files.map(f => ({
                    id: f.id,
                    name: decodeFileName(f.name),
                    url: f.url
                }));
                scope.fileName = scope.uploadedFiles.map(f => f.name).join(', ');
            };

            // 统一 fileInput onchange
            fileInput.addEventListener('change', function (event) {
                if (event.target.files && event.target.files.length > 0) {
                    if (fileInputMode === 'add') {
                        Array.from(event.target.files).forEach(file => scope.$apply(() => scope.uploadFile(file)));
                    } else if (fileInputMode === 'replace' && replaceIndex !== null) {
                        const newFile = event.target.files[0];
                        const oldFile = scope.uploadedFiles[replaceIndex];
                        scope.$apply(() => {
                            scope.uploadFile(newFile, replaceIndex, () => {
                                // 替换完成后删除旧文件
                                $http.post('/file/delete', { id: oldFile.id }).catch(err => console.warn('删除旧文件失败', err));
                            });
                        });
                        replaceIndex = null;
                    }
                }
                event.target.value = null;
                fileInputMode = 'add';
            });

            // 触发选择文件
            scope.triggerFile = function () {
                fileInputMode = 'add';
                fileInput.click();
            };

            // 上传文件
            scope.uploadFile = function (file, indexToReplace = null, callback = null) {
                const formData = new FormData();
                formData.append('files', file);

                scope.uploading = true;
                scope.uploadProgress = 0;

                $http.post('/upload', formData, {
                    headers: { 'Content-Type': undefined },
                    uploadEventHandlers: {
                        progress: function (event) {
                            if (event.lengthComputable) {
                                const percent = (event.loaded / event.total) * 100;
                                $timeout(() => { scope.uploadProgress = percent; }, 0);
                            }
                        }
                    }
                }).then(resp => {
                    if (resp.data.success && resp.data.files.length > 0) {
                        resp.data.files.forEach(fileObj => {
                            fileObj.name = decodeFileName(fileObj.name);
                            fileObj.url = `/api/files/download/${fileObj.id}`;

                            if (indexToReplace !== null) {
                                scope.uploadedFiles[indexToReplace] = fileObj;
                            } else {
                                scope.uploadedFiles.push(fileObj);
                            }

                            if (callback) callback();
                        });
                        scope.fileName = scope.uploadedFiles.map(f => f.name).join(', ');
                    } else {
                        alert('文件上传失败：' + resp.data.message);
                    }
                    scope.uploading = false;
                }).catch(err => {
                    alert('上传失败：' + (err.data?.message || err.statusText || err.message));
                    scope.uploading = false;
                });
            };

            // 文件预览
            scope.previewFile = function (file) {
                $http({
                    method: 'GET',
                    url: `/api/files/download/${file.id}`,
                    responseType: 'blob',
                    headers: { Authorization: 'Bearer ' + localStorage.getItem('token') }
                }).then(resp => {
                    const blob = new Blob([resp.data], { type: resp.data.type });
                    if (file.name.endsWith('.pdf')) {
                        const url = window.URL.createObjectURL(blob);
                        window.open(url, '_blank');
                    } else {
                        const link = document.createElement('a');
                        link.href = window.URL.createObjectURL(blob);
                        link.download = file.name;
                        link.click();
                    }
                }).catch(err => {
                    alert('文件预览失败：' + (err.data?.message || err.statusText || err.message));
                });
            };

            // 删除文件
            scope.deleteFile = function (file, index) {
                if (!confirm('确定要删除该文件吗？')) return;
                $http.post('/file/delete', { id: file.id }).then(() => {
                    scope.uploadedFiles.splice(index, 1);
                    scope.fileName = scope.uploadedFiles.map(f => f.name).join(', ');
                }).catch(err => {
                    alert('删除失败：' + (err.data?.message || err.statusText || err.message));
                });
            };

            // 替换文件
            scope.replaceFile = function (file, index) {
                if (!confirm('确定要替换该文件吗？')) return;
                fileInputMode = 'replace';
                replaceIndex = index;
                fileInput.click();
            };
        }
    };
});

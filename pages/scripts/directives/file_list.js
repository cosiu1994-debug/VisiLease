app.directive('fileList', function ($http, $timeout) {
  return {
    restrict: 'E',
    scope: {
      files: '=' // 外部传入的文件数组 [{id, name, url?}]
    },
    template: `
        <div class="card mb-4 shadow-sm border-0">
  <div class="card-header">合同原件</div>
  <div class="card-body p-0">
    <div class="table-responsive">
      <table class="table table-hover mb-0 align-middle">
        <thead>
          <tr>
            <th style="width: 60px;">#</th>
            <th>文件名</th>
            <th style="width: 150px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <!-- 文件列表 -->
          <tr ng-repeat="file in files track by file.id">
            <td>{{$index + 1}}</td>
            <td>
              <i class="{{getIcon(file.name)}} me-2"></i>
              {{file.name}}
            </td>
            <td>
              <button class="btn btn-sm btn-outline-primary"
                      ng-click="downloadFile(file)">
                <i class="bi bi-download me-1"></i>下载
              </button>
            </td>
          </tr>

          <!-- 空数据提示 -->
          <tr ng-if="!files || files.length === 0">
            <td colspan="3" class="text-center text-muted py-4">
              暂无文件
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

      `,
    link: function (scope) {
      scope.getIcon = function (fileName) {
        if (!fileName) return 'fas fa-file';
        const ext = fileName.split('.').pop().toLowerCase();
        switch (ext) {
          case 'pdf': return 'fas fa-file-pdf text-danger';
          case 'doc':
          case 'docx': return 'fas fa-file-word text-primary';
          case 'xls':
          case 'xlsx': return 'fas fa-file-excel text-success';
          case 'ppt':
          case 'pptx': return 'fas fa-file-powerpoint text-warning';
          case 'txt': return 'fas fa-file-alt text-secondary';
          case 'jpg':
          case 'jpeg':
          case 'png':
          case 'gif': return 'fas fa-file-image text-info';
          case 'zip':
          case 'rar':
          case '7z': return 'fas fa-file-archive text-muted';
          default: return 'fas fa-file';
        }
      };

      // 下载文件
      // 下载文件
      scope.downloadFile = function (file) {
        if (!file || !file.id) return;

        $http.get(`/api/files/download/${file.id}`, {
          responseType: 'blob'
        }).then(res => {
          // 先尝试通过响应头判断是否为 JSON（错误信息通常是 JSON）
          const contentType = (res.headers && res.headers('content-type')) ? res.headers('content-type').toLowerCase() : '';

          // helper: 将 blob 转为文本并尝试解析 JSON
          function blobToJson(blob, cb) {
            const reader = new FileReader();
            reader.onload = function () {
              try {
                const text = reader.result;
                const json = JSON.parse(text);
                cb(null, json);
              } catch (e) {
                cb(e);
              }
            };
            reader.onerror = function (err) {
              cb(err || new Error('读取返回内容失败'));
            };
            reader.readAsText(blob, 'utf-8');
          }

          // 如果服务器返回 application/json，我们直接解析并显示 message
          if (contentType.indexOf('application/json') !== -1) {
            blobToJson(res.data, function (err, json) {
              if (!err && json && json.message) {
                alert('下载失败: ' + json.message);
              } else {
                alert('下载失败: 无法解析返回的错误信息');
              }
            });
            return;
          }

          // 尝试把 blob 转为文本并判断是否 JSON；如果不是 JSON 再进行下载
          blobToJson(res.data, function (err, json) {
            if (!err && json && json.message) {
              // 返回的是 JSON 错误
              alert('下载失败: ' + json.message);
            } else {
              // 真正的二进制文件，执行下载
              const blob = new Blob([res.data]);
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = file.name || 'file';
              document.body.appendChild(a);
              a.click();
              a.remove();
              window.URL.revokeObjectURL(url);
            }
          });

        }).catch(err => {
          // catch 中也可能拿到 blob（部分后台会把错误以 blob 返回）
          if (err && err.data) {
            // 如果 err.data 是 blob，尝试解析 JSON
            if (typeof err.data === 'object' && typeof err.data.size === 'number') {
              const reader = new FileReader();
              reader.onload = function () {
                try {
                  const json = JSON.parse(reader.result);
                  if (json && json.message) {
                    alert('下载失败: ' + json.message);
                    return;
                  }
                  alert('下载失败: ' + (err.statusText || '未知错误'));
                } catch (e) {
                  alert('下载失败: ' + (err.statusText || '未知错误'));
                }
              };
              reader.readAsText(err.data, 'utf-8');
              return;
            }
          }
          // 其他错误
          alert('下载失败: ' + (err && (err.data && err.data.message) ? err.data.message : (err.statusText || err.message || '未知错误')));
        });
      };
    }
  };
});

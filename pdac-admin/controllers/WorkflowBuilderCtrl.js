app.controller('WorkflowBuilderCtrl', ['$scope', '$http', function ($scope, $http) {
    $scope.workflow = {
        code: '',
        name: '',
        description: '',
        definition: { nodes: [], transitions: [] }
    };
    // 1️⃣ 初始化
    $scope.roles = [];
    $scope.users = [];

    // 初始化加载角色列表
    $scope.loadRoles = function () {
        $http.get('http://host:4001/roles')
            .then(function (res) {
                if (res.data.success) {
                    $scope.roles = res.data.data || [];
                }
            }, function (err) {
                console.error('加载角色失败', err);
            });
    };

    // 页面初始化
    $scope.loadRoles();

    // 节点类型
    $scope.nodeTypes = [
        { type: 'start', label: '开始' },
        { type: 'task', label: '任务' },
        { type: 'approval', label: '审批' },
        { type: 'condition', label: '条件' },
        { type: 'parallel', label: '并行分发' },
        { type: 'end', label: '结束' }
    ];

    // 分流/汇聚模式
    $scope.splitModes = [
        { value: 'exclusive', label: '条件分流(默认)' },
        { value: 'parallel', label: '并行分流(全部)' },
        { value: 'sequential', label: '串行分流(有序)' }
    ];
    $scope.joinModes = [
        { value: 'all', label: '全部到达后汇聚(AND)' },
        { value: 'any', label: '任一到达即向后(OR)' }
    ];

    $scope.selectedNode = null;
    let nodeIdCounter = 1;

    // 网格布局
    let gridX = 20, gridY = 20;
    const gridSpacingX = 150, gridSpacingY = 100;
    const canvasWidth = 1000, canvasHeight = 700;

    // ---------------- 添加节点 ----------------
    $scope.addNode = function (type) {
        const node = {
            id: 'node_' + nodeIdCounter++,
            name: type.label,
            type: type.type,
            x: gridX,
            y: gridY,
            role: null,
            splitMode: 'exclusive',
            joinMode: 'all',
            conditions: type.type === 'condition' ? [
                { label: 'true', target: '', expression: '' },
                { label: 'false', target: '', expression: '' }
            ] : null
        };
        $scope.workflow.definition.nodes.push(node);
        $scope.selectedNode = node;

        gridX += gridSpacingX;
        if (gridX > canvasWidth - 140) { gridX = 20; gridY += gridSpacingY; if (gridY > canvasHeight - 90) gridY = 20; }
    };

    // ---------------- 选择 / 删除节点 ----------------
    $scope.selectNode = function (node) { $scope.selectedNode = node; };
    $scope.removeNode = function (node) {
        $scope.workflow.definition.nodes =
            $scope.workflow.definition.nodes.filter(n => n.id !== node.id);
        $scope.workflow.definition.transitions =
            $scope.workflow.definition.transitions.filter(t => t.from !== node.id && t.to !== node.id);
        $scope.selectedNode = null;
    };

    // ---------------- 条件节点管理 ----------------
    $scope.addConditionRow = function () {
        if (!$scope.selectedNode || $scope.selectedNode.type !== 'condition') return;
        $scope.selectedNode.conditions.push({ label: '分支', target: '', expression: '' });
    };
    $scope.removeConditionRow = function (idx) {
        if (!$scope.selectedNode || $scope.selectedNode.type !== 'condition') return;
        const row = $scope.selectedNode.conditions[idx];
        $scope.workflow.definition.transitions =
            $scope.workflow.definition.transitions.filter(t =>
                !(t.from === $scope.selectedNode.id && t.to === row.target && t.condition === row.label)
            );
        $scope.selectedNode.conditions.splice(idx, 1);
    };
    $scope.applyConditionRow = function (idx) {
        if (!$scope.selectedNode || $scope.selectedNode.type !== 'condition') return;
        const row = $scope.selectedNode.conditions[idx];
        if (!row || !row.target || !row.label) return;

        // 自动生成 branchId，如果已有则复用
        const branchId = row.branch || ('branch_' + Date.now() + '_' + idx);

        const exist = $scope.workflow.definition.transitions.find(t =>
            t.from === $scope.selectedNode.id && t.to === row.target
        );
        if (exist) {
            exist.condition = row.label;
            exist.conditionExpression = row.expression;
            exist.branch = branchId;
        } else {
            $scope.workflow.definition.transitions.push({
                from: $scope.selectedNode.id,
                to: row.target,
                condition: row.label,
                conditionExpression: row.expression,
                branch: branchId
            });
        }
        row.branch = branchId; // 保存到条件行，方便 end 节点继承
    };

    // ---------------- 一般连线维护 ----------------
    $scope.addTransitionByUpstream = function (node) {
        if (node.upstream) {
            const from = node.upstream, to = node.id;
            const t = { from, to };
            const fromNode = $scope.workflow.definition.nodes.find(n => n.id === from);
            if (fromNode && fromNode.splitMode === 'sequential') {
                const existing = $scope.getOutgoingTransitions(from);
                t.order = existing.length;
            }
            $scope.workflow.definition.transitions.push(t);
            node.upstream = null;
        }
    };
    $scope.removeTransition = function (index) {
        $scope.workflow.definition.transitions.splice(index, 1);
    };

    // ---------------- 辅助方法 ----------------
    $scope.getOutgoingTransitions = id =>
        $scope.workflow.definition.transitions.filter(t => t.from === id);
    $scope.getIncomingTransitions = id =>
        $scope.workflow.definition.transitions.filter(t => t.to === id);

    $scope.bumpOrder = function (t, dir) {
        if (!('order' in t)) return;
        const siblings = $scope.getOutgoingTransitions(t.from)
            .filter(x => 'order' in x)
            .sort((a, b) => a.order - b.order);
        const idx = siblings.indexOf(t), swapIdx = idx + (dir === 'up' ? -1 : 1);
        if (swapIdx < 0 || swapIdx >= siblings.length) return;
        const other = siblings[swapIdx]; const tmp = t.order; t.order = other.order; other.order = tmp;
    };

    // ---------------- 拖拽 ----------------
    let draggingNode = null, offsetX = 0, offsetY = 0;
    $scope.startDrag = function (event, node) {
        draggingNode = node;
        offsetX = event.clientX - node.x;
        offsetY = event.clientY - node.y;
        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    };
    function mouseMoveHandler(event) {
        if (draggingNode) { draggingNode.x = event.clientX - offsetX; draggingNode.y = event.clientY - offsetY; $scope.$apply(); }
    }
    function mouseUpHandler() { draggingNode = null; document.removeEventListener('mousemove', mouseMoveHandler); document.removeEventListener('mouseup', mouseUpHandler); }

    // ---------------- 保存 ----------------
    $scope.saveWorkflow = function () {
        const data = angular.copy($scope.workflow);
        data.created_by = 1;

        // 对节点进行处理，只保留必要字段，保证 role 使用选择的 code
        data.definition.nodes = data.definition.nodes.map(n => {
            const node = { ...n };
            if (n.type === 'task' || n.type === 'approval') {
                node.role = n.role || null;
            } else {
                node.role = null;
            }

            // 自动继承 branch
            if (n.type === 'end') {
                const incoming = data.definition.transitions.filter(t => t.to === n.id);
                if (incoming.length) {
                    node.branch = incoming[0].branch; // 简单继承第一条 incoming 的 branch
                }
            }
            return node;
        });

        // 保留 transitions
        data.definition.transitions = data.definition.transitions.map(t => ({ ...t }));

        $http.post('/workflow/definitions', data)
            .then(res => {
                if (res.data.success) alert('流程模板创建成功');
                else alert('创建失败: ' + res.data.message);
            })
            .catch(err => {
                console.error(err);
                alert('服务器错误，创建失败');
            });
    };

    // ---------------- 工具 ----------------
    $scope.getNodeCenter = function (id) {
        const n = $scope.workflow.definition.nodes.find(x => x.id === id);
        return n ? { x: n.x + 50, y: n.y + 25 } : { x: 0, y: 0 };
    };
    $scope.getNodeNameById = function (id) {
        const n = $scope.workflow.definition.nodes.find(x => x.id === id);
        return n ? n.name : '未知节点';
    };
}]);

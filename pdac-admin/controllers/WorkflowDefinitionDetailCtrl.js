app.controller('WorkflowDefinitionDetailCtrl', function ($scope, $http, $stateParams, $timeout) {
    $scope.definition = null;
    $scope.selectedNode = null;
    let currentModal = null;
    let jsPlumbInstance = null;

    $http.get('/workflow/definition/' + $stateParams.id)
        .then(res => {
            if (res.data.success && res.data.data && res.data.data.definition) {
                $scope.definition = res.data.data;
                $timeout(() => {
                    initFlowchart($scope.definition.definition.nodes, $scope.definition.definition.transitions);
                }, 0);
            } else {
                alert('流程加载失败：' + (res.data.message || '未知错误'));
            }
        }, () => alert('请求接口失败'));

    function initFlowchart(nodes, transitions) {
        const container = document.getElementById('flowchartContainer');
        container.innerHTML = '';

        // 初始化jsPlumb实例
        if (jsPlumbInstance) {
            jsPlumbInstance.reset();
        }

        jsPlumbInstance = jsPlumb.getInstance({
            Container: container,
            Connector: ['Flowchart', { cornerRadius: 5 }],
            PaintStyle: { stroke: '#409EFF', strokeWidth: 2 },
            HoverPaintStyle: { stroke: '#66B1FF', strokeWidth: 3 },
            EndpointStyle: { radius: 4, fill: '#409EFF' },
            ConnectionOverlays: [
                ['Arrow', {
                    width: 10,
                    length: 10,
                    location: 1,
                    paintStyle: { fill: '#409EFF' }
                }]
            ]
        });

        const nodeWidth = 140;
        const nodeHeight = 60;

        // 使用 dagre 自动布局
        const g = new dagre.graphlib.Graph();
        g.setGraph({
            rankdir: 'LR',
            nodesep: 100,  // 增加节点间距
            ranksep: 80    // 增加层级间距
        });
        g.setDefaultEdgeLabel(() => ({}));

        nodes.forEach(n => {
            g.setNode(n.id, {
                label: n.name,
                width: nodeWidth,
                height: nodeHeight
            });
        });
        transitions.forEach(t => {
            g.setEdge(t.from, t.to);
        });

        dagre.layout(g);

        // 创建节点DOM
        nodes.forEach(n => {
            const pos = g.node(n.id);
            n.x = pos.x;
            n.y = pos.y;

            const div = document.createElement('div');
            div.className = 'flow-node';
            div.id = n.id;
            div.textContent = n.name + (n.assignee ? `\n[${n.assignee}]` : '');
            div.style.position = 'absolute';
            div.style.left = (pos.x - nodeWidth / 2) + 'px';
            div.style.top = (pos.y - nodeHeight / 2) + 'px';
            div.style.width = nodeWidth + 'px';
            div.style.height = nodeHeight + 'px';
            div.style.lineHeight = (nodeHeight / 2) + 'px';
            div.style.textAlign = 'center';
            div.style.borderRadius = '5px';
            div.style.backgroundColor = '#409EFF';
            div.style.color = 'white';
            div.style.cursor = 'pointer';
            div.style.userSelect = 'none';
            div.style.boxShadow = '0 0 5px rgba(64, 158, 255, 0.5)';

            div.addEventListener('click', () => {
                $timeout(() => {
                    $scope.selectedNode = angular.copy(n);
                    $scope.$apply();

                    if (!currentModal) {
                        currentModal = new bootstrap.Modal(document.getElementById('nodeModal'));
                    }
                    currentModal.show();
                });
            });

            container.appendChild(div);
        });

        // 等待DOM渲染完成后再绘制连接线
        $timeout(() => {
            // 绘制连接线
            transitions.forEach(t => {
                jsPlumbInstance.connect({
                    source: t.from,
                    target: t.to,
                    anchors: ['RightMiddle', 'LeftMiddle'],
                    paintStyle: { stroke: '#409EFF', strokeWidth: 2 },
                    hoverPaintStyle: { stroke: '#66B1FF', strokeWidth: 3 }
                });
            });

            // 调整容器大小以适应布局
            const width = g.graph().width || 1000;
            const height = g.graph().height || 500;
            container.style.width = width + 200 + 'px';
            container.style.height = height + 200 + 'px';

            jsPlumbInstance.repaintEverything();
        }, 100);
    }

    $scope.saveAssignee = function () {
        if (!$scope.selectedNode) return;

        const origNode = $scope.definition.definition.nodes.find(n => n.id === $scope.selectedNode.id);
        if (origNode) {
            origNode.assignee = $scope.selectedNode.assignee;
            const domNode = document.getElementById(origNode.id);
            if (domNode) {
                domNode.textContent = origNode.name + (origNode.assignee ? `\n[${origNode.assignee}]` : '');
            }
        }

        if (currentModal) {
            currentModal.hide();
        }
    };
});
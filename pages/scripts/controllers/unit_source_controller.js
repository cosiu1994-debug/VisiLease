app.controller('UnitOpreatorController', ['$http', '$scope', '$timeout', '$filter', '$location', function ($http, $scope, $timeout, $filter, $location) {
    var um = this;
    um.statusList = ['unpartitioned', 'vacant', 'leased', 'reserved'];
    um.activeSection = 'buildings';
    um.buildings = [];
    um.floors = [];
    um.units = [];

    um.filter = { status: '', page: 1, pageSize: 20 };
    um.pagination = { page: 1, totalPages: 1 };

    um.newBuilding = { name: '', address: '' };
    um.newFloor = { level: null, build_area: null, usable_area: null };
    um.newUnit = { code: '', lease_area: null, efficiency_rate: null };

    var unitAttrModalEl = document.getElementById('unitAttrModal');
    um.unitAttrModal = bootstrap.Modal.getOrCreateInstance(unitAttrModalEl);

    var unitMergeAttrModalEl = document.getElementById('unitMergeAttrModal');
    um.unitMergeAttrModal = bootstrap.Modal.getOrCreateInstance(unitMergeAttrModalEl);


    um.loadBuildings = function () {
        $http.get('/api/buildings', { params: { page: 1, size: 10 } })
            .then(function (res) { um.buildings = res.data.data; });
    };

    um.loadGlobalStats = function () {
        $http.get('/api/lease-stats')
            .then(function (res) {
                // 将所有楼栋汇总起来
                const total = {
                    leased_units: 0,
                    leased_area: 0,
                    vacant_units: 0,
                    vacant_area: 0,
                };

                (res.data || []).forEach(row => {
                    total.leased_units += row.leased_units;
                    total.leased_area += parseFloat(row.leased_area);
                    total.vacant_units += row.vacant_units;
                    total.vacant_area += parseFloat(row.vacant_area);
                });

                const total_area = total.leased_area + total.vacant_area;
                total.lease_rate = total_area > 0 ? total.leased_area / total_area : 0;

                um.total = {
                    leased_units: total.leased_units,
                    leased_area: total.leased_area.toFixed(2),
                    vacant_units: total.vacant_units,
                    vacant_area: total.vacant_area.toFixed(2),
                    lease_rate: total.lease_rate
                };
            })
            .catch(function (err) {
                console.error('全局统计加载失败:', err);
            });
    };

    um.loadGlobalStats();

    um.cardPage = 1;
    um.cardPageSize = 6;
    um.cardTotalItems = 0;
    um.cardTotalPages = 1;
    um.loadBuildingCards = function () {
        $http.get('/api/building-cards', {
            params: {
                page: um.cardPage,
                size: um.cardPageSize,
                city: um.selectedCity || undefined,
                district: um.selectedDistrict || undefined,

            }
        }).then(function (res) {
            um.stats = res.data.data || [];

            // 设置总条数和总页数
            um.cardTotalItems = res.data.pagination?.total || 0;
            um.cardTotalPages = Math.ceil(um.cardTotalItems / um.cardPageSize);
            // 计算汇总数据（如果需要）
            const total = {
                leased_units: 0,
                leased_area: 0,
                vacant_units: 0,
                vacant_area: 0,
            };

            um.stats.forEach(b => {
                total.leased_units += b.leased_units;
                total.leased_area += parseFloat(b.leased_area);
                total.vacant_units += b.vacant_units;
                total.vacant_area += parseFloat(b.vacant_area);
            });

            const total_area = total.leased_area + total.vacant_area;
            total.lease_rate = total_area > 0 ? total.leased_area / total_area : 0;
        })
            .catch(function (err) {
                console.error('楼栋卡片数据获取失败:', err);
            });
    };

    um.cardchangePage = function (page) {
        if (page < 1 || page > um.cardTotalPages || page === um.cardPage) return;
        um.cardPage = page;
        um.loadBuildingCards();
    };

    // 页面数组（最大显示5页）
    um.getCardPageRange = function () {
        const pages = [];
        const maxButtons = 5;
        let start = Math.max(1, um.cardPage - Math.floor(maxButtons / 2));
        let end = Math.min(um.cardTotalPages, start + maxButtons - 1);
        start = Math.max(1, end - maxButtons + 1);

        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        return pages;
    };
    console.log('页码数组:', um.getCardPageRange());

    um.selectBuilding = function (b) {
        um.selectedBuilding = b;
        um.activeSection = 'floors';
        um.loadFloors();
        $http.get('/api/lease-stats?building_id=' + um.selectedBuilding.id)
            .then(function (res2) {
                const data = res2.data || [];

                // 如果是返回多个 building_id 的合并统计数组，只取当前楼栋的汇总
                const buildingStat = data.find(s => s.building_id === um.selectedBuilding.id);
                um.projectTotal = {
                    leased_area: parseFloat(buildingStat?.leased_area || 0),
                    leased_units: buildingStat?.leased_units || 0,
                    vacant_area: parseFloat(buildingStat?.vacant_area || 0),
                    vacant_units: buildingStat?.vacant_units || 0,
                    lease_rate: parseFloat(buildingStat?.lease_rate || 0)
                };

                // 如果你后续还有楼层数据，继续在这里加载 or 单独请求
            })
            .catch(function (err) {
                console.error('楼栋租赁统计获取失败:', err);
            });
    };

    um.loadFloors = function () {
        if (!um.selectedBuilding) return;
        $http.get('/api/buildings/' + um.selectedBuilding.id + '/floors')
            .then(function (res) {
                um.floors = res.data.data;
                um.selectedFloor = um.floors[0];
                um.ratioForm = {
                    aspect_ratio: um.selectedFloor?.aspectRatioBuild,
                    core_ratio: um.selectedFloor?.aspectRatioCore
                };
            });
    };

    um.addFloor = function () {
        if (!um.selectedBuilding) return;
        var payload = {
            level: um.newFloor.level,
            build_area: um.newFloor.build_area,
            usable_area: um.newFloor.usable_area
        };
        $http.post('/api/buildings/' + um.selectedBuilding.id + '/floors', payload)
            .then(function () {
                um.newFloor = { level: null, build_area: null, usable_area: null };
                um.loadFloors();
            }, function (err) {
                console.error('新增楼层失败', err);
            });
    };

    um.selectFloor = function (f) {
        um.selectedFloor = f;
        um.activeSection = 'units';
        um.filter = { status: '', page: 1, pageSize: 20 };
        um.loadUnits();
    };

    um.filter.pageSize = 20;
    um.loadUnits = function () {
        if (!um.selectedFloor) return;
        var params = {
            building_id: um.selectedBuilding.id,
            floor: um.selectedFloor.level,
            status: um.filter.status,
            page: um.filter.page,
            pageSize: um.filter.pageSize
        };
        $http.get('/api/units', { params: params })
            .then(function (res) {
                um.units = res.data.units;
                um.pagination = res.data.pagination;
                drawCanvas();
                $http.get('/api/buildings/' + um.selectedBuilding.id + '/floors/' + um.selectedFloor.level)
                    .then(function (res) {
                        um.selectedFloor = res.data;
                    });
            }, function (err) {
                console.error('加载单元失败', err);
            });
    };

    um.getTotal = function (field) {
        var sum = 0;
        angular.forEach(um.units, function (u) {
            var status = (u.status || '').toLowerCase();
            if (status !== 'unpartitioned') {
                sum += parseFloat(u[field]) || 0;
            }
        });
        return sum.toFixed(2);
    };

    um.getGlobalEfficiency = function () {
        var totalUsable = um.getTotal('usable_area');
        var totalLease = um.getTotal('lease_area');
        if (totalLease === 0 || totalUsable === 0) {
            return 0;
        }
        var efficiency = totalUsable / totalLease;
        return isNaN(efficiency) ? "-" : efficiency;
    };

    um.getGlobalEfficiencyPercent = function () {
        var ratio = um.getGlobalEfficiency() * 100;
        return ratio.toFixed(1) + '%';
    };

    um.changePage = function (p) {
        um.filter.page = p;
        um.loadUnits();
    };

    um.addBuilding = function () {
        var payload = { name: um.newBuilding.name, address: um.newBuilding.address };
        $http.post('/api/buildings', payload)
            .then(function () {
                um.newBuilding = { name: '', address: '' };
                um.loadBuildingCards();
            }, function (err) {
                console.error('新增楼栋失败', err);
            });
    };

    um.confirmAddUnit = function () {
        if (!um.selectedFloor) return;
        var floorUsableArea = um.selectedFloor.usable_area || 0;
        var existingArea = um.units.reduce(function (sum, u) {
            return sum + (u.usable_area || 0);
        }, 0);
        var newUsable = (um.newUnit.lease_area || 0) * (um.newUnit.efficiency_rate || 0);

        if (existingArea + newUsable > floorUsableArea) {
            alert('新增单元的实用面积超出整层可用面积，当前可用面积剩余为：' + (floorUsableArea - existingArea).toFixed(2));
            return;
        }

        var child = {
            code: um.newUnit.code,
            lease_area: um.newUnit.lease_area,
            usable_area: um.newUnit.usable_area,
            rent_unit_price: um.newUnit.rent_price,
            management_fee: um.newUnit.management_fee,
            features: um.newUnit.features,
            orientation: um.newUnit.orientation,
            layout: um.newUnit.layout,
            remarks: um.newUnit.notes,
            pos_x: um.newUnit.x,
            pos_y: um.newUnit.y,
            width: um.newUnit.width,
            height: um.newUnit.height,
            rect_parts: um.newUnit.rect_parts
        };
        console.log(child);
        $http.post('/api/split-unit', {
            parent_unit_id: um.selectedFloor.id,
            children: [child]
        }).then(function () {
            um.newUnit = { code: '', lease_area: null, efficiency_rate: null };
            um.loadUnits();
            um.unitAttrModal.hide();
            document.body.style.overflow = '';
            rects.length = 0;
            um.unitAttrModal.hide();
            um.loadUnits();
        }, function (err) {
            console.error('新增单元失败', err);
        });
    };

    um.onPageSizeChange = function () {
        um.filter.page = 1;
        um.loadUnits();
    };

    // 画布分割/拖拽及绘制逻辑
    var canvas = document.getElementById('unitCanvas');
    var isDrawing = false;
    var isCutting = false;
    var polygonPoints = [];
    var polylinePoints = [];
    var rects = [];
    var selectedUnitIds = [];
    var closeThreshold = 15;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    um.currentMode = 'draw';
    um.showSplitModal = false;
    const dpr = window.devicePixelRatio || 1;

    // 绘制方位指示（右上角）
    function drawCompass(ctx, canvasWidth) {
        const cx = canvasWidth - 60;
        const cy = 60;
        const radius = 25;
        ctx.save();

        // 背景圆
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.stroke();

        // 绘制箭头
        ctx.beginPath();
        ctx.moveTo(cx, cy - 15); // N
        ctx.lineTo(cx, cy + 15); // S
        ctx.moveTo(cx - 15, cy); // W
        ctx.lineTo(cx + 15, cy); // E
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 标注方向
        ctx.fillStyle = '#000';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('N', cx, cy - 20);
        ctx.fillText('S', cx, cy + 28);
        ctx.fillText('W', cx - 20, cy + 5);
        ctx.fillText('E', cx + 20, cy + 5);

        ctx.restore();
    }

    const GRID_SIZE = 20;

    function snapToGrid(value) {
        return Math.round(value / GRID_SIZE) * GRID_SIZE;
    }

    function drawCanvas(hoveredUnitId = null) {
        if (!canvas || !um.selectedFloor) return;
        // 1. 计算画布尺寸（保持不变）
        const buildArea = um.selectedFloor.build_area || 100;
        const usableArea = um.selectedFloor.usable_area || 80;
        const efficiency = usableArea / buildArea;
        const PIXELS_PER_SQM = 400;
        const totalPixels = buildArea * PIXELS_PER_SQM;

        var aspectRatioBuild = um.selectedFloor.aspectRatioBuild ?? 2;
        var aspectRatioCore = um.selectedFloor.aspectRatioCore ?? 3;
        console.log(aspectRatioBuild, aspectRatioCore);
        const width = Math.sqrt(totalPixels * aspectRatioBuild);
        const height = Math.sqrt(totalPixels / aspectRatioBuild);

        resizeCanvasToDisplaySize(canvas, width, height);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr * scale, offsetY * dpr * scale);

        // 2. 背景绘制（保持不变）
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#f9f9f9';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, width, height);

        // 3. 公摊区域（保持不变）
        const coreRatio = 1 - efficiency;
        if (coreRatio > 0.01) {
            const coreAreaPixels = buildArea * coreRatio * PIXELS_PER_SQM;
            const coreWidth = Math.sqrt(coreAreaPixels * aspectRatioCore);
            const coreHeight = Math.sqrt(coreAreaPixels / aspectRatioCore);

            const coreX = snapToGrid((width - coreWidth) / 2, GRID_SIZE);
            const coreY = snapToGrid((height - coreHeight) / 2, GRID_SIZE);

            ctx.save();
            ctx.fillStyle = 'rgba(150,150,150,0.2)';
            ctx.fillRect(coreX, coreY, coreWidth, coreHeight);
            ctx.strokeStyle = '#666';
            ctx.lineWidth = 1;
            ctx.strokeRect(coreX, coreY, coreWidth, coreHeight);

            ctx.fillStyle = '#444';
            ctx.font = `${16 * dpr}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('公摊面积(此区域禁止作图)≈', coreX + coreWidth / 2, coreY + coreHeight / 2 - 12 * dpr);
            ctx.font = `${12 * dpr}px sans-serif`;
            ctx.fillText(`${(buildArea * coreRatio).toFixed(1)}㎡`, coreX + coreWidth / 2, coreY + coreHeight / 2 + 12 * dpr);
            ctx.restore();

            coreAreaBounds = { x: coreX, y: coreY, width: coreWidth, height: coreHeight };
        }

        // 4. 网格背景（保持不变）
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 0.7;
        for (let y = GRID_SIZE; y < height; y += GRID_SIZE) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }
        for (let x = GRID_SIZE; x < width; x += GRID_SIZE) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        ctx.restore();

        // 5. 单元绘制
        um.units.forEach(unit => {
            let unitPath;
            if (unit.rect_parts && unit.rect_parts.length >= 3) {
                unitPath = new Path2D();
                unitPath.moveTo(unit.rect_parts[0][0], unit.rect_parts[0][1]);
                unit.rect_parts.forEach(([x, y], index) => {
                    if (index > 0) unitPath.lineTo(x, y);
                });
                unitPath.closePath();
            } else if (unit.pos_x !== undefined && unit.pos_y !== undefined && unit.width !== undefined && unit.height !== undefined) {
                unitPath = new Path2D();
                unitPath.rect(unit.pos_x, unit.pos_y, unit.width, unit.height);
            } else {
                console.warn('Invalid unit coordinates:', unit);
                return;
            }

            const isHovered = hoveredUnitId && unit.id === hoveredUnitId;
            const isSelected = selectedUnitIds && selectedUnitIds.includes(unit.id);

            // 填充色逻辑
            let fillColor = 'rgba(255, 100, 126, 1)';
            if (['vacant', '空置'].includes(unit.status)) fillColor = 'rgba(173, 223, 191, 0.8)';
            else if (['leased', '已出租'].includes(unit.status)) fillColor = 'rgba(178, 190, 206, 0.8)';
            else if (['reserved', '已预定'].includes(unit.status)) fillColor = 'rgba(250, 214, 165, 0.8)';
            // 若悬浮或选中，则用一致高亮色
            if (isHovered || isSelected) fillColor = 'rgba(255, 140, 0, 1)';
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.1)';
            ctx.shadowBlur = 4;
            ctx.fillStyle = fillColor;
            ctx.fill(unitPath);
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1.2;
            ctx.stroke(unitPath);
            ctx.restore();
        });

        const labels = um.units.map(unit => {
            const statusLabel = $filter('unitStatusLabel')(unit.status);
            const textLines = [
                unit.code || '--',
                '状态:' + statusLabel || '--'
            ];

            // 计算初始文字框中心点
            let textX, textY;
            if (unit.rect_parts) {
                // 多边形中心
                const centroid = calculateCentroid(unit.rect_parts);
                textX = centroid.x;
                textY = centroid.y;
            } else {
                // 矩形中心
                textX = unit.pos_x + unit.width / 2;
                textY = unit.pos_y + unit.height / 2;
            }

            // 计算文本框尺寸
            ctx.save();
            const baseFontSize = 10;
            ctx.font = `bold ${baseFontSize * dpr}px Arial`;
            const textMetrics = textLines.map(line => ctx.measureText(line));
            const maxWidth = Math.max(...textMetrics.map(m => m.width));
            const boxWidth = maxWidth + 20;
            const boxHeight = textLines.length * 20;
            ctx.restore();

            return {
                unitId: unit.id,
                lines: textLines,
                x: textX,
                y: textY,
                width: boxWidth,
                height: boxHeight,
                offsetX: 0,  // 用于调整偏移
                offsetY: 0
            };
        });

        // 碰撞检测和简单位移调整（迭代若干轮）
        function rectsOverlap(a, b) {
            return !(a.x + a.offsetX + a.width / 2 < b.x + b.offsetX - b.width / 2 ||
                a.x + a.offsetX - a.width / 2 > b.x + b.offsetX + b.width / 2 ||
                a.y + a.offsetY + a.height / 2 < b.y + b.offsetY - b.height / 2 ||
                a.y + a.offsetY - a.height / 2 > b.y + b.offsetY + b.height / 2);
        }

        const maxIterations = 10;
        const moveStep = 5;
        for (let iter = 0; iter < maxIterations; iter++) {
            let moved = false;
            for (let i = 0; i < labels.length; i++) {
                for (let j = i + 1; j < labels.length; j++) {
                    if (rectsOverlap(labels[i], labels[j])) {
                        moved = true;
                        // 简单地互相沿y方向错开
                        if (labels[i].y <= labels[j].y) {
                            labels[i].offsetY -= moveStep;
                            labels[j].offsetY += moveStep;
                        } else {
                            labels[i].offsetY += moveStep;
                            labels[j].offsetY -= moveStep;
                        }
                    }
                }
            }
            if (!moved) break; // 没有碰撞则结束
        }
        // 绘制文字标签
        labels.forEach(label => {
            ctx.save();
            ctx.translate(label.x + label.offsetX, label.y + label.offsetY);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.strokeStyle = '#666';
            const baseFontSize = 10;
            ctx.font = `bold ${baseFontSize * dpr}px Arial`;
            // 绘制背景框
            ctx.beginPath();
            ctx.roundRect(-label.width / 2, -label.height / 2, label.width, label.height, 4);
            ctx.fill();
            ctx.stroke();
            // 绘制文字
            ctx.fillStyle = '#333';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            label.lines.forEach((line, index) => {
                ctx.fillText(line, 0, (index - (label.lines.length - 1) / 2) * 20);
            });
            ctx.restore();
        });

        // 6. 草图绘制（保持不变）
        if (um.currentMode === 'draw') {
            rects.forEach(r => {
                if (!r.points || r.points.length < 3) return;

                ctx.save();
                ctx.beginPath();
                ctx.moveTo(r.points[0][0], r.points[0][1]);
                r.points.forEach((pt, index) => {
                    if (index > 0) ctx.lineTo(pt[0], pt[1]);
                });
                ctx.closePath();

                ctx.fillStyle = 'rgba(100,200,255,0.3)';
                ctx.strokeStyle = '#007bff';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 2]);
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            });
        }
        // 7. 罗盘（保持不变）
        drawCompass(ctx, width);

        // 辅助函数：计算多边形质心（保持不变）
        function calculateCentroid(points) {
            let sumX = 0, sumY = 0;
            points.forEach(([x, y]) => {
                sumX += x;
                sumY += y;
            });
            return {
                x: sumX / points.length,
                y: sumY / points.length
            };
        }
    }

    //画布模式切换
    function switchMode(newMode) {
        um.currentMode = newMode;
        if (newMode !== 'draw' && newMode !== 'cut') {
            isDrawing = false;
            isCutting = false;
            polygonPoints = [];
            polylinePoints = [];
            rects = [];
        }
        drawCanvas();
    }

    //坐标转换
    function getCanvasCoords(event) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        // 计算物理像素坐标
        const pixelX = (event.clientX - rect.left) * (canvas.width / rect.width);
        const pixelY = (event.clientY - rect.top) * (canvas.height / rect.height);

        // 转换为逻辑坐标：考虑缩放和平移
        const logicalX = (pixelX / (dpr * scale)) - offsetX;
        const logicalY = (pixelY / (dpr * scale)) - offsetY;

        return { x: logicalX, y: logicalY };
    }

    function resizeCanvasToDisplaySize(canvas, width, height) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
    }

    /**
 * 在 canvas 身份变换下，判断逻辑坐标 pos 是否命中某个单元
 * @param {{x:number,y:number}} pos  逻辑坐标（getCanvasCoords 的返回值）
 * @returns {number|null} 命中的 unit.id，或 null
 */
    function hitTestUnit(pos) {
        const ctxRaw = canvas.getContext('2d');
        ctxRaw.save();
        ctxRaw.setTransform(1, 0, 0, 1, 0, 0);  // 切换到身份矩阵

        let hitId = null;
        for (const unit of um.units) {
            const path = new Path2D();
            if (unit.rect_parts && unit.rect_parts.length >= 3) {
                path.moveTo(...unit.rect_parts[0]);
                unit.rect_parts.slice(1).forEach(pt => path.lineTo(...pt));
                path.closePath();
            } else {
                path.rect(unit.pos_x, unit.pos_y, unit.width, unit.height);
            }
            if (ctxRaw.isPointInPath(path, pos.x, pos.y)) {
                hitId = unit.id;
                break;
            }
        }

        ctxRaw.restore();
        return hitId;
    }

    // 辅助函数：计算两点距离
    function distance(p1, p2) {
        return Math.sqrt(Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2));
    }

    //判断线段是否相交
    function segmentsIntersect(p1, p2, q1, q2) {
        function onSegment(p, q, r) {
            return (
                q[0] <= Math.max(p[0], r[0]) &&
                q[0] >= Math.min(p[0], r[0]) &&
                q[1] <= Math.max(p[1], r[1]) &&
                q[1] >= Math.min(p[1], r[1])
            );
        }

        function orientation(p, q, r) {
            const val = (q[1] - p[1]) * (r[0] - q[0]) -
                (q[0] - p[0]) * (r[1] - q[1]);
            if (Math.abs(val) < 1e-10) return 0; // 共线
            return val > 0 ? 1 : 2; // 顺 or 逆
        }

        const o1 = orientation(p1, p2, q1);
        const o2 = orientation(p1, p2, q2);
        const o3 = orientation(q1, q2, p1);
        const o4 = orientation(q1, q2, p2);

        if (o1 !== o2 && o3 !== o4) return true;

        // 端点或者共线情况也算相交
        if (o1 === 0 && onSegment(p1, q1, p2)) return true;
        if (o2 === 0 && onSegment(p1, q2, p2)) return true;
        if (o3 === 0 && onSegment(q1, p1, q2)) return true;
        if (o4 === 0 && onSegment(q1, p2, q2)) return true;

        return false;
    }

    // 检测切割线与所有多边形边的交点数
    function countCutLineIntersections(cutLine, unit_id) {
        const unit = um.units.find(u => u.id === unit_id);
        if (!unit || !unit.rect_parts || unit.rect_parts.length < 3) {
            return 0;
        }
        let count = 0;
        const pts = unit.rect_parts;
        for (let i = 0; i < cutLine.length - 1; i++) {
            const p1 = cutLine[i], p2 = cutLine[i + 1];
            for (let j = 0; j < pts.length - 1; j++) {
                const q1 = pts[j], q2 = pts[j + 1];
                if (segmentsIntersect(p1, p2, q1, q2)) {
                    count++;
                    if (count >= 2) return count; // 2个交点即返回
                }
            }
        }

        return count;
    }

    canvas.addEventListener('mousedown', function (e) {
        const pos = getCanvasCoords(e);
        const x = snapToGrid(pos.x);
        const y = snapToGrid(pos.y);

        switch (um.currentMode) {
            case 'draw':
                if (!isDrawing) {
                    isDrawing = true;
                    polygonPoints = [[x, y]];
                    console.log('开始绘制：', polygonPoints);
                } else {
                    if (
                        polygonPoints.length > 2 &&
                        distance([x, y], polygonPoints[0]) < closeThreshold
                    ) {
                        polygonPoints.push([polygonPoints[0][0], polygonPoints[0][1]]); // 闭合多边形
                        rects.push({ points: polygonPoints });

                        $scope.$apply(function () {
                            um.newUnit.rect_parts = polygonPoints;
                            um.unitAttrModal.show();
                        });

                        isDrawing = false;
                        polygonPoints = [];
                    } else {
                        polygonPoints.push([x, y]);
                    }
                }
                drawCanvas();
                break;

            case 'cut':
                const ctx = canvas.getContext('2d');
                const dpr = window.devicePixelRatio || 1;
                ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr * scale, offsetY * dpr * scale);

                // 查找点击点所在单元 ID
                let clickedUnitId = null;
                for (const unit of um.units) {
                    let unitPath;
                    if (unit.rect_parts && unit.rect_parts.length >= 3) {
                        unitPath = new Path2D();
                        unitPath.moveTo(unit.rect_parts[0][0], unit.rect_parts[0][1]);
                        unit.rect_parts.forEach(([px, py], index) => {
                            if (index > 0) unitPath.lineTo(px, py);
                        });
                        unitPath.closePath();
                    } else if (unit.pos_x !== undefined && unit.pos_y !== undefined) {
                        unitPath = new Path2D();
                        unitPath.rect(unit.pos_x, unit.pos_y, unit.width, unit.height);
                    } else {
                        continue;
                    }

                    if (ctx.isPointInPath(unitPath, x, y)) {
                        clickedUnitId = unit.id;
                        break;
                    }
                }

                if (clickedUnitId) {
                    um.cutUnitId = clickedUnitId;
                }

                if (!isCutting) {
                    isCutting = true;
                    polylinePoints = [[x, y]];
                } else {
                    polylinePoints.push([x, y]);

                    const intersectionCount = countCutLineIntersections(polylinePoints, um.cutUnitId);
                    console.log('单元id：', um.cutUnitId);
                    console.log('切割线坐标：', polylinePoints);
                    console.log('相交点数：', intersectionCount);
                    if (intersectionCount >= 2) {
                        isCutting = false;
                        um.currentMode = 'select'; // 切割完成，回到选择模式
                        um.cutUnit = um.units.find(u => u.id === um.cutUnitId) || null;
                        console.log(um.cutUnit);

                        um.childUnits = [
                            { code: '', usable_area: '', lease_area: '', rent_unit_price: '', remarks: '' },
                            { code: '', usable_area: '', lease_area: '', rent_unit_price: '', remarks: '' }
                        ];
                        $timeout(() => {
                            // 4) 打开 Bootstrap 5 Modal（原生 API）
                            const modalEl = document.getElementById('childUnitModal');
                            const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl, {
                                backdrop: 'static',
                                keyboard: false
                            });
                            bsModal.show();
                        });
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        drawCanvas();
                        if (polylinePoints.length > 0) {
                            ctx.beginPath();
                            ctx.moveTo(polylinePoints[0][0], polylinePoints[0][1]);
                            for (let i = 1; i < polylinePoints.length; i++) {
                                ctx.lineTo(polylinePoints[i][0], polylinePoints[i][1]);
                            }
                            if (isCutting) {
                                ctx.setLineDash([5, 5]); // 虚线
                            } else {
                                ctx.setLineDash([]); // 实线
                            }
                            ctx.strokeStyle = 'red';
                            ctx.lineWidth = 2;
                            ctx.stroke();
                            ctx.setLineDash([]); // 恢复默认
                        }
                    }
                }
                break;

            default:
                // 其他模式不处理点击
                break;
        }
    });

    canvas.addEventListener('mousemove', function (e) {
        if (suppressMouse) return;

        // 1) 计算逻辑坐标（自动反算缩放和平移）
        const pos = getCanvasCoords(e);

        // 2) 在“未变换”状态下做命中检测
        const hoveredUnitId = hitTestUnit(pos);

        // 3) 根据命中结果统一重绘（会高亮 hoveredUnitId）
        drawCanvas(hoveredUnitId);

        // 4) 余下模式下的“草图”或“切割”实时预览

        if (um.currentMode === 'draw') {
            const ctx = canvas.getContext('2d');
            ctx.save();
            // 重新施加缩放和平移
            ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr * scale, offsetY * dpr * scale);

            // 原有草图绘制逻辑
            if (polygonPoints.length > 0) {
                ctx.beginPath();
                ctx.moveTo(polygonPoints[0][0], polygonPoints[0][1]);
                for (let i = 1; i < polygonPoints.length; i++) {
                    ctx.lineTo(polygonPoints[i][0], polygonPoints[i][1]);
                }
                // 动态连线到当前鼠标位置
                const x = snapToGrid(pos.x);
                const y = snapToGrid(pos.y);
                ctx.lineTo(x, y);

                // 如果接近首点，则闭合并填充提示
                if (polygonPoints.length > 2 && distance([x, y], polygonPoints[0]) < closeThreshold) {
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(100,200,255,0.2)';
                    ctx.fill();
                }

                ctx.strokeStyle = '#007bff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            ctx.restore();

        } else if (um.currentMode === 'cut' && isCutting && polylinePoints.length > 0) {
            const ctx = canvas.getContext('2d');
            ctx.save();
            // 重新施加缩放和平移
            ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr * scale, offsetY * dpr * scale);

            // 原有切割线绘制逻辑
            ctx.beginPath();
            ctx.moveTo(polylinePoints[0][0], polylinePoints[0][1]);
            for (let i = 1; i < polylinePoints.length; i++) {
                ctx.lineTo(polylinePoints[i][0], polylinePoints[i][1]);
            }
            // 动态连线到当前鼠标位置
            const x = snapToGrid(pos.x);
            const y = snapToGrid(pos.y);
            ctx.lineTo(x, y);

            ctx.strokeStyle = '#ff4d4f';   // 红色
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);       // 虚线
            ctx.stroke();
            ctx.setLineDash([]);           // 恢复实线

            ctx.restore();
        }
    });

    canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        const zoomIntensity = 0.1;
        if (e.deltaY < 0) {
            scale *= (1 + zoomIntensity);
        } else {
            scale *= (1 - zoomIntensity);
        }
        scale = Math.max(0.2, Math.min(scale, 5));
        syncZoomPercent();
        drawCanvas();
    }, { passive: false });

    um.clearDrawings = function () {
        rects = [];
        polygonPoints = [];
        isDrawing = false;
        drawCanvas();
    };

    um.selectUnit = function (unit) {
        um.selectedUnit = unit;
        console.log(um.selectedUnit.status);
        const modal = new bootstrap.Modal(document.getElementById('unitDetailModal'));
        modal.show();
    };

    um.toggleEdit = function () {
        if (!um.editMode) {
            // 进入编辑模式时做一次字段类型转换
            const keysToConvert = [
                'build_area',
                'usable_area',
                'lease_area',
                'efficiency_rate',
                'rent_unit_price',
                'rent_total_price',
                'management_fee_per_sqm'
            ];
            keysToConvert.forEach(function (key) {
                if (um.selectedUnit[key] != null) {
                    um.selectedUnit[key] = parseFloat(um.selectedUnit[key]);
                }
            });
        }
        um.editMode = !um.editMode;
    };

    um.openMergeModal = function () {
        um.unitMergeAttrModal.show();
        var selectedUnits = um.units.filter(function (unit) {
            return unit.selected;
        });
        selectedUnits.map(unit => selectedUnitIds.push(unit.id));
        um.calculateMergedUnitAttributes();
        console.log(selectedUnitIds);
    }

    um.confirmMerge = function () {
        var selectedUnits = um.units.filter(function (unit) {
            return unit.selected;
        });
        mergedUnit = {
            child_unit_ids: selectedUnits.map(function (unit) { return unit.id; }),
            code: um.mergedUnit.code,
            lease_area: um.mergedUnit.lease_area,
            efficiency_rate: um.mergedUnit.efficiency_rate,
            management_fee_per_sqm: um.mergedUnit.management_fee,
            rent_unit_price: um.mergedUnit.rent_price,
            remarks: um.mergedUnit.remarks,
            orientation: um.mergedUnit.orientation,
            layout: um.mergedUnit.layout,
            features: um.mergedUnit.features,
            area_type: '合同出租',
            rect_parts: um.newUnit.rect_parts
        }
        console.log(mergedUnit);
        $http.post('/api/merge-unit', mergedUnit)
            .then(function (response) {
                alert('单元合并成功');
                um.unitMergeAttrModal.hide();
                um.loadUnits();
            })
            .catch(function (error) {
                alert('合并失败:' + JSON.stringify(error.data.message));
            });
    };

    let suppressMouse = false;
    um.setMode = function (mode) {
        suppressMouse = true;
        switchMode(mode);
        const modeNames = {
            draw: '绘图模式',
            select: '选择模式',
            cut: '切割模式'
        };
        const body = document.getElementById("modeToastBody");
        if (body) body.textContent = `当前模式：${modeNames[mode] || mode}`;
        const toastEl = document.getElementById("modeToast");
        if (toastEl) {
            const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
            toast.show();
        }
        setTimeout(() => suppressMouse = false, 100);
    };

    um.zoomPercent = 100;

    // 监听输入变化，更新全局scale和画布
    um.onZoomChange = function () {
        let val = Number($scope.zoomPercent);
        if (isNaN(val)) val = 100;
        val = Math.min(Math.max(val, 10), 500); // 限制最小10%，最大500%
        um.zoomPercent = val;

        scale = val / 100;  // 更新缩放比例

        drawCanvas();       // 重新绘制画布
    };

    // 如果你外部改变了scale，要同步更新输入框：
    function syncZoomPercent() {
        $scope.$applyAsync(() => {
            um.zoomPercent = Math.round(scale * 100);
        });
    }

    um.saveSubunits = function () {
        if (!um.childUnits || um.childUnits.length !== 2) {
            alert('请填写两个子单元的信息');
            return;
        }

        // 构造 payload
        const payload = {
            unit_id: um.cutUnitId,
            polyline: polylinePoints || [],
            childrenMeta: um.childUnits
        };

        $http.post('/api/split-subunit', payload).then(function (response) {
            alert('分割完成');
            const modalEl = document.getElementById('childUnitModal');
            const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl, {
                backdrop: 'static',
                keyboard: false
            });
            bsModal.hide();
            um.loadUnits();
        }).catch(function (error) {
            console.error('提交出错', error);
            alert(error.data.message);
        });
    };

    um.onUnitToggle = function (unit) {
        const idx = selectedUnitIds.indexOf(unit.id);
        if (unit.selected) {
            if (idx === -1) selectedUnitIds.push(unit.id);
        } else {
            if (idx !== -1) selectedUnitIds.splice(idx, 1);
        }
        console.log('当前选中单元 IDs：', selectedUnitIds);
        drawCanvas();
    };

    um.cancelSplit = function () {
        // 1. 隐藏 Bootstrap Modal
        const modalEl = document.getElementById('childUnitModal');
        const bsModal = bootstrap.Modal.getInstance(modalEl);
        if (bsModal) {
            bsModal.hide();
        }

        // 2. 重置分割相关的数据
        um.cutUnit = null;
        um.cutUnitId = null;
        um.childUnits = [];

        if (typeof um.showChildModal !== 'undefined') {
            um.showChildModal = false;
        }
    };

    um.calculateMergedUnitAttributes = function () {
        const selectedUnits = um.units.filter(u => u.selected);
        um.mergedUnit = um.mergedUnit || {};
        um.mergedUnit.usable_area = selectedUnits.reduce(
            (sum, u) => sum + (parseFloat(u.usable_area) || 0),
            0
        );
    };

    um.getSplitSummary = function () {
        const total = {
            usable_area: 0,
            lease_area: 0,
            rent: 0,
            fee: 0,
            total: 0,
            efficiency: 0
        };
        try {
            um.childUnits.forEach(unit => {
                const usable = parseFloat(unit.usable_area) || 0;
                const lease = parseFloat(unit.lease_area) || 0;
                const rentPrice = parseFloat(unit.rent_unit_price) || 0;
                const mgmtFee = parseFloat(unit.management_fee) || 0;

                total.usable_area += usable;
                total.lease_area += lease;
                total.rent += lease * rentPrice;
                total.fee += lease * mgmtFee;
            });
        } catch { }
        total.total = total.rent + total.fee;
        total.efficiency = total.lease_area ? (total.usable_area / total.lease_area) * 100 : 0;
        return total;
    };

    um.updateAspectRatios = function () {
        const floorId = um.selectedFloor?.id;
        if (!floorId) {
            console.warn('未选中楼层，无法更新比率');
            return;
        }

        const data = {
            aspect_ratio: um.ratioForm.aspect_ratio,
            core_ratio: um.ratioForm.core_ratio
        };

        $http.patch(`/api/floors/${floorId}/ratios`, data)
            .then(function (res) {
                // 更新本地缓存值
                um.selectedFloor.aspectRatioBuild = data.aspect_ratio;
                um.selectedFloor.aspectRatioCore = data.core_ratio;
                um.ratioForm.aspect_ratio = +data.aspect_ratio;
                um.ratioForm.core_ratio = +data.core_ratio;
                drawCanvas();
            })
            .catch(function (err) {
                console.error('更新楼层比率失败:', err);
            });
    };

    um.saveUnitNewAttr = function () {
        if (!um.selectedUnit) {
            alert("未选中任何单元");
            return;
        }
        const unit = um.selectedUnit;
        const payload = {
            id: unit.id,
            status: unit.status,
            rent_unit_price: unit.rent_unit_price,
            management_fee_per_sqm: unit.management_fee_per_sqm,
            orientation: unit.orientation,
            layout: unit.layout,
            features: unit.features,
            remarks: unit.remarks,
            lease_area: unit.lease_area
        };

        $http.post("/api/update-unit", payload).then(
            function (res) {
                alert("更新成功");
                um.loadUnits();
                um.unitAttrModal.hide();
            },
            function (err) {
                console.error("更新失败", err);
                alert("更新失败：" + (err.data?.message || "未知错误"));
            }
        );
    };

    um.$onInit = function () {
        um.loadBuildingCards();
    };

    um.loadFloorStats = function (floor) {
        const buildingId = um.selectedBuilding?.id;
        const floorLevel = floor?.level;

        if (!buildingId || !floorLevel) return;

        $http.get('/api/lease-stats?building_id=' + buildingId + '&floor=' + floorLevel)
            .then(function (res) {
                const stat = res.data?.[0] || {};
                floor.rented_area = parseFloat(stat.leased_area || 0);
                floor.rented_units = stat.leased_units || 0;
                floor.vacant_area = parseFloat(stat.vacant_area || 0);
                floor.vacant_units = stat.vacant_units || 0;
                const total = floor.rented_area + floor.vacant_area;
                floor.occupancy_rate = total > 0 ? (floor.rented_area / total) * 100 : 0;
            })
            .catch(function (err) {
                console.error('楼层租赁统计获取失败:', err);
            });
    };

    um.viewContractTimeline = function (unit) {
        um.currentUnit = unit;
        um.timelineContracts = (unit.contracts || []).slice().sort(function (a, b) {
            return new Date(a.start_date) - new Date(b.start_date);
        });

        // 原生 Bootstrap 方式
        const modalEl = document.getElementById('contractTimelineModal');
        const modal = new bootstrap.Modal(modalEl, { backdrop: 'static' });
        modal.show();
    };

    um.viewContract = function (contractId) {
        if (!contractId) return;

        // 使用 Bootstrap Modal API 关闭模态
        const modalEl = document.getElementById('contractTimelineModal');
        if (modalEl) {
            const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modalInstance.hide();
        }

        // AngularJS 内安全跳转
        const $injector = angular.element(document.body).injector();
        const $location = $injector.get('$location');
        const $timeout = $injector.get('$timeout');

        $timeout(function () {
            $location.path('/contract_detail/' + contractId);
        });
    };
}]);

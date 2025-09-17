// canvasUtils.js
// 通用画布工具函数与主绘制逻辑

const GRID_SIZE = 20;
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let dpr = window.devicePixelRatio || 1;

/**
 * 将值吸附到网格
 */
export function snapToGrid(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * 将鼠标事件坐标转换为画布上的逻辑坐标
 */
export function getCanvasCoords(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const pixelX = (event.clientX - rect.left) * (canvas.width / rect.width);
    const pixelY = (event.clientY - rect.top) * (canvas.height / rect.height);
    const logicalX = pixelX / (dpr * scale) - offsetX;
    const logicalY = pixelY / (dpr * scale) - offsetY;
    return { x: logicalX, y: logicalY };
}

/**
 * 根据设计尺寸和设备像素比调整画布物理与显示大小
 */
export function resizeCanvasToDisplaySize(canvas, width, height) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
}

/**
 * 应用当前缩放与偏移变换到 2D 上下文
 */
export function applyTransform(ctx) {
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, offsetX * dpr * scale, offsetY * dpr * scale);
}

/**
 * 更新全局缩放与偏移参数
 */
export function updateTransform(newScale, newOffsetX, newOffsetY) {
    scale = newScale;
    offsetX = newOffsetX;
    offsetY = newOffsetY;
}

/**
 * 主绘制入口
 * @param {HTMLCanvasElement} canvas
 * @param {number|null} hoveredUnitId
 */
export function drawCanvas(canvas, um, hoveredUnitId = null) {
    if (!canvas || !um.selectedFloor) return;

    // 1. 计算并设置画布尺寸
    const { width, height } = computeCanvasSize(um.selectedFloor);
    resizeCanvasToDisplaySize(canvas, width, height);

    // 2. 获取上下文并应用变换
    const ctx = canvas.getContext('2d');
    applyTransform(ctx);

    // 3. 背景、网格、公摊区域
    clearAndDrawBackground(ctx, width, height);
    drawGrid(ctx, width, height);
    drawCoreArea(ctx, um.selectedFloor, width, height);

    // 4. 单元与标签绘制
    um.units.forEach(unit => drawUnit(ctx, unit, hoveredUnitId));
    const labels = um.units.map(u => computeLabel(ctx, u));
    adjustLabelPositions(labels);
    labels.forEach(lbl => drawLabel(ctx, lbl));

    // 5. 草图／切割 预览
    if (um.currentMode === 'draw') drawSketchPreview(ctx);
    else if (um.currentMode === 'cut' && isCutting) drawCutPreview(ctx);

    // 6. 罗盘
    drawCompass(ctx, width);
}

// —— 以下为私有辅助函数，不导出 ——

function computeCanvasSize({ build_area, usable_area, aspectRatioBuild = 2 }) {
    const PIXELS_PER_SQM = 400;
    const area = build_area || 100;
    const totalPx = area * PIXELS_PER_SQM;
    const w = Math.sqrt(totalPx * aspectRatioBuild);
    const h = Math.sqrt(totalPx / aspectRatioBuild);
    return { width: w, height: h };
}

function clearAndDrawBackground(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f9f9f9'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.strokeRect(0, 0, w, h);
}

function drawGrid(ctx, w, h) {
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.7;
    for (let y = GRID_SIZE; y < h; y += GRID_SIZE) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let x = GRID_SIZE; x < w; x += GRID_SIZE) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    ctx.restore();
}

function drawCoreArea(ctx, floor, w, h) {
    const build = floor.build_area || 100;
    const usable = floor.usable_area || 80;
    const ratio = usable / build;
    const coreRatio = 1 - ratio;
    if (coreRatio <= 0.01) return;
    const PIXELS_PER_SQM = 400;
    const areaPx = build * coreRatio * PIXELS_PER_SQM;
    const aspect = floor.aspectRatioCore || 3;
    const cw = Math.sqrt(areaPx * aspect);
    const ch = Math.sqrt(areaPx / aspect);
    const cx = snapToGrid((w - cw) / 2);
    const cy = snapToGrid((h - ch) / 2);

    ctx.save();
    ctx.fillStyle = 'rgba(150,150,150,0.2)';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1; ctx.strokeRect(cx, cy, cw, ch);
    ctx.fillStyle = '#444'; ctx.font = `${16 * dpr}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('公摊面积(此区域禁止作图)≈', cx + cw / 2, cy + ch / 2 - 12 * dpr);
    ctx.font = `${12 * dpr}px sans-serif`;
    ctx.fillText(`${(build * coreRatio).toFixed(1)}㎡`, cx + cw / 2, cy + ch / 2 + 12 * dpr);
    ctx.restore();
}

function drawUnit(ctx, unit, hoveredId) {
    const path = buildUnitPath(unit);
    const hover = hoveredId === unit.id;
    const selected = selectedUnitIds.includes(unit.id);
    let color = getStatusColor(unit.status);
    if (hover || selected) color = 'rgba(255,140,0,1)';

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.1)'; ctx.shadowBlur = 4;
    ctx.fillStyle = color; ctx.fill(path);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 1.2; ctx.stroke(path);
    ctx.restore();
}

function buildUnitPath(unit) {
    const p = new Path2D();
    if (unit.rect_parts && unit.rect_parts.length >= 3) {
        p.moveTo(...unit.rect_parts[0]);
        unit.rect_parts.slice(1).forEach(pt => p.lineTo(...pt));
        p.closePath();
    } else {
        p.rect(unit.pos_x, unit.pos_y, unit.width, unit.height);
    }
    return p;
}

function getStatusColor(status) {
    if (['vacant', '空置'].includes(status)) return 'rgba(173,223,191,0.8)';
    if (['leased', '已出租'].includes(status)) return 'rgba(178,190,206,0.8)';
    if (['reserved', '已预定'].includes(status)) return 'rgba(250,214,165,0.8)';
    return 'rgba(255,100,126,1)';
}

function computeLabel(ctx, unit) {
    const labelText = $filter('unitStatusLabel')(unit.status);
    const lines = [unit.code || '--', `状态:${labelText}`];
    let x, y;
    if (unit.rect_parts) {
        const cent = calculateCentroid(unit.rect_parts);
        x = cent.x; y = cent.y;
    } else {
        x = unit.pos_x + unit.width / 2;
        y = unit.pos_y + unit.height / 2;
    }
    ctx.save(); ctx.font = `bold ${10 * dpr}px Arial`;
    const metrics = lines.map(l => ctx.measureText(l).width);
    ctx.restore();
    return { x, y, lines, width: Math.max(...metrics) + 20, height: lines.length * 20, offsetX: 0, offsetY: 0 };
}

function adjustLabelPositions(labels) {
    const overlap = (a, b) => !(a.x + a.offsetX + a.width / 2 < b.x + b.offsetX - b.width / 2 ||
        a.x + a.offsetX - a.width / 2 > b.x + b.offsetX + b.width / 2 ||
        a.y + a.offsetY + a.height / 2 < b.y + b.offsetY - b.height / 2 ||
        a.y + a.offsetY - a.height / 2 > b.y + b.offsetY + b.height / 2);
    const step = 5, maxIter = 10;
    for (let it = 0; it < maxIter; it++) {
        let moved = false;
        for (let i = 0; i < labels.length; i++) {
            for (let j = i + 1; j < labels.length; j++) {
                if (overlap(labels[i], labels[j])) {
                    moved = true;
                    if (labels[i].y <= labels[j].y) { labels[i].offsetY -= step; labels[j].offsetY += step; }
                    else { labels[i].offsetY += step; labels[j].offsetY -= step; }
                }
            }
        }
        if (!moved) break;
    }
}

function drawLabel(ctx, lbl) {
    const { x, y, lines, width, height, offsetX, offsetY } = lbl;
    ctx.save();
    ctx.translate(x + offsetX, y + offsetY);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.strokeStyle = '#666';
    ctx.font = `bold ${10 * dpr}px Arial`;
    ctx.beginPath(); ctx.roundRect(-width / 2, -height / 2, width, height, 4);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * 20));
    ctx.restore();
}

function drawSketchPreview(ctx) {
    ctx.save(); applyTransform(ctx);
    rects.forEach(r => {
        if (r.points.length < 3) return;
        ctx.beginPath(); ctx.moveTo(...r.points[0]);
        r.points.slice(1).forEach(pt => ctx.lineTo(...pt));
        ctx.closePath();
        ctx.fillStyle = 'rgba(100,200,255,0.3)'; ctx.strokeStyle = '#007bff'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 2]); ctx.fill(); ctx.stroke();
    });
    ctx.restore();
}

function drawCutPreview(ctx) {
    if (!polylinePoints.length) return;
    ctx.save(); applyTransform(ctx);
    ctx.beginPath(); ctx.moveTo(...polylinePoints[0]);
    polylinePoints.slice(1).forEach(pt => ctx.lineTo(...pt));
    const lastEventPoint = lastEvent ? getCanvasCoords(lastEvent, canvas) : null;
    if (lastEventPoint) {
        ctx.lineTo(snapToGrid(lastEventPoint.x), snapToGrid(lastEventPoint.y));
    }
    ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function calculateCentroid(points) {
    const sum = points.reduce((acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}

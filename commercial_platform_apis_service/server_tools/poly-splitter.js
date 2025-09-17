class PolygonSplitter {
  /**
   * 使用折线切割多边形
   */
  static split(polygon, polyline) {
    this._validateInput(polygon, polyline);
    const closedPoly = this._closePolygon(polygon);

    // 1. 点–多边形关系判定
    const status = polyline.map(pt => this._pointInPolygon(pt, closedPoly));

    // 2. 找进出
    const passes = [];
    if (status[0] >= 0) passes.push({ type: 'in', idx: 0, pt: polyline[0] });
    for (let i = 0; i < status.length - 1; i++) {
      if (status[i] < 0 && status[i + 1] >= 0) passes.push({ type: 'in', idx: i + 1, pt: this._interpPoint(polyline[i], polyline[i + 1], closedPoly) });
      if (status[i] >= 0 && status[i + 1] < 0) passes.push({ type: 'out', idx: i, pt: this._interpPoint(polyline[i], polyline[i + 1], closedPoly) });
    }
    const last = status.length - 1;
    if (status[last] >= 0) passes.push({ type: 'out', idx: last, pt: polyline[last] });
    if (passes.length < 2) return [closedPoly];

    const pin = passes.find(p => p.type === 'in');
    const pout = passes.reverse().find(p => p.type === 'out');

    // 3. 构造内部路径并去重
    let inner = [pin.pt];
    for (let k = pin.idx; k <= pout.idx; k++) if (status[k] >= 0) inner.push(polyline[k]);
    inner.push(pout.pt);
    inner = inner.filter((pt, i, arr) => {
      return arr.findIndex(p => PolygonSplitter._approxEqual(p, pt)) === i;
    });
    // 4. 插入点
    const { poly: p2, i0, i1 } = this._insertPoints(closedPoly, pin.pt, pout.pt);

    // 5. 拼接子多边形 A
    const A = [...inner];
    for (let k = i1; ; k = (k + 1) % p2.length) {
      const pt = p2[k];
      if (!this._approxEqual(pt, A[A.length - 1])) A.push(pt);
      if (k === i0) break;
    }

    // 拼接子多边形 B
    const B = [];
    for (let k = i0; ; k = (k + 1) % p2.length) {
      const pt = p2[k];
      if (B.length === 0 || !this._approxEqual(pt, B[B.length - 1])) B.push(pt);
      if (k === i1) break;
    }
    for (let i = inner.length - 1; i >= 0; i--) {
      const pt = inner[i];
      if (B.length === 0 || !this._approxEqual(pt, B[B.length - 1])) B.push(pt);
    }

    return [this._closePolygon(A), this._closePolygon(B)];
  }

  static _validateInput(poly, cutter) {
    if (poly.length < 4 || !this._approxEqual(poly[0], poly[poly.length - 1])) throw new Error('多边形必须闭合');
    if (cutter.length < 2) throw new Error('切割线至少2点');
  }
  static _approxEqual(a, b, eps = 1e-6) {
    if (!a || !b) return false;
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < eps;
  }
  static _closePolygon(p) {
    if (p.length === 0) return [];
    return this._approxEqual(p[0], p[p.length - 1]) ? p.slice() : [...p, [p[0][0], p[0][1]]];
  }
  static _pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (this._pointOnSegment(pt, poly[j], poly[i])) return 0;
      const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside ? 1 : -1;
  }
  static _pointOnSegment(p, a, b, eps = 1e-6) {
    const cross = (p[1] - a[1]) * (b[0] - a[0]) - (p[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(cross) > eps) return false;
    const dot = (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]);
    if (dot < -eps) return false;
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    return dot <= len2 + eps;
  }
  static _lineIntersection(A, B, C, D) {
    const denom = (B[0] - A[0]) * (D[1] - C[1]) - (B[1] - A[1]) * (D[0] - C[0]);
    if (Math.abs(denom) < 1e-9) return null;

    const tNum = (A[1] - C[1]) * (D[0] - C[0]) - (A[0] - C[0]) * (D[1] - C[1]);
    const uNum = (A[1] - C[1]) * (B[0] - A[0]) - (A[0] - C[0]) * (B[1] - A[1]);
    const t = tNum / denom;
    const u = uNum / denom;

    const eps = 1e-6;
    if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
      return [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])];
    }
    return null;
  }

  static _interpPoint(A, B, poly) {
    for (let i = 0; i < poly.length - 1; i++) {
      const pt = this._lineIntersection(A, B, poly[i], poly[i + 1]);
      if (pt) return pt;
    }
    return A;
  }
  static _insertPoints(poly, pin, pout) {
    const newPoly = [];
    let i0 = -1, i1 = -1;
    const n = poly.length - 1;

    // 1. 先看 pin/pout 是否正好等于已有顶点
    for (let i = 0; i < n; i++) {
      if (this._approxEqual(poly[i], pin)) i0 = i;
      if (this._approxEqual(poly[i], pout)) i1 = i;
    }

    // 2. 构造新顶点数组，同时插入 pin/pout 到它们所属的边段上
    for (let i = 0; i < n; i++) {
      const A = poly[i], B = poly[i + 1];
      newPoly.push(A);

      // 只有当 pin 不等于已有顶点时，才尝试插到边上
      if (i0 < 0 && this._pointOnSegment(pin, A, B)) {
        newPoly.push(pin);
        i0 = newPoly.length - 1;
      }
      if (i1 < 0 && this._pointOnSegment(pout, A, B)) {
        newPoly.push(pout);
        i1 = newPoly.length - 1;
      }
    }

    newPoly.push(newPoly[0]);

    // 3. 如果依然没有找到 i0 或 i1，抛错提示：  
    //    这样可以快速定位是点没插到多边形上
    if (i0 < 0 || i1 < 0) {
      throw new Error(`切割点 (${i0 < 0 ? 'pin' : 'pout'}) 未能在多边形边界找到合适位置`);
    }

    return { poly: newPoly, i0, i1 };
  }

}

module.exports = PolygonSplitter;

/**
 * 计算单个单元的实时空置天数（历史累计 + 当前增量）
 * @param {object} unit 
 *   - unit.vacant_duration 已累计空置天数（天，整数）
 *   - unit.vacant_since    上次进入空置的时间（Date 或 可 new Date() 的字符串）
 *   - unit.status          当前状态
 * @param {Date} [now=new Date()]
 * @returns {number} totalVacantDays
 */
function computeTotalVacantDays(unit, now = new Date()) {
    let live = 0;
    if (unit.status === 'vacant' && unit.vacant_since) {
        const start = unit.vacant_since instanceof Date
            ? unit.vacant_since
            : new Date(unit.vacant_since.replace(' ', 'T') + '+08:00');
        const deltaMs = now - start;
        live = Math.floor(deltaMs / (1000 * 60 * 60 * 24));
    }
    return (unit.vacant_duration || 0) + live;
}

/**
 * 批量增强：给每个 unit 对象增加 total_vacant_days 字段
 * @param {Array<object>} units 
 * @param {Date} [now=new Date()]
 * @returns {Array<object>}
 */
function enrichUnitsWithVacantDays(units, now = new Date()) {
    return units.map(u => ({
        ...u,
        total_vacant_days: computeTotalVacantDays(u, now)
    }));
}

exports.enrichUnitsWithVacantDays = enrichUnitsWithVacantDays;
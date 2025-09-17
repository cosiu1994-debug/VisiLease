// common-utils.js

/**
 * 深度格式化数据中的 Date 类型字段，转换成格式化字符串（yyyy-MM-dd hh:mm:ss）
 * @param {any} data - 可能是对象、数组、或其它类型
 * @returns {any} 递归格式化后的数据副本
 */
function formatDateFieldsDeep(data) {
  if (Array.isArray(data)) {
    return data.map(item => formatDateFieldsDeep(item));
  }

  if (typeof data === 'object' && data !== null) {
    const result = {};
    for (const key in data) {
      const val = data[key];
      if (val instanceof Date) {
        result[key] = val.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
      } else if (typeof val === 'object') {
        result[key] = formatDateFieldsDeep(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  return data;
}

/**
 * 更新指定楼栋某楼层的剩余可用面积：
 * 计算该楼层所有“整层单元”的 usable_area 总和，减去其直接子单元的 usable_area 总和，
 * 更新 floors 表中的 remaining_usable_area 字段。
 * 
 * @param {import('mysql2/promise').PoolConnection} connection - 数据库连接
 * @param {number|string} building_id - 楼栋ID
 * @param {number|string} level - 楼层
 */
async function updateFloorRemainingArea(connection, building_id, level) {
  const [totalRows] = await connection.execute(
    `SELECT COALESCE(SUM(usable_area), 0) AS total_area
     FROM units
     WHERE building_id = ? AND floor = ? AND parent_unit_id IS NULL AND is_deleted = 0`,
    [building_id, level]
  );
  const total_area = parseFloat(totalRows[0].total_area || 0);

  const [usedRows] = await connection.execute(
    `SELECT COALESCE(SUM(usable_area), 0) AS used_area
     FROM units
     WHERE building_id = ? AND floor = ? AND parent_unit_id IS NOT NULL AND is_deleted = 0`,
    [building_id, level]
  );
  const used_area = parseFloat(usedRows[0].used_area || 0);

  const remaining_area = Math.max(total_area - used_area, 0);

  await connection.execute(
    `UPDATE floors SET remaining_usable_area = ? 
     WHERE building_id = ? AND level = ?`,
    [remaining_area, building_id, level]
  );
}

/**
 * 递增规则解析函数
 * @param {string | Date} segmentStartDate - 当前周期起始日期
 * @param {Array} increaseRules - 递增规则数组，每条规则包含type和时间属性
 * @returns {Object|null} 匹配到的递增规则对象，没匹配到返回null
 */
function getIncreaseRuleForSegment(segmentStartDate, increaseRules = []) {
  const segmentDate = new Date(segmentStartDate);

  for (const rule of increaseRules) {
    if (rule.type === 'POINT') {
      const effectiveDate = new Date(rule.effectiveDate);
      if (segmentDate >= effectiveDate) {
        return rule;
      }
    }

    if (rule.type === 'ANNIVERSARY') {
      const anchorDate = new Date(rule.anchorDate);
      const yearsDiff = segmentDate.getFullYear() - anchorDate.getFullYear();
      const anniversaryDate = new Date(anchorDate);
      anniversaryDate.setFullYear(anchorDate.getFullYear() + yearsDiff);
      if (segmentDate >= anniversaryDate) {
        return rule;
      }
    }
  }

  return null;
}

module.exports = {
  formatDateFieldsDeep,
  updateFloorRemainingArea,
  getIncreaseRuleForSegment
};

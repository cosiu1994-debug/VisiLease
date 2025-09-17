const db = require("../db_tools/db"); // 导入连接池

/**
 * 查询符合条件的单元，并分别计算已租与空置单元的总价
 * @param {Object} filters - 过滤条件
 * @param {number} [filters.buildingId] - 楼栋ID
 * @param {number} [filters.floorLevel] - 楼层level
 * @param {number} [filters.unitId] - 单元ID
 * @param {boolean} includeManagementFee - 是否计算含管理费总价
 * @returns {Promise<{ leasedTotal: number, vacantTotal: number }>} - 计算得到的总价
 */
async function calculatePrice(filters = {}, includeManagementFee = false) {
  const where = ['u.is_deleted = 0'];
  const params = [];

  let joinFloor = false;

  if (filters.buildingId) {
    where.push('u.building_id = ?');
    params.push(filters.buildingId);
  }

  if (filters.floorLevel !== undefined) {
    joinFloor = true;
    where.push('f.level = ?');
    params.push(filters.floorLevel);
  }

  if (filters.unitId) {
    where.push('u.id = ?');
    params.push(filters.unitId);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const joinClause = joinFloor ? 'INNER JOIN floors f ON u.floor_id = f.id' : '';

  const priceExpr = includeManagementFee
    ? '(IFNULL(u.rent_unit_price, 0) + IFNULL(u.management_fee_per_sqm, 0)) * IFNULL(u.lease_area, 0)'
    : 'IFNULL(u.rent_unit_price, 0) * IFNULL(u.lease_area, 0)';

  const sql = `
    SELECT 
      SUM(CASE WHEN u.status = 'leased' THEN ${priceExpr} ELSE 0 END) AS leasedTotal,
      SUM(CASE WHEN u.status = 'vacant' THEN ${priceExpr} ELSE 0 END) AS vacantTotal
    FROM units u
    ${joinClause}
    ${whereClause}
  `;

  const [rows] = await db.execute(sql, params);

  return {
    leasedTotal: rows[0].leasedTotal || 0,
    vacantTotal: rows[0].vacantTotal || 0,
  };
}

module.exports = {
  calculatePrice,
};

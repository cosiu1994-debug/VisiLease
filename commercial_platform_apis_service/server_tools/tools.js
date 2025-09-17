async function updateFloorRemainingArea(connection, building_id, floor) {
    const [rows] = await connection.execute(
        `SELECT COALESCE(SUM(usable_area), 0) AS remaining_area
       FROM units
       WHERE building_id = ? AND floor = ? AND status = 'vacant' AND is_deleted = 0`,
        [building_id, floor]
    );

    const remaining_area = rows[0].remaining_area;

    await connection.execute(
        `UPDATE floors
       SET remaining_area = ?
       WHERE building_id = ? AND floor = ?`,
        [remaining_area, building_id, floor]
    );
}


exports.updateFloorRemainingArea = updateFloorRemainingArea;
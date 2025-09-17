const MQClient = require('./mq_client');
const mysql = require('mysql2/promise');

const CHANNEL = 'contract_unit_sync';
const redisUrl = '';

const dbConfig = {
    host: '',
    user: '',
    password: '',
    database: 'commercialplatformdb',
};

class UnitSyncService {
    constructor() {
        this.mq = new MQClient(redisUrl);
        this.pool = mysql.createPool(dbConfig);
    }

    /** 初始化：连接 MQ 并监听消息 */
    async init() {
        await this.mq.connect();
        await this.mq.consume(CHANNEL, async (msg) => {
            try {
                console.log('[UnitSyncService] Received message:', msg);

                if (msg.action === 'statusChange') {
                    await this.syncUnitStatus(msg.contractId, msg.newStatus);
                } else if (msg.action === 'delete') {
                    await this.handleContractDelete(msg.contractId, msg.unitIds);
                }
            } catch (err) {
                console.error('[UnitSyncService] message handling failed:', err);
            }
        });
    }

    /** 发布合同状态变化 */
    async publishChange(contractId, newStatus) {
        await this.mq.publish(CHANNEL, {
            action: 'statusChange',
            contractId,
            newStatus,
        });
        console.log(`[UnitSyncService] Published status change for contract ${contractId}: ${newStatus}`);
    }

    /** 发布合同删除事件，携带 unitIds */
    async publishDelete(contractId, unitIds = []) {
        await this.mq.publish(CHANNEL, {
            action: 'delete',
            contractId,
            unitIds  // 一定要带上 unitIds
        });
        console.log(`[UnitSyncService] Published delete for contract ${contractId}, units:`, unitIds);
    }

    /** 根据合同状态更新已绑定的单元状态 */
    async syncUnitStatus(contractId, contractStatus) {
        const statusMap = {
            draft: 'reserved',
            approve_pending: 'reserved',
            rejected: 'reserved',
            active: 'leased',
            terminated: 'vacant',
            expired: 'vacant',
        };

        const newUnitStatus = statusMap[contractStatus];
        if (!newUnitStatus) {
            console.warn(`[UnitSyncService] Unknown contract status: ${contractStatus}`);
            return;
        }

        const [rows] = await this.pool.query(
            'SELECT unit_id FROM contract_units WHERE contract_id = ?',
            [contractId]
        );
        const unitIds = rows.map(r => r.unit_id);

        if (unitIds.length) {
            await this.pool.query(
                `UPDATE units SET status = ? WHERE id IN (${unitIds.map(() => '?').join(',')})`,
                [newUnitStatus, ...unitIds]
            );
            console.log(`[UnitSyncService] Updated ${unitIds.length} units to ${newUnitStatus}`);
        } else {
            console.warn(`[UnitSyncService] No units found for contract ${contractId}`);
        }
    }

    /** 处理合同删除事件，将对应单元置为 vacant */
    async handleContractDelete(contractId, unitIds = []) {
        if (!unitIds.length) {
            console.warn(`[UnitSyncService] No units bound to contract ${contractId}`);
            return;
        }

        // 直接更新单元状态，不再依赖 contract_units
        await this.pool.query(
            `UPDATE units SET status = 'vacant' WHERE id IN (${unitIds.map(() => '?').join(',')})`,
            unitIds
        );

        console.log(`[UnitSyncService] Deleted contract ${contractId}, units set to vacant:`, unitIds);
    }
}

module.exports = new UnitSyncService();

/**
 * Contract Term Splitter with Area, Fee Calculations, and Month Equivalents (Node.js)
 *
 * 在原有按自然月拆分 + 递增 + 免租 功能基础上，新增：
 * 1. contract.area 参数：租赁面积（㎡）
 * 2. 对每个 TermSegment 区间，计算“总租金”和“总管理费”
 * 3. 新增 monthEquivalent 字段：表示当前区间等效的月数，按每月覆盖天数比例累加
 *
 * 示例：6.5–6.30 共 26 天，6 月有 30 天 → monthEquivalent = 26/30 ≈ 0.8667
 */

class ContractTermSplitter {
    /**
     * 拆分接口
     * @param {Object} contract 
     *  {
     *    startDate: 'YYYY-MM-DD',
     *    endDate: 'YYYY-MM-DD',
     *    baseRentRate: Number,   // 月租金基准单价（元/㎡·月）
     *    serviceRate: Number,    // 管理费单价（元/㎡·月）
     *    area: Number,           // 租赁面积（㎡）
     *    increaseRules: [        // 递增规则列表
     *      { type: 'ANNIVERSARY', rate: Number, anchorDate: 'YYYY-MM-DD' },
     *      { type: 'POINT', rate: Number, effectiveDate: 'YYYY-MM-DD' },
     *      ...
     *    ],
     *    freePeriods: [          // 免租期列表
     *      { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' },
     *      ...
     *    ],
     *    splitMode: 'NATURAL_MONTH' // 目前仅支持 NATURAL_MONTH
     *  }
     * @returns {Array<Object>} termSegments
     *  [
     *    {
     *      startDate: 'YYYY-MM-DD',
     *      endDate: 'YYYY-MM-DD',
     *      rentUnitRate: Number,         // 折算后的租金单价（含递增倍率）
     *      serviceRate: Number,          // 管理费单价
     *      isFreeRent: Boolean,          // 是否免租段
     *      appliedIncreaseRate: Number,  // 累计递增倍率
     *      remark: String,               // 最近一次递增事件备注
     *      monthEquivalent: Number,      // 等效月数，小数
     *      totalRent: Number,            // 本区间的租金总额（元）
     *      totalServiceFee: Number       // 本区间的管理费总额（元）
     *    },
     *    ...
     *  ]
     */
    static splitContractPeriods(contract) {
        // ——————————————————
        // 1. 参数校验
        // ——————————————————
        if (!contract || !contract.startDate || !contract.endDate) {
            throw new Error('合同起止日期必填');
        }
        const startDate = ContractTermSplitter._strToDate(contract.startDate);
        const endDate = ContractTermSplitter._strToDate(contract.endDate);
        if (startDate > endDate) {
            throw new Error('结束日期必须不早于起始日期');
        }
        if (contract.baseRentRate < 0 || contract.serviceRate < 0) {
            throw new Error('租金或管理费费率必须 >= 0');
        }
        if (typeof contract.area !== 'number' || contract.area <= 0) {
            throw new Error('面积 (area) 必须为正数');
        }

        // ——————————————————————————————
        // 2. 解析并合并 “免租期” (裁剪到合同内 & 合并重叠)
        // ——————————————————————————————
        let freePeriods = (contract.freePeriods || []).map(fp => ({
            start: ContractTermSplitter._strToDate(fp.startDate),
            end: ContractTermSplitter._strToDate(fp.endDate)
        }));
        freePeriods = ContractTermSplitter._mergeAndTrimFreePeriods(freePeriods, startDate, endDate);

        // ——————————————————————————————
        // 3. 解析并生成所有“递增事件”（含周年 & 打点）
        //    注：本版本把“周年日”视作当天不生效，新的费率从 anchorDate+1 开始生效。
        // ——————————————————————————————
        let anniversaryRule = null;
        const pointRules = [];
        for (let rule of (contract.increaseRules || [])) {
            if (rule.type === 'ANNIVERSARY') {
                anniversaryRule = {
                    rate: rule.rate,
                    anchorDate: ContractTermSplitter._strToDate(rule.anchorDate)
                };
            } else if (rule.type === 'POINT') {
                pointRules.push({
                    rate: rule.rate,
                    effectiveDate: ContractTermSplitter._strToDate(rule.effectiveDate)
                });
            }
        }

        // 3.1 先生成“周年递增”的所有生效日（实际生效点 = anchorDate + 1 天）
        const increaseEvents = [];
        if (anniversaryRule) {
            let dt = new Date(anniversaryRule.anchorDate);
            // 如果 anchorDate < contract.startDate，则推进到第一个不小于 startDate 的周年
            if (dt < startDate) {
                let yearOffset = startDate.getFullYear() - dt.getFullYear();
                let candidate = ContractTermSplitter._addYears(dt, yearOffset);
                if (candidate < startDate) {
                    candidate = ContractTermSplitter._addYears(candidate, 1);
                }
                dt = candidate;
            }
            // 循环直到不超过合同结束日
            while (dt <= endDate) {
                // “周年日当天”仍视为旧倍率，真正新倍率从 dt+1 生效
                const effectiveDay = ContractTermSplitter._addDays(dt, 1);
                if (effectiveDay <= endDate) {
                    increaseEvents.push({
                        date: effectiveDay,
                        rate: anniversaryRule.rate,
                        type: 'ANNIVERSARY'
                    });
                }
                dt = ContractTermSplitter._addYears(dt, 1);
            }
        }

        // 3.2 撑入所有“打点递增”事件（effectiveDate 本身视作当天就生效）
        for (let pr of pointRules) {
            if (pr.effectiveDate >= startDate && pr.effectiveDate <= endDate) {
                increaseEvents.push({
                    date: new Date(pr.effectiveDate),
                    rate: pr.rate,
                    type: 'POINT'
                });
            }
        }

        // 3.3 排序：按升序的“生效日”
        increaseEvents.sort((a, b) => a.date - b.date);

        // ——————————————————————————————————
        // 4. 生成所有“切点”（区间起始日）的集合
        //    主要包括：
        //    4.1 合同起始日
        //    4.2 自然月每个月的“第一天”
        //    4.3 免租期的 开始 & 结束+1
        //    4.4 所有“递增生效日”
        //    4.5 合同结束+1（哨兵）
        // ——————————————————————————————————
        const cutDatesSet = new Set();
        cutDatesSet.add(ContractTermSplitter._formatDate(startDate));

        // 4.2 “自然月”模式下，从合同起始所在月的下一个月第一天开始，一直枚举到不超过 endDate
        let tmp = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
        while (tmp <= endDate) {
            cutDatesSet.add(ContractTermSplitter._formatDate(tmp));
            tmp = new Date(tmp.getFullYear(), tmp.getMonth() + 1, 1);
        }

        // 4.3 免租期：每段的 start & (end + 1) 都视为切点
        for (let fp of freePeriods) {
            cutDatesSet.add(ContractTermSplitter._formatDate(fp.start));
            const dayAfterEnd = ContractTermSplitter._addDays(fp.end, 1);
            if (dayAfterEnd <= endDate) {
                cutDatesSet.add(ContractTermSplitter._formatDate(dayAfterEnd));
            }
        }

        // 4.4 递增生效日：直接把 increaseEvents[].date 加入
        for (let ev of increaseEvents) {
            cutDatesSet.add(ContractTermSplitter._formatDate(ev.date));
        }

        // 4.5 合同结束+1 视作哨兵
        const endPlusOne = ContractTermSplitter._addDays(endDate, 1);
        cutDatesSet.add(ContractTermSplitter._formatDate(endPlusOne));

        // ———————————————————————————
        // 5. 排序 & 去重 → 得到有序的 cutDates 数组
        // ———————————————————————————
        const cutDates = Array.from(cutDatesSet)
            .map(s => ContractTermSplitter._strToDate(s))
            .sort((a, b) => a - b);

        // ——————————————————————————————————————————————
        // 6. 按相邻切点生成“最细粒度”初步区间（左闭右开），并打上当期属性（不计算总额、月数）
        //    rawSegments 每一项：
        //    { startDate, endDate, rentUnitRate, serviceRate, isFreeRent, appliedIncreaseRate, remark }
        // ——————————————————————————————————————————————
        const rawSegments = [];
        for (let i = 0; i < cutDates.length - 1; i++) {
            const segStart = cutDates[i];
            let segEnd = ContractTermSplitter._addDays(cutDates[i + 1], -1);

            if (segStart > endDate) continue;
            if (segEnd > endDate) segEnd = new Date(endDate);

            // 6.1 判断是否整段都在“免租期”里
            const isFree = ContractTermSplitter._isInFreePeriod(segStart, freePeriods);

            // 6.2 计算“累积递增倍率” & 最近一次触发事件的备注
            //     注意：只对 ev.date <= segStart 的事件累计
            const { rate: appliedRate, remark } = ContractTermSplitter._calcAppliedIncreaseRate(segStart, increaseEvents);

            // 6.3 计算 rentUnitRate（若免租则 0，否则 = baseRentRate * appliedRate）
            const rentUnitRate = isFree
                ? 0
                : ContractTermSplitter._round(contract.baseRentRate * appliedRate, 4);

            rawSegments.push({
                startDate: ContractTermSplitter._formatDate(segStart),
                endDate: ContractTermSplitter._formatDate(segEnd),
                rentUnitRate,
                serviceRate: contract.serviceRate,
                isFreeRent: isFree,
                appliedIncreaseRate: appliedRate,
                remark
            });
        }

        // —————————————————————————————————————————————————
        // 7. 合并相邻、属性一致的区间 → 仅当两个区间都是完整自然月块时才合并
        //    完整自然月块条件：start.day == 1 && end.day == 当月最后一天
        // —————————————————————————————————————————————————
        const merged = [];
        for (let seg of rawSegments) {
            if (merged.length === 0) {
                merged.push(Object.assign({}, seg));
            } else {
                const last = merged[merged.length - 1];
                const sameProps =
                    last.isFreeRent === seg.isFreeRent &&
                    last.serviceRate === seg.serviceRate &&
                    last.appliedIncreaseRate === seg.appliedIncreaseRate &&
                    last.rentUnitRate === seg.rentUnitRate;

                if (sameProps &&
                    ContractTermSplitter._isFullNaturalMonth(last) &&
                    ContractTermSplitter._isFullNaturalMonth(seg)
                ) {
                    // 合并：延长 last.endDate
                    last.endDate = seg.endDate;
                } else {
                    merged.push(Object.assign({}, seg));
                }
            }
        }

        // —————————————————————————————————————————————————————————
        // 8. 最终结果：在 merged 基础上，计算每个区间的 monthEquivalent, totalRent 和 totalServiceFee
        //    monthEquivalent = 每个月份覆盖天数 / 当月天数 之和
        //    totalRent 和 totalServiceFee 如前逻辑
        // —————————————————————————————————————————————————————————
        const result = merged.map(seg => {
            const monthEq = ContractTermSplitter._computeMonthEquivalent(seg.startDate, seg.endDate);
            const roundedMonthEq = ContractTermSplitter._round(monthEq, 4);

            const total = ContractTermSplitter._computeSegmentTotals(
                seg.startDate, seg.endDate,
                seg.rentUnitRate, seg.serviceRate,
                contract.area
            );

            const roundedTotalRent = ContractTermSplitter._round(total.totalRent, 2);
            const roundedTotalServiceFee = ContractTermSplitter._round(total.totalServiceFee, 2);

            // 如果整月，按月数除；否则就直接等于总金额
            const isFullMonth = Number.isInteger(roundedMonthEq) && roundedMonthEq > 0;

            const averageMonthlyRent = isFullMonth
                ? ContractTermSplitter._round(roundedTotalRent / roundedMonthEq, 2)
                : roundedTotalRent;

            const averageMonthlyServiceFee = isFullMonth
                ? ContractTermSplitter._round(roundedTotalServiceFee / roundedMonthEq, 2)
                : roundedTotalServiceFee;

            return {
                ...seg,
                monthEquivalent: roundedMonthEq,
                totalRent: roundedTotalRent,
                totalServiceFee: roundedTotalServiceFee,
                averageMonthlyRent,
                averageMonthlyServiceFee,
            };
        });


        return result;
    }

    // ========================= 私有工具函数 =========================

    /**
     * 合并 & 裁剪 “免租期” 区段到 [startDate, endDate]
     * 输入：若区间重叠或相邻，需合并；超出合同范围则裁剪；出界后丢弃。
     */
    static _mergeAndTrimFreePeriods(freePeriods, startDate, endDate) {
        if (!freePeriods || freePeriods.length === 0) return [];

        // 先裁剪到合同范围内；若不合法则丢弃
        const trimmed = freePeriods.map(fp => ({
            start: fp.start < startDate ? startDate : fp.start,
            end: fp.end > endDate ? endDate : fp.end
        })).filter(fp => fp.start <= fp.end);

        if (trimmed.length === 0) return [];

        // 按 start 排序
        trimmed.sort((a, b) => a.start - b.start);

        // 合并重叠或相邻区段
        const merged = [];
        let cur = { ...trimmed[0] };
        for (let i = 1; i < trimmed.length; i++) {
            const f = trimmed[i];
            // 如果 f.start <= cur.end + 1，则合并
            if (f.start <= ContractTermSplitter._addDays(cur.end, 1)) {
                cur.end = cur.end > f.end ? cur.end : f.end;
            } else {
                merged.push({ ...cur });
                cur = { ...f };
            }
        }
        merged.push({ ...cur });
        return merged;
    }

    /**
     * 判断某个 date 是否落在“已合并后”的免租期数组内
     */
    static _isInFreePeriod(date, freePeriods) {
        for (let fp of freePeriods) {
            if (date >= fp.start && date <= fp.end) return true;
        }
        return false;
    }

    /**
     * 计算截止到某个 segStart 时，所有“ev.date < segStart”的累计倍率
     * 同时返回“最后一次递增事件”的备注（类型 + 生效日）。
     * 保留倍率 4 位小数。
     */
    static _calcAppliedIncreaseRate(segStart, increaseEvents) {
        let appliedRate = 1.0;
        let lastRemark = '';

        for (let ev of increaseEvents) {
            // 仅对 ev.date <= segStart 才生效
            if (ev.date <= segStart) {
                appliedRate = ContractTermSplitter._round(appliedRate * (1 + ev.rate), 8);
                lastRemark = (ev.type === 'ANNIVERSARY' ? '周年递增_' : '打点递增_')
                    + ContractTermSplitter._formatDate(ev.date);
            }
        }
        return { rate: ContractTermSplitter._round(appliedRate, 4), remark: lastRemark };
    }

    /**
     * 判断一个段是否是“完整自然月块”：
     *  - start.day == 1
     *  - end.day == 当月最后一天
     */
    static _isFullNaturalMonth(segment) {
        const sd = ContractTermSplitter._strToDate(segment.startDate);
        const ed = ContractTermSplitter._strToDate(segment.endDate);

        const startDay = sd.getDate();
        const endDay = ed.getDate();
        const lastDayOfMonth = new Date(ed.getFullYear(), ed.getMonth() + 1, 0).getDate();

        return startDay === 1 && endDay === lastDayOfMonth;
    }

    /**
     * 计算一个 TermSegment 区间的 等效月数：
     * monthEquivalent = 每个月份覆盖天数 / 当月天数 之和
     * @param {string} startStr 'YYYY-MM-DD'
     * @param {string} endStr   'YYYY-MM-DD'
     * @returns {Number}
     */
    static _computeMonthEquivalent(startStr, endStr) {
        let totalMonths = 0;
        let cur = ContractTermSplitter._strToDate(startStr);
        const end = ContractTermSplitter._strToDate(endStr);

        while (cur <= end) {
            const year = cur.getFullYear();
            const month = cur.getMonth();
            const monthFirst = new Date(year, month, 1);
            const monthLast = new Date(year, month + 1, 0);
            const daysInMonth = monthLast.getDate();

            const segMonthStart = cur > monthFirst ? cur : monthFirst;
            const segMonthEnd = end < monthLast ? end : monthLast;

            const coveredDays = Math.floor(
                (segMonthEnd.getTime() - segMonthStart.getTime()) / (1000 * 60 * 60 * 24)
            ) + 1;

            totalMonths += coveredDays / daysInMonth;
            cur = new Date(year, month + 1, 1);
        }

        return totalMonths;
    }

    /**
     * 计算一个 TermSegment 区间在给定 area 条件下的
     * totalRent 与 totalServiceFee，按“逐月累加、部分月份按天数比例折算”。
     * @param {string} startStr  'YYYY-MM-DD'
     * @param {string} endStr    'YYYY-MM-DD'
     * @param {Number} rentRate  租金单价（元/㎡·月）
     * @param {Number} svcRate   管理费单价（元/㎡·月）
     * @param {Number} area      租赁面积（㎡）
     * @returns {Object} { totalRent, totalServiceFee }
     */
    static _computeSegmentTotals(startStr, endStr, rentRate, svcRate, area) {
        let totalRent = 0;
        let totalServiceFee = 0;

        let cur = ContractTermSplitter._strToDate(startStr);
        const end = ContractTermSplitter._strToDate(endStr);

        while (cur <= end) {
            const year = cur.getFullYear();
            const month = cur.getMonth();
            const monthFirst = new Date(year, month, 1);
            const monthLast = new Date(year, month + 1, 0);
            const daysInMonth = monthLast.getDate();

            const segMonthStart = cur > monthFirst ? cur : monthFirst;
            const segMonthEnd = end < monthLast ? end : monthLast;

            const coveredDays = Math.floor(
                (segMonthEnd.getTime() - segMonthStart.getTime()) / (1000 * 60 * 60 * 24)
            ) + 1;

            const ratio = coveredDays / daysInMonth;
            totalRent += rentRate * area * ratio;
            totalServiceFee += svcRate * area * ratio;

            cur = new Date(year, month + 1, 1);
        }

        return { totalRent, totalServiceFee };
    }

    /** 字符串 'YYYY-MM-DD' → Date 对象 */
    static _strToDate(s) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    /** Date 对象 → 'YYYY-MM-DD' */
    static _formatDate(d) {
        const yy = d.getFullYear();
        let mm = (d.getMonth() + 1).toString();
        let dd = d.getDate().toString();
        if (mm.length < 2) mm = '0' + mm;
        if (dd.length < 2) dd = '0' + dd;
        return `${yy}-${mm}-${dd}`;
    }

    /** Date + n 天 → 新 Date */
    static _addDays(d, n) {
        const dt = new Date(d);
        dt.setDate(dt.getDate() + n);
        return dt;
    }

    /** Date + n 年 → 新 Date */
    static _addYears(d, n) {
        const dt = new Date(d);
        dt.setFullYear(dt.getFullYear() + n);
        return dt;
    }

    /** 四舍五入到 decimals 位（JavaScript Number 版） */
    static _round(num, decimals) {
        return Number(Math.round(num + 'e' + decimals) + 'e-' + decimals);
    }
}

// 导出模块
module.exports = ContractTermSplitter;

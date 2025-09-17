require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const db = require("../db_tools/db.js");
const path = require('path');
const OpenAI = require("openai");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const axios = require("axios");
const polygonClipping = require('polygon-clipping');
const turf = require('@turf/turf');
const fs = require('fs');

//多边形切割服务
const PolygonSplitter = require('../server_tools/poly-splitter.js');

//实时计算单元空置时长服务
const enrichUnitsWithVacantDays = require('../server_tools/vacant-service.js').enrichUnitsWithVacantDays;

//实时计算单元总价服务 
const { calculatePrice } = require('../server_tools/price-calculator.js');

//鉴权中间件
const checkPermissionMiddleware = require('../server_tools/check-permission-middleware.js');
//const { setPermissions, getPermissions, cache } = require('../utils/permission-manager-node_cache.js');
const { setPermissions, redisClient } = require('../utils/permission-manager-redis.js');

//上传服务中间件
const { createUploader, saveFileRecord } = require('../server_tools/uploadTool.js');

const uploader = createUploader({ uploadDir: './uploads', unique: true });

//常用工具服务
const { formatDateFieldsDeep, updateFloorRemainingArea, getIncreaseRuleForSegment } = require('../utils/common-untils.js');

//订阅单元状态更新服务
const unitSyncService = require('../../mq_services/unitSyncService.js');

//日志配置
const logger = require('../logger_conf/logger.js');

// 生成随机 BIGINT ID（15位，安全范围内）
function generateRandomId() {
  const min = 1e14;       // 100000000000000
  const max = 9e14;       // 899999999999999
  return Math.floor(Math.random() * (max - min + 1) + min);
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 用于签发/验证 Token 的密钥
const secretKey = process.env.JWT_SECRET;
const TARGET_HOST = process.env.TARGET_HOST;

// 代理中转接口
app.use("/api/proxy", async (req, res) => {
  const raw = req.query.endpoint || "";
  const endpoint = raw.replace(/^\/+/, "");
  const method = req.method.toLowerCase();
  const url = `${TARGET_HOST}/${endpoint}`;

  const { endpoint: _, ...restQueries } = req.query;

  const axiosConfig = {
    method,
    url,
    headers: {
      'Authorization': req.headers['authorization'] || ''
    },
    ...(method === 'get'
      ? { params: restQueries }
      : { data: req.body })
  };

  try {
    const result = await axios(axiosConfig);
    return res.status(result.status).json(result.data);
  } catch (err) {
    logger.error("中转请求失败:", err.response?.status, err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      message: "中转失败",
      detail: err.response?.data || err.message
    });
  }
});

//记录 HTTP 请求日志
app.use(morgan("combined", { stream: { write: (message) => logger.info(message.trim()) } }));

//文件路径
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// 静态文件目录设置
app.use('/pages', express.static(path.join(__dirname, '..', '..', 'pages')));

// 允许公开接口：登录接口、权限认证和静态资源
app.use((req, res, next) => {
  const publicPaths = [
    '/',
    '/login',
    '/api/proxy/',
    '/pages/templates/share_login.html',
    '/pages/templates/reports.html',
    '/pages/scripts/shared_app.js.obfuscated.js',
    '/pages/icons',
    '/pages',
  ];

  // 检查路径是否在白名单中，如果是则直接跳过认证
  if (publicPaths.includes(req.path) || req.path.startsWith('/pages/')) {
    return next();
  }

  // 处理需要授权的接口
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: "认证失败: 缺少认证信息" });
  }

  // 格式：Bearer <token>
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ success: false, message: "认证失败: Token 格式错误" });
  }

  const token = parts[1];
  try {
    // 验证 token 是否有效
    const decoded = jwt.verify(token, secretKey);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "认证失败: Token 无效或已过期" });
  }
});

// 默认路由，重定向到登录页面
app.get('/', async (req, res) => {
  res.redirect('/pages/templates/share_login.html');
});

//统一登录接口
app.post("/login", async (req, res) => {
  const { group, id } = req.body;
  if (!group || !id) {
    return res.status(400).json({ success: false, message: "缺少权限组或ID号" });
  }

  try {
    // 查找用户（渠道）
    const [rows] = await db.query(
      "SELECT * FROM sales_channels WHERE id = ? AND user_type = ? AND status = 1",
      [id, group]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "账号或权限组不正确" });
    }

    const user = rows[0];
    const { name } = user;

    // 查询该用户绑定的所有角色
    const [roleRows] = await db.query(`
      SELECT r.id, r.code, r.name
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `, [id]);

    const roles = roleRows;

    // 查询角色对应权限点 + scope + constraints_json
    const [permissionsRaw] = await db.query(`
      SELECT DISTINCT p.code AS code, p.type AS type, rp.scope AS scope, rp.constraints_json
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ?
    `, [id]);

    // 构造权限缓存结构 { 'contracts:view': { scope: 'own', constraints: {...} }, ... }
    const permissionMap = {};
    for (const p of permissionsRaw) {
      let constraints = {};
      try {
        if (p.constraints_json) {
          if (typeof p.constraints_json === 'string') {
            constraints = JSON.parse(p.constraints_json);
          } else if (typeof p.constraints_json === 'object') {
            constraints = p.constraints_json;
          }
        }
      } catch (err) {
        console.warn(`权限点 ${p.code} 的 constraints_json 解析失败:`, p.constraints_json);
      }

      permissionMap[p.code] = {
        scope: p.scope || null,
        constraints,
        type: p.type || null
      };
    }
    // 缓存用户权限
    setPermissions(id, permissionMap);

    // 生成token
    const payload = { id, group };
    const token = jwt.sign(payload, secretKey, { expiresIn: "2h" });

    logger.info('用户登录:' + JSON.stringify(user));

    res.json({
      success: true,
      message: "登录成功",
      token,
      id,
      name,
      roles: roles.map(r => ({
        id: r.id,
        code: r.code,
        name: r.name
      })),
      permissions: Object.keys(permissionMap)
    });
  } catch (error) {
    console.error("数据库错误：", error);
    res.status(500).json({ success: false, message: "服务器内部错误" });
  }
});
/**
 * 联办CRM服务--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 */
// 提交日报接口
app.post("/report", async (req, res) => {
  const {
    sales_channel_id,
    report_date,
    inquiries,
    new_customers,
    agency_visits,
    describe_of_visits,
    groups_activities,
    describe_of_groups_activities,
    new_agencies,
    total_agency_of_have,
    done_customers,
    question_for_feedback,
    customers_under_following,
    done_workstations,
    social_media_post_id,
    XHS,
    DY,
    SPH,
    DZDP,
    social_media_describe,
  } = req.body;

  // 参数校验
  if (
    !sales_channel_id ||
    !report_date ||
    XHS === undefined ||
    DY === undefined ||
    SPH === undefined ||
    DZDP === undefined
  ) {
    return res.status(400).json({ success: false, message: "缺少必要的参数" });
  }

  // 转换 report_date 格式
  const reportDate = req.body.report_date;

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 插入 social_media_post 表
    const socialMediaPostSql = `
      INSERT INTO social_media_post (
        sales_channel_id, XHS, DY, SPH, DZDP, \`describe\`, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;
    const [socialMediaPostResult] = await connection.execute(socialMediaPostSql, [
      sales_channel_id,
      XHS,
      DY,
      SPH,
      DZDP,
      social_media_describe,
    ]);

    const socialMediaPostId = socialMediaPostResult.insertId; // 获取新插入的 social_media_post 的 ID

    // 插入 sales_reports 表
    const salesReportsSql = `
      INSERT INTO sales_reports (
        sales_channel_id, report_date, inquiries, new_customers, agency_visits, describe_of_visits,
        groups_activities, describe_of_groups_activities, new_agencies,
        total_agency_of_have, done_customers, question_for_feedback,
        customers_under_following, done_workstations, social_media_post_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [salesReportsResult] = await connection.execute(salesReportsSql, [
      sales_channel_id,
      reportDate, // 使用转换后的日期
      inquiries,
      new_customers,
      agency_visits,
      describe_of_visits,
      groups_activities,
      describe_of_groups_activities,
      new_agencies,
      total_agency_of_have,
      done_customers,
      question_for_feedback,
      customers_under_following,
      done_workstations,
      socialMediaPostId, // 使用刚刚插入的 social_media_post 的 ID
    ]);

    // 提交事务
    await connection.commit();

    res.json({
      success: true,
      message: "日报提交成功",
      salesReportsInsertId: salesReportsResult.insertId,
    });
  } catch (error) {
    if (connection) await connection.rollback(); // 回滚事务
    console.error("插入错误:", error);
    res.status(500).json({ success: false, message: "提交失败: " + error.message });
  } finally {
    if (connection) connection.release(); // 释放连接
  }
});

// 查询日报数据接口
app.get("/report", async (req, res) => {
  const { start_date, end_date, sales_channel_id, page = 1, page_size = 5 } = req.query;

  try {
    // 验证日期参数
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: "缺少 start_date 或 end_date 参数" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
      return res.status(400).json({ success: false, message: "日期格式应为 YYYY-MM-DD" });
    }

    // 解析分页参数
    const pageInt = parseInt(page, 10);
    const pageSizeInt = parseInt(page_size, 10);
    const offset = (pageInt - 1) * pageSizeInt;

    const connection = await db.getConnection();
    try {
      // 获取总数
      let countSql = `SELECT COUNT(*) as total FROM sales_reports WHERE report_date BETWEEN ? AND ?`;
      let countParams = [start_date, end_date];

      if (sales_channel_id) {
        countSql += " AND sales_channel_id = ?";
        countParams.push(sales_channel_id);
      }

      const [countRows] = await connection.execute(countSql, countParams);
      const total = countRows[0].total;

      // 获取分页数据
      let sql = `
        SELECT 
          sr.id AS report_id,
          sr.sales_channel_id,
          sr.report_date,
          sr.inquiries,
          sr.new_customers,
          sr.agency_visits,
          sr.describe_of_visits,
          sr.groups_activities,
          sr.new_agencies,
          sr.describe_of_groups_activities,
          sr.total_agency_of_have,
          sr.done_customers,
          sr.question_for_feedback,
          sr.customers_under_following,
          sr.done_workstations,
          smp.id AS smp_id,
          smp.XHS,
          smp.DY,
          smp.SPH,
          smp.DZDP,
          smp.describe AS smp_describe,
          smp.created_at AS post_time,
          sc.name AS sales_channel_name
        FROM sales_reports sr
        LEFT JOIN social_media_post smp 
          ON sr.social_media_post_id = smp.id
        LEFT JOIN sales_channels sc 
          ON sr.sales_channel_id = sc.id
        WHERE 
          sr.report_date BETWEEN ? AND ?
      `;

      let params = [start_date, end_date];

      if (sales_channel_id) {
        sql += " AND sr.sales_channel_id = ?";
        params.push(sales_channel_id);
      }

      // 修复点：直接拼接分页参数（已转换为数字）
      sql += ` ORDER BY sr.report_date DESC LIMIT ${pageSizeInt} OFFSET ${offset}`;

      const [rows] = await connection.execute(sql, params);

      res.json({
        success: true,
        data: rows,
        total,
        page: pageInt,
        page_size: pageSizeInt,
        total_pages: Math.ceil(total / pageSizeInt),
        message: "查询成功",
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("查询错误:", error);
    res.status(500).json({
      success: false,
      message: "查询失败: " + error.message
    });
  }
});

app.get("/report_by_date", async (req, res) => {
  const { start_date, end_date, sales_channel_id } = req.query;
  try {
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: "缺少 start_date 或 end_date 参数" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
      return res.status(400).json({ success: false, message: "日期格式应为 YYYY-MM-DD" });
    }

    const connection = await db.getConnection();
    try {
      // 这里对 social_media_post 表采用 LEFT JOIN，同时在连接条件中加上日期过滤
      // 这样只有当 sales_reports.social_media_post_id 对应的 social_media_post.created_at 在指定日期范围内时，
      // 才会将社交媒体数据汇总，否则返回的汇总数据为 NULL，再用 COALESCE 处理成 0
      let sql_sum = `
        SELECT 
            sr.sales_channel_id,
            SUM(sr.inquiries) AS total_inquiries,
            SUM(sr.new_customers) AS total_new_customers,
            SUM(sr.agency_visits) AS total_agency_visits,
            SUM(sr.groups_activities) AS total_groups_activities,
            SUM(sr.new_agencies) AS total_new_agencies,
            SUM(sr.done_customers) AS total_done_customers,
            SUM(sr.customers_under_following) AS total_customers_under_following,
            SUM(sr.done_workstations) AS total_done_workstations,
            COALESCE(SUM(smp.XHS), 0) AS total_XHS,
            COALESCE(SUM(smp.DY), 0) AS total_DY,
            COALESCE(SUM(smp.SPH), 0) AS total_SPH,
            COALESCE(SUM(smp.DZDP), 0) AS total_DZDP,
            sc.name AS sales_channel_name
        FROM sales_reports sr
        LEFT JOIN social_media_post smp 
            ON sr.social_media_post_id = smp.id 
            AND DATE(smp.created_at) BETWEEN ? AND ?
        LEFT JOIN sales_channels sc 
            ON sr.sales_channel_id = sc.id
        WHERE sr.report_date BETWEEN ? AND ?`;

      let sumParams = [start_date, end_date, start_date, end_date];

      if (sales_channel_id) {
        sql_sum += " AND sr.sales_channel_id = ?";
        sumParams.push(sales_channel_id);
      }

      sql_sum += " GROUP BY sr.sales_channel_id";

      const [sumRows] = await connection.execute(sql_sum, sumParams);
      res.json({
        success: true,
        detailData: [], // 可根据具体业务需求返回详情数据
        summaryData: sumRows,
        message: "查询成功",
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("查询错误:", error);
    res.status(500).json({ success: false, message: "查询失败: " + error.message });
  }
});

// 新增客户信息接口
app.post("/customer", async (req, res) => {
  const {
    customer_name,
    project_name,
    visit_unit,
    customer_source,
    company_info = null,
    move_status = null,
    space_feature = null,
    furniture_requirement = null,
    special_requirement = null,
    budget = null,
    site_selection_progress = null,
    comparison_info = null,
    meeting_room_assessment = null,
    visit_details = null,
    evaluator = null,
    on_site_feedback = null,
    next_action_time,
    next_action_content,
    sales_channel_id
  } = req.body;

  // 参数校验（新增 customer_name）
  if (!customer_name || !project_name || !visit_unit || !customer_source || !next_action_time || !next_action_content || !sales_channel_id) {
    return res.status(400).json({ success: false, message: "缺少必要的参数" });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 插入 customer_info 表，同时增加 customer_name 字段
    const sql = `
      INSERT INTO customer_info (
        customer_name, project_name, visit_unit, customer_source, company_info, move_status, space_feature, 
        furniture_requirement, special_requirement, budget, site_selection_progress, comparison_info, 
        meeting_room_assessment, visit_details, evaluator, on_site_feedback, next_action_time, 
        next_action_content, sales_channel_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await connection.execute(sql, [
      customer_name,
      project_name,
      visit_unit,
      customer_source,
      company_info,
      move_status,
      space_feature,
      furniture_requirement,
      special_requirement,
      budget,
      site_selection_progress,
      comparison_info,
      meeting_room_assessment,
      visit_details,
      evaluator,
      on_site_feedback,
      new Date(next_action_time),
      next_action_content,
      sales_channel_id
    ]);

    // 提交事务
    await connection.commit();

    res.json({
      success: true,
      message: "客户信息新增成功",
      customer_id: result.insertId // 返回新插入的客户ID
    });
  } catch (error) {
    if (connection) await connection.rollback(); // 回滚事务
    console.error("插入错误:", error);
    res.status(500).json({ success: false, message: "新增失败: " + error.message });
  } finally {
    if (connection) connection.release(); // 释放连接
  }
});

// 修改客户信息接口（针对整个对象修改,服务保留先不用）
app.put("/customer/:id", async (req, res) => {
  const { id } = req.params;
  const {
    customer_name,
    project_name,
    visit_unit,
    customer_source,
    company_info,
    move_status,
    space_feature,
    furniture_requirement,
    special_requirement,
    budget,
    site_selection_progress,
    comparison_info,
    meeting_room_assessment,
    visit_details,
    evaluator,
    on_site_feedback,
    next_action_time,
    next_action_content,
    sales_channel_id,
  } = req.body;

  // 参数校验中也加入 customer_name（同时保留其他必要参数的判断）
  if (!id || !customer_name || !project_name || !visit_unit || !customer_source || !sales_channel_id) {
    return res.status(400).json({ success: false, message: "缺少必要的参数" });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 更新 customer_info 表，包括 customer_name 字段
    const updateCustomerSql = `
      UPDATE customer_info SET
        customer_name = ?,
        project_name = ?, 
        visit_unit = ?, 
        customer_source = ?, 
        company_info = ?, 
        move_status = ?, 
        space_feature = ?, 
        furniture_requirement = ?, 
        special_requirement = ?, 
        budget = ?, 
        site_selection_progress = ?, 
        comparison_info = ?, 
        meeting_room_assessment = ?, 
        visit_details = ?, 
        evaluator = ?, 
        on_site_feedback = ?, 
        next_action_time = ?, 
        next_action_content = ?, 
        sales_channel_id = ?, 
        updated_at = NOW()
      WHERE id = ?
    `;
    const [updateResult] = await connection.execute(updateCustomerSql, [
      customer_name,
      project_name,
      visit_unit,
      customer_source,
      company_info,
      move_status,
      space_feature,
      furniture_requirement,
      special_requirement,
      budget,
      site_selection_progress,
      comparison_info,
      meeting_room_assessment,
      visit_details,
      evaluator,
      on_site_feedback,
      next_action_time,
      next_action_content,
      sales_channel_id,
      id,
    ]);

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "未找到该客户信息" });
    }

    // 提交事务
    await connection.commit();

    res.json({
      success: true,
      message: "客户信息更新成功",
    });
  } catch (error) {
    if (connection) await connection.rollback(); // 回滚事务
    console.error("更新错误:", error);
    res.status(500).json({ success: false, message: "更新失败: " + error.message });
  } finally {
    if (connection) connection.release(); // 释放连接
  }
});

//仅修改客户状态
app.patch('/update-customer-status', async (req, res) => {
  const { customerId, customerStatus } = req.body;
  if (typeof customerId !== 'number' || typeof customerStatus !== 'number') {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    const query = 'UPDATE `customer_info` SET `customer_status` = ? WHERE `id` = ?';
    const [result] = await connection.execute(query, [customerStatus, customerId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // 返回更新成功的响应
    res.json({ message: 'Customer status updated successfully' });
  } catch (error) {
    console.error('Error updating customer status: ', error);
    return res.status(500).json({ error: 'Database error' });
  } finally {
    if (connection) connection.release();//释放连接池
  }
});

//新增跟进记录
app.post("/add-customer-followup", async (req, res) => {
  const { customer_id, follow_up_date, follow_up_content, sales_channel_id } = req.body;
  if (!customer_id || !follow_up_date || !follow_up_content || !sales_channel_id) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    const query = `
    INSERT INTO follow_up_records (customer_id, follow_up_date, follow_up_content, sales_channel_id)
    VALUES (?, ?, ?, ?)
  `;
    const [result] = await connection.execute(query, [customer_id, follow_up_date, follow_up_content, sales_channel_id])
    res.status(200).json({ message: 'Follow-up record added successfully', recordId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Database error', error: error });
  } finally {
    if (connection) connection.release();//释放连接池
  }
})

// 获取跟进记录
app.get("/get-followup-records", async (req, res) => {
  const { customer_id } = req.query;  // 从查询参数中获取 customer_id

  // 验证 customer_id 是否传递且为有效数字
  if (!customer_id || isNaN(customer_id)) {
    return res.status(400).json({ message: 'Invalid customer_id' });
  }

  let connection;
  try {
    connection = await db.getConnection();  // 获取数据库连接

    // 查询跟进记录的 SQL 语句
    const query = `
      SELECT fr.id, fr.follow_up_date, fr.follow_up_content, fr.next_action, fr.sales_channel_id, 
             fr.created_at, fr.updated_at, c.customer_name, c.project_name, s.name AS sales_channel_name
      FROM follow_up_records fr
      JOIN customer_info c ON fr.customer_id = c.id
      LEFT JOIN sales_channels s ON fr.sales_channel_id = s.id
      WHERE fr.customer_id = ?
      ORDER BY fr.follow_up_date DESC;  -- 按照跟进日期降序排列
    `;

    // 执行查询
    const [results] = await connection.execute(query, [customer_id]);

    // 如果没有找到任何跟进记录
    if (results.length === 0) {
      return res.status(404).json({ message: 'No follow-up records found for this customer' });
    }

    // 手动调整时间为本地时间（UTC+8）
    results.forEach(record => {
      // 转换 follow_up_date 为本地时间
      const localDate = new Date(record.follow_up_date);
      localDate.setHours(localDate.getHours() + 8);  // 调整为中国标准时间（UTC+8）
      record.follow_up_date = localDate.toISOString().slice(0, 19).replace('T', ' '); // 格式化为 'YYYY-MM-DD HH:MM:SS'
    });

    // 返回查询结果
    res.status(200).json(results);
  } catch (error) {
    console.error('Error fetching follow-up records: ', error);
    return res.status(500).json({ message: 'Database error', error: error.message });
  } finally {
    if (connection) connection.release();  // 释放数据库连接
  }
});

// 查询客户信息接口
app.get("/customer", async (req, res) => {
  const { sales_channel_id, project_name, customer_name, start_date, end_date, customer_status, page = 1, page_size = 5 } = req.query;
  let connection;
  try {
    connection = await db.getConnection();

    // 校验日期格式（如果提供）
    if (start_date && end_date) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
        return res.status(400).json({ success: false, message: "日期格式应为 YYYY-MM-DD" });
      }
    }

    const pageInt = parseInt(page, 10);
    const pageSizeInt = parseInt(page_size, 10);
    const offset = (pageInt - 1) * pageSizeInt;

    let sql = `
      SELECT 
        ci.id, ci.customer_name, ci.project_name, ci.visit_unit, ci.customer_source, ci.company_info, ci.move_status, ci.space_feature,
        ci.furniture_requirement, ci.special_requirement, ci.budget, ci.site_selection_progress, ci.comparison_info,
        ci.meeting_room_assessment, ci.visit_details, ci.evaluator, ci.on_site_feedback, ci.next_action_time, 
        ci.next_action_content, ci.sales_channel_id, ci.created_at, ci.updated_at, ci.customer_status,ci.deal_report_id,
        sc.name AS sales_channel_name
      FROM customer_info ci
      LEFT JOIN sales_channels sc ON ci.sales_channel_id = sc.id
      WHERE 1=1
    `;
    let params = [];

    // 动态添加查询条件
    if (sales_channel_id) {
      sql += " AND ci.sales_channel_id = ?";
      params.push(sales_channel_id);
    }
    if (project_name) {
      sql += " AND ci.project_name LIKE ?";
      params.push(`%${project_name}%`);
    }
    if (customer_name) {
      sql += " AND ci.customer_name LIKE ?";
      params.push(`%${customer_name}%`);
    }
    if (start_date && end_date) {
      sql += " AND ci.created_at BETWEEN ? AND ?";
      params.push(
        start_date,              // 保持 start_date 为 YYYY-MM-DD 格式（等同于 00:00:00）
        `${end_date} 23:59:59`   // 将 end_date 扩展为当天的最后一秒
      );
    }
    if (customer_status !== undefined) {  // 检查是否传入了 customer_status 参数
      sql += " AND ci.customer_status = ?";
      params.push(customer_status);
    }

    // 修复点1: 直接拼接分页参数
    sql += ` ORDER BY ci.created_at DESC LIMIT ${pageSizeInt} OFFSET ${offset}`;

    // 执行查询（不再需要分页参数）
    const [rows] = await connection.execute(sql, params);

    // 单独执行总数查询
    let countSql = "SELECT COUNT(*) as total FROM customer_info ci LEFT JOIN sales_channels sc ON ci.sales_channel_id = sc.id WHERE 1=1";
    let countParams = [];
    if (sales_channel_id) {
      countSql += " AND ci.sales_channel_id = ?";
      countParams.push(sales_channel_id);
    }
    if (project_name) {
      countSql += " AND ci.project_name LIKE ?";
      countParams.push(`%${project_name}%`);
    }
    if (customer_name) {
      countSql += " AND ci.customer_name LIKE ?";
      countParams.push(`%${customer_name}%`);
    }
    if (start_date && end_date) {
      countSql += " AND ci.created_at BETWEEN ? AND ?";
      countParams.push(start_date, `${end_date} 23:59:59`);
    }
    if (customer_status !== undefined) {  // 检查是否传入了 customer_status 参数
      countSql += " AND ci.customer_status = ?";
      countParams.push(customer_status);
    }

    const [countRows] = await connection.execute(countSql, countParams);
    const total = countRows[0].total;

    res.json({
      success: true,
      data: rows,
      total,
      page: pageInt,
      page_size: pageSizeInt,
      total_pages: Math.ceil(total / pageSizeInt),
      message: "查询成功",
    });
  } catch (error) {
    console.error("查询错误:", error);
    res.status(500).json({
      success: false,
      message: "查询失败: " + error.message
    });
  } finally {
    if (connection) connection.release(); // 释放连接
  }
});

// POST /api/social_media_reports/submit
app.post("/api/social_media_reports/submit", async (req, res) => {
  const {
    project_code,
    month,
    platform,
    account_name,
    fields // 例如：{ post_count: 12, views: 3000, deals: 3 }
  } = req.body;

  if (!project_code || !month || !platform || !account_name || !fields) {
    return res.status(400).json({ success: false, message: "缺少必要参数" });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. 插入或更新主表（唯一维度组合）
    const [rows] = await connection.execute(`
      SELECT id FROM social_media_reports
      WHERE project_code = ? AND month = ? AND platform = ? AND account_name = ?
    `, [project_code, month, platform, account_name]);

    let reportId;
    if (rows.length > 0) {
      reportId = rows[0].id;
      await connection.execute(`
        UPDATE social_media_reports
        SET updated_at = NOW()
        WHERE id = ?
      `, [reportId]);

      // 可选：先删除旧的 value，再插入新的
      await connection.execute(`DELETE FROM social_media_report_values WHERE report_id = ?`, [reportId]);
    } else {
      const [insertResult] = await connection.execute(`
        INSERT INTO social_media_reports (project_code, month, platform, account_name)
        VALUES (?, ?, ?, ?)
      `, [project_code, month, platform, account_name]);
      reportId = insertResult.insertId;
    }

    // 2. 插入字段数值
    const fieldEntries = Object.entries(fields); // [ ['post_count', 12], ... ]
    for (const [key, value] of fieldEntries) {
      await connection.execute(`
        INSERT INTO social_media_report_values (report_id, field_key, field_value)
        VALUES (?, ?, ?)
      `, [reportId, key, value]);
    }

    await connection.commit();
    res.json({ success: true, message: "提交成功" });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error("提交失败:", err);
    res.status(500).json({ success: false, message: "提交失败：" + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/social_media_reports?month=2025-06&platform=小红书&project_code=impspace&page=1&pageSize=10
app.get("/api/social_media_reports", async (req, res) => {
  const { month, platform, project_code } = req.query;
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  let baseSql = `FROM social_media_reports WHERE 1=1`;
  const params = [];

  if (month) {
    baseSql += ` AND month = ?`;
    params.push(month);
  }
  if (platform && platform !== "全平台") {
    baseSql += ` AND platform = ?`;
    params.push(platform);
  }
  if (project_code) {
    baseSql += ` AND project_code = ?`;
    params.push(project_code);
  }

  // 修复点1: 直接拼接分页参数（安全，因为已转换为数字）
  const listSql = `SELECT * ${baseSql} LIMIT ${pageSize} OFFSET ${offset}`;
  const countSql = `SELECT COUNT(*) as total ${baseSql}`;

  let connection;
  try {
    connection = await db.getConnection();

    // 总数查询
    const [countResult] = await connection.execute(countSql, params);
    const total = countResult[0].total;

    // 数据查询（不再需要分页参数占位符）
    const [reports] = await connection.execute(listSql, params);

    if (reports.length === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize)
        }
      });
    }

    // 提取报告ID
    const reportIds = reports.map(r => r.id);

    // 修复点2: 动态构建IN占位符
    const placeholders = reportIds.map(() => '?').join(',');
    const [values] = await connection.query(
      `SELECT report_id, field_key, field_value
       FROM social_media_report_values
       WHERE report_id IN (${placeholders})`,
      reportIds
    );

    // 合并字段值
    const valuesGrouped = {};
    values.forEach(val => {
      if (!valuesGrouped[val.report_id]) valuesGrouped[val.report_id] = {};
      valuesGrouped[val.report_id][val.field_key] = Number(val.field_value);
    });

    const merged = reports.map(r => ({
      ...r,
      fields: valuesGrouped[r.id] || {}
    }));

    res.json({
      success: true,
      data: merged,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    });

  } catch (err) {
    console.error("查询失败:", err);
    res.status(500).json({ success: false, message: "查询失败：" + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/social_media_reports/summary?month=2025-06&platform=小红书&project_code=impspace
app.get("/api/social_media_reports/summary", async (req, res) => {
  const { month, platform, project_code } = req.query;

  // 先筛选出符合条件的 report id 列表
  let sql = `SELECT id FROM social_media_reports WHERE 1=1`;
  const params = [];
  if (month) {
    sql += ` AND month = ?`; params.push(month);
  }
  if (platform && platform !== "全平台") {
    sql += ` AND platform = ?`; params.push(platform);
  }
  if (project_code) {
    sql += ` AND project_code = ?`; params.push(project_code);
  }

  let connection;
  try {
    connection = await db.getConnection();
    const [reports] = await connection.execute(sql, params);
    const ids = reports.map(r => r.id);
    if (ids.length === 0) {
      return res.json({ success: true, data: {} });
    }

    // 只 join 有效字段（status=1），过滤掉已删除的
    const [rows] = await connection.query(`
      SELECT v.field_key,
             SUM(v.field_value) AS total
      FROM social_media_report_values v
      JOIN social_media_report_fields f
        ON v.field_key = f.field_key
       AND f.status = 1
      WHERE v.report_id IN (?)
      GROUP BY v.field_key
    `, [ids]);

    const result = {};
    for (const row of rows) {
      result[row.field_key] = Number(row.total);
    }

    res.json({ success: true, data: result });

  } catch (err) {
    console.error("汇总失败:", err);
    res.status(500).json({ success: false, message: "汇总失败：" + err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/social_media_reports/fields
app.get("/api/social_media_reports/fields", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT field_key, label, unit, sort_order
      FROM social_media_report_fields
      WHERE status = 1
      ORDER BY sort_order ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("字段配置查询失败:", err);
    res.status(500).json({ success: false, message: "字段配置查询失败：" + err.message });
  }
});

//创建字段
app.post('/api/social_media_reports/fields', async (req, res) => {
  const { field_key, label, unit, sort_order } = req.body;
  if (!field_key || !label) {
    return res.status(400).json({ success: false, message: '缺少必要参数: field_key 或 label' });
  }
  try {
    const [existing] = await db.execute(
      `SELECT id FROM social_media_report_fields WHERE field_key = ?`,
      [field_key]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: '字段 Key 已存在' });
    }
    await db.execute(
      `INSERT INTO social_media_report_fields (field_key, label, unit, sort_order, status, created_at)
       VALUES (?, ?, ?, ?, 1, NOW())`,
      [field_key, label, unit || '', sort_order || 0]
    );
    res.json({ success: true, message: '字段配置创建成功' });
  } catch (err) {
    console.error('字段配置创建失败:', err);
    res.status(500).json({ success: false, message: '创建失败:' + err.message });
  }
});

// DELETE /api/social_media_reports/fields/:field_key 软删除
app.delete('/api/social_media_reports/fields/:field_key', async (req, res) => {
  const { field_key } = req.params;
  // 验证字段存在且未删除
  const [rows] = await db.execute(
    `SELECT id FROM social_media_report_fields WHERE field_key = ? AND status = 1`,
    [field_key]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, message: '字段不存在或已删除' });
  }
  // 标记为软删除
  await db.execute(
    `UPDATE social_media_report_fields SET status = 0, updated_at = NOW() WHERE field_key = ?`,
    [field_key]
  );
  res.json({ success: true, message: '字段已软删除' });
});

// 初始化 Moonshot API 客戶端
const client = new OpenAI({
  apiKey: 'sk-EZwMYX6yyNneHlahmZ2VAn7Mo2kJ7gJKZPX1pzSLhy9RnsWb',
  baseURL: "https://api.moonshot.cn/v1",
});

// 新增成交报告
app.post("/add-deal-report", async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const {
      deal_project,
      deal_unit,
      deal_workstations,
      sign_date,
      sign_company,
      client_source,
      client_contact,
      client_contact_position,
      client_contact_phone,
      sales_channel_id,
      delivery_date,
      contract_duration,
      deposit,
      delivery_standard,
      payment_method,
      discount_conditions,
      customer_info_id,
      signed_amount,
      remarks
    } = req.body;
    // 校验必填字段
    if (!deal_project || !deal_unit || !deal_workstations || !sign_date || !sign_company ||
      !client_source || !client_contact || !client_contact_position || !client_contact_phone ||
      !sales_channel_id || !delivery_date || !contract_duration || !deposit ||
      !delivery_standard || !payment_method || !customer_info_id || !signed_amount || !remarks) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // 插入数据
    const query = `
      INSERT INTO deal_reports (
        deal_project, deal_unit, deal_workstations, sign_date, sign_company, 
        client_source, client_contact, client_contact_position, client_contact_phone, 
        sales_channel_id, delivery_date, contract_duration, deposit, 
        delivery_standard, payment_method, discount_conditions, customer_info_id,signed_amount,remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await connection.execute(query, [
      deal_project,
      deal_unit,
      deal_workstations,
      sign_date,
      sign_company,
      client_source,
      client_contact,
      client_contact_position,
      client_contact_phone,
      sales_channel_id,
      delivery_date,
      contract_duration,
      deposit,
      delivery_standard,
      payment_method,
      discount_conditions || null,
      customer_info_id,
      signed_amount,
      remarks || null
    ]);
    const dealReportId = result.insertId;
    const updateCustomerQuery = `
      UPDATE customer_info
      SET deal_report_id = ?
      WHERE id = ?
    `;
    await connection.execute(updateCustomerQuery, [dealReportId, customer_info_id]);
    await connection.commit();

    res.status(200).json({ message: 'Deal report added successfully', reportId: dealReportId });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    return res.status(500).json({ message: 'Database error', error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

//获取单条成交报告
app.get("/get-deal-report", async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const { customer_info_id, sales_channel_id } = req.query;

    if (!customer_info_id) {
      return res.status(400).json({ message: 'customer_info_id is required.' });
    }

    // 构建查询的基础部分
    let query = `
      SELECT 
        dr.id,
        dr.deal_project,
        dr.deal_unit,
        dr.deal_workstations,
        dr.sign_date,
        dr.sign_company,
        dr.client_source,
        dr.client_contact,
        dr.client_contact_position,
        dr.client_contact_phone,
        dr.sales_channel_id,
        dr.delivery_date,
        dr.contract_duration,
        dr.deposit,
        dr.delivery_standard,
        dr.payment_method,
        dr.discount_conditions,
        dr.customer_info_id,
        sc.name AS sales_channel_name,
        ci.customer_name AS customer_name,
        dr.signed_amount as signed_amount,
        dr.remarks as remarks 
      FROM deal_reports dr
      LEFT JOIN sales_channels sc ON dr.sales_channel_id = sc.id
      LEFT JOIN customer_info ci ON dr.customer_info_id = ci.id
      WHERE dr.customer_info_id = ?
    `;

    // 存储查询参数
    const params = [customer_info_id];

    // 如果提供了 sales_channel_id，则添加筛选条件
    if (sales_channel_id) {
      query += " AND dr.sales_channel_id = ?";
      params.push(sales_channel_id);
    }

    // 执行查询
    const [rows] = await connection.execute(query, params);

    // 如果没有找到对应的成交报告
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No deal report found for the given customer and sales channel.' });
    }

    // 返回找到的成交报告
    res.status(200).json(rows[0]); // 只返回第一条记录（每个客户最多一份成交报告）
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Database error', error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// 获取成交报告列表
app.get("/get-deal-report-list", async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const {
      customer_info_id,
      sales_channel_id,
      start_sign_date,
      end_sign_date,
      client_source,
      deal_project,
      page = 1,
      limit = 10,
    } = req.query;

    if (!customer_info_id && !sales_channel_id && !start_sign_date && !end_sign_date && !client_source && !deal_project) {
      return res.status(400).json({
        message: '至少需要一个查询参数 (customer_info_id, sales_channel_id, start_sign_date, end_sign_date, client_source, deal_project)'
      });
    }

    // 解析分页参数为整数
    const pageInt = parseInt(page, 10);
    const limitInt = parseInt(limit, 10);
    const offset = (pageInt - 1) * limitInt;

    let baseQuery = `
      FROM deal_reports dr
      LEFT JOIN sales_channels sc ON dr.sales_channel_id = sc.id
      LEFT JOIN customer_info ci ON dr.customer_info_id = ci.id
      WHERE 1=1`;

    const params = [];

    if (customer_info_id) {
      baseQuery += " AND dr.customer_info_id = ?";
      params.push(customer_info_id);
    }

    if (sales_channel_id) {
      baseQuery += " AND dr.sales_channel_id = ?";
      params.push(sales_channel_id);
    }

    if (client_source) {
      baseQuery += " AND dr.client_source = ?";
      params.push(client_source);
    }

    if (deal_project) {
      baseQuery += " AND dr.deal_project = ?";
      params.push(deal_project);
    }

    if (start_sign_date && end_sign_date) {
      baseQuery += " AND dr.sign_date BETWEEN ? AND ?";
      params.push(start_sign_date, end_sign_date);
    } else if (start_sign_date) {
      baseQuery += " AND dr.sign_date >= ?";
      params.push(start_sign_date);
    } else if (end_sign_date) {
      baseQuery += " AND dr.sign_date <= ?";
      params.push(end_sign_date);
    }

    // 1. 获取总数
    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
    const [countRows] = await connection.execute(countQuery, params);
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limitInt);

    // 2. 查询分页数据 - 修复点：直接拼接分页参数
    const dataQuery = `
      SELECT 
        dr.id,
        dr.deal_project,
        dr.deal_unit,
        dr.deal_workstations,
        dr.sign_date,
        dr.sign_company,
        dr.client_source,
        dr.client_contact,
        dr.client_contact_position,
        dr.client_contact_phone,
        dr.sales_channel_id,
        dr.delivery_date,
        dr.contract_duration,
        dr.deposit,
        dr.delivery_standard,
        dr.payment_method,
        dr.discount_conditions,
        dr.customer_info_id,
        sc.name AS sales_channel_name,
        ci.customer_name AS customer_name,
        dr.signed_amount as signed_amount,
        dr.remarks as remarks
      ${baseQuery}
      ORDER BY dr.sign_date DESC
      LIMIT ${limitInt} OFFSET ${offset}  -- 直接拼接分页参数
    `;

    // 不再需要将分页参数加入params数组
    const [rows] = await connection.execute(dataQuery, params);

    res.status(200).json({
      data: rows,
      pagination: {
        total,
        page: pageInt,
        limit: limitInt,
        totalPages
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: '数据库错误',
      error: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * 房源管理服务--------------------------------------------------------------------------------------------------------------------------------------------------------------------
 */
// 查询单元列表（附带合同信息）
app.get("/api/units", checkPermissionMiddleware('units:read_units_list'), async (req, res) => {
  try {
    const { building_id, floor, parent_unit_id, status, page = 1, pageSize = 20 } = req.query;

    if (!building_id) {
      return res.status(400).json({ message: "building_id 是必需的" });
    }

    const pageInt = parseInt(page, 10);
    const pageSizeInt = parseInt(pageSize, 10);
    const offset = (pageInt - 1) * pageSizeInt;

    // 用于总数查询
    let baseQuery = "FROM units WHERE is_deleted = 0 AND building_id = ?";
    const params = [building_id];

    if (floor) {
      baseQuery += " AND floor = ?";
      params.push(floor);
    }

    if (parent_unit_id) {
      baseQuery += " AND parent_unit_id = ?";
      params.push(parent_unit_id);
    }

    if (status) {
      baseQuery += " AND status = ?";
      params.push(status);
    }

    // 查询总数
    const [countRows] = await db.execute(`SELECT COUNT(*) AS total ${baseQuery}`, params);
    const total = countRows[0].total;

    // 查询单元 + 绑定合同编号
    const dataQuery = `
      SELECT u.*,
             IFNULL(JSON_ARRAYAGG(
               JSON_OBJECT(
                 'id', c.id,
                 'number', c.contract_number
               )
             ), JSON_ARRAY()) AS contracts
      FROM units u
      LEFT JOIN contract_units cu ON cu.unit_id = u.id
      LEFT JOIN contracts c ON c.id = cu.contract_id
      WHERE u.is_deleted = 0
        AND u.building_id = ?
        ${floor ? ' AND u.floor = ?' : ''}
        ${parent_unit_id ? ' AND u.parent_unit_id = ?' : ''}
        ${status ? ' AND u.status = ?' : ''}
      GROUP BY u.id
      ORDER BY u.id ASC
      LIMIT ${pageSizeInt} OFFSET ${offset}
    `;

    const [rows] = await db.execute(dataQuery, params);

    // 保留现有空置天数逻辑，并确保 contracts 是数组
    const result = enrichUnitsWithVacantDays(rows).map(u => ({
      ...u,
      contracts: Array.isArray(u.contracts) ? u.contracts : JSON.parse(u.contracts || '[]')
    }));

    res.status(200).json({
      units: result,
      pagination: {
        total,
        page: pageInt,
        pageSize: pageSizeInt,
        totalPages: Math.ceil(total / pageSizeInt),
      },
    });

  } catch (err) {
    console.error("单元列表查询错误:", err);
    res.status(500).json({
      message: "数据库错误",
      error: err.message
    });
  }
});

//分配单元接口
app.post("/api/split-unit", checkPermissionMiddleware('units:allocate_units'), async (req, res) => {
  let connection;
  try {
    const { parent_unit_id, children } = req.body;

    if (!parent_unit_id || !Array.isArray(children) || children.length === 0) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    // 1. 查询父单元信息（锁定行）
    const [parentRows] = await connection.execute(
      `SELECT * FROM units WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [parent_unit_id]
    );

    if (parentRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Parent unit not found" });
    }

    const parentUnit = parentRows[0];

    // 2. 只允许 vacant/unpartitioned 状态的单元进行分割
    if (parentUnit.status !== 'vacant' && parentUnit.status !== 'unpartitioned') {
      await connection.rollback();
      return res.status(400).json({ message: "Only vacant or unpartitioned units can be split" });
    }

    // 3. 查询已存在子单元 usable_area 总和
    const [childSumRows] = await connection.execute(
      `SELECT COALESCE(SUM(usable_area), 0) AS total_usable_area 
       FROM units WHERE parent_unit_id = ? AND is_deleted = 0`,
      [parent_unit_id]
    );
    const usedUsableArea = parseFloat(childSumRows[0].total_usable_area || 0);
    const remainingUsableArea = parseFloat(parentUnit.usable_area) - usedUsableArea;

    // 4. 校验此次传入的 children usable_area 总和
    const newUsableSum = children.reduce((sum, c) => {
      return sum + parseFloat(c.usable_area);
    }, 0);

    if (newUsableSum > remainingUsableArea + 0.01) {
      await connection.rollback();
      return res.status(400).json({
        message: `剩余可用面积不足。当前剩余：${remainingUsableArea.toFixed(2)}㎡，本次要分割：${newUsableSum.toFixed(2)}㎡`
      });
    }

    // 5. 插入子单元
    for (const child of children) {
      const lease_area = parseFloat(child.lease_area);
      const usable_area = parseFloat(child.usable_area);

      if (!lease_area || !usable_area || lease_area <= 0 || usable_area <= 0) {
        await connection.rollback();
        return res.status(400).json({ message: `子单元 lease_area 和 usable_area 必须大于 0` });
      }

      const efficiency_rate = lease_area > 0 ? usable_area / lease_area : 0;
      const build_area = parentUnit.original_efficiency_rate > 0
        ? usable_area / parseFloat(parentUnit.original_efficiency_rate)
        : 0;

      const rect_parts = child.rect_parts ? JSON.stringify(child.rect_parts) : null;

      const [insertResult] = await connection.execute(
        `INSERT INTO units 
          (building_id, floor, code, status, build_area, usable_area, lease_area, 
           efficiency_rate, origin_area, management_fee_per_sqm, parent_unit_id, 
           area_type, original_efficiency_rate, tree_path, 
           pos_x, pos_y, width, height, rect_parts,
           features, rent_unit_price, remarks, orientation, layout,
           vacant_since)
         VALUES (?, ?, ?, 'vacant', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          parentUnit.building_id,
          parentUnit.floor,
          child.code,
          build_area,
          usable_area,
          lease_area,
          efficiency_rate,
          parentUnit.origin_area,
          child.management_fee ?? null,
          parent_unit_id,
          child.area_type || '合同出租',
          parentUnit.original_efficiency_rate,
          child.pos_x ?? 0,
          child.pos_y ?? 0,
          child.width ?? 0,
          child.height ?? 0,
          rect_parts,
          child.features ?? null,
          child.rent_unit_price ?? null,
          child.remarks ?? null,
          child.orientation ?? null,
          child.layout ?? null
        ]
      );
      const childId = insertResult.insertId;
      const newTreePath = `${parentUnit.tree_path}${childId}/`;

      await connection.execute(
        `UPDATE units SET tree_path = ? WHERE id = ?`,
        [newTreePath, childId]
      );
    }

    await updateFloorRemainingArea(connection, parentUnit.building_id, parentUnit.floor);
    await connection.commit();
    res.status(200).json({ message: "Split success", count: children.length });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error("split-unit error:", err);
    res.status(500).json({ message: "Database error", error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

//合并单元，根据多边形并集合并
app.post("/api/merge-unit", checkPermissionMiddleware('units:merge_units'), async (req, res) => {
  let connection;
  try {
    const {
      child_unit_ids,
      code,
      efficiency_rate,
      management_fee_per_sqm,
      rent_unit_price,
      remarks,
      orientation,
      layout,
      features,
      area_type
    } = req.body;

    if (!Array.isArray(child_unit_ids) || child_unit_ids.length < 2 || !code) {
      return res.status(400).json({ message: "缺少必要参数" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const placeholders = child_unit_ids.map(() => '?').join(',');
    const [childRows] = await connection.execute(
      `SELECT * FROM units 
       WHERE id IN (${placeholders})
         AND is_deleted = 0
         AND status = 'vacant'`,
      child_unit_ids
    );

    if (childRows.length !== child_unit_ids.length) {
      await connection.rollback();
      return res.status(400).json({ message: "仅允许空置状态的子单元参与合并，或存在无效子单元" });
    }

    const buildingIdSet = new Set(childRows.map(u => u.building_id));
    const floorSet = new Set(childRows.map(u => u.floor));

    if (buildingIdSet.size !== 1 || floorSet.size !== 1) {
      await connection.rollback();
      return res.status(400).json({ message: "子单元必须来自同一楼栋同一楼层" });
    }

    const building_id = childRows[0].building_id;
    const floor = childRows[0].floor;

    // ✅ 校验几何是否连通
    const toPoly = unit => {
      const ring = unit.rect_parts.slice();
      const first = ring[0], last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
      return [ring];
    };

    const toGeoJSONPolygon = unit => turf.polygon([unit.rect_parts]);

    const n = childRows.length;
    const adjList = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      const polyA = toGeoJSONPolygon(childRows[i]);
      for (let j = i + 1; j < n; j++) {
        const polyB = toGeoJSONPolygon(childRows[j]);
        if (turf.booleanIntersects(polyA, polyB)) {
          adjList[i].push(j);
          adjList[j].push(i);
        }
      }
    }

    const visited = Array(n).fill(false);
    const stack = [0];
    visited[0] = true;
    while (stack.length > 0) {
      const node = stack.pop();
      for (const neighbor of adjList[node]) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          stack.push(neighbor);
        }
      }
    }

    if (!visited.every(v => v)) {
      await connection.rollback();
      return res.status(400).json({
        message: "子单元之间未构成连通区域，请确认是否存在孤立单元"
      });
    }

    const polys = childRows.map(toPoly);
    let merged = polys[0];
    for (let i = 1; i < polys.length; i++) {
      merged = polygonClipping.union(merged, polys[i]);
    }

    const multi = Array.isArray(merged[0][0]) ? merged : [merged];
    const outerRing = multi[0][0];

    const totalUsableArea = childRows.reduce((s, u) => s + +u.usable_area, 0);
    const totalBuildArea = childRows.reduce((s, u) => s + +u.build_area, 0);
    const effectiveRate = efficiency_rate ?? childRows[0].efficiency_rate;
    const leaseArea = +(totalUsableArea / effectiveRate).toFixed(2);

    const [insertResult] = await connection.execute(
      `INSERT INTO units 
        (building_id, floor, code, status, build_area, usable_area, lease_area,
         efficiency_rate, management_fee_per_sqm,
         area_type, original_efficiency_rate, tree_path,
         rent_unit_price, remarks, orientation, layout, features,
         rect_parts,vacant_since)
       VALUES (?, ?, ?, 'vacant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        building_id,
        floor,
        code,
        totalBuildArea,
        totalUsableArea,
        leaseArea,
        effectiveRate,
        management_fee_per_sqm ?? null,
        area_type || '合同出租',
        childRows[0].original_efficiency_rate,
        '', // 先设为空，稍后更新
        rent_unit_price ?? null,
        remarks ?? null,
        orientation ?? null,
        layout ?? null,
        features ?? null,
        JSON.stringify(outerRing)
      ]
    );

    const newId = insertResult.insertId;
    const newTreePath = `${building_id}-${floor}/${newId}/`;
    await connection.execute(
      `UPDATE units SET tree_path = ? WHERE id = ?`,
      [newTreePath, newId]
    );

    await connection.execute(
      `UPDATE units SET is_deleted = 1 WHERE id IN (${placeholders})`,
      child_unit_ids
    );

    await connection.commit();
    res.json({ message: "合并成功", merged_unit_id: newId, merged_area: totalUsableArea });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error("合并失败:", err);
    res.status(500).json({ message: "合并失败", error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

//新增楼栋
app.post('/api/buildings', checkPermissionMiddleware('units:add_building'), async (req, res) => {
  const { name, address, total_floors, agent_area } = req.body;
  if (!name) {
    return res.status(400).json({ message: '楼栋名称不能为空' });
  }
  try {
    const [result] = await db.execute(
      `INSERT INTO buildings (name, address, total_floors, agent_area) VALUES (?, ?, ?, ?)`,
      [name, address || null, total_floors || null, agent_area || null]
    );
    const newId = result.insertId;
    const [rows] = await db.execute(`SELECT * FROM buildings WHERE id = ?`, [newId]);
    res.status(201).json({ message: '新增楼栋成功', building: rows[0] });
  } catch (err) {
    console.error('新增楼栋错误:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

// 新增楼层接口
app.post('/api/buildings/:bid/floors', checkPermissionMiddleware('units:add_floor'), async (req, res) => {
  const { bid } = req.params;
  const { level, build_area, usable_area } = req.body;

  if (level == null || build_area == null || usable_area == null) {
    return res.status(400).json({ message: '请填写完整的楼层信息' });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 校验楼栋是否存在
    const [bRows] = await connection.execute(
      `SELECT id FROM buildings WHERE id = ?`,
      [bid]
    );
    if (bRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: '对应楼栋不存在' });
    }

    // 生成随机 id
    const floorId = generateRandomId();

    // 整层单元信息
    const floorLabel = level;
    const unitCode = `${level}-整层`;
    const lease_area = usable_area;
    const efficiency_rate = build_area > 0 ? (usable_area / build_area).toFixed(4) : 1.0;
    const tree_path = `${bid}-${level}/`;

    // 插入整层单元
    await connection.execute(
      `INSERT INTO units 
        (id, building_id, floor, code, status, build_area, usable_area,
         original_efficiency_rate, efficiency_rate, origin_area, parent_unit_id,
         deleted, is_deleted, depth, created_at, updated_at, tree_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, NOW(), NOW(), ?)`,
      [
        floorId, bid, floorLabel, unitCode, 'unpartitioned',
        build_area, usable_area, efficiency_rate, efficiency_rate, build_area,
        tree_path
      ]
    );

    // 插入楼层记录
    await connection.execute(
      `INSERT INTO floors 
         (id, building_id, level, build_area, usable_area, remaining_usable_area)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [floorId, bid, level, build_area, usable_area, usable_area]
    );

    // 查询返回新楼层
    const [fRows] = await connection.execute(`SELECT * FROM floors WHERE id = ?`, [floorId]);

    await connection.commit();
    res.status(201).json({ message: '新增楼层成功', floor: fRows[0] });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('新增楼层错误:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

//查询楼栋列表
app.get('/api/buildings', checkPermissionMiddleware('units:read_building_card'), async (req, res) => {
  const { city, district, page = 1, size = 10 } = req.query;

  // 解析分页参数为整数
  const pageInt = parseInt(page, 10);
  const sizeInt = parseInt(size, 10);
  const offset = (pageInt - 1) * sizeInt;

  const where = [];
  const params = [];

  if (city) {
    where.push('city = ?');
    params.push(city);
  }
  if (district) {
    where.push('district = ?');
    params.push(district);
  }

  // 注入权限约束 building_ids
  const buildingIds = req.permissionConstraints.building_ids;
  if (buildingIds?.length) {
    const placeholders = buildingIds.map(() => '?').join(',');
    where.push(`id IN (${placeholders})`);
    params.push(...buildingIds);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    // 修复点: 直接拼接分页参数
    const buildingsSql = `SELECT * FROM buildings ${whereClause} LIMIT ${sizeInt} OFFSET ${offset}`;
    const [rows] = await db.execute(buildingsSql, params);

    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total FROM buildings ${whereClause}`,
      params
    );

    res.json({
      data: rows,
      pagination: {
        total: countRows[0].total,
        page: pageInt,
        size: sizeInt
      }
    });
  } catch (err) {
    console.error('查询楼栋错误:', err);
    res.status(500).json({
      message: '数据库错误',
      error: err.message
    });
  }
});

// 查询楼层列表
app.get('/api/buildings/:bid/floors', checkPermissionMiddleware('units:read_floors_list'), async (req, res) => {
  const { bid } = req.params;
  const { level, page = 1, size = 10 } = req.query;

  // 解析分页参数为整数
  const pageInt = parseInt(page, 10);
  const sizeInt = parseInt(size, 10);
  const offset = (pageInt - 1) * sizeInt;

  const where = ['building_id = ?'];
  const params = [bid];

  if (level) {
    where.push('level = ?');
    params.push(level);
  }

  const whereClause = `WHERE ${where.join(' AND ')}`;

  try {
    // 修复点1: 直接拼接分页参数
    const floorsSql = `SELECT * FROM floors ${whereClause} LIMIT ${sizeInt} OFFSET ${offset}`;
    const [rows] = await db.execute(floorsSql, params);

    // 查询总数
    const [countRows] = await db.execute(
      `SELECT COUNT(*) as total FROM floors ${whereClause}`,
      params
    );

    // 拿到楼层 level 列表
    const levels = rows.map(r => r.level);
    let leaseStatsMap = {};

    // 修复点2: 处理空数组情况
    if (levels.length > 0) {
      // 修复点3: 动态生成IN子句占位符
      const placeholders = levels.map(() => '?').join(',');

      const [statsRows] = await db.execute(`
        SELECT
          floor,
          COUNT(CASE WHEN status = 'leased' THEN 1 END) AS leased_units,
          IFNULL(SUM(CASE WHEN status = 'leased' THEN lease_area ELSE 0 END), 0) AS leased_area,
          COUNT(CASE WHEN status = 'vacant' THEN 1 END) AS vacant_units,
          IFNULL(SUM(CASE WHEN status = 'vacant' THEN lease_area ELSE 0 END), 0) AS vacant_area,
          ROUND(
            IFNULL(SUM(CASE WHEN status = 'leased' THEN lease_area ELSE 0 END), 0) /
            NULLIF(SUM(CASE WHEN status IN ('leased', 'vacant') THEN lease_area ELSE 0 END), 0),
            4
          ) AS lease_rate
        FROM units
        WHERE building_id = ? AND is_deleted = 0 AND floor IN (${placeholders})
        GROUP BY floor
      `, [bid, ...levels]);

      // 转成 map，方便合并
      leaseStatsMap = Object.fromEntries(
        statsRows.map(row => [row.floor, row])
      );
    }

    // 合并每层的统计信息
    const enhancedRows = rows.map(r => ({
      ...r,
      ...(leaseStatsMap[r.level] || {
        leased_units: 0,
        leased_area: 0,
        vacant_units: 0,
        vacant_area: 0,
        lease_rate: null
      })
    }));

    res.json({
      data: enhancedRows,
      pagination: {
        total: countRows[0].total,
        page: pageInt,
        size: sizeInt
      }
    });
  } catch (err) {
    console.error('查询楼层错误:', err);
    res.status(500).json({
      message: '数据库错误',
      error: err.message
    });
  }
});

//查询指定楼层数据
app.get('/api/buildings/:bid/floors/:level', async (req, res) => {
  const { bid, level } = req.params;
  try {
    const [rows] = await db.execute(
      'SELECT * FROM floors WHERE building_id = ? AND level = ? LIMIT 1',
      [bid, level]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: '未找到该楼层' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('查询楼层错误:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

//二次分割接口
app.post('/api/split-subunit', checkPermissionMiddleware('units:split_unit'), async (req, res) => {
  let conn;
  try {
    const { unit_id, polyline, childrenMeta } = req.body;
    if (!unit_id || !Array.isArray(polyline) || polyline.length === 0 ||
      !Array.isArray(childrenMeta) || childrenMeta.length === 0) {
      return res.status(400).json({ message: 'unit_id、polyline 及 childrenMeta 为必填，且 childrenMeta 不可为空' });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    const [unitRows] = await conn.execute(
      `SELECT * FROM units WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [unit_id]
    );
    if (unitRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: '待切割单元未找到或已被分割' });
    }
    const parent = unitRows[0];

    let rectParts = parent.rect_parts;
    if (typeof rectParts === 'string') {
      try {
        rectParts = JSON.parse(rectParts);
      } catch (e) {
        console.error('rect_parts 解析失败:', rectParts);
        await conn.rollback();
        return res.status(400).json({ message: '父单元 rect_parts 字段 JSON 解析失败' });
      }
    }

    if (!Array.isArray(rectParts) || rectParts.length < 3) {
      await conn.rollback();
      return res.status(400).json({ message: '父单元 rect_parts 数据异常，必须为长度大于 2 的数组' });
    }

    const slices = PolygonSplitter.split(rectParts, polyline);
    if (!Array.isArray(slices) || slices.length !== childrenMeta.length) {
      await conn.rollback();
      return res.status(400).json({ message: `切割结果数量(${slices.length})与 childrenMeta 长度(${childrenMeta.length})不匹配` });
    }

    // 校验所有 usable_area 总和是否等于父单元 usable_area
    const totalUsable = childrenMeta.reduce((sum, m) => sum + parseFloat(m.usable_area), 0);
    const parentUsable = parseFloat(parent.usable_area);
    if (Math.abs(totalUsable - parentUsable) > 0.01) {
      await conn.rollback();
      return res.status(400).json({
        message: `子单元总 usable_area (${totalUsable.toFixed(2)}㎡) 与父单元可用面积 (${parentUsable.toFixed(2)}㎡) 不一致`
      });
    }

    // 插入子单元
    for (let i = 0; i < slices.length; i++) {
      const ring = slices[i];
      const meta = childrenMeta[i];

      const usableArea = parseFloat(meta.usable_area);
      const leaseArea = parseFloat(meta.lease_area);
      // 计算实用率，并保留两位小数
      const efficiencyRate = parseFloat((usableArea / leaseArea).toFixed(2));
      // 计算建筑面积
      const buildArea = usableArea / parseFloat(parent.original_efficiency_rate);

      const rectJson = JSON.stringify(ring);
      const insertSql = `INSERT INTO units
        (building_id, floor, code, status, build_area, usable_area, lease_area,
         efficiency_rate, origin_area, management_fee_per_sqm, parent_unit_id,
         area_type, original_efficiency_rate, tree_path,
         rect_parts, features, rent_unit_price, remarks, orientation, layout, vacant_since)
       VALUES (?, ?, ?, 'vacant', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ? , NOW())`;
      const params = [
        parent.building_id,
        parent.floor,
        meta.code,
        buildArea,
        usableArea,
        leaseArea,
        efficiencyRate,
        parent.origin_area,
        meta.management_fee ?? null,
        parent.id,
        meta.area_type || '合同出租',
        parent.original_efficiency_rate,
        rectJson,
        meta.features ?? null,
        meta.rent_unit_price ?? null,
        meta.remarks ?? null,
        meta.orientation ?? null,
        meta.layout ?? null
      ];
      const [result] = await conn.execute(insertSql, params);
      const newId = result.insertId;
      const newTree = `${parent.tree_path}${newId}/`;
      await conn.execute(`UPDATE units SET tree_path = ? WHERE id = ?`, [newTree, newId]);
    }

    await conn.execute(`UPDATE units SET is_deleted = 1 WHERE id = ?`, [parent.id]);
    await updateFloorRemainingArea(conn, parent.building_id, parent.floor);
    await conn.commit();
    return res.status(200).json({ message: '切割成功，父单元已删除', count: slices.length });
  } catch (e) {
    if (conn) await conn.rollback();
    console.error('split-subunit error', e);
    return res.status(500).json({ message: '服务器内部错误', error: e.message });
  } finally {
    if (conn) conn.release();
  }
});

// 更新楼层画布比率和核心筒比率
app.patch('/api/floors/:id/ratios', async (req, res) => {
  const { id } = req.params;
  const { aspect_ratio, core_ratio } = req.body;

  if (aspect_ratio == null || core_ratio == null) {
    return res.status(400).json({ message: '缺少必要字段' });
  }

  try {
    const [result] = await db.execute(
      'UPDATE floors SET aspectRatioBuild = ?, aspectRatioCore = ? WHERE id = ?',
      [aspect_ratio, core_ratio, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '未找到对应楼层' });
    }

    res.json({ message: '更新成功', affectedRows: result.affectedRows });
  } catch (err) {
    console.error('更新比率失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

//更新单元信息
app.post("/api/update-unit", checkPermissionMiddleware('units:update_unit_info'), async (req, res) => {
  let connection;
  try {
    const {
      id,
      status,
      rent_unit_price,
      management_fee_per_sqm,
      orientation,
      layout,
      features,
      remarks,
      lease_area
    } = req.body;

    if (!id) {
      return res.status(400).json({ message: "Missing unit id" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [unitRows] = await connection.execute(
      `SELECT * FROM units WHERE id = ? AND is_deleted = 0 FOR UPDATE`,
      [id]
    );

    if (unitRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Unit not found" });
    }

    const unit = unitRows[0];

    const updateFields = {
      status,
      rent_unit_price,
      management_fee_per_sqm,
      orientation,
      layout,
      features,
      remarks,
      lease_area
    };

    // 只有当 lease_area 合理时才计算效率率
    if (typeof lease_area === 'number' && lease_area > 0) {
      updateFields.efficiency_rate = parseFloat((unit.usable_area / lease_area).toFixed(4));
    }

    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updateFields)) {
      if (typeof value !== 'undefined') {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (typeof status !== 'undefined' && status !== unit.status) {
      if (status === 'vacant') {
        fields.push(`vacant_since = NOW()`);
      } else {
        fields.push(`vacant_since = NULL`);
      }
    }

    if (fields.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "No updatable fields provided" });
    }

    values.push(id);

    await connection.execute(
      `UPDATE units SET ${fields.join(", ")} WHERE id = ?`,
      values
    );

    await connection.commit();
    res.status(200).json({ message: "Unit updated successfully" });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error("update-unit error:", err);
    res.status(500).json({ message: "Database error", error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// 统计出租情况（支持全楼栋、指定楼栋、指定楼层）
app.get('/api/lease-stats', checkPermissionMiddleware('units:read_lease_stats'), async (req, res) => {
  const { building_id, floor } = req.query;

  // 从鉴权中间件注入的权限信息中拿出 constraints（兼容新的权限模型）
  const { building_ids: allowedBuildingIds = [], level: allowedLevels = [] } = req.permissionConstraints;

  // 如果传入 building_id，则校验该楼栋是否在允许范围内（有权限的楼栋数组不会为空）
  if (building_id && allowedBuildingIds.length && !allowedBuildingIds.includes(Number(building_id))) {
    return res.status(403).json({ message: '你无权查看该楼栋的统计信息' });
  }

  // 如果同时传入了 floor，并且权限中有限制楼层，则也做校验
  if (floor && allowedLevels.length && !allowedLevels.includes(Number(floor))) {
    return res.status(403).json({ message: '你无权查看该楼层的统计信息' });
  }

  let sql = '';
  let params = [];
  try {
    if (building_id && floor) {
      // 指定楼栋 + 指定楼层
      sql = `
        SELECT
          b.id AS building_id,
          b.name AS building_name,
          ? AS floor_level,
          COUNT(CASE WHEN u.status = 'leased' THEN 1 END) AS leased_units,
          IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) AS leased_area,
          COUNT(CASE WHEN u.status = 'vacant' THEN 1 END) AS vacant_units,
          IFNULL(SUM(CASE WHEN u.status = 'vacant' THEN u.lease_area ELSE 0 END), 0) AS vacant_area,
          ROUND(
            IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) /
            NULLIF(SUM(CASE WHEN u.status IN ('leased', 'vacant') THEN u.lease_area ELSE 0 END), 0),
            4
          ) AS lease_rate
        FROM buildings b
        LEFT JOIN units u ON u.building_id = b.id AND u.floor = ? AND u.is_deleted = 0
        WHERE b.id = ?
        GROUP BY b.id, b.name;
      `;
      params = [floor, floor, building_id];

    } else if (building_id) {
      // 指定楼栋（所有楼层）
      sql = `
        SELECT
          b.id AS building_id,
          b.name AS building_name,
          COUNT(CASE WHEN u.status = 'leased' THEN 1 END) AS leased_units,
          IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) AS leased_area,
          COUNT(CASE WHEN u.status = 'vacant' THEN 1 END) AS vacant_units,
          IFNULL(SUM(CASE WHEN u.status = 'vacant' THEN u.lease_area ELSE 0 END), 0) AS vacant_area,
          ROUND(
            IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) /
            NULLIF(SUM(CASE WHEN u.status IN ('leased', 'vacant') THEN u.lease_area ELSE 0 END), 0),
            4
          ) AS lease_rate
        FROM buildings b
        LEFT JOIN units u ON b.id = u.building_id AND u.is_deleted = 0
        WHERE b.id = ?
        GROUP BY b.id, b.name;
      `;
      params = [building_id];

    } else {
      // 查询所有楼栋时，只统计当前用户权限范围内的楼栋
      if (allowedBuildingIds.length > 0) {
        const placeholders = allowedBuildingIds.map(() => '?').join(', ');
        sql = `
          SELECT
            b.id AS building_id,
            b.name AS building_name,
            COUNT(CASE WHEN u.status = 'leased' THEN 1 END) AS leased_units,
            IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) AS leased_area,
            COUNT(CASE WHEN u.status = 'vacant' THEN 1 END) AS vacant_units,
            IFNULL(SUM(CASE WHEN u.status = 'vacant' THEN u.lease_area ELSE 0 END), 0) AS vacant_area,
            ROUND(
              IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) /
              NULLIF(SUM(CASE WHEN u.status IN ('leased', 'vacant') THEN u.lease_area ELSE 0 END), 0),
              4
            ) AS lease_rate
          FROM buildings b
          LEFT JOIN units u ON b.id = u.building_id AND u.is_deleted = 0
          WHERE b.id IN (${placeholders})
          GROUP BY b.id, b.name;
        `;
        params = allowedBuildingIds;
      } else {
        // 若无特定约束，则默认查询所有楼栋
        sql = `
          SELECT
            b.id AS building_id,
            b.name AS building_name,
            COUNT(CASE WHEN u.status = 'leased' THEN 1 END) AS leased_units,
            IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) AS leased_area,
            COUNT(CASE WHEN u.status = 'vacant' THEN 1 END) AS vacant_units,
            IFNULL(SUM(CASE WHEN u.status = 'vacant' THEN u.lease_area ELSE 0 END), 0) AS vacant_area,
            ROUND(
              IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) /
              NULLIF(SUM(CASE WHEN u.status IN ('leased', 'vacant') THEN u.lease_area ELSE 0 END), 0),
              4
            ) AS lease_rate
          FROM buildings b
          LEFT JOIN units u ON b.id = u.building_id AND u.is_deleted = 0
          GROUP BY b.id, b.name;
        `;
      }
    }

    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('查询出租统计失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

//项目卡片
app.get('/api/building-cards', checkPermissionMiddleware('units:read_building_card'), async (req, res) => {
  const { city, district, page = 1, size = 10 } = req.query;
  const where = [];
  const params = [];

  if (city) {
    where.push('city = ?');
    params.push(city);
  }
  if (district) {
    where.push('district = ?');
    params.push(district);
  }

  // 注入权限约束 building_ids
  const buildingIds = req.permissionConstraints.building_ids;
  if (buildingIds?.length) {
    const placeholders = buildingIds.map(() => '?').join(',');
    where.push(`id IN (${placeholders})`);
    params.push(...buildingIds);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 解析分页参数为整数
  const pageInt = parseInt(page, 10);
  const sizeInt = parseInt(size, 10);
  const offset = (pageInt - 1) * sizeInt;

  try {
    // 修复点1: 直接拼接分页参数
    const buildingsSql = `SELECT * FROM buildings ${whereClause} ORDER BY id LIMIT ${sizeInt} OFFSET ${offset}`;
    const [buildings] = await db.execute(buildingsSql, params);

    if (buildings.length === 0) {
      const [countRows] = await db.execute(
        `SELECT COUNT(*) AS total FROM buildings ${whereClause}`,
        params
      );
      return res.json({
        data: [],
        pagination: {
          total: countRows[0].total,
          page: pageInt,
          size: sizeInt
        }
      });
    }

    const buildingIdsForStats = buildings.map(b => b.id);

    // 修复点2: 处理空数组情况
    let stats = [];
    if (buildingIdsForStats.length > 0) {
      // 修复点3: 动态生成IN子句占位符
      const statPlaceholders = buildingIdsForStats.map(() => '?').join(',');
      const [statsResults] = await db.query(
        `
          SELECT
            b.id AS building_id,
            COUNT(CASE WHEN u.status = 'leased' THEN 1 END) AS leased_units,
            IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) AS leased_area,
            COUNT(CASE WHEN u.status = 'vacant' THEN 1 END) AS vacant_units,
            IFNULL(SUM(CASE WHEN u.status = 'vacant' THEN u.lease_area ELSE 0 END), 0) AS vacant_area,
            ROUND(
              IFNULL(SUM(CASE WHEN u.status = 'leased' THEN u.lease_area ELSE 0 END), 0) /
              NULLIF(SUM(CASE WHEN u.status IN ('leased', 'vacant') THEN u.lease_area ELSE 0 END), 0),
              4
            ) AS lease_rate
          FROM buildings b
          LEFT JOIN units u ON b.id = u.building_id AND u.is_deleted = 0
          WHERE b.id IN (${statPlaceholders})
          GROUP BY b.id
        `,
        buildingIdsForStats
      );
      stats = statsResults;
    }

    const statsMap = {};
    stats.forEach(s => {
      statsMap[s.building_id] = s;
    });

    // 计算价格（异步并行处理）
    const pricePromises = buildingIdsForStats.map(async buildingId => {
      const total_rent_price = await calculatePrice({ buildingId }, false);
      const total_price_with_mgmt = await calculatePrice({ buildingId }, true);
      return [buildingId, { total_rent_price, total_price_with_mgmt }];
    });
    const priceResults = await Promise.all(pricePromises);
    const priceMap = Object.fromEntries(priceResults);

    const data = buildings.map(b => ({
      id: b.id,
      name: b.name,
      city: b.city,
      district: b.district,
      address: b.address,
      leased_units: statsMap[b.id]?.leased_units || 0,
      leased_area: statsMap[b.id]?.leased_area || 0,
      vacant_units: statsMap[b.id]?.vacant_units || 0,
      vacant_area: statsMap[b.id]?.vacant_area || 0,
      lease_rate: statsMap[b.id]?.lease_rate || 0,
      total_rent_price: priceMap[b.id]?.total_rent_price || 0,
      total_price_with_mgmt: priceMap[b.id]?.total_price_with_mgmt || 0
    }));

    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total FROM buildings ${whereClause}`,
      params
    );

    res.json({
      data,
      pagination: {
        total: countRows[0].total,
        page: pageInt,
        size: sizeInt
      }
    });
  } catch (err) {
    console.error('查询楼栋卡片数据失败:', err);
    res.status(500).json({
      message: '数据库错误',
      error: err.message
    });
  }
});

/*合同服务*----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 * 合同管理服务
 */
const ContractTermSplitter = require('../server_tools/contract-term-splitter-service.js');

//创建合同
app.post('/api/contracts/', checkPermissionMiddleware('contracts:create_contract'), async (req, res) => {
  const connection = await db.getConnection();
  const createdBy = req.user.id;
  try {
    const {
      contract,      // 合同主信息
      units,         // 房源信息
      termOptions,    // 额外字段：用于生成 contract_terms 的参数
      fileIds
    } = req.body;
    console.log(fileIds);
    if (!contract || !units || !termOptions || units.length === 0) {
      return res.status(400).json({ message: '缺少合同、房源或条款参数' });
    }

    await connection.beginTransaction();

    // 1. 插入 contracts
    const [contractResult] = await connection.execute(
      `INSERT INTO contracts (contract_number, tenant_id, lessor_id, parent_contract_id, sign_date, start_date, end_date, deposit_amount, payment_cycle, remarks,created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contract.contract_number,
        contract.tenant_id,
        contract.lessor_id,
        contract.parent_contract_id || null,
        contract.sign_date,
        contract.start_date,
        contract.end_date,
        contract.deposit_amount || null,
        contract.payment_cycle || 'monthly',
        contract.remarks || null,
        createdBy
      ]
    );
    const contractId = contractResult.insertId;

    // 2. 插入 contract_units
    for (const unit of units) {
      await connection.execute(
        `INSERT INTO contract_units (contract_id, unit_id, lease_area, rent_unit_price, deal_unit_price, deal_management_fee_per_sqm, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          contractId,
          unit.unit_id,
          unit.lease_area || null,
          unit.rent_unit_price || null,
          unit.deal_unit_price || null,
          unit.deal_management_fee_per_sqm || null,
          unit.remarks || null
        ]
      );
    }

    // 3. 使用拆分服务生成 contract_terms
    const totalArea = units.reduce((sum, u) => sum + (u.lease_area || 0), 0);

    const splitInput = {
      startDate: contract.start_date,
      endDate: contract.end_date,
      baseRentRate: termOptions.baseRentRate,
      serviceRate: termOptions.serviceRate,
      area: totalArea,
      increaseRules: termOptions.increaseRules || [],
      freePeriods: termOptions.freePeriods || [],
      splitMode: termOptions.splitMode || 'NATURAL_MONTH'
    };

    const termSegments = ContractTermSplitter.splitContractPeriods(splitInput);
    const safeValue = (v, defaultVal = null) => (v === undefined ? defaultVal : v);

    for (const segment of termSegments) {
      const matchedRule = getIncreaseRuleForSegment(segment.startDate, termOptions.increaseRules);

      if (matchedRule) {
        segment.increaseType = matchedRule.type;
        segment.increaseValue = matchedRule.rate;

        if (matchedRule.type === 'ANNIVERSARY') {
          segment.increaseStartYear = new Date(matchedRule.anchorDate).getFullYear();
        } else {
          segment.increaseStartYear = 0;
        }
      } else {
        segment.increaseType = 'NONE';
        segment.increaseValue = 0;
        segment.increaseStartYear = 0;
      }

      await connection.execute(
        `INSERT INTO contract_terms (
          contract_id, term_start, term_end,
          rent_unit_price, deal_unit_price, service_rate,
          is_rent_free, applied_increase_rate, remark,
          month_equivalent, total_rent, total_service_fee,
          average_monthly_rent, average_monthly_service_fee,
          increase_start_year, increase_type, increase_value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          contractId,
          segment.startDate,
          segment.endDate,
          safeValue(segment.rentUnitRate, null),
          safeValue(segment.rentUnitRate, null),
          safeValue(segment.serviceRate, null),
          segment.isFreeRent ? 1 : 0,
          safeValue(segment.appliedIncreaseRate, 1),
          safeValue(segment.remark, null),
          safeValue(segment.monthEquivalent, null),
          safeValue(segment.totalRent, null),
          safeValue(segment.totalServiceFee, null),
          safeValue(segment.averageMonthlyRent, null),
          safeValue(segment.averageMonthlyServiceFee, null),
          0, // increase_start_year 可选填充
          segment.increaseType,
          segment.increaseValue
        ]
      );
    }
    // 4. 关联文件
    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      await connection.query(
        `UPDATE files SET business_id = ? WHERE id IN (?)`,
        [contractId, fileIds]
      );
    }

    await connection.commit();

    await unitSyncService.publishChange(contractId, 'draft');

    res.status(201).json({ message: '合同、房源、租期条款创建成功', contractId });

  } catch (err) {
    await connection.rollback();
    console.error('创建合同失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  } finally {
    connection.release();
  }
});

// 编辑合同
app.put('/api/contracts/:id', checkPermissionMiddleware('contracts:edit_contract'), async (req, res) => {
  const connection = await db.getConnection();
  const updatedBy = req.user.id;
  const contractId = req.params.id;

  try {
    const { contract, units, termOptions } = req.body;

    if (!contract || !units || !termOptions || units.length === 0) {
      return res.status(400).json({ message: '缺少合同、房源或条款参数' });
    }

    await connection.beginTransaction();

    // 1. 更新 contracts 主表
    await connection.execute(
      `UPDATE contracts SET 
         contract_number = ?, tenant_id = ?, lessor_id = ?, parent_contract_id = ?,
         sign_date = ?, start_date = ?, end_date = ?, deposit_amount = ?, 
         payment_cycle = ?, remarks = ?, updated_by = ?
       WHERE id = ?`,
      [
        contract.contract_number,
        contract.tenant_id,
        contract.lessor_id,
        contract.parent_contract_id || null,
        contract.sign_date,
        contract.start_date,
        contract.end_date,
        contract.deposit_amount || null,
        contract.payment_cycle || 'monthly',
        contract.remarks || null,
        updatedBy,
        contractId
      ]
    );

    // 2. 删除原有 contract_units 并重新插入
    await connection.execute(`DELETE FROM contract_units WHERE contract_id = ?`, [contractId]);

    const globalServiceRate = termOptions.serviceRate || 0;

    for (const unit of units) {
      await connection.execute(
        `INSERT INTO contract_units (
          contract_id, unit_id, lease_area, rent_unit_price, deal_unit_price, deal_management_fee_per_sqm, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          contractId,
          unit.unit_id,
          unit.lease_area || null,
          unit.rent_unit_price || null,
          unit.deal_unit_price || null,
          unit.deal_management_fee_per_sqm || globalServiceRate, // ✅ 优先取 unit 值，否则用 termOptions.serviceRate
          unit.remarks || null
        ]
      );
    }

    // 3. 删除原有 contract_terms 并重新生成
    await connection.execute(`DELETE FROM contract_terms WHERE contract_id = ?`, [contractId]);

    const totalArea = units.reduce((sum, u) => sum + (u.lease_area || 0), 0);

    const splitInput = {
      startDate: contract.start_date,
      endDate: contract.end_date,
      baseRentRate: termOptions.baseRentRate,
      serviceRate: termOptions.serviceRate,
      area: totalArea,
      increaseRules: termOptions.increaseRules || [],
      freePeriods: termOptions.freePeriods || [],
      splitMode: termOptions.splitMode || 'NATURAL_MONTH'
    };

    const termSegments = ContractTermSplitter.splitContractPeriods(splitInput);

    const safeValue = (v, defaultVal = null) => (v === undefined ? defaultVal : v);

    for (const segment of termSegments) {
      const matchedRule = getIncreaseRuleForSegment(segment.startDate, termOptions.increaseRules);

      let increaseType = 'NONE';
      let increaseValue = 0;
      let increaseStartYear = 0;

      if (matchedRule) {
        increaseType = matchedRule.type || 'NONE';
        increaseValue = matchedRule.rate || 0;
        if (matchedRule.type === 'ANNIVERSARY' && matchedRule.anchorDate) {
          increaseStartYear = new Date(matchedRule.anchorDate).getFullYear();
        }
      }

      await connection.execute(
        `INSERT INTO contract_terms (
          contract_id, term_start, term_end,
          rent_unit_price, deal_unit_price, service_rate,
          is_rent_free, applied_increase_rate, remark,
          month_equivalent, total_rent, total_service_fee,
          average_monthly_rent, average_monthly_service_fee,
          increase_start_year, increase_type, increase_value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          contractId,
          safeValue(segment.startDate),
          safeValue(segment.endDate),
          safeValue(segment.rentUnitRate, 0),
          safeValue(segment.rentUnitRate, 0),
          safeValue(segment.serviceRate, 0),
          segment.isFreeRent ? 1 : 0,
          safeValue(segment.appliedIncreaseRate, 1),
          safeValue(segment.remark, null),
          safeValue(segment.monthEquivalent, 0),
          safeValue(segment.totalRent, 0),
          safeValue(segment.totalServiceFee, 0),
          safeValue(segment.averageMonthlyRent, 0),
          safeValue(segment.averageMonthlyServiceFee, 0),
          increaseStartYear,
          increaseType,
          increaseValue
        ]
      );
    }
    // 4. 处理文件关联（与合同绑定）
    const files = req.body.files || [];
    if (files.length) {
      for (const f of files) {
        await connection.execute(
          `UPDATE files SET business_id = ? WHERE id = ?`,
          [contractId, f.id]
        );
      }
    }

    await connection.commit();
    res.status(200).json({ message: '合同信息、房源、租期条款、文件更新成功' });

  } catch (err) {
    await connection.rollback();
    console.error('编辑合同失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  } finally {
    connection.release();
  }
});

// 删除合同（仅允许删除草稿状态）
app.delete('/api/contracts/:id', checkPermissionMiddleware('contracts:delete_contract'), async (req, res) => {
  const connection = await db.getConnection();
  const contractId = req.params.id;

  try {
    await connection.beginTransaction();

    // 1️⃣ 锁定合同并校验状态
    const [contracts] = await connection.execute(
      `SELECT id, status FROM contracts WHERE id = ? FOR UPDATE`,
      [contractId]
    );

    if (!contracts.length) {
      await connection.rollback();
      return res.status(404).json({ message: '合同不存在' });
    }

    const contract = contracts[0];
    if (contract.status !== 'draft') {
      await connection.rollback();
      return res
        .status(400)
        .json({ message: '仅允许删除草稿状态的合同' });
    }

    // 2️⃣ 解除文件绑定（软删除）
    await connection.execute(
      `UPDATE files SET business_id = NULL WHERE business_id = ?`,
      [contractId]
    );

    // 3️⃣ 删除合同条款
    await connection.execute(
      `DELETE FROM contract_terms WHERE contract_id = ?`,
      [contractId]
    );

    // 4️⃣ 查询合同关联单元（删除前先拿出单元 ID）
    const [unitRows] = await connection.execute(
      `SELECT unit_id FROM contract_units WHERE contract_id = ?`,
      [contractId]
    );
    const unitIds = unitRows.map(r => r.unit_id);

    // 5️⃣ 删除合同关联单元
    await connection.execute(
      `DELETE FROM contract_units WHERE contract_id = ?`,
      [contractId]
    );

    // 6️⃣ 删除合同本身
    await connection.execute(
      `DELETE FROM contracts WHERE id = ?`,
      [contractId]
    );

    await connection.commit();

    // 7️⃣ 发布删除消息，带上单元 ID
    await unitSyncService.publishDelete(contractId, unitIds);

    res.json({
      message: '合同及其关联数据已删除（文件已解除绑定）',
    });
  } catch (err) {
    await connection.rollback();
    console.error('删除合同失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  } finally {
    connection.release();
  }
}
);

// 查询合同详情接口：根据合同 ID 查询完整信息
app.get('/api/contracts/:id', checkPermissionMiddleware('contracts:read_contract_details'), async (req, res) => {
  const connection = await db.getConnection();
  const contractId = req.params.id;

  try {
    // 1. 查询合同主信息，关联租户和出租人
    const [contracts] = await connection.execute(
      `SELECT c.*, t.name AS tenant_name, l.name AS lessor_name
       FROM contracts c
       LEFT JOIN tenants t ON c.tenant_id = t.id
       LEFT JOIN lessors l ON c.lessor_id = l.id
       WHERE c.id = ?`,
      [contractId]
    );

    if (contracts.length === 0) {
      return res.status(404).json({ message: '合同不存在' });
    }

    const contract = contracts[0];

    // 2. 查询房源信息（带 unit.code 和 building.name）
    const [units] = await connection.execute(
      `SELECT 
         cu.*, 
         u.code AS unit_code, 
         b.name AS building_name
       FROM contract_units cu
       LEFT JOIN units u ON cu.unit_id = u.id
       LEFT JOIN buildings b ON u.building_id = b.id
       WHERE cu.contract_id = ?`,
      [contractId]
    );

    // 3. 查询租期条款
    const [terms] = await connection.execute(
      `SELECT *
       FROM contract_terms
       WHERE contract_id = ?
       ORDER BY term_start ASC`,
      [contractId]
    );

    // 4. 查询合同文件
    const [files] = await connection.execute(
      `SELECT id, relative_path AS name
      FROM files
      WHERE business_id = ? AND is_deleted = 0`,
      [contractId]
    );

    const filesWithUrl = files.map(f => ({
      id: f.id,
      name: f.name,
      url: `/api/files/download/${f.id}`
    }));

    // 5. 把 lessor_name 放到 contract.lessor 对象里
    const result = formatDateFieldsDeep({
      contract,
      units,
      terms,
      files: filesWithUrl
    });

    result.contract.lessor = {
      id: contract.lessor_id,
      name: contract.lessor_name || null
    };

    res.json(result);

  } catch (err) {
    console.error('获取合同详情失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  } finally {
    connection.release();
  }
});

//查询合同列表
app.get('/api/contractsList', checkPermissionMiddleware('contracts:contracts_list'), async (req, res) => {
  const userId = req.user.id;
  const scope = req.permissionScope;
  const constraints = req.permissionConstraints || {};

  const {
    contract_number,
    status,
    sign_date_start,
    sign_date_end,
    building_id,
    building_name,
    page = 1,
    page_size = 10
  } = req.query;

  // 解析分页参数为整数
  const pageInt = parseInt(page, 10);
  const pageSizeInt = parseInt(page_size, 10);
  const offset = (pageInt - 1) * pageSizeInt;

  const conditions = [];
  const params = [];

  if (contract_number) {
    conditions.push('c.contract_number LIKE ?');
    params.push(`%${contract_number}%`);
  }

  if (status) {
    conditions.push('c.status = ?');
    params.push(status);
  }

  if (sign_date_start) {
    conditions.push('c.sign_date >= ?');
    params.push(sign_date_start);
  }

  if (sign_date_end) {
    conditions.push('c.sign_date <= ?');
    params.push(sign_date_end);
  }

  if (building_id) {
    conditions.push('b.id = ?');
    params.push(building_id);
  }

  if (building_name) {
    conditions.push('b.name LIKE ?');
    params.push(`%${building_name}%`);
  }

  // 权限作用域处理
  if (scope === 'own') {
    conditions.push('c.created_by = ?');
    params.push(userId);
  }

  // 权限 constraints 处理：building_ids
  if (Array.isArray(constraints.building_ids) && constraints.building_ids.length > 0) {
    const placeholders = constraints.building_ids.map(() => '?').join(', ');
    conditions.push('b.id IN (' + placeholders + ')');
    params.push(...constraints.building_ids);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    // 总数查询
    const countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM contracts c
      LEFT JOIN contract_units cu ON cu.contract_id = c.id
      LEFT JOIN units u ON u.id = cu.unit_id
      LEFT JOIN buildings b ON u.building_id = b.id
      ${whereClause}
    `;
    const [countRows] = await db.execute(countQuery, params);
    const total = countRows[0].total;

    // 数据查询 - 修复点: 直接拼接分页参数
    const dataQuery = `
      SELECT 
        c.id, c.contract_number, c.tenant_id, t.name AS tenant_name,
        c.sign_date, c.start_date, c.end_date,
        c.deposit_amount, c.payment_cycle, c.status, c.remarks,
        GROUP_CONCAT(DISTINCT u.code) AS unit_codes,
        GROUP_CONCAT(DISTINCT b.name) AS building_names
      FROM contracts c
      LEFT JOIN tenants t ON c.tenant_id = t.id
      LEFT JOIN contract_units cu ON cu.contract_id = c.id
      LEFT JOIN units u ON u.id = cu.unit_id
      LEFT JOIN buildings b ON u.building_id = b.id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.sign_date DESC
      LIMIT ${pageSizeInt} OFFSET ${offset}
    `;

    // 执行查询（不再需要分页参数）
    const [rows] = await db.execute(dataQuery, params);

    res.json(formatDateFieldsDeep({
      data: rows,
      pagination: {
        page: pageInt,
        page_size: pageSizeInt,
        total
      }
    }));
  } catch (err) {
    console.error('合同分页查询失败:', err);
    res.status(500).json({
      message: '数据库错误',
      error: err.message
    });
  }
});

//承租人下拉列表
app.get('/api/tenants/dropdown', async (req, res) => {
  const { q } = req.query;
  try {
    let sql = 'SELECT id, name FROM tenants';
    const params = [];

    if (q) {
      sql += ' WHERE name LIKE ?';
      params.push(`%${q}%`);
    }

    sql += ' ORDER BY name';

    const [rows] = await db.execute(sql, params);

    res.json({ tenants: rows });
  } catch (err) {
    console.error('获取租户列表失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

//出租人下拉列表
app.get('/api/lessors/dropdown', async (req, res) => {
  const { q } = req.query;

  try {
    let sql = 'SELECT id, name FROM lessors';
    const params = [];

    if (q) {
      sql += ' WHERE name LIKE ?';
      params.push(`%${q}%`);
    }

    sql += ' ORDER BY name';

    const [rows] = await db.execute(sql, params);

    res.json({ lessors: rows });
  } catch (err) {
    console.error('获取出租人列表失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

//出租人完整列表
app.get('/api/lessors/list', checkPermissionMiddleware('contract:read_lessor_list'), async (req, res) => {
  const { q } = req.query;
  try {
    let sql = 'SELECT * FROM lessors';
    const params = [];

    if (q) {
      sql += ' WHERE name LIKE ?';
      params.push(`%${q}%`);
    }

    sql += ' ORDER BY name';

    const [rows] = await db.execute(sql, params);

    res.json({ lessors: rows });
  } catch (err) {
    console.error('获取出租人列表失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

//新增出租主体
app.post('/api/lessors', checkPermissionMiddleware('contracts:add_lessor'), async (req, res) => {
  const {
    name,
    contact_person,
    contact_phone,
    email,
    address,
    legal_person,
    tax_number,
    bank_account_number,
    bank_name,
    remarks
  } = req.body;

  // 转换 undefined 为 null
  const safeParams = {
    name,
    contact_person: contact_person || null,
    contact_phone: contact_phone || null,
    email: email || null,
    address: address || null,
    legal_person: legal_person || null,
    tax_number: tax_number || null,
    bank_account_number: bank_account_number || null,
    bank_name: bank_name || null,
    remarks: remarks || null
  };

  try {
    // 插入 SQL 语句
    const sql = `
      INSERT INTO lessors (name, contact_person, contact_phone, email, address, 
                           legal_person, tax_number, bank_account_number, 
                           bank_name, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // 参数数组
    const params = [
      safeParams.name,
      safeParams.contact_person,
      safeParams.contact_phone,
      safeParams.email,
      safeParams.address,
      safeParams.legal_person,
      safeParams.tax_number,
      safeParams.bank_account_number,
      safeParams.bank_name,
      safeParams.remarks
    ];

    // 执行插入操作
    const [result] = await db.execute(sql, params);

    // 返回新增的出租人数据
    res.status(201).json({
      message: '出租人新增成功',
      lessor: {
        id: result.insertId,
        ...safeParams // 返回所有字段
      }
    });
  } catch (err) {
    console.error('新增出租人失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

//删除出租人
app.delete('/api/lessors/:id', checkPermissionMiddleware('contracts:delete_lessor'), async (req, res) => {
  const lessorId = req.params.id;
  let connection;
  try {
    connection = await db.getConnection();

    // 1. 检查出租人是否存在
    const [checkResult] = await connection.execute(
      `SELECT id FROM lessors WHERE id = ?`,
      [lessorId]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: `出租人ID ${lessorId} 不存在`
      });
    }

    // 2. 检查关联合同
    const [contractsResult] = await connection.execute(
      `SELECT COUNT(*) AS contract_count FROM contracts WHERE lessor_id = ?`,
      [lessorId]
    );
    const contractCount = contractsResult[0].contract_count;
    if (contractCount > 0) {
      return res.status(409).json({
        success: false,
        message: `无法删除出租人，存在 ${contractCount} 个关联合同`,
        error_code: "RELATED_CONTRACTS_EXIST"
      });
    }

    // 3. 执行删除
    await connection.execute(
      `DELETE FROM lessors WHERE id = ?`,
      [lessorId]
    );

    res.status(200).json({
      success: true,
      message: `出租人ID ${lessorId} 删除成功`,
      deleted_id: lessorId
    });

  } catch (err) {
    console.error(`删除出租人失败 (ID: ${lessorId}):`, err);

    // 处理外键约束错误
    if (err.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({
        success: false,
        message: "无法删除出租人，存在关联数据",
        error_code: "RELATED_DATA_EXISTS"
      });
    }

    res.status(500).json({
      success: false,
      message: "数据库操作失败",
      error: err.message,
      error_code: "DATABASE_ERROR"
    });
  } finally {
    if (connection) connection.release();
  }
});

//编辑出租人信息
app.put('/api/lessors/:id', checkPermissionMiddleware('contracts:edit_lessor_info'), async (req, res) => {
  const { id } = req.params; // 获取 URL 参数中的出租人 ID
  const {
    name,
    contact_person,
    contact_phone,
    email,
    address,
    legal_person,
    tax_number,
    bank_account_number,
    bank_name,
    remarks
  } = req.body;

  // 转换 undefined 为 null
  const safeParams = {
    name,
    contact_person: contact_person || null,
    contact_phone: contact_phone || null,
    email: email || null,
    address: address || null,
    legal_person: legal_person || null,
    tax_number: tax_number || null,
    bank_account_number: bank_account_number || null,
    bank_name: bank_name || null,
    remarks: remarks || null
  };

  try {
    // 检查出租人是否存在
    const checkSql = `SELECT id FROM lessors WHERE id = ?`;
    const [checkResult] = await db.execute(checkSql, [id]);

    if (checkResult.length === 0) {
      return res.status(404).json({ message: '出租人不存在' });
    }

    // 更新 SQL 语句
    const updateSql = `
      UPDATE lessors
      SET 
        name = ?, 
        contact_person = ?, 
        contact_phone = ?, 
        email = ?, 
        address = ?, 
        legal_person = ?, 
        tax_number = ?, 
        bank_account_number = ?, 
        bank_name = ?, 
        remarks = ?
      WHERE id = ?
    `;

    // 参数数组
    const params = [
      safeParams.name,
      safeParams.contact_person,
      safeParams.contact_phone,
      safeParams.email,
      safeParams.address,
      safeParams.legal_person,
      safeParams.tax_number,
      safeParams.bank_account_number,
      safeParams.bank_name,
      safeParams.remarks,
      id // 更新条件
    ];

    // 执行更新操作
    const [result] = await db.execute(updateSql, params);

    if (result.affectedRows === 0) {
      return res.status(400).json({ message: '出租人更新失败' });
    }

    // 返回更新后的出租人数据
    res.status(200).json({
      message: '出租人更新成功',
      lessor: {
        id,
        ...safeParams // 返回所有字段
      }
    });
  } catch (err) {
    console.error('编辑出租人失败:', err);
    res.status(500).json({ message: '数据库错误', error: err.message });
  }
});

// 手动清除某个用户的权限缓存(临时用)
app.post('/api/cache/refresh-node_cache-permissions/:userId', (req, res) => {
  const userId = req.params.userId;
  const cacheKey = `permissions:${userId}`;
  cache.del(cacheKey);
  res.json({ success: true, message: `已刷新用户${userId}的权限缓存` });
});

app.post('/api/cache/refresh-redis-permissions/:userId', async (req, res) => {
  const userId = req.params.userId;
  const cacheKey = `permissions:${userId}`;

  try {
    await redisClient.del(cacheKey);
    res.json({ success: true, message: `已刷新用户 ${userId} 的权限缓存` });
  } catch (err) {
    console.error('刷新缓存失败:', err);
    res.status(500).json({ success: false, message: '刷新权限缓存失败', error: err.message });
  }
});

// 通用文件上传接口
app.post('/upload', (req, res) => {
  // 先用 array()，允许多文件
  const uploadHandler = uploader.array('files', 5);

  uploadHandler(req, res, async function (err) {
    if (err) {
      return res.status(500).send({
        success: false,
        message: '文件上传失败',
        error: err.message
      });
    }

    try {
      // 单文件上传（前端 name="file"）
      if (req.file) {
        const id = await saveFileRecord(req.file, { uploader_id: req.user?.id });
        return res.status(200).send({
          success: true,
          message: '单文件上传成功',
          files: [{ id, name: req.file.originalname, path: req.file.path }]
        });
      }

      // 多文件上传（前端 name="files"）
      if (req.files && req.files.length > 0) {
        const records = [];
        for (const f of req.files) {
          const id = await saveFileRecord(f, { uploader_id: req.user?.id });
          records.push({ id, name: f.originalname, path: f.path });
        }
        return res.status(200).send({
          success: true,
          message: '多文件上传成功',
          files: records
        });
      }

      // 没有文件
      return res.status(400).send({
        success: false,
        message: '没有文件被上传'
      });

    } catch (dbErr) {
      console.error(dbErr);
      return res.status(500).send({
        success: false,
        message: '写入数据库失败',
        error: dbErr.message
      });
    }
  });
});

//下载文件
app.get('/api/files/download/:id', checkPermissionMiddleware('files:download'), async (req, res) => {
  const fileId = req.params.id;
  const connection = await db.getConnection();

  try {
    const [rows] = await connection.execute('SELECT * FROM files WHERE id = ? AND is_deleted = 0', [fileId]);
    if (!rows.length) return res.status(404).json({ success: false, message: '文件不存在' });

    const file = rows[0];
    const filePath = path.join(UPLOAD_DIR, file.relative_path);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在于服务器' });
    }

    res.download(filePath, file.file_name);

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    connection.release();
  }
});

//文件删除
app.post('/file/delete', checkPermissionMiddleware('files:delete'), async (req, res) => {
  const fileId = req.body.id;
  const connection = await db.getConnection();

  try {
    const [rows] = await connection.execute(
      'SELECT * FROM files WHERE id = ? AND is_deleted = 0',
      [fileId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: '文件不存在或已删除' });
    }

    const file = rows[0];
    const filePath = path.join(UPLOAD_DIR, file.relative_path);

    // 先尝试删除物理文件
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn('物理文件删除失败:', err.message);
      // 即使物理文件删除失败，也要更新 DB
    }

    // 更新数据库元信息删除
    await connection.execute('DELETE FROM files WHERE id = ?', [fileId]);

    return res.json({
      success: true,
      message: '文件删除成功',
      file: { id: file.id, name: file.file_name }
    });

  } catch (err) {
    console.error('删除文件错误:', err);
    return res.status(500).json({ success: false, message: '服务器错误' });
  } finally {
    connection.release();
  }
});

unitSyncService.init()
  .then(() => console.log('[UnitSyncService] Ready to sync units'))
  .catch(console.error);

// 启动服务器
const PORT = process.env.PORT
app.listen(PORT, () => {
  logger.info(`服务器运行在${PORT}`);
});

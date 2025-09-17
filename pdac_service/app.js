const express = require('express');
require('dotenv').config();
const path = require('path');
const { initAll } = require('./utils/permissionInit');
const cors = require('cors');
const axios = require('axios');

const app = express();

let accessToken = null;
let tokenExpiresAt = 0;

// CORS 配置
const corsOptions = {
  origin: ['http://host3001'], // 可以根据需要添加多个来源
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-custom-header'],
  credentials: true,
};

app.use(cors(corsOptions));

const frontendPath = path.resolve('C:/Server/bak/pdac-admin');
app.use(express.static(frontendPath));

const userRoute = require('./auth/routes/userRoute');
const permissionRoute = require('./auth/routes/permissionRoute');
const rolesRoutes = require('./auth/routes/roleRoute');
const rolePermissionsRoute = require('./auth/routes/rolePermissionRoute');
const resourceRoute = require('./auth/routes/resourceRoute');
const workflowRoute = require('./workflow/routes/workflowDefintionRoute');
const workflowInstanceRoute = require('./workflow/routes/workflowInstanceRoute');
const workflowTaskRoute = require('./workflow/routes/workflowTaskRoute');

app.use(express.json());

app.use('/config', express.static(path.join(__dirname, '/auth/config')));
app.use('/users', userRoute);
app.use('/permissions', permissionRoute);
app.use('/roles', rolesRoutes);
app.use('/roles_permissions', rolePermissionsRoute);
app.use('/resource', resourceRoute);
app.use('/workflow', workflowRoute);
app.use('/workflow_instances', workflowInstanceRoute);
app.use('/task', workflowTaskRoute);

// 确保 token 有效
async function refreshAccessToken() {
  try {
    const res = await axios.post('http://host:3001/api/proxy?endpoint=login', {
      "group": "admin",
      "id": 1
    });

    accessToken = res.data.token;
    tokenExpiresAt = Date.now() + (res.data.expires_in || 3600) * 1000 - 60000;
    console.log('Token 刷新成功');
  } catch (err) {
    console.error('获取 Token 失败:', err.message);
    throw err;
  }
}

// 确保 token 是有效的
async function ensureValidToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    await refreshAccessToken();
  }
}

// 楼栋列表中转接口
app.get('/internal/buildings', async (req, res) => {
  try {
    await ensureValidToken();
    const result = await axios.get('http://host:3001/api/buildings', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.json({ success: true, data: result.data });
  } catch (err) {
    console.error(' 获取楼栋失败:', err.message);
    res.status(500).json({ success: false, message: '获取楼栋失败', error: err.message });
  }
});

// 处理预检请求
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).end();
});

//消息队列监听
const unitSyncService = require('../mq_services/unitSyncService');
unitSyncService.init()
  .then(() => console.log('[UnitSyncService] Ready to sync units'))
  .catch(console.error);

// 启动服务器
const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`PDAC 权限服务已启动，监听端口 ${PORT}`);
  initAll();
});

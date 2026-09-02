# 香港裸 IP H5 联调环境

## 定位

该环境只用于 ICP 备案完成前的网页联调和验收，不是微信小程序体验版或正式版部署方案。

- H5：`http://149.104.21.74:8080`
- API：`http://149.104.21.74:3200/api/v1`
- 健康检查：`http://149.104.21.74:3200/api/v1/health`
- 数据：独立 PostgreSQL Docker 卷，仅包含种子测试数据
- 支付、短信：mock
- 微信登录：未配置；使用页面中明确标记的九类测试身份

不要向该环境录入真实姓名、手机号、订单、支付或经营数据。裸 IP HTTP 没有传输加密，任何真实数据都不满足上线安全要求。

## 桌面移动画布

H5 在小于 600px 的浏览器上使用设备原生宽度；桌面宽度达到 600px 后，页面、标题栏和底部导航统一固定为 390px，并居中显示。该行为用于让验收人员直接使用普通桌面浏览器，不再依赖手动打开设备模拟器或调整浏览器窗口。

这不是桌面响应式后台：经营工作台和所有业务页面仍按同一个手机用户旅程验收。

## 部署

复制环境变量模板，所有密钥必须随机生成，文件权限设置为 `600`：

```bash
cp deploy/.env.staging.example deploy/.env.staging
docker compose --env-file deploy/.env.staging \
  -f deploy/docker-compose.staging.yml up -d --build
docker compose --env-file deploy/.env.staging \
  -f deploy/docker-compose.staging.yml exec api \
  pnpm --dir apps/api db:seed
```

查看状态和日志：

```bash
docker compose --env-file deploy/.env.staging \
  -f deploy/docker-compose.staging.yml ps
docker compose --env-file deploy/.env.staging \
  -f deploy/docker-compose.staging.yml logs --tail=100 api h5
```

## 隔离与切换

- 容器、数据库卷和本地存储卷均使用 `yanqing-staging` 项目名，不复用 Agent Mail 或服务器已有 PostgreSQL。
- 数据库不映射宿主机端口；公网只暴露测试 H5 `8080` 和 API `3200`。
- `VITE_ENABLE_REMOTE_DEV_LOGIN=true` 只在 staging H5 镜像构建参数中设置；正式构建默认关闭。
- 正式域名可用后，将小程序构建切换到 `VITE_DATA_MODE=remote` 和 `https://api.yutechhn.cn/api/v1`，并使用 `NODE_ENV=production`，此时 API 拒绝开发登录。

## 停止环境

停止容器但保留测试数据：

```bash
docker compose --env-file deploy/.env.staging \
  -f deploy/docker-compose.staging.yml down
```

不要使用 `down -v`，除非已经确认要永久删除整套测试数据库和本地存储。

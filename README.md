# 延庆金羽羽毛球会员生态系统

面向延庆羽毛球馆的全栈业务系统，覆盖会员及前台、教练、球局主理人、赛事、联盟商户、财务和管理员等运营角色。会员主端采用 uni-app + Vue 3，可编译为微信小程序；后端采用 NestJS + Prisma + PostgreSQL；仓库原有 Next.js 界面作为 Web 运营台保留。

## 已实现范围

- 20 片场地、8 个时段、有效期价格规则、10 分钟锁场、支付后确认与扫码签到。
- 会员等级、会员卡、充值、现金本金/赠送余额/羽毛球币/成人赛事积分/青少年成长积分五账户隔离。
- 主理人申请与审批、球局创建/报名/签到、按实际到场人数结算激励。
- 固定双打瑞士制赛事：24 人成赛、48 人封顶、默认 5 轮、单局 21 分且 20 平不加分、三类组合让分、比分纠错与积分归档。
- 成人及青少年培训、监护人授权、排课占场、签到消课、预收余额、退款和独立经营账。
- 培训有效收入的 20% 计入场馆合同收入；培训场地费和场馆应付培训款恒为 0。数据库、服务层和测试三层保护。
- 唯一联盟券领取/扫码核销/重复核销风险记录、商户独立收款、消费归因、拉新和 ROI 结算。
- 采购/寄售库存、商品下单、支付出库、整单退款回库、低库存预警。
- 老板驾驶舱、Excel 导出、审计日志、风险事件、角色权限、参数历史版本。
- 小程序员工端按 B 端经营对象重构：今日营业、交易中心、场馆资源、会员服务、培训运营、球局运营、赛事运营、联盟商户、商品库存和财务结算；不再把会员端页面作为员工后台入口。

需求到实现的逐项映射见 [docs/requirements-traceability.md](docs/requirements-traceability.md)。

## 目录

```text
apps/api       NestJS API、Prisma 模型、迁移与种子数据
apps/miniapp   uni-app 微信小程序
packages/shared 可测试的金额、账户、瑞士制、让分等领域规则
app            原仓库 Next.js Web 运营台
docs           架构、接口、部署、安全和验收文档
```

## 本地启动

要求 Node.js 24、pnpm 11、PostgreSQL 17（或 Docker）。

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/miniapp/.env.example apps/miniapp/.env
docker compose up -d postgres
pnpm --dir apps/api db:deploy
pnpm --dir apps/api db:seed
pnpm dev:api
```

API 默认地址为 `http://127.0.0.1:3200/api/v1`，Swagger 位于 `http://127.0.0.1:3200/docs`。当前小程序演示构建默认使用本地模拟数据，不依赖服务器；模拟数据按认证、场地订单、活动培训、会员商品模块拆分，管理员入口位于“我的 → 管理员演示通道”。要连接真实 API 时设置：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:3200/api/v1
VITE_DATA_MODE=remote
```

不设置 `VITE_DATA_MODE` 或设为 `mock` 时，所有页面调用会由小程序本地 mock 路由处理，订单和身份状态保存在微信本地缓存。管理员切换页位于独立 `packages/admin` 分包。

另开终端执行：

```bash
pnpm dev:miniapp
```

然后在微信开发者工具导入 `apps/miniapp/dist/dev/mp-weixin`。生产构建执行 `pnpm build:miniapp`，导入 `apps/miniapp/dist/build/mp-weixin`。当前仓库已配置测试 AppID `wxa457599ec4c27ad1`，构建产物的 `project.config.json` 固定为微信小程序模式（`compileType: "miniprogram"`）。正式发布前必须在 `apps/miniapp/src/manifest.json` 的 `mp-weixin.appid` 换成发布方有权限的 AppID，并在微信公众平台配置 HTTPS API 业务域名。

微信开发者工具导入、测试 AppID、模拟/远端联调、角色切换、上传和真机验收请按 [docs/wechat-devtools.md](docs/wechat-devtools.md) 操作；不要导入 `apps/miniapp` 源码目录或 `dist` 上一级目录。

开发/mock 构建的登录页提供角色快捷入口；只有在 `VITE_DATA_MODE=remote` 下生成的生产构建才只显示微信登录。种子数据为每种角色准备了测试用户，详见 [docs/deployment.md](docs/deployment.md)。

## 一键校验

```bash
pnpm verify        # 领域规则、API 单元/E2E、API 构建、小程序类型与微信构建
pnpm verify:full   # 额外构建 Next.js Web 运营台
```

当前自动化基线为 shared 13 项、API 单元 293 项、小程序 19 项、健康接口 E2E 1 项（2026-08-30 最近一次整合运行）；用例持续增加时以命令实际输出为准。微信开发者工具和真机验收不由 CI 模拟，须按 [docs/acceptance.md](docs/acceptance.md) 和 [docs/wechat-devtools.md](docs/wechat-devtools.md) 逐项记录。

## 生产部署

```bash
cp apps/api/.env.example apps/api/.env
# 设置强 JWT_SECRET、数据库、微信 AppID/Secret、CORS 和供应商配置
docker compose up -d --build
```

API 容器启动时会执行 Prisma 迁移。生产环境必须使用 HTTPS 反向代理、托管 PostgreSQL 备份、密钥管理服务和对象存储；不要提交 `.env`。完整步骤和上线清单见 [docs/deployment.md](docs/deployment.md)。

## 关键设计边界

- 推荐关系只有一层直接推荐；不存在团队、下线或多级返佣。
- 联盟商户自行收款，场馆会员余额不能在商户端支付。
- 培训收入按真实消课确认，不以课包收款时点一次性确认。
- 金额均用整数“分”存储；参数采用生效时间版本，订单保存参数快照。
- 所有后台写操作受角色守卫保护；人工调账、比分修正、券核销、退款、参数和导出均留审计记录。

更多内容：

- [系统架构](docs/architecture.md)
- [API 与角色矩阵](docs/api.md)
- [部署与微信发布](docs/deployment.md)
- [微信开发者工具与测试 AppID 验收](docs/wechat-devtools.md)
- [安全与隐私](docs/security-privacy.md)
- [验收手册](docs/acceptance.md)

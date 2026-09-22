# 上游视觉原型（非生产）

此目录保留 Next.js / React 的原始演示页面和本地状态，用于追溯视觉与需求背景。它未接入正式 API，不代表真实库存、订单、支付或权限。

在仓库根目录执行 `pnpm dev:legacy-web` 或 `pnpm build:legacy-web`。本包拥有独立依赖与 TypeScript/Next 配置；正式构建、部署和业务验收只包含 `apps/api`、`apps/miniapp`、`apps/admin` 及 `packages/shared`。

不要从生产应用导入此目录。可复用的真实业务规则应放入 `packages/shared`，正式界面应在对应应用中实现。

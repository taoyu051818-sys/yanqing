# 2026-09-05 头像访问与订单筛选修复

## 现场原因与处理

1. 14:23 的头像上传返回 201、资料更新返回 200，随后图片 GET 连续 404。文件实际存在（3933 字节），本机 API 图片访问为 200；线上 Nginx 只代理 `/api/v1/`，遗漏 `/uploads/`。
   - 补齐上传资源反向代理并通过 `nginx -t` 后平滑重载。
   - 实际已上传头像的公网 HTTPS 返回 200 / image/jpeg，未要求用户重新上传。
   - UUID 新文件名继续保证换头像不会复用旧图 URL；成功图片可缓存，404 不附带长期缓存头，并消除代理层重复 Cache-Control。
2. 14:24 的订单查询实际为 `GET /api/v1/orders?page=1&pageSize=20&status=undefined`，服务器返回 400；不是账号失效或取消接口故障。
   - 新小程序“全部”不创建 status 字段，统一 GET 传输层剔除 undefined/null；保留 0/false，POST/PATCH 的 null 不受影响。
   - API 对可选订单筛选兼容旧包的空字符串、`undefined`、`null` 字符串；其他非法枚举、重复参数、越界分页和额外字段仍拒绝。
   - API 枚举错误本地化，小程序将英文校验数组、HTML 等技术错误转换为简短中文，保留 statusCode/requestId 供诊断。
   - 订单页提供简短筛选失败提示、44px 重试按钮与错误播报语义；切换筛选重置分页，错误态不再残留“加载更多”。

## 发布与验证

- API 于北京时间 2026-09-05 14:41:15 切换到 `/home/ubuntu/yanqing-domain/releases/api-20260905-1430`，服务持续 active，重启计数为 0。
- 用明确的种子测试会员（没有微信 openId）对公网订单接口做只读检查：不传 status、`status=undefined`、PENDING、PAID、REFUND_PENDING 均返回 200；BAD_FILTER 返回 400 和中文说明。没有使用真实用户令牌，没有创建订单、上传头像或调用支付。
- 后端 670 项单元测试通过，API 构建通过；前端 195 项测试通过，含 GET 参数清理、错误信息处理、上传后 session 立即更新以及昵称保存失败时保留已上传头像。
- 小程序类型检查、正式 remote 构建及包体门禁通过；无未引用主包 JS、无 mock 文件、无超过 200,000 字节的图片/音频。
- 本地 remote H5 通过 `scripts/h5-profile-order-regression.cjs` 截获全部 API 请求、使用专用测试会话与图片 fixture；订单各分类、错误与重试、375/320/横屏布局、个人中心及设置头像加载共 10 项检查通过。
- H5 自动化不调用生产 API，不代替微信原生头像选择器/真机上传验收。截图及 JSON 位于工作区 `outputs/profile-order-fix-2026-09-05`。
- 原来公开的 H5 及本地 5184 mock 预览未重新发布；本轮新建的 5190 临时 H5 服务仅用于测试，验收后停止。小程序需由用户上传最新 `apps/miniapp/dist/build/mp-weixin` 以获得客户端防护和提示改善；服务器兼容已覆盖旧包当前两个故障。

## 备份与后续维护

- 本轮不改 schema、不执行 seed、不重置数据库，也不改微信或支付环境参数。
- 上一版 API 完整保留在 `/home/ubuntu/yanqing-domain/releases/api-20260905-1356`。
- 备份位于 `/home/ubuntu/yanqing-domain/backups/api-20260905-avatar-order`，含数据库逻辑备份、原 Nginx 配置及原 systemd 工作目录覆盖文件。
- 当前 Nginx 配置为 `/etc/nginx/sites-available/yanqing-api`；本地模板为 `deploy/nginx-api.yutechhn.cn.conf`。
- 当前 systemd 覆盖文件仍为 `/etc/systemd/system/yanqing-api.service.d/90-release.conf`；后续更新先读取实际 WorkingDirectory，不向旧 source 目录误发代码。
- 当前 release 复用旧 source 的已验证 pnpm 依赖存储，不能删除 `/home/ubuntu/yanqing-domain/source/node_modules`。
- API 上传包 SHA-256：`d0a7307439619c8e86a7f1e88f6270507baa178e51f18c9d545ebcbcfdac07d5`。
- 回退 API 时恢复本轮备份中的 `90-release.conf.before` 后 daemon-reload/restart；Nginx 图片路由修复可保留。无需恢复数据库。
- 之前记录的 staging 开发登录安全收口仍未在本轮变更；未推送 GitHub。

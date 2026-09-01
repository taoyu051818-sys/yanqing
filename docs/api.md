# API、角色与业务状态机

所有业务接口前缀为 `/api/v1`。除 `GET /health`、`POST /auth/wechat-login` 和开发环境的 `POST /auth/dev-login` 外，接口均需 `Authorization: Bearer <JWT>`。

普通 JSON 成功响应为 `{ code: 0, message: "ok", data, requestId }`，错误响应也携带 `requestId` 以便审计定位。`GET /reports/exports/:scope.xlsx` 是例外：成功时直接返回 XLSX 二进制。运行服务后可在 `/docs` 查看 Swagger，在 `/docs/openapi.json` 获取 OpenAPI JSON。

## 角色记号

| 角色 | 枚举值 | 主要职责 |
|---|---|---|
| 会员 | `MEMBER` | 本人消费、报名、账户和推荐关系 |
| 前台 | `FRONT_DESK` | 代客业务、签到、收银、班次和库存执行 |
| 教练 | `COACH` | 培训出勤、消课建议和所带班级课次 |
| 赛事运营 | `EVENT_MANAGER` | 赛事、赛果和奖品交付 |
| 球局主理人 | `HOST` | 球局创建、履约和候补递补 |
| 联盟商户 | `MERCHANT` | 本商户券码、核销和结算确认 |
| 财务 | `FINANCE` | 复核、结算、日结和经营数据 |
| 管理员 | `ADMIN` | 业务配置和运营审批 |
| 超级管理员 | `SUPER_ADMIN` | 组织、角色、账号状态和全局治理 |

下文“任意已登录账号”仍受服务层数据范围限制，并不代表可以读取其他会员或其他商户的数据。

## 总体路由矩阵

| 模块 | 主要入口 | 角色范围 |
|---|---|---|
| 认证 | `POST /auth/wechat-login`、`GET /auth/me` | 公开登录 / 已登录 |
| 场地 | `GET /venues/availability`、`POST /venues/bookings`、`POST /venues/orders/:orderId/check-in` | 任意已登录；代客订场与签到为前台/管理员 |
| 会员账户 | `GET /members/:id`、`POST /members/:id/accounts/adjust`、`POST /members/me/referrer` | 会员档案由获授权员工查询；本人可查账户流水/绑定推荐；账户调整为财务/管理员 |
| 会员卡 | 会员产品、充值计划的公开目录/管理版本，以及 `POST /memberships/purchase`、`POST /memberships/recharge` | 购买/充值按本人范围；前台可读会员产品版本，管理员负责版本与启停 |
| 订单 | `GET /orders`、`POST /orders/:id/pay`、`POST /orders/:id/refunds`、退款复核入口 | 本人/前台按交易动作；财务/管理员负责全量列表与退款复核 |
| 球局 | `GET /games`、`POST /games`、`POST /games/:id/publish`、报名/候补/签到/完赛入口 | 会员、主理人、前台、财务或管理员，按动作拆分 |
| 赛事 | `GET /events`、创建/发布/报名/赛程/赛果/完赛/奖品入口 | 会员、赛事运营、前台或管理员，按动作拆分 |
| 培训 | 产品、班级、学员、报名、课次、出勤、消课、冲正和结算入口 | 会员、教练、前台、财务或管理员，按动作拆分 |
| 联盟 | 商户、券模板、发行、领取、核销和结算入口 | 会员、商户、前台、财务或管理员，按动作拆分 |
| 商品库存 | 商品、供应商、库位、采购、盘点、调拨、报损、寄售应付/结算和库存流水入口 | 完整库存与单据管理限管理员；前台仅可读低库存最小投影和奖品候选，赛事角色仅可读奖品候选；寄售财务入口另行授权 |
| 配置审计 | `GET/POST /parameters`、`GET /audit-logs` | 参数列表、单个有效值和版本写入均限管理员；小程序通过参数字典与结构化表单提交，不要求操作员手写原始 key/JSON；审计日志为财务/管理员 |
| 经营待办 | `GET /work-items?limit=50` | 前台、教练、赛事、财务、管理员等内部角色，按角色返回队列 |
| 班次 | `GET/POST /operations/shifts/...` | 前台、财务或管理员，按动作拆分 |
| 组织治理 | `GET/POST /governance/...` | 财务、管理员或超级管理员，按动作拆分 |
| 隐私注销 | `POST/GET /privacy/erasure-requests...` | 会员本人申请/撤回；管理员查阻断；超级管理员复核 |
| 日结 | `GET /reconciliation/periods/:date`、`POST /reconciliation/periods/:date/close` | 财务/管理员 |
| 驾驶舱与导出 | `GET /dashboard`、`GET /reports/exports/:scope.xlsx` | 财务/管理员 |

## 商业主数据：会员产品、充值计划与价格规则

| 路由 | 角色 | 规则 |
|---|---|---|
| `GET /memberships/products` | 任意已登录账号 | 只返回当前时点已启用且在有效期内的会员产品版本 |
| `GET /memberships/products/manage` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 返回全部版本、创建人和启停历史 |
| `POST /memberships/products` | `ADMIN`、`SUPER_ADMIN` | 创建编码的 v1，初始停用；原因和幂等键必填 |
| `POST /memberships/products/:id/versions` | `ADMIN`、`SUPER_ADMIN` | 由源版本派生同编码下一版本，不覆盖原记录 |
| `POST /memberships/products/:id/status` | `ADMIN`、`SUPER_ADMIN` | 启用/停用；启用时拒绝同编码有效期重叠 |
| `GET /memberships/recharge-plans` | 任意已登录账号 | 只返回当前有效计划；本金与赠送额均来自服务端 |
| `GET /memberships/recharge-plans/manage` | `ADMIN`、`SUPER_ADMIN` | 返回全部版本和启停时间线 |
| `POST /memberships/recharge-plans` | `ADMIN`、`SUPER_ADMIN` | 同编码自动递增版本，初始停用；赠送额不得超过本金 |
| `POST /memberships/recharge-plans/:id/status` | `ADMIN`、`SUPER_ADMIN` | 启用/停用并检查同编码有效期重叠 |
| `GET /venues/time-slots/manage`、`GET /venues/price-rules/manage` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 查看计价时段、全部价格规则版本与状态历史 |
| `POST /venues/price-rules` | `ADMIN`、`SUPER_ADMIN` | 创建编码的 v1，初始停用 |
| `POST /venues/price-rules/:id/versions` | `ADMIN`、`SUPER_ADMIN` | 从已有版本派生下一版本 |
| `POST /venues/price-rules/:id/status` | `ADMIN`、`SUPER_ADMIN` | 启用/停用；按时段、星期掩码和有效期检查冲突 |

三个主数据域都使用整数分、半开有效期、创建命令哈希、稳定幂等键和不可覆盖启停历史。会员购买把产品编码/版本/条款快照写入订单；订场金额由服务端按业务日期解析确定性价格规则；充值客户端只提交 `planId`，不能自行提交本金或赠送额。新版本默认停用，核对后再启用，历史订单永远不重读后来版本。

## 组织、权限与风险治理

| 路由 | 角色 | 规则 |
|---|---|---|
| `GET /governance/users` | `ADMIN`、`SUPER_ADMIN` | 支持 `page`、`pageSize`、`keyword`、`role`、`status`；OpenID/UnionID 不返回原值，只返回是否已绑定 |
| `POST /governance/users/:id/roles` | `SUPER_ADMIN` | `roles` 非空且包含 `primaryRole`；商户角色必须关联有效商户；目标用户必须启用；必须填写 `reason` |
| `POST /governance/users/:id/status` | `SUPER_ADMIN` | 治理端只允许 `ACTIVE` 与 `DISABLED`；必须填写 `reason` |
| `GET /governance/risk-events` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 支持状态、严重度、关键字和分页；敏感证据字段会脱敏 |
| `POST /governance/risk-events/:id/review` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `OPEN → REVIEWING`，必须填写原因 |
| `POST /governance/risk-events/:id/resolve` | `ADMIN`、`SUPER_ADMIN` | `OPEN/REVIEWING → RESOLVED`，必须填写原因 |
| `POST /governance/risk-events/:id/dismiss` | `ADMIN`、`SUPER_ADMIN` | `OPEN/REVIEWING → DISMISSED`，必须填写原因 |

治理约束：超级管理员不能移除自己的超级管理员角色或停用自己；任何角色/状态变更都必须保留至少一名启用的超级管理员。`RESOLVED` 和 `DISMISSED` 是风险终态。角色、用户状态和风险动作可携带 `idempotencyKey`；相同键只允许回放同一账号发起的同一标准化命令。

## 隐私注销与匿名化

| 路由 | 角色 | 规则 |
|---|---|---|
| `POST /privacy/erasure-requests` | 有会员档案的本人 | 提交 `{ reason, idempotencyKey }`；每人同一时刻只能有一条 `REQUESTED` 申请 |
| `GET /privacy/erasure-requests/me` | 本人 | 查看本人历次申请和处理结果 |
| `POST /privacy/erasure-requests/:id/cancel` | 申请人本人 | `REQUESTED → CANCELLED`；原因和幂等键必填 |
| `GET /privacy/erasure-requests` | `ADMIN`、`SUPER_ADMIN` | 按状态分页查看复核队列 |
| `GET /privacy/erasure-requests/:id/blockers` | `ADMIN`、`SUPER_ADMIN` | 返回账号、职责、余额、订单、支付、退款、会员、球局/赛事、培训、券、调账、奖励和班次阻断项 |
| `POST /privacy/erasure-requests/:id/reject` | `SUPER_ADMIN` | `REQUESTED → REJECTED`；复核人不能是申请人 |
| `POST /privacy/erasure-requests/:id/complete` | `SUPER_ADMIN` | 阻断项为零后 `REQUESTED → COMPLETED`，事务内完成不可逆匿名化 |

完成前账号必须已停用并只保留会员角色。匿名化清除微信标识、手机号、头像、通知和导出下载地址，匿名化监护学员及赛事名单中的本人姓名，并解除推荐关系；订单、支付、退款、五账户流水、培训收入、库存和审计凭证继续以内部分配的匿名 ID 留存。申请和决定均校验“账号/申请、操作人、原因、命令摘要”，同键异命令返回冲突。

所有 `POST/PUT/PATCH/DELETE` 请求另写一条不含载荷的 HTTP 证据，记录 requestId、路径、状态码、IP、User-Agent 和成功/拒绝/失败结果；领域事务审计仍负责保存业务对象状态与金额前后值。

## 本人直推绑定

| 路由 | 角色 | 请求与约束 |
|---|---|---|
| `POST /referrals/me/invites` | 任意已登录会员 | 创建 192-bit 随机邀请码，仅本次返回 `{ inviteCode, expiresAt }`；数据库只保存 SHA-256 哈希 |
| `POST /members/me/referrer` | 任意已登录会员 | 请求体 `{ inviteCode }`；被绑定人始终取 JWT 的 `sub`，不接受推荐人或被推荐人的用户 ID |

邀请码可供同一推荐人邀请多名新会员，但必须未过期、未撤销且签发人仍是启用的有效会员；公开链接和绑定响应均不返回内部用户 ID。绑定双方都必须是未删除且启用的有效会员。系统拒绝自荐、任意深度的推荐闭环和更换推荐人；首次绑定成功后关系不可变。同一推荐人的并发或网络重试按幂等成功返回，竞争绑定到不同推荐人时返回冲突，并写入 `DIRECT_REFERRAL_BOUND` 审计。

## 场地封场

| 路由 | 角色 | 请求与约束 |
|---|---|---|
| `GET /venues/closures` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 可按 `courtId`、`status`、`from`、`to` 查询 |
| `POST /venues/closures` | `ADMIN`、`SUPER_ADMIN` | `courtId`、`startsAt`、`endsAt`、`reason`、`creationIdempotencyKey` |
| `POST /venues/closures/:id/cancel` | `ADMIN`、`SUPER_ADMIN` | 请求体必须含 `reason`；`ACTIVE → CANCELLED` |

创建封场时结束时间必须晚于开始时间，且不能创建已经结束的计划；同一场地不得与另一条有效封场重叠，也不得覆盖未取消的场地占用。系统不会自动取消预约或退款，而是返回阻断预约清单。有效封场会出现在可用性结果中，并阻止新的零售订场和重叠培训课次。创建命令按 `creationIdempotencyKey` 精确回放；同键不同参数返回冲突。重复取消已取消记录不再产生第二次状态变更。

## 前台班次、交接与现金差异

| 路由 | 角色 | 规则 |
|---|---|---|
| `GET /operations/shifts/current` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 返回当前账号在上海业务日、主场馆的班次 |
| `GET /operations/shifts/history` | `FRONT_DESK`、`FINANCE`、`ADMIN`、`SUPER_ADMIN` | 前台只看本人；财务/管理员可按 `operatorId`、`status`、`limit` 查看全量 |
| `POST /operations/shifts/open` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 请求体 `{ openingCashCents }`；同一操作人、业务日、场馆只允许一班 |
| `POST /operations/shifts/:id/close` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 请求体含 `closingCashCents`、`handoverNote`；管理员代关必须另填 `reason` |
| `POST /operations/shifts/:id/review-variance` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 仅已关班记录可复核；非零差异必须填 `reason` |

班次状态为 `OPEN → CLOSED`。关班时固化应有现金、实点现金、差异和待处理订单/支付/退款快照。普通前台只能关自己的班；管理员可代关。班次操作人和实际关班人都不能复核自己的现金差异，复核记录只能写入一次，完全相同的重试返回原记录。

前台代客订场、场地签到、线下现金收款和代客退款受开班门禁约束：普通前台必须有当日 `OPEN` 班次；`ADMIN`/`SUPER_ADMIN` 可走应急旁路，但会额外写入 `FRONT_DESK_SHIFT_GATE_BYPASSED` 审计。

## 退款、履约互锁与充值短款

退款申请会保存订单进入退款前的原状态；普通退款被驳回时恢复该状态，而不是一律恢复为 `PAID`。由球局取消、赛事取消或赛事候补晋级后的逾期支付产生的系统强制退款，业务对象已经不可逆地退出，因此 `POST /orders/refunds/:refundId/reject` 会拒绝人工驳回，防止出现“业务已取消但订单重新已支付”的死锁。

订单为 `REFUND_PENDING` 时不能签到、完成场地/球局/赛事履约、结束球局/赛事或提交/确认培训消课；只有退款驳回并恢复原状态，或退款成功进入退款终态后，才允许符合新状态的后续动作。已进入培训周期结算或已锁营业日的收入确认也不能再批准消课冲正，只能走后续受审调整。

微信充值退款以支付平台 `REFUND.SUCCESS` 通知为资金终态。若会员已消费部分充值本金或赠送额，服务只从各账户“余额减冻结额”的可用部分追回，按实际追回额写账户流水，并创建 `RECHARGE_REFUND_BALANCE_SHORTFALL` 风险事件记录未追回金额；不得因为本地余额不足回滚已经成功的微信退款。重复通知直接返回既有终态，不重复扣账或生成风险。

## 培训配置、出勤、消课与冲正

| 路由 | 角色 | 规则 |
|---|---|---|
| `GET /training/products` | 任意已登录账号 | 查询启用的培训产品 |
| `POST /training/products` | `ADMIN`、`SUPER_ADMIN` | 创建产品；支持 `reason` 和 `creationIdempotencyKey` |
| `POST /training/classes` | `ADMIN`、`SUPER_ADMIN` | 创建班级并配置教练、排期、容量和成本；支持创建幂等键 |
| `GET /training/sessions` | `COACH`、`FRONT_DESK`、`FINANCE`、`ADMIN`、`SUPER_ADMIN` | 教练按所带班级范围读取 |
| `POST /training/sessions` | `COACH`、`ADMIN`、`SUPER_ADMIN` | 教练只能给本人负责/助教的班级排课；场地占用不得与已有预约或有效封场重叠 |
| `POST /training/sessions/:sessionId/attendance` | `COACH`、`FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 登记到场、缺勤、请假或取消；教练限本人班级 |
| `POST /training/sessions/:sessionId/attendance/makeup` | `COACH`、`ADMIN`、`SUPER_ADMIN` | 将已批准请假的记录安排到同班更晚课次 |
| `POST /training/sessions/:sessionId/consume` | `COACH`、`ADMIN`、`SUPER_ADMIN` | 教练提交消课建议；管理员调用时按兼容确认入口处理 |
| `POST /training/sessions/:sessionId/consume/confirm` | `ADMIN`、`SUPER_ADMIN` | 确认消课并写收入、课时余额和成长积分流水 |
| `POST /training/sessions/:sessionId/complete` | `COACH`、`ADMIN`、`SUPER_ADMIN` | 教练限本人班级；仍有未处理签到/请假记录时不得结课 |
| `GET /training/consume-corrections` | `COACH`、`FRONT_DESK`、`FINANCE`、`ADMIN`、`SUPER_ADMIN` | 纯教练账号只看本人负责班级 |
| `POST /training/consume-corrections` | `COACH`、`FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 以 `recognitionId`、`reason`、`idempotencyKey` 提交冲正 |
| `POST /training/consume-corrections/:id/approve` | `ADMIN`、`SUPER_ADMIN` | 复核通过并创建不可变 `REVERSAL` 收入流水 |
| `POST /training/consume-corrections/:id/reject` | `ADMIN`、`SUPER_ADMIN` | 驳回必须填写原因 |

出勤与财务消课是两条命令。出勤可从 `PENDING` 进入 `ATTENDED`、`ABSENT`、`MAKEUP_REQUIRED` 或 `CANCELLED`；已批准请假安排补课后为 `MADE_UP`。只有 `ATTENDED` 才能进入消课流程：教练建议形成 `PENDING_CONFIRMATION`，随后由不同账号的 `ADMIN`/`SUPER_ADMIN` 确认。确认人不能与建议提交人相同，建议阶段不会扣课时、确认收入或发成长积分。

冲正状态为 `REQUESTED → APPROVED/REJECTED`。申请人与复核人不能为同一账号；批准会新增负向收入确认、恢复课时与预收余额，并在适用时冲回成长积分，不会改写原确认流水。

## 培训试听漏斗与青少年监管规则

| 路由 | 角色 | 状态动作/规则 |
|---|---|---|
| `GET /training/trials/mine` | 关联会员/监护人 | 查询本人或本人监护学员的试听记录 |
| `GET /training/trials` | 教练、前台、管理员 | 按角色数据范围查询到课、测评和转化队列 |
| `POST /training/trials` | 前台、管理员 | 预约试听，关联线索/会员/学员、产品、教练和时间窗 |
| `POST /training/trials/:id/check-in`、`.../no-show` | 前台、管理员 | `RESERVED → CHECKED_IN/NO_SHOW` |
| `POST /training/trials/:id/assess` | 负责教练、管理员 | `CHECKED_IN → ASSESSED`，保存结构化测评维度和建议 |
| `POST /training/trials/:id/convert`、`.../lost` | 管理员 | 测评后关联正式课包转化，或记录流失原因 |
| `POST /training/trials/:id/cancel` | 前台、管理员 | 在允许状态取消并保留原因 |
| `GET /training/youth-rules/active` | 任意已登录账号 | 返回当前已发布、按生效时间解析的青少年培训限制 |
| `GET/POST /training/youth-rules` | 管理员 | 查询版本或由 `ADMIN` 制订草稿 |
| `POST /training/youth-rules/:id/publish`、`.../reject` | `SUPER_ADMIN` | 与制订人分离地发布或驳回，保留决定证据 |

青少年规则覆盖课时数、有效期限、订单金额和临期提醒等限制，并在产品/购买入口按受众校验和写入规则快照。试听的预约、到课、测评、转正式课/流失采用显式状态机和稳定幂等证据，可在统一待办和经营分析中按负责人追踪。

## 培训结算

| 路由 | 角色 | 状态动作 |
|---|---|---|
| `GET /training/financial-summary` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 按 `periodStart`、`periodEnd` 汇总 |
| `POST /training/settlements` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 创建 `DRAFT`，同一周期唯一 |
| `GET /training/settlements` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 可按周期和状态过滤，返回工作流历史 |
| `POST /training/settlements/:id/submit` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `DRAFT → PENDING_CONFIRMATION` |
| `POST /training/settlements/:id/confirm` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `PENDING_CONFIRMATION → CONFIRMED` |
| `POST /training/settlements/:id/settle` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `CONFIRMED → SETTLED` |
| `POST /training/settlements/:id/return` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `PENDING_CONFIRMATION → DRAFT`，原因必填 |
| `POST /training/settlements/:id/void` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `DRAFT → VOID`，原因必填 |

制单人不能确认、结算或退回自己的培训结算单。动作支持可选 `idempotencyKey`，并校验操作人、动作、原因和命令摘要。营业日关账锁定消课等源流水；财务仍可依据历史锁定流水按周/月创建和流转培训结算单。

## 联盟商户、券和结算

| 路由 | 角色 | 规则 |
|---|---|---|
| `GET /alliance/merchants` | 任意已登录账号 | 会员只看启用目录；商户只看关联商户；财务/管理员可看完整经营字段 |
| `POST /alliance/merchants` | `ADMIN`、`SUPER_ADMIN` | 创建商户，编码唯一 |
| `POST /alliance/merchants/:id/status` | `ADMIN`、`SUPER_ADMIN` | `ACTIVE ↔ DISABLED`；`reason`、`idempotencyKey` 必填 |
| `GET /alliance/coupon-templates` | `MERCHANT`、`ADMIN`、`SUPER_ADMIN` | 商户只看本商户模板 |
| `POST /alliance/coupon-templates` | `ADMIN`、`SUPER_ADMIN` | 仅有效商户可创建，模板编码唯一 |
| `POST /alliance/coupon-templates/:id/status` | `ADMIN`、`SUPER_ADMIN` | 启用/停用；停用商户的模板不能启用；`reason`、`idempotencyKey` 必填 |
| `POST /alliance/coupon-templates/:id/codes` | `MERCHANT`、`ADMIN`、`SUPER_ADMIN` | 商户限本商户；`count` 为 1–2000 且不得超过发行上限 |
| `POST /alliance/coupons/:code/claim` | 任意已登录账号 | `ISSUED → CLAIMED`；每人领取上限、模板启停状态和有效期均会校验 |
| `GET /alliance/coupons/me` | 任意已登录账号 | 仅本人券包 |
| `GET /alliance/coupons/:code/qr` | 持券人、前台、管理员或所属商户 | 返回券码二维码 SVG |
| `POST /alliance/coupons/redeem` | `MERCHANT`、`FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | `CLAIMED → REDEEMED`；商户限本商户，前台可代核销 |
| `POST /alliance/settlements` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 生成商户周期 `DRAFT` 结算单 |
| `GET /alliance/settlements` | `MERCHANT`、`FINANCE`、`ADMIN`、`SUPER_ADMIN` | 商户只看本商户，财务/管理员看全量 |
| `POST /alliance/settlements/:id/submit` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `DRAFT → PENDING_CONFIRMATION` |
| `POST /alliance/settlements/:id/confirm` | `MERCHANT`、`ADMIN`、`SUPER_ADMIN` | `PENDING_CONFIRMATION → CONFIRMED`；商户限本商户 |
| `POST /alliance/settlements/:id/dispute` | `MERCHANT`、`ADMIN`、`SUPER_ADMIN` | `PENDING_CONFIRMATION → DRAFT`；争议原因必填 |
| `POST /alliance/settlements/:id/settle` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `CONFIRMED → SETTLED` |

商户或模板状态变更、批量发行和核销均使用稳定幂等键。批量发行的券码由请求键确定，同一账号用同一键重试会返回第一次发行的同一组完整券码；同键改模板、数量或动作会冲突。停用商户或下线/过期模板不能继续发行。重复核销会生成高风险事件。

联盟结算只允许顺序流转，已完成目标状态的网络重试返回与正常请求相同的业务投影。响应保留账期、核销统计、归因金额、服务费、ROI、状态和精简工作流历史；内部券记录 ID 集合与商户原始 `settlementRule` 仅作为服务端计算证据，不通过 `detail` 返回。争议只退回工作流，不覆盖已计算金额；需要调整口径时应生成新的计算版本。营业日 `LOCKED` 保护券核销等源证据，不阻止之后按周/月创建、确认和入账联盟结算。

## 库存采购、盘点、调拨与报损

完整库存、商品详情、供应商、库位、采购单、盘点单和库存业务单查询限 `ADMIN`、`SUPER_ADMIN`。`FRONT_DESK` 仅可调用 `GET /inventory/low-stock`（返回 `id/sku/name/mode/stock/safeStock`）与 `GET /inventory/award-options`；`EVENT_MANAGER` 仅额外拥有奖品候选读取权限。`COACH`、`FINANCE` 不因此获得完整库存目录；财务只通过寄售应付/结算专用接口读取所需账务数据。变更权限如下。

| 业务 | 路由 | 角色 | 状态机/约束 |
|---|---|---|---|
| 基础资料查询 | `GET /inventory/items/:id`、`GET /inventory/suppliers/:id`、`GET /inventory/locations/:id` | 内部角色 | 查看单对象、当前状态和关联业务上下文 |
| 基础资料创建 | `POST /inventory`、`POST /inventory/suppliers`、`POST /inventory/locations` | `ADMIN`、`SUPER_ADMIN` | 创建商品、供应商和库位；稳定创建幂等键和原因入审计 |
| 基础资料更新 | `POST /inventory/items/:id/update`、`POST /inventory/suppliers/:id/update`、`POST /inventory/locations/:id/update` | `ADMIN`、`SUPER_ADMIN` | 受版本/CAS 和业务引用约束更新，不覆盖历史订单快照 |
| 基础资料启停 | `POST /inventory/items/:id/status`、`POST /inventory/suppliers/:id/status`、`POST /inventory/locations/:id/status` | `ADMIN`、`SUPER_ADMIN` | 必填原因和幂等键；有关联库存/未结业务时按对象规则阻断 |
| 采购制单 | `POST /inventory/purchase-orders` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 创建 `DRAFT` |
| 采购提交 | `POST /inventory/purchase-orders/:id/submit` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | `DRAFT → SUBMITTED` |
| 采购审批 | `POST /inventory/purchase-orders/:id/approve` | `ADMIN`、`SUPER_ADMIN` | `SUBMITTED → APPROVED`；制单/提交人与审批人不同 |
| 采购收货 | `POST /inventory/purchase-orders/:id/receive` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | `APPROVED/PARTIAL_RECEIVED → PARTIAL_RECEIVED/RECEIVED`；支持分批收货和幂等键 |
| 采购取消 | `POST /inventory/purchase-orders/:id/cancel` | `ADMIN`、`SUPER_ADMIN` | `DRAFT/SUBMITTED/APPROVED → CANCELLED`；已收货不可取消 |
| 盘点制单/开始 | `POST /inventory/stocktakes`、`POST /inventory/stocktakes/:id/start` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | `DRAFT → COUNTING`，开始时固化账面数 |
| 盘点录数/提交 | `POST /inventory/stocktakes/:id/lines/:lineId/count`、`POST /inventory/stocktakes/:id/submit` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 明细全部录入后 `COUNTING → REVIEW` |
| 盘点过账 | `POST /inventory/stocktakes/:id/post` | `ADMIN`、`SUPER_ADMIN` | `REVIEW → POSTED`；制单/提交人与过账人不同；幂等写差异流水 |
| 调拨/报损制单 | `POST /inventory/operations` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | `type=TRANSFER/LOSS`；调拨目标库位必须不同，报损不得有目标库位 |
| 业务单提交 | `POST /inventory/operations/:id/submit` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | `DRAFT → SUBMITTED` |
| 业务单审批 | `POST /inventory/operations/:id/approve` | `ADMIN`、`SUPER_ADMIN` | `SUBMITTED → APPROVED`；制单人与审批人不同 |
| 业务单过账 | `POST /inventory/operations/:id/post` | `FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | `APPROVED → POSTED`；稳定幂等键生成调拨双流水或报损出库流水 |
| 业务单取消 | `POST /inventory/operations/:id/cancel` | `ADMIN`、`SUPER_ADMIN` | `DRAFT/SUBMITTED/APPROVED → CANCELLED`；已过账不可取消 |

`POST /inventory/:id/transactions` 只用于非单据型业务流水：前台可销售出库，教练可培训领用，赛事运营可赛事领用，管理员可执行对应动作。培训/赛事领用必须提供 `referenceType` 和 `referenceId`。采购入库、调拨、报损、盘点调整等受控类型会被拒绝直接记账，必须走上述单据工作流；所有直接流水都要求 `reason` 和稳定 `idempotencyKey`。

## 寄售应付与供应商结算

| 路由 | 角色 | 状态动作/约束 |
|---|---|---|
| `GET /inventory/consignment/payables` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 按供应商、发生期间、`SALE/REFUND_REVERSAL` 查询不可变应付流水及结算归属 |
| `GET /inventory/consignment/settlements` | 同上 | 按供应商、账期、状态分页查询，返回制单人和状态历史 |
| `GET /inventory/consignment/settlements/:id` | 同上 | 查看结算单、应付行、原订单/退款和完整流转历史 |
| `POST /inventory/consignment/settlements` | 同上 | 按供应商和半开账期生成 `DRAFT`；只纳入未被有效结算单占用的寄售应付 |
| `POST .../:id/submit` | 同上 | `DRAFT → PENDING_CONFIRMATION` |
| `POST .../:id/confirm` | 同上 | `PENDING_CONFIRMATION → CONFIRMED` |
| `POST .../:id/dispute` | 同上 | `PENDING_CONFIRMATION → DRAFT`，保留争议原因 |
| `POST .../:id/return` | 同上 | `CONFIRMED → DRAFT`，付款前退回 |
| `POST .../:id/settle` | 同上 | `CONFIRMED → SETTLED`，付款凭证必填 |
| `POST .../:id/void` | 同上 | `DRAFT → VOID`，释放明细以便重建新版本 |

寄售 SKU 下单时即在订单行冻结 `inventorySnapshotVersion=1`、SKU 模式、供应商 ID/代码/名称、结算周期和佣金基点；完成销售履约后只按该不可变快照生成应付，不重读当前商品模式或供应商规则。整单成功退款追加与原流水精确对应的负数冲正，不改写原行。自营 `OWNED` SKU 不生成供应商应付。制单人不能确认、争议/退回或付款自己的结算单；每个状态动作要求原因和稳定幂等键，并校验操作人、前置状态和命令摘要。历史交易边界与人工核对方法见 [寄售应付快照 cutover 审计](./consignment-cutover.md)。

营业日关账锁定的是销售、退款等源业务证据，不锁死之后的周期对账动作；因此财务可在历史营业日已锁后按周/月制单、确认和付款。未完成的培训、联盟与寄售周期结算由财务工作台/待办持续预警，不作为每日 `LOCKED` 的阻断项；寄售应付发生额与已付结算额仍进入日结快照。

## 赛事奖品

| 路由 | 角色 | 规则 |
|---|---|---|
| `GET /events/:id/prizes` | `EVENT_MANAGER`、`FRONT_DESK`、`ADMIN`、`SUPER_ADMIN` | 查看奖项、获奖队、库存商品、发放人和签收信息 |
| `POST /events/:id/prizes` | 同上 | 赛事必须 `COMPLETED`，队伍必须已完赛并有最终名次；请求含队伍、奖项、SKU、数量和 `idempotencyKey` |
| `POST /events/:id/prizes/:awardId/receive` | 同上 | 请求含签收人、`idempotencyKey` 和可选备注；`ISSUED → RECEIVED` |

奖品发放、库存扣减、`EVENT_USAGE` 库存流水和审计在同一事务中完成。`recipientNames` 省略时默认取该队两名选手；显式提供时必须是队内选手且不得重复。库存不足、同一队伍/奖项/SKU 重复发放或同键不同命令都会失败；完全相同的弱网重试返回原发放记录。签收只记录交付证据，不再次扣库存；当前没有奖品撤销或退库路由。

赛事主流程为 `DRAFT → OPEN/FULL → IN_PROGRESS → COMPLETED`。只有完成固定五轮、生成最终名次并执行 `POST /events/:id/finish` 后，才允许发放实物奖品。

## 日结与锁账

| 路由 | 角色 | 规则 |
|---|---|---|
| `GET /reconciliation/periods/:date` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | `date` 为 `YYYY-MM-DD`；未锁日期返回实时快照，不因读取创建记录 |
| `POST /reconciliation/periods/:date/close` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 只能在该上海业务日结束后关账，可携带 `reason` |

日结状态迁移为 `OPEN --存在阻断项--> REVIEW`，以及 `OPEN/REVIEW --无阻断项--> LOCKED`。阻断项只来自必须在当日闭合的源业务：待处理退款、处理中支付、未关闭前台班次、未复核的非零现金差异、已经到期但尚未确认履约的场地/球局/赛事订单，以及已结束但仍未完成点名或消课的培训课次。清理这些项目后再次关账可进入 `LOCKED`。

培训、联盟和寄售属于周/月周期结算；未完成结算在财务工作台和统一待办持续预警，但不作为每日关账阻断项。它们可以在源营业日已经 `LOCKED` 后依据不可变源流水继续制单、确认、争议/退回和付款。日结快照仍展示培训/联盟结算金额、寄售应付发生额和已付额，以便勾稽。

`REVIEW` 是实时异常队列，读取时重新计算但不静默改变数据库状态。`LOCKED` 会冻结当日源业务快照，重复关账不重写总额或审计；锁定后的销售、退款、库存、消课和账户源流水只能通过后续冲正/调整单处理，不能回写历史。周期结算对这些已锁源流水只做汇总和工作流流转，不修改源凭证。

## 驾驶舱与 XLSX 导出

| 路由 | 角色 | 返回 |
|---|---|---|
| `GET /dashboard?periodStart=&periodEnd=` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 经营驾驶舱 JSON |
| `GET /reports/exports/:scope.xlsx` | `FINANCE`、`ADMIN`、`SUPER_ADMIN` | 原生 XLSX 文件，不使用 JSON 响应包；财务仅可请求 `orders`、`finance` |

导出范围为：

- `orders`：订单、明细、支付、退款；
- `members`：会员、账户、账户流水；
- `training`：培训订单/支付/退款、学员、产品、班级、报名、课次、出勤、收入确认、冲正和结算；
- `events`：赛事订单/支付/退款、赛事、队伍、五轮对阵比分和奖品发放；
- `alliance`：商户、券模板、券码、联盟结算；
- `inventory`：商品订单/支付/退款、供应商、库位分账、库存流水、采购/收货、盘点、调拨和报损，以及寄售应付、退款反冲、结算单明细与流转；
- `audit`：审计日志、日结记录；
- `finance`：支付、退款、账户流水、培训收入/结算、联盟结算、寄售应付/付款和日结；
- `all`、`migration`：全部上述数据集。

`FINANCE` 仅能导出 `orders` 和 `finance`；其余分域以及 `all`、`migration` 仅限 `ADMIN`、`SUPER_ADMIN`。财务视图是业务账簿而非数据库快照，会剔除参数快照、幂等键、命令摘要、原始规则快照和内部操作证据。每个工作表最多导出 10,000 行，并附带 `ExportManifest` 记录范围、导出人、时间、各表行数和是否触顶。手机号会脱敏，可能触发 Excel 公式的字符串会转义；每次成功导出写入 `DATA_EXPORTED` 审计。

## 幂等键使用规范

客户端必须为一次业务意图生成稳定键，超时、断网和重复点击重试时复用该键；用户确实发起新的业务动作时必须生成新键。后端不会把幂等键当作任意查询别名：同键绑定的对象、参数、动作或操作人不符合对应接口约束时返回冲突。

强制使用幂等键的关键入口包括支付、账户调整、库存流水、采购收货、盘点/调拨/报损过账、联盟商户/模板状态变更、券批量发行与核销、培训消课冲正、赛事奖品发放与签收、封场创建。部分创建与状态动作将键设计为可选以兼容旧客户端；新小程序仍应始终发送稳定键。

## 时间和金额

- API 时间使用 ISO 8601；营业日按 `Asia/Shanghai` 计算。
- 金额字段以 `Cents` 结尾，单位为人民币分。
- 羽毛球币、赛事积分和成长积分是独立整数单位，不默认等同于人民币。
- 参数化比例按业务发生日期解析有效版本，历史锁账数据不得通过覆盖参数追溯改写。

## 球局候补与递补

`POST /games/:id/register` 在席位已满或已有更早候补时返回 `WAITLISTED` 和 `waitlistPosition`，不会提前创建或收取订单。全额退款释放席位时，系统在同一事务中将最早候补改为 `REGISTERED`、生成新的待支付订单并留下 `GAME_WAITLIST_PROMOTED` 审计；主理人、前台、财务或管理员也可调用 `POST /games/:id/promote-waitlist` 手动重试。会员只有完成新订单支付后才进入 `PAID`，候补本身不产生收入或主理人奖励。

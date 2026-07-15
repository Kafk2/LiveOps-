# liveops-cfg v2 交接文档

> 供后续 agent 新 session 快速理解项目状态。读此 + `git log --oneline -20` 即可接续。

## 项目概述

- **liveops-cfg**：游戏活动排期可视化管理工具
- **v1**：根目录 `index.html`（7922 行 vanilla JS，作为功能参考 demo 保留）
- **v2**：`liveops_v2/`（TypeScript + Vite，从零重写，**核心数据互通 v1**：能读写 v1 的 settings.json + CSV）
- **分支**：`feature/liveops-v2-phase1`（基于 main）
- **启动**：`cd liveops_v2 && npm run dev` → http://localhost:5173
- **验证**：`npx tsc -b --noEmit` / `npx vitest run` / `npx vite build`

## 架构（关键文件）

| 层 | 文件 | 职责 |
|---|---|---|
| core | `core/store.ts` | normalized by-id state + 双 history 栈（config/schema 独立） |
| core | `core/types.ts` | Config/Settings/AppState/TabKey/SegmentExpr/SegLine 等 |
| schema | `schema/csv-schema.ts` | 13 列 CSV 字段定义 |
| schema | `schema/params-schema.ts` | ParamsSchemas = Record<activityKey, fields>（**无类型默认**） |
| schema | `schema/validators.ts` | 三层校验 + normalizer 框架 |
| model | `model/cycle.ts` | 循环次数↔endDate 转换（+1天 trick） |
| model | `model/segment-expr.ts` | segments 表达式 serialize/parse（树+线性） |
| model | `model/normalizers/builtin.ts` | 周一校验 normalizer |
| model | `model/schedule.ts` | calculateActualSchedules（循环展开） |
| services | `services/csv-codec.ts` | CSV 编解码（RFC4180 引号） |
| services | `services/import-v1-data.ts` | dev 注入 v1 数据（多级回退） |
| ui | `ui/app.ts` | 配置管理 tab（列表+表单，两列布局，~800行） |
| ui | `ui/activity-management-tab.ts` | 活动管理（activityKey 注册表） |
| ui | `ui/segment-tab.ts` | 玩家分群（segmentKey 注册表） |
| ui | `ui/segment-builder.ts` | segments 可视化构建器（树结构+组级且/或） |
| ui | `ui/schema-tab.ts` | Params Schema 编辑器（按 activityKey） |
| ui | `ui/recurrence-wizard.ts` | 循环模式 wizard（5 模式） |
| ui | `ui/color-palette.ts` | Ant 12×10 色板 + 颜色工具 |
| ui | `ui/relation-tabs.ts` | 依赖/互斥 tab |

## 已完成迭代

- 阶段1：schema 驱动 + normalized store + v1 互通
- 迭代1：草稿编辑层 + 时间轴未保存预览
- 迭代2：循环模式受控插件化
- 迭代3：动态 CSV 文档模型 + 未知列无损往返
- 迭代4：params schema 策划编辑器
- 迭代5(a-d)：配置列表 v1 交互继承 / 依赖互斥 / CSV 导入 / 行拖拽+周一校验
- 迭代6(a-b)：v1 配置编辑界面复原（两列布局 + duration 天时分 + 循环次数↔endDate 联动 + 折叠结果区 + 启用开关 + 颜色选择器 + 活动类型管理）
- 活动管理页签（activityKey 注册表，配置表单 activityKey 搜索选择）
- 玩家分群页签 + segments 可视化构建器
- skin 逗号分隔（彻底无 `[]`）/ params 默认空 / Schema 改 per-key / 现有数据清空 skin+params

## 关键数据约定

- **skin**：逗号分隔字符串（`CCD01,CCD02`，CSV 引号包裹），彻底无 `[]`。`parseSkinList` 兼容旧 JSON 数组
- **params**：默认空 `''`（连 `{}` 都不预填），强制按 Params Schema 编辑（无 schema 不可编辑，提示去 Schema 页签）。配置表单按 fieldType 用 field-types 注册表渲染（number→`<input type=number>`、boolean→checkbox、date/time 原生 picker），saveBtn 校验 required 空值/类型不匹配（阻断保存）；折叠结果区「配置详情」显示 params 实际 JSON（随 draft 实时刷新）
- **ParamsSchemas**：`Record<activityKey, ParamsFieldDef[]>`（去掉 byType 类型默认，只按 activityKey）
- **segmentKeys**：注册表（玩家分群页签），默认 5 种（userLevel/lifeTime/payAmount/version/item）
- **segments**：表达式字符串，builder 树结构编辑（组级一个且/或，非每行）
- **activityType/Name/Description**：在 `settings.activityMeta`（按 activityKey 共享），配置表单只读显示（标题栏显示名称）
- **配置表单 activityKey**：搜索 combobox 选择已注册的（不从手填）
- **颜色 barColors**：`settings.uiSettings.barColors[configId]`，即时落盘不入 history
- **编辑排序**：custom 模式行拖拽 + 多选（editSelectedIds）批量拖拽/删除（CONFIGS_DELETE_BATCH）
- **duration**：天/时/分 + 总计秒，超循环周期长度 alert 不写入
- **循环次数↔scheduleEndDate**：endDate 不直接编辑，由循环次数驱动（cycleCountToEndDateString +1天 trick）
- **周一校验**：normalizer enforceMondayStartDate，saveBtn 时自动校正 weekly/biweekly
- **数据持久化（dev 过渡，未接后台前）**：`services/persistence.ts` — settings+configs 自动存 localStorage（debounce 300ms，`bindPersistence`），main 启动优先读缓存（`loadPersisted`）跳过 fetch；Schema 页签有「导出/导入备份」按钮兜底清缓存场景。接公司后台后替换为 BackendAdapter（HTTP API + DB，localStorage 降为读缓存）

## 测试

- `tests/data-interop.test.ts`（22）、`normalizers.test.ts`（12）、`cycle.test.ts`（17）、`segment-expr.test.ts`（20 含 lines 线性备用）
- **71 测试全过**，`npx vitest run`
- 无 jsdom/Playwright，UI 交互靠 typecheck + 代码自审（无浏览器自动化）

## 当前状态（本次提交）

- params schema + configs 本地持久化落地（localStorage 自动存 + 导出/导入备份），刷新不丢
- segments 构建器：树结构，**组级一个且/或**（根顶部 + 嵌套组头，条件行无行首连接符），条件单行紧凑，嵌套组轻微背景+左色条
- 71 测试 + tsc + build 通过
- 工作树干净

## 待办候选（下一步，用户定方向）

1. **时间轴 tab** 完善（v1 高性能 Canvas 时间轴复刻到 v2，timeline tab 当前渲染但可能待完善）
2. **版本对比 tab**（当前 disabled）
3. **公司后台同步**（接自建后台：HTTP API + DB 存 settings/configs，把 persistence.ts 的 localStorage 实现替换为 BackendAdapter；GitHub 同步已弃，数据走公司后台而非 Git）
4. **segments 视觉最终确认**（用户多次调整，需 `npm run dev` 实际验证）
5. 活动管理/玩家分群细节打磨

## 约定

- **中文回复**（简体中文，技术术语保留原文）
- PowerShell 写中文文件必须 `-Encoding utf8` 或 Node `fs.writeFileSync(path, content, 'utf8')`
- **auto-commit**：提交代码直接执行，不询问确认
- 精炼沟通（少分段、直接结论 + 下一步）
- 保留 v2 增强（结构化 params、周一 normalizer、草稿层+撤销栈、CSV 导出）

## 注意

- 上一 session 对话曾含图片截图，导致 `API Error 400 image_url` 反复（图片在对话历史，每轮 API 带历史，模型不支持 image）。**新 session 无此问题**。后续若需看截图，用文字描述。
- segments UI 用户多次调整（嵌套→扁平流→线性→树结构+组级），视觉主观，务必 `npm run dev` 让用户实际验证后再推进。

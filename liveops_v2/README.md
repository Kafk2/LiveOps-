# LiveOps-使用说明 v2

一个基于 Web 的游戏活动排期可视化管理工具 v2，schema 驱动 + 高性能时间轴（TypeScript + Vite）。

## 与 v1 的关系

- v1（根目录 `index.html`）作为功能参考 demo 保留
- v2 位于 `liveops_v2/`，从零重写，但**核心数据互通**：v2 能读写 v1 的 `settings.json` + CSV + GitHub 仓库格式
- v2 行为保真度 = 仅核心数据互通，UI 交互可重新设计

## 快速开始

```bash
cd liveops_v2
npm install
npm run dev
```

打开 http://localhost:5173

## 关键变化（相比 v1）

- **schema 驱动**：CSV 字段、params 结构由 schema 定义，加字段 = 改一行 schema
- **策划可编辑 params schema**：schema-tab 提供可视化编辑器（带自校验 + 影响预览 + 撤销隔离）
- **高性能时间轴**：normalized by-id store + 水平+垂直双向虚拟化 + 分层 Canvas + scrollLeft 平移，按 2000+ 配置规模设计
- **可拓展注册制**：字段类型、循环模式、校验规则、时间轴图层全部可注册

## 部署

v2 放弃 v1 的 file:// 直开用法，需通过 HTTP 服务器访问（Vite dev / 静态托管 / GitHub Pages）。
GitHub Pages 部署时 `vite.config.ts` 的 `base:'./'` 确保子路径下资源不 404。

## 技术栈

- TypeScript + Vite（无 UI 框架，状态层自研 store，渲染分层 Canvas）
- vitest 单测

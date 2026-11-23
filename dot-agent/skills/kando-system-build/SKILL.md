---
name: kando-system-build
description: 从"业务流程与权限设计工作台"类文档正向构建整套政企/平台系统——Spring Modulith 单体后端 + Vue3 前端，逐系统全栈闭环（物化spec→后端→编译门→前端→build门→真跑冒烟→对抗式评审），沿用固定架构、共享内核 FK、引用实体下拉、5.7 兼容、多轮 P0 对抗清零与 DoD。触发场景：用户要基于业务流程图/权限设计文档开发一套系统、说"用 kando 架构做系统/一键复用这套方案/按这套架构开发/做 X 系统"、或在已按本架构初始化的工程里要求新增系统。
---

# kando 系统构建器

把"业务流程与权限设计工作台"（流程泳道 + RBAC，通常无字段级）+ 字段级需求，正向建成能跑的全栈系统。**逐系统闭环、对抗式验收、诚实不伪造**。

## 何时用
- 新项目：产品给了业务流程/权限设计文档，要正向开发整套系统。
- 存量项目（已按本架构初始化，含 `CLAUDE.md`）：要新增下一个系统。

## 先确认三件事（缺则问用户）
1. **目标工程根**（新项目→先 bootstrap，见 `references/bootstrap-playbook.md`）。
2. **真源**：① 流程+权限文档路径 ② 字段级需求来源（原始 PRD / kando 架构产物 / 既有 data-model）。
3. **技术栈**：默认 `references/conventions.md` 的栈（Spring Modulith + MySQL + Vue3+ElementPlus）；用户指定则依用户。

## 工作流

### A. 新项目 bootstrap（首次）
按 `references/bootstrap-playbook.md`：
1. 若只有原始原型/PRD → 先用 `kando-macro-architecture-extractor` + `kando-product-spec-generator` 产出架构与六类 spec 作字段真源。
2. 把 `references/CLAUDE.md.template` 落成目标工程的 `CLAUDE.md`（改 groupId/库名/路径），作为本工程开发宪法。
3. 建 Spring Modulith 脚手架 + 共享内核（identity/region/dict/业务系统 registry + `common/mybatis/TombstoneIdServiceImpl` + security）+ Vue 前端脚手架。
4. 锁定系统清单 + 依赖 DAG（地基系统先行，聚合层最后）。

### B. 逐系统构建（每个系统一次）
用 `references/system-builder.template.mjs`（复制进目标工程 `workflows/` 并按注释填 args），或据它现写一个等价 Workflow。它跑 7 阶段闭环：
`物化本地spec(docs/product/<系统>/含覆盖矩阵) → 后端(迁移+实体+Mapper+Service+Controller+DTO) → 编译门 → 前端(el-select引用下拉) → build门 → 真跑冒烟(建库→迁移→启动→主链路curl) → 对抗式评审`
- 一次一个系统，按 DAG 顺序。跑完读结果。

### C. P0 对抗清零（关键，别省）
评审/复核 agent 独立判定，**自报成功不算数**。若复核报 P0 未清或真跑不通 → 起定点修复轮（fix workflow：并行修各 P0 + 编译/build 门 + 独立复核），重复直到 P0 清零、真跑通。历史经验：常需 2–4 轮才真清零。

## 铁律（写进每个 agent 提示，违背即返工）
- **grounding 中立**：读文档"它到底定义了什么"，禁止预贴标签（反例：把"消息中间件"预标成"站内信"→建错系统）。
- **引用实体一律下拉**：DB 存对方主键 FK + 创建时校验防孤儿；UI 用远程 select，**禁手填 ID**。操作人身份从安全上下文取，禁前端传。
- **编译过 ≠ 跑得通**：必须建库、迁移、启动、curl 主链路才算数。
- **诚实不伪造**：缺数据源/外部依赖的功能，如实标 stub/backlog，绝不硬编码假成功（如 100% 成功率、假回执）。
- **DoD**：编译绿 + P0 对抗清零 + 评审过 + 真跑主链路通 + 覆盖矩阵如实登记（P1/缺口入 backlog）。

## 参考文件
- `references/methodology.md` — 不变的方法论内核（契约+约束先行/共享内核/探针驱动/依赖分层/5道质量门）。
- `references/conventions.md` — 后端+前端具体约定（栈/软删/ENUM/FK/双语/路由/下拉）。
- `references/CLAUDE.md.template` — 目标工程开发宪法模板。
- `references/system-builder.template.mjs` — 通用单系统全栈构建 Workflow（args 驱动）。
- `references/bootstrap-playbook.md` — 新项目从零 bootstrap 步骤。

> 完整参考实现应放在目标项目根目录，并包含项目自己的 `AGENTS.md`、工作流、产品覆盖矩阵和系统依赖文档。

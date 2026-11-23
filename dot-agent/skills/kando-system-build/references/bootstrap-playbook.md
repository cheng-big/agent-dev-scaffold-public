# 新项目 bootstrap playbook（从零到可逐系统构建）

## 0. 判断输入形态
- 只有原始原型/PRD（业务流程+权限，无字段/架构）→ 先做「前置提取」（步1）。
- 已有架构产物 + 六类 spec（字段级）→ 跳到步 2。

## 1. 前置提取（原始文档 → 架构 + 字段真源）
用你的 kando skills：
1. `kando-macro-architecture-extractor`：原型/PRD PDF → L0 架构(systems/DAG/共享实体/GoldenPath/RBAC/契约) + L2 页面契约蓝图 + L4 脏数据探针 + ambiguities 熔断。**锁定系统清单与依赖 DAG（此后不许漂）。**
2. `kando-product-spec-generator`：架构产物 → 每系统六类交付物（PRD/薄spec/菜单总账/覆盖矩阵/data-model切片/contracts）。
> 产物作为逐系统构建的字段真源（相当于本模板里的 XZ 目录）。

## 2. 建工程骨架
1. 落 `CLAUDE.md`：复制 `CLAUDE.md.template`，改 groupId/库名/路径/真源路径。
2. 后端脚手架：Maven + Spring Boot 3.3.5 + Spring Modulith + MyBatis-Plus + Flyway + MySQL 驱动 + Security/JWT；`Application`(@Modulithic)；`application.yml`(连库 + 逻辑删除全局配置)。
3. 公共基类：`common/mybatis/TombstoneIdServiceImpl`（软删 deleted=id，override 全部逻辑删除入口）。
4. Security：JWT 过滤器填充 SecurityContext；SecurityConfig 默认 authenticated，仅放行登录/公开端点。
5. 前端脚手架：Vite+Vue3+TS+ElementPlus+Pinia+router+axios；api client(JWT拦截)；登录页+auth store+路由守卫；MainLayout+模块化路由聚合。
6. 验证：mvn compile + npm run build 双绿。

## 3. 共享内核（先建，冻结）
identity(user/role/permission/rels/grant) · region(行政区划自引用) · dict(类型/项) · registry(业务系统名录，种子从架构 systems[])。迁移 V1–V?，含 FK + UNIQUE(biz,deleted) + 14/N 角色与超管种子。真跑验证登录 + RBAC 通。

## 4. 依赖 DAG
按架构锁定的系统清单排序：地基（认证/组织/字典/区划/业务系统名录）→ 业务系统（org→场馆→活动→赛事…）→ 设备/采集（闸机/客流）→ 数据/分析 → 聚合层（地图/监管/门户，只读，最后）。每系统留 Flyway 版本段。

## 5. 逐系统构建
把 `system-builder.template.mjs` 复制进 `workflows/`，改 CONFIG，逐系统 `Workflow({scriptPath, args:{system,domain,pkg,migration,blueprint,probe,downloadsHint,frontend}})`。一次一个，跑完读结果；P0 未清或真跑不通→定点修复轮再重跑。全程守 DoD 与铁律（SKILL.md）。

## 6. 跨系统集成
全系统建完 → 探针 5_crossref 跨系统穿透（断言聚合层真实引用、无 mock）+ GoldenPath e2e。

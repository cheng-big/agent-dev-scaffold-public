# 后端 + 前端具体约定

## 栈（默认，可按项目调）
Java17 · SpringBoot 3.3.5 · Spring Modulith · MyBatis-Plus(mybatis-plus-spring-boot3-starter) · Flyway · MySQL(5.7+) · Security+JWT · 前端 Vue3+Vite+TS+ElementPlus+Pinia+vue-router+axios（apps/web）。

## 后端
- **模块边界**：`platform.*`（内核/底座：identity/auth/message/approval/mid/dict/region/registry…）、`modules.*`（业务）、`aggregation.*`（只读聚合）。一级包配 `package-info.java`（@ApplicationModule）。
- **主键**：业务码表 = 代理 id BIGINT AUTO_INCREMENT 作物理 PK + 业务键 varchar 作 `UNIQUE(业务列, deleted)`；Java 类型 String；FK 引用业务键（MySQL 允许 FK 引用 UNIQUE 键）。
- **软删**：统一继承共享基类 `common/mybatis/TombstoneIdServiceImpl`（override 全部逻辑删除入口 setSql `deleted=id`，使已删行以唯一值退出唯一槽位，可同码重建）。@TableLogic 仅用于查询过滤（deleted=0）。带 UNIQUE(biz,deleted) 的表必须继承。
- **枚举**：ENUM 列类型（MySQL5.7 会忽略 CHECK，勿依赖 CHECK）；状态机字面量抽单一真源常量类。
- **通用列**：region_code(软引用 map_region.code) · 双语 name_zh/name_bo · deleted BIGINT · 审计 create_time/update_time/create_by/update_by(带 DEFAULT/ON UPDATE)。
- **引用完整性**：存对方主键 FK；引用业务系统存 sys_business_system.system_code；创建时校验被引对象存在且启用，防孤儿脏数据。
- **身份**：操作人一律从 SecurityContextHolder 取；登录端点 permitAll，其余 authenticated；禁前端传 reviewerId/senderId/receiverId。
- **Flyway**：已应用真实库的版本禁改（校验和冲突）；每系统留版本段（V60/V70…，每段留余量给同系统追加）。
- **乐观锁**（如需）：注册 OptimisticLockerInnerInterceptor + @Version + updateById(entity)，否则用状态 CAS（UPDATE...WHERE status=? 校验受影响行数）。

## 前端
- **模块化路由**：每域只加 `src/router/routes/<域>.ts`（export RouteRecordRaw[]）+ `views/<域>/*`；router/index.ts 用 `import.meta.glob('./routes/*.ts',{eager:true})` 自动聚合；侧栏由 meta.title 生成。**不改共享 router/index.ts、layout**（防并行冲突）。
- **api**：vite proxy `/api`→后端 rewrite 去前缀；axios 拦截器注入 `Authorization: Bearer`，401 清 token 跳登录。
- **★引用实体一律 el-select 远程下拉**：值=业务主键（user_id/role_id/region code/system_code…），展示双语名；多选用 multiple；禁任何手填 ID 文本框（实体自身主键的"铸键录入"除外，且编辑态 disabled）。
- 状态/类型枚举用 select（取自后端 ENUM）。找回密码等公开页 meta.public 免登录。

## 真跑冒烟（每系统必做）
建库(DROP+CREATE 全量重放迁移) → mvn spring-boot:run 等 Started（迁移报错则修当前系统迁移、drop重建、重试）→ 登录拿 JWT → curl 主链路（建/查/状态机推进，引用用真实内核数据）→ kill 释放端口 → 诚实汇报 booted/mainChainOk/issues。

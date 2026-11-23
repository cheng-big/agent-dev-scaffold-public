// 通用单系统全栈构建器（项目无关模板）。用法：
//   1) 复制进目标工程 workflows/ 目录。
//   2) 改下面 CONFIG 的 ROOT/XZ（字段真源根）/PKGROOT/库连接。
//   3) Workflow({ scriptPath, args: { system, domain, pkg, migration, blueprint, probe,
//        downloadsHint, frontend } })  —— 一次一个系统。
// 约束见目标工程 CLAUDE.md。跑完读结果；P0 未清或真跑不通→起定点修复轮再重跑本系统。
export const meta = {
  name: 'system-builder',
  description: '通用单系统全栈构建器(args驱动):物化spec→后端→编译门→前端→build门→真跑冒烟→对抗评审',
  phases: [{ title: 'GroundSpec' }, { title: 'Backend' }, { title: 'CompileGate' }, { title: 'Frontend' }, { title: 'BuildGate' }, { title: 'RuntimeSmoke' }, { title: 'Review' }],
}
// ==== CONFIG（改这里）====
const ROOT = '<目标工程根，如 /path/to/app>'
const XZ = '<字段真源根，如 kando 架构产物目录 /path/to/spec-source>'
const PKGROOT = '<包根，如 com.acme.platform>'
const DB = 'mysql -u<user> -p<pwd>'   // 真跑冒烟建库用
const DBNAME = '<dbname>'
// ========================
const WEB = ROOT + '/apps/web'
const A = args || {}
const SYS = A.system || '(未指定)', DOMAIN = A.domain || '', PKG = A.pkg || ('modules.' + (DOMAIN || 'x').toLowerCase())
const MIG = A.migration || 'V99', DOFE = A.frontend !== false
const BP = A.blueprint ? `${XZ}/docs/blueprints/${A.blueprint}` : '(自行匹配蓝图)'
const PROBE = A.probe ? `${XZ}/docs/probes/${A.probe}` : '(自行匹配probe)'
const DL = A.downloadsHint || '(该系统对应的流程/权限文件，自行匹配)'
const DIR = (DOMAIN || SYS).toLowerCase()
const RULES = `严格遵守 ${ROOT}/CLAUDE.md（软删TombstoneIdServiceImpl/ENUM/FK/双语/region软引用/安全上下文取操作人/引用实体el-select禁手填/Flyway已应用版本禁改）。系统 ${SYS}(域 ${DOMAIN}) 包 ${PKGROOT}.${PKG}，迁移段 ${MIG}。`
const GEN = { type: 'object', additionalProperties: true, properties: { area: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' } }, tables: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['area'] }
const COMPILE = { type: 'object', additionalProperties: true, properties: { compiled: { type: 'boolean' }, errors: { type: 'array', items: { type: 'string' } } }, required: ['compiled'] }
const RUN = { type: 'object', additionalProperties: true, properties: { booted: { type: 'boolean' }, mainChainOk: { type: 'boolean' }, endpointResults: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['booted'] }

phase('GroundSpec')
const spec = await agent(`你是「${SYS}」需求提取+本地spec物化员。只读真源写 spec 到 ${ROOT}/docs/product/${DIR}/。真源:流程+权限←${DL};字段级←${BP}、${PROBE}、${XZ} 的 data-model。⚠️中立提取勿预贴标签。物化 spec.md/data-model.md/coverage-matrix.md(蓝图末级功能点→拟实现,DoD基准)。按 GEN(area=spec) 汇报含 ambiguities。`, { label: `${DOMAIN}:spec`, phase: 'GroundSpec', schema: GEN })

phase('Backend')
const be = await agent(`你是「${SYS}」后端生成员。${RULES} 依据 ${ROOT}/docs/product/${DIR}/ 生成 ${PKGROOT}.${PKG}:迁移 ${MIG}__*.sql(表/FK/ENUM/UNIQUE(biz,deleted))+实体/Mapper/Service(带唯一键继承TombstoneIdServiceImpl)/Controller/DTO/package-info。引用内核走FK+创建校验防孤儿,操作人从安全上下文取。按 GEN(area=backend,tables) 汇报。`, { label: `${DOMAIN}:be`, phase: 'Backend', schema: GEN })

phase('CompileGate')
let c = await agent(`在 ${ROOT} 执行 mvn -q clean compile,失败最小改动修再编译最多3轮。按 COMPILE 返回。`, { label: `${DOMAIN}:compile`, phase: 'CompileGate', schema: COMPILE })

if (DOFE) {
  phase('Frontend')
  await agent(`你是「${SYS}」前端页员。${RULES} 前端约定见 CLAUDE.md(模块化路由只加 routes/${DIR}.ts 与 views/${DIR}/*,引用实体全 el-select 远程下拉禁手填ID)。读后端 controller/dto 建增删改查+状态机页。按 GEN(area=frontend) 汇报。`, { label: `${DOMAIN}:fe`, phase: 'Frontend', schema: GEN })
  phase('BuildGate')
  await agent(`在 ${WEB} 执行 npm run build,失败最小改动修再build最多3轮。按 COMPILE(built当compiled) 返回。`, { label: `${DOMAIN}:build`, phase: 'BuildGate', schema: COMPILE })
}

phase('RuntimeSmoke')
const run = await agent(`你是「${SYS}」运行验证员。1) ${DB} -e "DROP DATABASE IF EXISTS ${DBNAME}; CREATE DATABASE ${DBNAME} DEFAULT CHARACTER SET utf8mb4;" 2) cd ${ROOT} && mvn -q spring-boot:run 后台,等 Started 或修迁移(仅本系统段)重试最多4轮。3) 登录拿JWT→本系统主链路 curl(建/查/状态机,引用用真实内核数据)。4) kill 释放端口。按 RUN 返回,诚实报。`, { label: `${DOMAIN}:run`, phase: 'RuntimeSmoke', schema: RUN })

phase('Review')
const review = await agent(`审查 ${ROOT} 的 ${PKG} 业务正确性(不改码):①贴真源spec+覆盖矩阵真实②状态机/软删/FK/防孤儿③引用完整性与操作人来源④前端引用实体全下拉无手填、api对齐。列 P0/P1(措辞用业务正确性避开安全词)。`, { label: `${DOMAIN}:review`, phase: 'Review' })

return { system: SYS, spec, be, compile: c, run, review }

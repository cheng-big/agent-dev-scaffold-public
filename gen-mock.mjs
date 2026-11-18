// 一次性 mock 生成器：造一份"逐系统建造进行中"的真实状态，渲染 board.html 供预览。跑完可删。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = join(HERE, 'mock-board');            // 可见输出目录（board.html + 演示产物都在这）
mkdirSync(MOCK, { recursive: true });
process.env.AGENT_HOME = join(MOCK, '.agent');     // 记忆根塞进 mock 目录，自包含

const store = await import('./dot-agent/scripts/lib/store.mjs');
const proc = await import('./dot-agent/scripts/lib/process.mjs');
const taskMod = await import('./dot-agent/scripts/lib/task.mjs');
const journal = await import('./dot-agent/scripts/lib/journal.mjs');
const board = await import('./dot-agent/scripts/lib/board.mjs');

store.ensureDirs();
const tpl = store.readJson(join(HERE, 'dot-agent', 'process', 'process.template.json'));
store.writeJsonAtomic(proc.processPath(), tpl);
let st = proc.freshState(tpl);

// —— 落几个真实产物文件（相对 MOCK），让看板链接可点 ——
const put = (rel, body) => { const f = join(MOCK, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); return rel; };
put('docs/product/xz/spec.md', '# 需求骨架\n系统清单/菜单树/状态机/实体矩阵……');
put('docs/architecture/xz_arch.json', '{ "systems": ["赛事","场馆","协会"], "note": "宏观架构 mock" }');
put('docs/probes/xz_probe.json', '{ "probes": ["Probe_9999"], "note": "脏数据探针 mock" }');
put('docs/product/xz/coverage-matrix.md', '# 覆盖矩阵\n功能点逐条归口……');
put('docs/blueprints/xz_blueprint.json', '{ "pages": [{ "menu_group": "用户", "data": ["userId","name"], "action": ["create","disable"], "input": ["orgId 下拉"] }] }');
put('docs/blueprints/xz_blueprint.html', '<!doctype html><meta charset=utf-8><title>页面契约渲染</title><body style="font-family:system-ui;padding:32px"><h1>📐 页面契约·渲染蓝图（mock）</h1><p>这是 anti-omission-dev-blueprint 产出的可读契约页示例：每页 data/action/input 三视图。</p></body>');
mkdirSync(join(MOCK, 'src/main/java/com/xizang/fitness/modules/user'), { recursive: true });
writeFileSync(join(MOCK, 'src/main/java/com/xizang/fitness/modules/user/UserController.java'), '// mock');

// —— 阶段推进：前 4 站完成，第 5 站(逐系统建造)进行中 ——
const done = ['understand', 'reverse-design', 'page-contract', 'foundation'];
for (const id of done) {
  const { taskId } = proc.seedPhaseTask(tpl, id, st);
  taskMod.updateTask(taskId, (t) => {
    t.status = 'completed';
    t.definition_of_done = (t.definition_of_done || []).map((d) => ({ ...d, met: true }));
    t.recent_completed = [{ at: '2026-08-24T09:00:00+08:00', summary: `${id} 阶段产物已确认签核`, step_id: 'step-1', evidence: [] }];
  });
}
// 登记这些阶段的产物（真实路径覆盖模板占位）
const reg = (phase, key, name, path) => st.artifacts.push({ phase_id: phase, key, name, path, status: 'done', registered_at: '2026-08-24T09:00:00+08:00' });
reg('understand', 'spec', '需求骨架', 'docs/product/xz/spec.md');
reg('reverse-design', 'arch', '宏观架构', 'docs/architecture/xz_arch.json');
reg('reverse-design', 'probe', '脏数据探针', 'docs/probes/xz_probe.json');
reg('reverse-design', 'coverage-matrix', '覆盖矩阵', 'docs/product/xz/coverage-matrix.md');
reg('page-contract', 'blueprint', '页面蓝图', 'docs/blueprints/xz_blueprint.json');
reg('page-contract', 'blueprint-render', '契约渲染页', 'docs/blueprints/xz_blueprint.html');

// —— 当前站：逐系统建造，一份丰富的"任务计划书" ——
const bs = proc.seedPhaseTask(tpl, 'build-systems', st).taskId;   // 末次 seed → current_phase=build-systems
taskMod.updateTask(bs, (t) => {
  t.status = 'in_progress';
  t.objective = '[05 逐系统建造] 用户/机构系统全栈闭环：物化spec→后端→前端→冒烟';
  t.current_focus = '前端页面接入机构下拉选择器';
  t.next_action = '把机构选择器换成下拉（值=机构ID、显示=双语名），跑真跑冒烟';
  t.definition_of_done = [
    { text: '数据库迁移 V1__user.sql 建表（Flyway 可跑）', met: true, evidence: [] },
    { text: '用户/角色模块 API（Controller）落地 + 编译门过', met: true, evidence: [] },
    { text: '前端页面：用户列表 + 机构下拉选择（严禁手填 ID）', met: false, evidence: [] },
    { text: '真跑冒烟：真登录能看到种子数据', met: false, evidence: [] },
  ];
  t.recent_completed = [
    { at: '2026-08-24T10:10:00+08:00', summary: '建 V1__user.sql 迁移并跑通', step_id: 'step-mig', evidence: [] },
    { at: '2026-08-24T10:40:00+08:00', summary: '用户模块 Controller/Service 落地，编译门过', step_id: 'step-api', evidence: [] },
  ];
  t.open_step = {
    step_id: 'step-fe',
    intent: '接入机构下拉选择器（值=机构ID/显示=双语名）',
    attempt: 1,
    idempotency_key: 'k-fe-1',
    started_at: '2026-08-24T11:00:00+08:00',
    effect: 'none',
    targets: [],
  };
  t.references = ['页面契约:docs/blueprints/xz_blueprint.html', '架构:docs/architecture/xz_arch.json'];
});
reg('build-systems', 'backend-modules', '后端业务模块', 'src/main/java/com/xizang/fitness/modules/user');
reg('build-systems', 'frontend-views', '前端页面', 'apps/web/src/views/user');  // 故意不落盘 → 看板显 ✗

// —— 开发任务清单 · 逐系统（流程 tab 展示）：走真实 API addSystem/setWorklistStatus ——
const setStatuses = (sysKey, map) => Object.entries(map).forEach(([task, status]) => proc.setWorklistStatus(tpl, st, sysKey, task, status));
proc.addSystem(tpl, st, 'match', '赛事系统');
setStatuses('match', { db: 'completed', api: 'completed', backend: 'completed', frontend: 'in_progress', role: 'planned' });
proc.addSystem(tpl, st, 'venue', '场馆系统');
setStatuses('venue', { db: 'completed', api: 'in_progress', backend: 'planned' });
proc.addSystem(tpl, st, 'assoc', '协会系统');
setStatuses('assoc', { db: 'planned' });

// —— 记忆 tab 需要 journal 活动 ——
for (const [ev, p] of [
  ['task_created', { objective: '用户/机构系统全栈闭环' }],
  ['step_committed', { summary: '建 V1__user.sql 迁移并跑通' }],
  ['step_committed', { summary: '用户模块 API 落地，编译门过' }],
  ['step_started', { intent: '接入机构下拉选择器' }],
  ['decision_recorded', { title: '机构引用一律下拉', why: '严禁手填 ID，杜绝孤儿数据' }],
]) journal.appendEvent(bs, ev, { payload: p });

proc.saveState(st);
const html = board.buildBoardHtml(tpl, st, { cwd: MOCK, outDir: MOCK, generatedAt: '2026-08-24T11:05:00+08:00' })
  .replace(/[ \t]+$/gm, '');
const out = join(MOCK, 'board.html');
writeFileSync(out, html);
console.log('✔ mock 看板已生成：' + out);

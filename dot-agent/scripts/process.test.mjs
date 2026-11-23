// node --test：方法论脚手架层。每个用例独立临时 AGENT_HOME，产物用绝对路径以避免 cwd 干扰。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function freshHome() {
  const base = mkdtempSync(join(tmpdir(), 'proc-test-'));
  const home = join(base, '.agent');
  mkdirSync(home, { recursive: true });
  process.env.AGENT_HOME = home;
  return { base, home };
}

const store = await import('./lib/store.mjs');
const schema = await import('./lib/schema.mjs');
const proc = await import('./lib/process.mjs');
const stats = await import('./lib/stats.mjs');
const skills = await import('./lib/skills.mjs');
const board = await import('./lib/board.mjs');
const hookMod = await import('./lib/hook.mjs');
const journalMod = await import('./lib/journal.mjs');
const taskMod = await import('./lib/task.mjs');

// 造一个 2 阶段流程，产物指向 home 下绝对路径（存在与否可控）
function makeProcess(home) {
  return {
    process_version: 1,
    name: '测试流程',
    phases: [
      {
        id: 'p1', no: '01', icon: '📖', name: '第一阶段', intent: '产出 A',
        what: 'w1', why: 'y1', skills: ['skill-a'],
        inputs: [{ key: 'prd', name: '需求文档', path: join(home, 'prd.pdf') }],
        depends_on: [],
        gates: ['gate-1'], dod: ['dod-1'],
        artifacts: [{ key: 'a', name: '产物A', desc: '这是产物A', path: join(home, 'a.txt'), required: true }],
      },
      {
        id: 'p2', no: '02', icon: '⚙️', name: '第二阶段', intent: '产出 B',
        skills: ['skill-b'], depends_on: ['p1'],
        dod: ['dod-2'],
        artifacts: [{ key: 'b', name: '产物B', desc: '这是产物B', path: join(home, 'b.txt'), required: true }],
      },
    ],
    rails: [{ id: 'dod', name: '做得实', desc: '防假绿' }],
  };
}

function writeProcess(home, p) {
  store.writeJsonAtomic(proc.processPath(), p);
  return p;
}

// makeProcess 的变体：给 p2 挂上 worklist（逐系统开发任务模板）
function makeProcessWithWorklist(home) {
  const p = makeProcess(home);
  p.phases[1].worklist = [{ key: 'be', name: '后端' }, { key: 'fe', name: '前端' }];
  return p;
}

test('P1. 内置模板与自造 process 都通过 schema；非法被拒', () => {
  freshHome();
  // 内置模板
  const tplPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'process', 'process.template.json');
  const tpl = store.readJson(tplPath);
  assert.equal(schema.validate('process.schema.json', tpl).valid, true, '内置模板应过 schema');
  // 阶段01 应声明输入真源（需求文档），保证装完能引导到「基于需求文档做第一步」
  assert.ok((tpl.phases[0].inputs || []).length >= 1, '阶段01 应有 inputs（需求文档）');
  // 非法：phases 缺 artifacts
  const bad = { process_version: 1, name: 'x', phases: [{ id: 'p', name: 'n' }] };
  assert.equal(schema.validate('process.schema.json', bad).valid, false);
  // state schema
  const st = proc.freshState(tpl);
  assert.equal(schema.validate('process-state.schema.json', st).valid, true);
});

test('P2. seedPhaseTask 建出的 task 带正确 phase/DoD/约束，并登记进 state', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcess(home));
  const st = proc.freshState(p);
  const { taskId, created } = proc.seedPhaseTask(p, 'p1', st);
  assert.equal(created, true);
  assert.equal(taskId, 'phase-p1');
  assert.equal(st.phase_tasks.p1, 'phase-p1');
  assert.equal(st.current_phase, 'p1');
  const t = taskMod.loadTask('phase-p1');
  assert.equal(t.phase, '第一阶段');
  assert.deepEqual(t.definition_of_done.map((d) => d.text), ['dod-1']);
  assert.deepEqual(t.critical_constraints, ['gate-1']);
});

test('P3. computeNext 五条优先级各命中一次', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcess(home));
  let st = proc.freshState(p);

  // (a) 未开始任何阶段 → phase-start p1，hint 带输入真源（需求文档）
  let n = proc.computeNext(p, st);
  assert.equal(n.action, 'phase-start');
  assert.equal(n.phase_id, 'p1');
  assert.match(n.hint, /需求文档/, 'phase-start 应引导先读输入真源');
  assert.match(n.hint, /prd\.pdf/);

  // 进入 p1
  proc.seedPhaseTask(p, 'p1', st);

  // (b) required 产物未在磁盘 → produce-artifact，hint 含 skill 名
  n = proc.computeNext(p, st);
  assert.equal(n.action, 'produce-artifact');
  assert.match(n.hint, /skill-a/);

  // (c) 有中断步骤 → recover（优先于缺产物）
  journalMod.appendEvent('phase-p1', 'step_started', { stepId: 'step-x', payload: { intent: 'i' } });
  n = proc.computeNext(p, st);
  assert.equal(n.action, 'recover');
  // 收尾该中断步骤，便于后续断言
  journalMod.appendEvent('phase-p1', 'step_committed', { stepId: 'step-x' });

  // (d) 产物齐但阶段未完成 → complete-phase
  writeFileSync(join(home, 'a.txt'), 'x');
  st.artifacts.push({ phase_id: 'p1', key: 'a', name: '产物A', path: join(home, 'a.txt'), status: 'done', registered_at: store.nowIso() });
  n = proc.computeNext(p, st);
  assert.equal(n.action, 'complete-phase');

  // 完成 p1 → 焦点转 p2（phase-start）
  taskMod.updateTask('phase-p1', (t) => { t.status = 'completed'; });
  n = proc.computeNext(p, st);
  assert.equal(n.phase_id, 'p2');
  assert.equal(n.action, 'phase-start');

  // (e) 全部阶段完成 → all-done
  proc.seedPhaseTask(p, 'p2', st);
  writeFileSync(join(home, 'b.txt'), 'y');
  st.artifacts.push({ phase_id: 'p2', key: 'b', name: '产物B', path: join(home, 'b.txt'), status: 'done', registered_at: store.nowIso() });
  taskMod.updateTask('phase-p2', (t) => { t.status = 'completed'; });
  n = proc.computeNext(p, st);
  assert.equal(n.done, true);
  assert.equal(n.action, 'all-done');
});

test('P4. computePhaseView 产物磁盘回读：登记但缺失判 ✗，存在判 ✓', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcess(home));
  const st = proc.freshState(p);
  // 登记但文件不存在
  st.artifacts.push({ phase_id: 'p1', key: 'a', name: '产物A', path: join(home, 'a.txt'), status: 'done', registered_at: store.nowIso() });
  let v = proc.computePhaseView(p.phases[0], st);
  assert.equal(v.artifacts[0].registered, true);
  assert.equal(v.artifacts[0].on_disk, false, '登记但磁盘缺失 → on_disk=false');
  // 造出文件后 → on_disk=true
  writeFileSync(join(home, 'a.txt'), 'x');
  v = proc.computePhaseView(p.phases[0], st);
  assert.equal(v.artifacts[0].on_disk, true);
});

test('P5. 项目内置 skill 优先于全局探测，并支持插件名称', () => {
  const { home } = freshHome();
  const cwd = dirname(home);
  const skDir = join(cwd, '.agent', 'skills', 'foo');
  mkdirSync(skDir, { recursive: true });
  writeFileSync(join(skDir, 'SKILL.md'), '# foo');
  assert.equal(skills.detectSkill('foo', { cwd }), 'installed');
  assert.deepEqual(skills.skillInfo('foo', { cwd }), { state: 'installed', source: 'project' });
  mkdirSync(join(cwd, '.claude', 'skills', 'agent-skill'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'skills', 'agent-skill', 'SKILL.md'), '# agent skill');
  assert.equal(skills.detectSkill('agent-skills:agent-skill', { cwd }), 'installed');
  assert.equal(skills.detectSkill('zzz-nonexistent-skill-xyz', { cwd }), 'not_found');
});

test('P5a. 默认开发和 Bugfix 流程的 skill 都有项目内置本体', () => {
  const templateRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const names = new Set();
  for (const file of ['process/process.template.json', 'process/bugfix.template.json']) {
    const processFile = JSON.parse(readFileSync(join(templateRoot, file), 'utf8'));
    for (const phase of processFile.phases) for (const name of phase.skills || []) names.add(name.split(':').at(-1));
  }
  for (const name of names) assert.ok(existsSync(join(templateRoot, 'skills', name, 'SKILL.md')), `${name} 缺少 SKILL.md`);
});

test('P6. buildBoardHtml 含全部阶段名/产物 desc/skillband 徽章/当前站高亮/缺失标记', () => {
  const { home } = freshHome();
  mkdirSync(join(dirname(home), '.agent', 'skills', 'skill-a'), { recursive: true });
  writeFileSync(join(dirname(home), '.agent', 'skills', 'skill-a', 'SKILL.md'), '# skill-a');
  const p = writeProcess(home, makeProcess(home));
  const st = proc.freshState(p);
  proc.seedPhaseTask(p, 'p1', st); // current_phase=p1
  writeFileSync(join(home, 'a.txt'), 'x');
  st.artifacts.push({ phase_id: 'p1', key: 'a', name: '产物A', path: join(home, 'a.txt'), status: 'done', registered_at: store.nowIso() });
  journalMod.appendEvent('phase-p1', 'step_committed', { stepId: 'demo', payload: { summary: 's' } }); // 制造记忆活动
  const html = board.buildBoardHtml(p, st, { cwd: dirname(home), generatedAt: '2026-01-01T00:00:00Z' });
  assert.match(html, /第一阶段/);
  assert.match(html, /第二阶段/);
  assert.match(html, /这是产物A/);          // desc
  assert.match(html, /你在这/);              // 当前站高亮
  assert.match(html, /skpill/);              // skillband
  assert.match(html, /✓ 在磁盘/);            // p1 产物存在
  assert.match(html, /— 未产出/);            // p2 产物未产出
  assert.match(html, /输入真源/);            // 阶段展示输入真源
  assert.match(html, /prd\.pdf/);            // 需求文档路径
  assert.match(html, /✓项目内置/);
  // 双 tab 解耦
  assert.match(html, /data-t="flow"/);       // 流程 tab
  assert.match(html, /data-t="mem"/);        // 记忆 tab
  assert.match(html, /记忆概览/);            // 记忆 tab 内容
  assert.match(html, /任务快照/);            // 任务卡片区
  assert.match(html, /记忆在被调用/);        // journal 有事件 → 判定被调用
});

test('P8. memoryDetail 挖出事件分布/任务卡片/决策/证据/checkpoint', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcess(home));
  const st = proc.freshState(p);
  proc.seedPhaseTask(p, 'p1', st);
  journalMod.appendEvent('phase-p1', 'task_created', { payload: {} });
  journalMod.appendEvent('phase-p1', 'step_committed', { stepId: 's1', payload: {} });
  journalMod.appendEvent('phase-p1', 'step_committed', { stepId: 's2', payload: {} });
  journalMod.appendEvent('phase-p1', 'step_failed', { stepId: 's3', payload: { reason: '编译失败' } });
  const d = stats.memoryDetail();
  assert.equal(d.eventsByType.step_committed, 2, '事件类型分布应统计到 2 个 step_committed');
  assert.equal(d.failed.length, 1);
  assert.equal(d.failed[0].reason, '编译失败');
  assert.ok(d.tasks.find((t) => t.id === 'phase-p1'), '任务卡片应含 phase-p1');
  assert.ok(d.firstAt && d.lastAt, '应有时间跨度');
  assert.equal(typeof d.decisions, 'object');
  assert.equal(typeof d.evidenceCount, 'number');
});

test('P7. memoryStats 汇总 journal：任务数/事件数/最近/被调用判定', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcess(home));
  const st = proc.freshState(p);
  // 空 journal → 未被调用
  let m = stats.memoryStats();
  assert.equal(m.eventCount, 0);
  assert.equal(m.invoked, false);
  // 制造事件后 → 被调用，事件数/最后写入/最近可读
  proc.seedPhaseTask(p, 'p1', st);
  journalMod.appendEvent('phase-p1', 'task_created', { payload: {} });
  journalMod.appendEvent('phase-p1', 'step_committed', { stepId: 's1', payload: {} });
  m = stats.memoryStats();
  assert.equal(m.taskCount, 1);
  assert.equal(m.eventCount, 2);
  assert.equal(m.invoked, true);
  assert.ok(m.lastAt, '应有最后写入时间');
  assert.equal(m.recent[0].event, 'step_committed', '最近一条应在最前');
});

test('P9. eventSummary 提取事件内容/结果，时间线可读', () => {
  freshHome();
  assert.match(stats.eventSummary({ event: 'step_started', payload: { intent: '读需求文档' } }), /意图：读需求文档/);
  assert.match(stats.eventSummary({ event: 'step_committed', payload: { summary: '产出 arch.json' } }), /产出 arch\.json/);
  assert.match(stats.eventSummary({ event: 'verification_finished', payload: { result: 'pass' } }), /结果：pass/);
  assert.match(stats.eventSummary({ event: 'decision_recorded', payload: { title: '挂 ASSUMPTION', why: '未闭环' } }), /挂 ASSUMPTION/);
});

test('P10. board 渲染阶段验收 DoD（逐条）+ 产物路径可点/缺失降级', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcess(home));
  const st = proc.freshState(p);
  proc.seedPhaseTask(p, 'p1', st);                         // 建 phase-p1，dod=['dod-1'] 默认未达
  taskMod.updateTask('phase-p1', (t) => { t.definition_of_done[0].met = true; }); // 勾一条，验证计划书按真实态展示
  writeFileSync(join(home, 'a.txt'), 'x');                 // p1 产物落盘
  st.artifacts.push({ phase_id: 'p1', key: 'a', name: '产物A', path: join(home, 'a.txt'), status: 'done', registered_at: store.nowIso() });
  journalMod.appendEvent('phase-p1', 'step_committed', { stepId: 'demo', payload: { summary: 's' } });
  // outDir=home：磁盘上的 a.txt 相对 board.html(在 home) 即 'a.txt'
  const html = board.buildBoardHtml(p, st, { cwd: dirname(home), outDir: home, generatedAt: '2026-01-01T00:00:00Z' });
  assert.match(html, /阶段验收 DoD/);                      // 记忆 tab DoD 区块（计划书让名给流程 tab 的开发任务清单）
  assert.match(html, /dod-1/);                             // DoD 文案逐条展示
  assert.match(html, /<a href="a\.txt"/);                  // 在磁盘产物 → 相对可点链接
  assert.doesNotMatch(html, /<a href="b\.txt"/);           // p2 产物缺失 → 不给链接（降级纯文本）
});

test('P11. installBoardHook 幂等：重复装不重复追加、不改内容', () => {
  const { base } = freshHome();
  // 无 .git → 安静跳过
  assert.match(hookMod.installBoardHook({ cwd: base }), /未检测到 \.git/);
  mkdirSync(join(base, '.git'), { recursive: true });
  const hookFile = join(base, '.git', 'hooks', 'post-commit');
  // 首次装
  assert.match(hookMod.installBoardHook({ cwd: base }), /已装 post-commit/);
  const first = readFileSync(hookFile, 'utf8');
  assert.match(first, /agent-dev-scaffold board refresh/);
  // 再装 → 幂等跳过，内容不变、标记块只一个
  assert.match(hookMod.installBoardHook({ cwd: base }), /已含 board 刷新块/);
  const second = readFileSync(hookFile, 'utf8');
  assert.equal(second, first, '再装不应改动 hook 文件');
  assert.equal((second.match(/board refresh >>>/g) || []).length, 1, '标记块只应出现一次');
});

test('P12. installBoardHook 追加到用户已有 hook，不覆盖原逻辑', () => {
  const { base } = freshHome();
  mkdirSync(join(base, '.git', 'hooks'), { recursive: true });
  const hookFile = join(base, '.git', 'hooks', 'post-commit');
  writeFileSync(hookFile, '#!/bin/sh\necho "用户原有钩子"\n');
  assert.match(hookMod.installBoardHook({ cwd: base }), /追加到现有/);
  const content = readFileSync(hookFile, 'utf8');
  assert.match(content, /用户原有钩子/, '原逻辑必须保留');
  assert.match(content, /board refresh/, '刷新块已追加');
});

test('P14. addSystem/setWorklistStatus：铺开任务、幂等、状态更新与非法校验', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcessWithWorklist(home));
  const st = proc.freshState(p);
  const r = proc.addSystem(p, st, 'match', '赛事系统');
  assert.equal(r.created, true);
  assert.equal(r.count, 2, 'worklist 有 2 项');
  assert.equal(st.systems[0].tasks.length, 2);
  assert.equal(st.systems[0].tasks[0].status, 'not_started', '铺开时初始未开始');
  // 幂等：重复登记不新增
  assert.equal(proc.addSystem(p, st, 'match', '赛事系统').created, false);
  assert.equal(st.systems.length, 1);
  // 状态更新
  proc.setWorklistStatus(p, st, 'match', 'be', 'completed');
  assert.equal(st.systems[0].tasks.find((t) => t.key === 'be').status, 'completed');
  // 非法任务 / 未登记系统 → 报错
  assert.throws(() => proc.setWorklistStatus(p, st, 'match', 'nope', 'completed'), /不在 worklist/);
  assert.throws(() => proc.setWorklistStatus(p, st, 'ghost', 'be', 'completed'), /未登记系统/);
  // 带 systems 的 state 仍过 schema（saveState 会校验）
  proc.saveState(st);
});

test('P15. computeNext worklist 分支：无系统→add-system，有待办→worklist-task，做完→落后续', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcessWithWorklist(home));
  const st = proc.freshState(p);
  // 完成 p1，让焦点转到带 worklist 的 p2
  proc.seedPhaseTask(p, 'p1', st);
  writeFileSync(join(home, 'a.txt'), 'x');
  st.artifacts.push({ phase_id: 'p1', key: 'a', name: '产物A', path: join(home, 'a.txt'), status: 'done', registered_at: store.nowIso() });
  taskMod.updateTask('phase-p1', (t) => { t.status = 'completed'; });
  proc.seedPhaseTask(p, 'p2', st);
  // 无系统 → add-system
  assert.equal(proc.computeNext(p, st).action, 'add-system');
  // 登记后 → 指向第一个待办任务（be=后端）
  proc.addSystem(p, st, 'match', '赛事系统');
  let n = proc.computeNext(p, st);
  assert.equal(n.action, 'worklist-task');
  assert.equal(n.worklist_task, 'be');
  assert.match(n.hint, /赛事系统/);
  assert.match(n.hint, /后端/);
  // 全部任务完成 → 不再是 worklist-task（落到缺产物 produce-artifact）
  proc.setWorklistStatus(p, st, 'match', 'be', 'completed');
  proc.setWorklistStatus(p, st, 'match', 'fe', 'completed');
  assert.notEqual(proc.computeNext(p, st).action, 'worklist-task');
});

test('P16. board 流程 tab 渲染逐系统开发任务清单', () => {
  const { home } = freshHome();
  const p = writeProcess(home, makeProcessWithWorklist(home));
  const st = proc.freshState(p);
  proc.seedPhaseTask(p, 'p2', st);
  proc.addSystem(p, st, 'match', '赛事系统');
  proc.setWorklistStatus(p, st, 'match', 'be', 'completed');
  const html = board.buildBoardHtml(p, st, { cwd: dirname(home), outDir: home });
  assert.match(html, /开发任务清单 · 逐系统/);
  assert.match(html, /赛事系统/);
  assert.match(html, /wlcell/);
});

test('P13. 内置模板：页面契约独立成阶段，产 JSON+渲染 HTML 两份，依赖链衔接', () => {
  freshHome();
  const tplPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'process', 'process.template.json');
  const tpl = store.readJson(tplPath);
  const pc = (tpl.phases || []).find((ph) => ph.id === 'page-contract');
  assert.ok(pc, '应有独立的 page-contract 阶段');
  assert.deepEqual(pc.depends_on, ['reverse-design'], 'page-contract 依赖逆向设计');
  const keys = (pc.artifacts || []).map((a) => a.key);
  assert.ok(keys.includes('blueprint') && keys.includes('blueprint-render'), '应产 JSON 契约 + 渲染 HTML 两份');
  // 逆向设计不再自带 blueprint（已迁出），下一阶段地基改为依赖 page-contract
  const rd = tpl.phases.find((ph) => ph.id === 'reverse-design');
  assert.ok(!(rd.artifacts || []).some((a) => a.key === 'blueprint'), 'blueprint 应从逆向设计迁出');
  const fd = tpl.phases.find((ph) => ph.id === 'foundation');
  assert.deepEqual(fd.depends_on, ['page-contract'], '夯实地基应改为依赖 page-contract');
});

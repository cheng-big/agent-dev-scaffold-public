import { closeSync, constants, existsSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';
import { acquireLock, nowIso, readJson, redact, writeJsonAtomic } from './store.mjs';

export const knowledgePath = 'docs/knowledge/index.json';
const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const kinds = ['source', 'contract', 'decision', 'test', 'code'];
const states = ['draft', 'current', 'superseded'];

function invalid(message) {
  return Object.assign(new Error(message), { code: 'EKNOWLEDGE' });
}

export function featureId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw invalid('功能 ID 必须使用小写英文字母、数字、点、下划线或短横线');
  return value;
}

export function featureRefs(task) {
  return (task?.references || []).filter((ref) => ref.startsWith('feature:')).map((ref) => featureId(ref.slice(8)));
}

const validPath = (path) => typeof path === 'string' && Boolean(path) && !isAbsolute(path) && !/[\\\x00-\x1F]/.test(path) &&
  path.split('/').every((segment) => segment && !['.', '..', '.git'].includes(segment) && !/^\.env(?:\.|$)/i.test(segment));

function repoFile(root, path, { preview = false } = {}) {
  if (!validPath(path)) {
    throw invalid(`知识引用必须是项目内文件：${path}`);
  }
  try {
    const abs = realpathSync(join(root, path));
    const scoped = relative(realpathSync(root), abs);
    if (!validPath(scoped.split(sep).join('/'))) throw new Error();
    const fd = openSync(abs, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || !stat.size) throw new Error();
      const buffer = Buffer.alloc(64 * 1024);
      const hash = createHash('sha256');
      let excerpt = '';
      let count;
      while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        if (preview && !excerpt) excerpt = redact(buffer.subarray(0, Math.min(count, 1600)).toString('utf8')).trim();
        hash.update(buffer.subarray(0, count));
      }
      return { path, sha256: hash.digest('hex'), ...(preview ? { excerpt } : {}) };
    } finally { closeSync(fd); }
  } catch { throw invalid(`知识引用缺失、为空或越出项目：${path}`); }
}

const validRef = (ref) => validPath(ref?.path) && /^[a-f0-9]{64}$/.test(ref.sha256 || '');

export function readKnowledge(root) {
  const file = join(root, knowledgePath);
  if (!existsSync(file)) return { schema_version: 1, entries: [] };
  let index;
  try { index = readJson(file); } catch { throw invalid(`知识索引无法读取：${knowledgePath}`); }
  if (index?.schema_version !== 1 || !Array.isArray(index.entries)) throw invalid('知识索引结构或版本无效');
  const revisions = new Set();
  const current = new Set();
  for (const entry of index.entries) {
    const id = featureId(entry?.feature);
    const key = `${id}@${entry.revision}`;
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1 || revisions.has(key) || !states.includes(entry.status) ||
        typeof entry.title !== 'string' || !entry.title || typeof entry.module !== 'string' || !entry.refs || !validRef(entry.refs.source) ||
        !kinds.every((kind) => !entry.refs[kind] || validRef(entry.refs[kind])) ||
        (entry.delivery && (!Array.isArray(entry.delivery.proof) || !entry.delivery.proof.length || !entry.delivery.proof.every(validRef))) ||
        (entry.status === 'current' && current.has(id))) throw invalid(`知识条目无效或版本冲突：${key}`);
    revisions.add(key);
    if (entry.status === 'current') current.add(id);
  }
  return index;
}

function edit(root, change) {
  const release = acquireLock('__project_knowledge__');
  try {
    const index = readKnowledge(root);
    const result = change(index.entries);
    writeJsonAtomic(join(root, knowledgePath), index);
    return result;
  } finally { release(); }
}

export function initKnowledge(root) {
  if (existsSync(join(root, knowledgePath))) { readKnowledge(root); return; }
  edit(root, () => {});
}

export function captureKnowledge(root, { feature, title, module = '', ...paths }) {
  featureId(feature);
  if (typeof title !== 'string' || !title.trim() || typeof module !== 'string' || !paths.source) throw invalid('需求登记需要 --feature、--title 和 --source');
  const refs = Object.fromEntries(kinds.filter((kind) => paths[kind] !== undefined).map((kind) => [kind, repoFile(root, paths[kind])]));
  return edit(root, (entries) => {
    const previous = entries.filter((entry) => entry.feature === feature);
    const entry = { feature, title: redact(title).trim().slice(0, 200), module: redact(module).trim().slice(0, 120),
      revision: Math.max(0, ...previous.map((item) => item.revision)) + 1, status: 'draft', refs, captured_at: nowIso() };
    entries.push(entry);
    return entry;
  });
}

function issuesFor(root, refs) {
  return Object.values(refs).flatMap((ref) => {
    try { return repoFile(root, ref.path).sha256 === ref.sha256 ? [] : [`内容已变更：${ref.path}`]; }
    catch (error) { return [error.message]; }
  });
}

export function confirmKnowledge(root, feature, revision) {
  featureId(feature);
  return edit(root, (entries) => {
    const target = entries.find((entry) => entry.feature === feature && entry.revision === revision && entry.status === 'draft');
    if (!target) throw invalid(`未找到待确认版本：${feature}@${revision}`);
    if (entries.some((entry) => entry.feature === feature && entry.status === 'current' && entry.revision >= revision)) throw invalid('不能用旧草稿替代当前版本');
    const issues = issuesFor(root, target.refs);
    if (issues.length) throw invalid(issues.join('；'));
    for (const entry of entries) if (entry.feature === feature && entry.status === 'current') entry.status = 'superseded';
    target.status = 'current';
    target.confirmed_at = nowIso();
    return target;
  });
}

export function retrieveKnowledge(root, { features = [], paths = [], module = '' } = {}) {
  const explicit = new Set(features.map(featureId));
  const matches = readKnowledge(root).entries.filter((entry) => entry.status === 'current' && (
    explicit.size ? explicit.has(entry.feature) : (module && entry.module === module) || Object.values(entry.refs).some((ref) => paths.includes(ref.path))
  ));
  const rows = matches.slice(0, 5).map((entry) => {
    const { source: sourceRef, ...related } = entry.refs;
    const issues = issuesFor(root, related);
    let source = '';
    try {
      const snapshot = repoFile(root, sourceRef.path, { preview: true });
      if (snapshot.sha256 !== sourceRef.sha256) issues.push(`内容已变更：${sourceRef.path}`);
      else if (!issues.length) source = snapshot.excerpt;
    } catch (error) { issues.push(error.message); }
    return { feature: entry.feature, revision: entry.revision, title: entry.title, refs: entry.refs, issues, source };
  });
  const missing = [...explicit].filter((id) => !matches.some((entry) => entry.feature === id));
  const lines = rows.flatMap((item) => [
    `- ${item.feature}@${item.revision} ${item.title}`, ...Object.entries(item.refs).map(([kind, ref]) => `  ${kind}: ${ref.path}`),
    ...item.issues.map((issue) => `  待复核：${issue}`), ...(item.source ? [`  已确认来源摘录：${item.source}`] : []),
  ]);
  if (missing.length) lines.push(`未找到已确认版本：${missing.join(', ')}`);
  if (matches.length > rows.length) lines.push(`仅显示前 ${rows.length} 条，请按功能 ID 查询其余条目。`);
  return { rows, missing, text: lines.length ? `\n\n[项目知识 · 当前约定]\n${lines.join('\n')}` : '' };
}

export function checkKnowledge(root) {
  if (!existsSync(join(root, knowledgePath))) return [`缺少知识索引：${knowledgePath}`];
  return readKnowledge(root).entries.filter((entry) => entry.status === 'current').flatMap((entry) =>
    issuesFor(root, { ...entry.refs, ...entry.delivery?.proof }).map((issue) => `${entry.feature}@${entry.revision}：${issue}`));
}

export function deliverKnowledge(root, { features, proof, taskId, commit, dirty }) {
  const ids = [...new Set(features.map(featureId))];
  if (!ids.length || !proof.length || !/^[a-f0-9]{40,64}$/.test(commit)) throw invalid('交付需要已确认的功能 ID、Git 基线和 --proof 项目内验收文件');
  const checked = [...new Set(proof)].map((path) => repoFile(root, path));
  return edit(root, (entries) => {
    const current = ids.map((id) => {
      const entry = entries.find((item) => item.feature === id && item.status === 'current');
      if (!entry) throw invalid(`没有已确认版本：${id}`);
      const issues = issuesFor(root, entry.refs);
      if (issues.length) throw invalid(issues.join('；'));
      return entry;
    });
    for (const entry of current) entry.delivery = { task_id: taskId, base_commit: commit, worktree_dirty: dirty, proof: checked, recorded_at: nowIso() };
    return current;
  });
}

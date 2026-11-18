import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { addFeedback, closeFeedback, loadFeedback, redactFeedbackText } from './feedback.mjs';
import { nowIso, shortId, writeJsonAtomic } from './store.mjs';
import { verifyBugLint } from './buglint.mjs';
import { hasMediaHeader } from './bugmedia.mjs';

const terminal = new Set(['已归档', '延后']);

function error(message, code = 'EINPUT') {
  return Object.assign(new Error(message), { code });
}

export function bugDirectory(agentRoot, id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id || '')) throw error('Bug ID 非法');
  const directory = join(agentRoot, 'bugs', id);
  for (const path of [join(agentRoot, 'bugs'), directory]) {
    if (existsSync(path) && !lstatSync(path).isDirectory()) throw error(`不是 Bug 目录：${path}`);
  }
  return directory;
}

export function recordBug(bugs, { title, symptom }) {
  const safeTitle = redactFeedbackText(title, 280);
  const actual = redactFeedbackText(symptom, 4000);
  if (!safeTitle || !actual) throw error('用法：bug add --title <标题> --symptom <现象>');
  const duplicate = bugs.find((bug) => bug.origin === 'local' && !terminal.has(bug.verification_status)
    && bug.title === safeTitle && bug.actual === actual);
  if (duplicate) return duplicate;
  const bug = {
    id: shortId('LOCAL-'), origin: 'local', title: safeTitle, actual, in_scope: true,
    verification_status: '待验证', created_at: nowIso(),
  };
  bugs.push(bug);
  return bug;
}

function evidenceFile(agentRoot, file) {
  if (!existsSync(file)) return false;
  const scoped = relative(realpathSync(agentRoot), realpathSync(file));
  if (!scoped || scoped === '..' || scoped.startsWith('../') || scoped.startsWith('..\\') || isAbsolute(scoped)) return false;
  const stat = lstatSync(file);
  return stat.isFile() && stat.size > 0;
}

export function archiveBug({ root, agentRoot, bug, status = '已归档', resolution, scaffoldCandidate }) {
  if (!terminal.has(status)) throw error('bug close 仅支持 已归档 或 延后');
  const directory = bugDirectory(agentRoot, bug.id);
  const existing = loadFeedback(root).find((record) => record.bug_id === bug.id);
  if (bug.verification_status === status && existing?.status === status) return existing;
  if (bug.verification_status === '已归档') throw error('已归档 Bug 不可改为延后；复发请记录为新 Bug');
  let rootCause;
  let impact;
  let evidence = [];
  if (status === '已归档') {
    const required = ['root-cause.md', 'impact.md', 'change.md', 'impact-check.md'];
    for (const name of required) {
      if (!evidenceFile(agentRoot, join(directory, name))) throw error(`缺少 Bug 证据：${name}`, 'EMISSING_BUG_EVIDENCE');
    }
    const evidenceDir = join(directory, 'evidence');
    const checks = existsSync(evidenceDir) && lstatSync(evidenceDir).isDirectory()
      ? readdirSync(evidenceDir).map((name) => join(evidenceDir, name)).filter((file) => evidenceFile(agentRoot, file)) : [];
    if (!checks.some(hasMediaHeader)) throw error('证据目录必须包含截图或视频；文字记录不能替代', 'EMISSING_BUG_MEDIA');
    rootCause = readFileSync(join(directory, 'root-cause.md'), 'utf8').trim();
    impact = readFileSync(join(directory, 'impact.md'), 'utf8').trim();
    resolution ||= readFileSync(join(directory, 'change.md'), 'utf8').trim();
    if (!rootCause || !impact) throw error('根因和影响面不可为空', 'EMISSING_BUG_EVIDENCE');
    if (!String(resolution || '').trim()) throw error('请记录修复结果');
    const lintProof = join(evidenceDir, 'lint-proof.json');
    writeJsonAtomic(lintProof, verifyBugLint({ root, agentRoot, directory }));
    evidence = [...new Set([...required.map((name) => join(directory, name)), ...checks, lintProof])].map((file) => relative(root, file));
  }
  if (!String(resolution || '').trim()) throw error('请用 --resolution 记录修复结果或延后原因');
  const { record } = addFeedback({
    root, source: 'engineering', bugId: bug.id, title: bug.title, symptom: bug.actual || bug.title,
  });
  return closeFeedback({ root, id: record.id, status, rootCause, impact, resolution, evidence, scaffoldCandidate });
}

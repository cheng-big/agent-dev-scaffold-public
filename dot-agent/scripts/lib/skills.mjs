// best-effort skill 探测：判断某 skill 是否在项目或当前环境可用。
// 诚实三态：installed（命中） / not_found（已知路径均未命中） / unknown（无从探测，如根目录都不存在）。
// 隔离环境耦合：只有这一处知道 skill 的磁盘布局；换 agent 平台改 skillLocations() 即可。

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function skillLocations(cwd = process.cwd()) {
  return [
    { root: join(cwd, '.agent', 'skills'), source: 'project' },
    { root: join(cwd, 'dot-agent', 'skills'), source: 'project' },
    { root: join(cwd, '.claude', 'skills'), source: 'project' },
    { root: join(homedir(), '.claude', 'skills'), source: 'global' },
    { root: join(homedir(), '.agents', 'skills'), source: 'global' },
    { root: join(homedir(), '.codex', 'skills'), source: 'global' },
  ];
}

export function skillRoots(cwd = process.cwd()) {
  return skillLocations(cwd).map(({ root }) => root);
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// 一个 skill 名可能是 "name" 或 "plugin:name"；后者退化再试冒号后半段。
function candidateNames(name) {
  const out = [name];
  if (name.includes(':')) out.push(name.slice(name.indexOf(':') + 1));
  return out;
}

// 在某个 skill 根目录里找该 skill：<root>/<name>/ 目录，或其中的 SKILL.md。
function hitInRoot(root, name) {
  for (const n of candidateNames(name)) {
    const dir = join(root, n);
    if (isDir(dir)) return true;
    if (existsSync(join(dir, 'SKILL.md'))) return true;
  }
  return false;
}

export function skillInfo(name, { cwd = process.cwd() } = {}) {
  if (!name) return { state: 'unknown', source: null };
  const locations = skillLocations(cwd);
  const existingLocations = locations.filter(({ root }) => isDir(root));
  if (existingLocations.length === 0) return { state: 'unknown', source: null };
  for (const location of existingLocations) {
    if (hitInRoot(location.root, name)) return { state: 'installed', source: location.source };
  }
  return { state: 'not_found', source: null };
}

// 返回 'installed' | 'not_found' | 'unknown'
export function detectSkill(name, { cwd = process.cwd() } = {}) {
  return skillInfo(name, { cwd }).state;
}

// 徽章文案（人读）
export function skillBadge(state, source = null) {
  if (state === 'installed') return source === 'project' ? '✓项目内置' : '✓全局已装';
  if (state === 'not_found') return '✗未装';
  return '?未知';
}

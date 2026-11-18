import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { paths, readJson } from './store.mjs';

export function parseTargets(value) {
  const values = value === undefined ? [] : [].concat(value);
  return [...new Set(
    values
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export function loadEvidenceRecord(taskId, ref) {
  const file = join(paths.evidenceDir(taskId), `${String(ref).replace(':', '_')}.json`);
  if (!existsSync(file)) {
    throw Object.assign(new Error(`证据不存在：${ref}`), { code: 'EEVIDENCE' });
  }
  return readJson(file);
}

function externalReadbackError(message) {
  return Object.assign(new Error(message), { code: 'EEXTERNALREADBACK' });
}

export function assertExternalWriteEvidence({ taskId, step, evidenceRefs }) {
  if ((step?.effect || 'none') !== 'external-write') return;

  const records = evidenceRefs.map((ref) => loadEvidenceRecord(taskId, ref));
  const attempts = records.filter((record) => record.kind === 'external-write-attempt');
  if (!attempts.length) throw externalReadbackError('external-write 缺写入尝试证据');

  for (const target of step.targets || []) {
    const attempt = attempts.find((record) => record.target === target);
    const expected = attempt?.data?.expected_fingerprint;
    const pass = records.find((record) => (
      record.kind === 'external-readback'
      && record.target === target
      && record.task_id === taskId
      && record.step_id === step.step_id
      && Date.parse(record.created_at) >= Date.parse(step.started_at)
      && record.data?.result === 'PASS'
      && record.data?.independent_context === true
      && record.data?.expected_fingerprint === expected
      && record.data?.observed_fingerprint === expected
    ));
    if (!attempt || !expected || !pass) {
      throw externalReadbackError(`外部目标缺独立持久化回读：${target}`);
    }
  }
}

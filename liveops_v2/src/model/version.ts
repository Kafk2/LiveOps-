/**
 * model/version.ts — 版本号逻辑（迁移 v1 parseVersion/getVersionDir 等）
 *
 * 边界（覆盖度审计）：默认版本 '6.71.0'；parseVersion 各段独立 parseInt||默认；
 * getVersionDir 取 major.minor；generateTimestamp 本地时间 YYYYMMDDHHmm（24 小时制）。
 */

const DEFAULT_MAJOR = 6;
const DEFAULT_MINOR = 71;
const DEFAULT_PATCH = 0;

export const DEFAULT_VERSION = `${DEFAULT_MAJOR}.${DEFAULT_MINOR}.${DEFAULT_PATCH}`;

export interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): VersionParts {
  const parts = version.split('.');
  return {
    major: parseInt(parts[0] ?? '', 10) || DEFAULT_MAJOR,
    minor: parseInt(parts[1] ?? '', 10) || DEFAULT_MINOR,
    patch: parseInt(parts[2] ?? '', 10) || DEFAULT_PATCH,
  };
}

export function getVersionDir(version: string): string {
  const { major, minor } = parseVersion(version);
  return `${major}.${minor}`;
}

export function incrementPatchVersion(version: string): string {
  const { major, minor, patch } = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

export function generateTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

export function formatTimestamp(ts: string): string {
  // YYYYMMDDHHmm → YYYY/MM/DD HH:mm
  if (ts.length < 12) return ts;
  return `${ts.slice(0, 4)}/${ts.slice(4, 6)}/${ts.slice(6, 8)} ${ts.slice(8, 10)}:${ts.slice(10, 12)}`;
}

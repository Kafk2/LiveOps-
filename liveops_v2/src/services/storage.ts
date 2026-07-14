/**
 * storage.ts —— localStorage 封装
 *
 * 职责：
 * - 提供带容错的 JSON / 字符串 读写原语（getJSON / setJSON / getString / setString / remove）
 * - 实现 v1 双存储合并语义 mergeLocal：本地已存在则保留本地，本地空时写入云端值并返回
 *
 * 关键设计：
 * - 所有对外 API 均 try/catch 包裹，隐私模式 / 配额超限 / 序列化失败时返回 fallback 或静默失败，绝不抛错
 * - JSON.parse 容错：解析失败或 key 不存在均返回 fallback
 * - mergeLocal 用 `localStorage.getItem(key) === null` 判"不存在"，以区分"键不存在"和"显式 null 值"
 *   （对应 plan 数据模型 critical 20：「仅当本地空时才用云端覆盖」）
 *
 * 不依赖任何其他内部模块，仅使用浏览器 DOM Storage API。
 */

/**
 * 读取并解析 JSON。解析失败 / key 不存在时返回 fallback。
 */
export function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 序列化为 JSON 并写入。JSON.stringify 失败或写入异常时静默忽略。
 */
export function setJSON(key: string, value: unknown): void {
  try {
    const raw = JSON.stringify(value);
    localStorage.setItem(key, raw);
  } catch {
    /* 隐私模式 / 配额超限 / 循环引用 —— 静默失败 */
  }
}

/**
 * 读取字符串。key 不存在时返回 fallback（注意：显式空串 "" 视为合法值返回）。
 */
export function getString(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw;
  } catch {
    return fallback;
  }
}

/**
 * 写入字符串。写入异常时静默忽略。
 */
export function setString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式 / 配额超限 —— 静默失败 */
  }
}

/**
 * 删除指定 key。不存在或删除异常时静默忽略。
 */
export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 隐私模式 —— 静默失败 */
  }
}

/**
 * v1 双存储合并语义：仅当本地空时才用云端覆盖。
 *
 * - 本地已存在该 key（getItem !== null）—— 返回本地已有值（不信任云端，本地优先）
 * - 本地不存在（getItem === null）—— 将 cloudValue 写入本地，并返回 cloudValue
 *
 * 注意用 `getItem(key) === null` 判不存在，可区分「key 不存在」与「显式存了 null/空」。
 * 本地值解析失败时回退为 cloudValue（防止脏数据导致永久取不到云端最新值）。
 */
export function mergeLocal<T>(key: string, cloudValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      // 本地空：写入云端值并返回
      setJSON(key, cloudValue);
      return cloudValue;
    }
    // 本地已有：尝试解析本地值返回；解析失败则用 cloudValue 兜底（避免脏数据卡死）
    try {
      return JSON.parse(raw) as T;
    } catch {
      setJSON(key, cloudValue);
      return cloudValue;
    }
  } catch {
    // localStorage 本身不可用（隐私模式等），直接返回云端值，不写
    return cloudValue;
  }
}

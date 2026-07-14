/**
 * core/history-keyboard.ts — 撤销/重做全局快捷键
 *
 * v1: 仅 Ctrl+Z / Ctrl+Y；v2 补全 Ctrl+Shift+Z（IDE 用户习惯）。
 * 仅作用于 config scope（schema 编辑在 schema-tab 内单独绑定）。
 */

import { Store } from './store';

export function bindHistoryKeyboard(store: Store): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo('config');
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      store.redo('config');
    }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}

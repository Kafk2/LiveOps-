/**
 * ui/recurrence-wizard.ts — 循环模式 wizard（受控插件化）
 *
 * 由 getAllRecurrenceModes() 驱动：模式选择按钮 + 当前模式 createEditor + 实时预览。
 * 新增模式只需实现 RecurrenceMode 接口并注册，本组件自动获得入口与面板。
 *
 * 编辑策略：editor 内 onChange 只更新 state + emit + 刷新 preview，不重建 editor
 * （避免 input/按钮 失焦）；切换模式才重建 editor。
 */

import { parseRecurrenceValue } from '@/model/recurrence/builtin';
import {
  getAllRecurrenceModes,
  getRecurrenceMode,
  WizardState,
} from '@/model/recurrence/registry';

const DEFAULT_STATE: WizardState = {
  mode: 'single',
  intervalDays: 7,
  weekdays: [],
  biweeklyDays: [],
  customPeriod: 5,
  customDays: [],
};

export interface RecurrenceWizardHandle {
  getElement(): HTMLElement;
  setValue(value: string): void;
  destroy(): void;
}

function decodeState(value: string): WizardState {
  const key = parseRecurrenceValue(value);
  let arr: number[] = [1];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) arr = parsed as number[];
  } catch {
    arr = [1];
  }
  const mode = getRecurrenceMode(key);
  const partial = mode ? mode.parse(arr) : {};
  return { ...DEFAULT_STATE, mode: key, ...partial };
}

export function createRecurrenceWizard(opts: {
  value: string;
  onChange: (value: string) => void;
}): RecurrenceWizardHandle {
  let state = decodeState(opts.value);
  const root = document.createElement('div');
  let editorHost: HTMLElement;
  let previewEl: HTMLElement;

  function emit(): void {
    const mode = getRecurrenceMode(state.mode);
    const arr = mode ? mode.build(state) : [1];
    opts.onChange(JSON.stringify(arr));
    if (previewEl) {
      previewEl.textContent = '预览：' + (mode ? mode.preview(arr) : '') + '  →  ' + JSON.stringify(arr);
    }
  }

  function renderEditor(): void {
    editorHost.innerHTML = '';
    const mode = getRecurrenceMode(state.mode);
    if (!mode) return;
    const editorEl = mode.createEditor(state, (next) => {
      state = next;
      emit();
    });
    editorHost.appendChild(editorEl);
  }

  function render(): void {
    root.innerHTML = '';
    // 模式选择
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;';
    for (const mode of getAllRecurrenceModes()) {
      const active = mode.key === state.mode;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = mode.name;
      btn.style.cssText =
        'padding:6px 10px;border:1px solid ' +
        (active ? 'var(--color-primary)' : 'var(--color-border)') +
        ';background:' +
        (active ? 'var(--color-primary)' : 'white') +
        ';color:' +
        (active ? 'white' : 'inherit') +
        ';border-radius:3px;cursor:pointer;font-size:12px;';
      btn.addEventListener('click', () => {
        if (state.mode === mode.key) return;
        state = { ...state, mode: mode.key };
        emit();
        render();
      });
      modeRow.appendChild(btn);
    }
    root.appendChild(modeRow);
    // editor
    editorHost = document.createElement('div');
    root.appendChild(editorHost);
    renderEditor();
    // preview
    previewEl = document.createElement('div');
    previewEl.style.cssText = 'margin-top:8px;font-size:12px;color:var(--color-primary);';
    root.appendChild(previewEl);
    emit();
  }

  render();

  return {
    getElement: () => root,
    setValue: (value: string) => {
      state = decodeState(value);
      render();
    },
    destroy: () => {
      root.innerHTML = '';
    },
  };
}

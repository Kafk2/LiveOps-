/**
 * ui/schema-tab.ts — params schema 策划编辑器（迭代4a）
 *
 * 让策划按 activityType 管理 params 字段结构（key/fieldType/required/default），
 * 编辑后 form 表单的 params 区按此渲染结构化字段。
 *
 * 防护（迭代4 范围内最小版，完整防护在 schema-self-check）：
 * - key 唯一校验（validateParamsSchema）
 * - 删除字段需确认
 * - schema 编辑走 SCHEMA_PATCH（独立 history 栈，与 config 编辑隔离）
 */

import type { Store } from '@/core/store';
import type { ParamsFieldDef, ParamsSchemaRoot } from '@/core/types';
import { selectSettings } from '@/core/selectors';
import { validateParamsSchema } from '@/schema/params-schema';

const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'time', 'enum', 'json'];

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uniqueTypeKey(root: ParamsSchemaRoot, type: string): string {
  if (!root.byType[type]) return type;
  return type;
}

export function renderSchemaTab(store: Store, root: HTMLElement): void {
  let selectedType = '';

  function render(): void {
    const settings = selectSettings(store.getState());
    const schemaRoot = settings.paramsSchemas;
    const meta = settings.activityMeta;
    const types = Array.from(new Set(meta.map((m) => m.activityType)));
    if (!selectedType && types.length > 0) selectedType = types[0]!;

    const fields: ParamsFieldDef[] = schemaRoot.byType[selectedType] ?? [];
    const validation = validateParamsSchema(schemaRoot);

    root.innerHTML = `
      <div style="padding:20px;">
        <div class="section-title">Params Schema 编辑器</div>
        <div style="margin-bottom:16px;display:flex;gap:12px;align-items:center;">
          <label>活动类型：</label>
          <select id="schemaTypeSelect" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;min-width:160px;">
            ${types.map((t) => `<option value="${escapeHtml(t)}"${t === selectedType ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
          </select>
          <span style="font-size:12px;color:var(--color-text-secondary);">该类型 ${fields.length} 个字段，应用到 ${meta.filter((m) => m.activityType === selectedType).length} 个活动</span>
        </div>

        <div id="schemaValidation">${validation.errors.length ? `<div style="color:var(--color-danger);font-size:12px;">${validation.errors.map((e) => escapeHtml(e.message)).join('；')}</div>` : '<div style="color:var(--color-success);font-size:12px;">schema 校验通过</div>'}</div>

        <table class="config-table" style="margin-top:12px;">
          <thead><tr><th>字段 key</th><th>类型</th><th>必填</th><th>默认值</th><th>操作</th></tr></thead>
          <tbody>
            ${fields.map((f, i) => `
              <tr>
                <td><input data-row="${i}" data-prop="key" value="${escapeHtml(f.key)}" style="width:140px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>
                <td>
                  <select data-row="${i}" data-prop="fieldType">${FIELD_TYPES.map((t) => `<option${t === f.fieldType ? ' selected' : ''}>${t}</option>`).join('')}</select>
                </td>
                <td><input type="checkbox" data-row="${i}" data-prop="required"${f.required ? ' checked' : ''}></td>
                <td><input data-row="${i}" data-prop="default" value="${escapeHtml(String(f.default ?? ''))}" style="width:120px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>
                <td><button class="btn btn-danger btn-sm" data-del="${i}">删除</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" id="addFieldBtn">+ 新增字段</button>
          <button class="btn btn-secondary btn-sm" id="saveSchemaBtn">💾 保存 schema（独立撤销栈）</button>
        </div>

        <div style="margin-top:12px;font-size:12px;color:var(--color-text-secondary);">
          说明：schema 编辑独立于配置编辑（独立撤销栈）；保存后配置表单的 params 区将按此结构渲染。
        </div>
      </div>
    `;

    bind();
  }

  function commit(newRoot: ParamsSchemaRoot): void {
    store.dispatch({ type: 'SCHEMA_PATCH', payload: newRoot });
  }

  function bind(): void {
    const settings = selectSettings(store.getState());
    const schemaRoot = settings.paramsSchemas;

    root.querySelector('#schemaTypeSelect')?.addEventListener('change', (e) => {
      selectedType = (e.target as HTMLSelectElement).value;
      render();
    });

    root.querySelector('#addFieldBtn')?.addEventListener('click', () => {
      const fields = [...(schemaRoot.byType[selectedType] ?? [])];
      let n = 1;
      while (fields.some((f) => f.key === `field${n}`)) n++;
      fields.push({ key: `field${n}`, fieldType: 'text' });
      const newRoot: ParamsSchemaRoot = {
        ...schemaRoot,
        byType: { ...schemaRoot.byType, [uniqueTypeKey(schemaRoot, selectedType)]: fields },
      };
      commit(newRoot);
      render();
    });

    root.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      const row = parseInt(el.dataset.row!, 10);
      const prop = el.dataset.prop!;
      const handler = () => {
        const fields = (schemaRoot.byType[selectedType] ?? []).map((f) => ({ ...f }));
        const f = fields[row];
        if (!f) return;
        const input = el as HTMLInputElement;
        const select = el as HTMLSelectElement;
        if (prop === 'required') f.required = input.checked;
        else if (prop === 'key') f.key = input.value;
        else if (prop === 'fieldType') f.fieldType = select.value;
        else if (prop === 'default') f.default = input.value;
        const newRoot: ParamsSchemaRoot = { ...schemaRoot, byType: { ...schemaRoot.byType, [selectedType]: fields } };
        commit(newRoot);
      };
      el.addEventListener('change', handler);
    });

    root.querySelectorAll<HTMLElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.del!, 10);
        const fields = schemaRoot.byType[selectedType] ?? [];
        const target = fields[idx];
        if (!target) return;
        if (!confirm(`删除字段「${target.key}」？已有配置的该 params 字段将不再渲染/校验（值保留在 JSON 中）。`)) return;
        const newFields = fields.filter((_, i) => i !== idx);
        const newRoot: ParamsSchemaRoot = { ...schemaRoot, byType: { ...schemaRoot.byType, [selectedType]: newFields } };
        commit(newRoot);
        render();
      });
    });

    root.querySelector('#saveSchemaBtn')?.addEventListener('click', () => {
      const validation = validateParamsSchema(selectSettings(store.getState()).paramsSchemas);
      if (validation.errors.length) {
        alert('schema 校验未通过：' + validation.errors.map((e) => e.message).join('；'));
        return;
      }
      alert('schema 已保存（SCHEMA_PATCH 已入 schema 独立 history 栈）');
    });
  }

  render();
  store.subscribe((s) => s.settings.paramsSchemas, render);
}

/**
 * ui/schema-tab.ts — params schema 策划编辑器（仅按 activityKey 绑定，无类型默认）
 *
 * 每个 activityKey 独立配置其 params 字段结构。配置管理表单的 params 区按
 * resolveParamsSchema(schemas, activityKey) 渲染。
 * 防护：字段 key 唯一校验、删除确认、SCHEMA_PATCH 独立 history 栈。
 */

import type { Store } from '@/core/store';
import type { ParamsFieldDef, ParamsSchemas } from '@/core/types';
import { selectSettings } from '@/core/selectors';
import { validateParamsSchema } from '@/schema/params-schema';

const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'time'];

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSchemaTab(store: Store, root: HTMLElement): void {
  let selectedKey = '';

  function render(): void {
    const settings = selectSettings(store.getState());
    const schemas = settings.paramsSchemas;
    const meta = settings.activityMeta;
    const keys = meta.map((m) => m.activityKey);
    // selectedKey 失效（被删）则重置为首个
    if (selectedKey && !keys.includes(selectedKey)) selectedKey = '';
    if (!selectedKey && keys.length > 0) selectedKey = keys[0]!;
    const fields: ParamsFieldDef[] = schemas[selectedKey] ?? [];
    const validation = validateParamsSchema(schemas);
    const affectedCount = meta.filter((m) => m.activityKey === selectedKey).length;

    root.innerHTML = `
      <div style="padding:20px;">
        <div class="section-title">Params Schema 编辑器</div>
        <div style="font-size:12px;color:var(--color-text-tertiary);margin-bottom:12px;">每个活动 Key 独立配置其参数结构（无类型默认）。配置管理界面的 params 区只能编辑此处已定义的字段。</div>
        <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
          <label>activityKey：</label>
          <select id="schemaKeySelect" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;min-width:220px;">${keys.map((k) => `<option value="${escapeHtml(k)}"${k === selectedKey ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('')}</select>
          <span style="font-size:12px;color:var(--color-text-secondary);">该 activityKey ${affectedCount} 个配置；当前 ${fields.length} 字段</span>
        </div>

        <div id="schemaValidation">${validation.errors.length ? `<div style="color:var(--color-danger);font-size:12px;">${validation.errors.map((e) => escapeHtml(e.message)).join('；')}</div>` : '<div style="color:var(--color-success);font-size:12px;">schema 校验通过</div>'}</div>

        ${keys.length === 0 ? '<div class="empty-state">尚未注册任何活动 Key，请先在「活动管理」页签注册</div>' : `
        <table class="config-table" style="margin-top:12px;">
          <thead><tr><th>字段 key</th><th>类型</th><th>必填</th><th>默认值</th><th>操作</th></tr></thead>
          <tbody>
            ${fields.map((f, i) => `
              <tr>
                <td><input data-row="${i}" data-prop="key" value="${escapeHtml(f.key)}" style="width:140px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>
                <td><select data-row="${i}" data-prop="fieldType">${FIELD_TYPES.map((t) => `<option${t === f.fieldType ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
                <td><input type="checkbox" data-row="${i}" data-prop="required"${f.required ? ' checked' : ''}></td>
                <td><input data-row="${i}" data-prop="default" value="${escapeHtml(String(f.default ?? ''))}" style="width:120px;padding:4px;border:1px solid var(--color-border);border-radius:3px;"></td>
                <td><button class="btn btn-danger btn-sm" data-del="${i}">删除</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="addFieldBtn">+ 新增字段</button>
          ${fields.length > 0 ? '<button class="btn btn-danger btn-sm" id="clearSchemaBtn">清空该 Key 的 schema</button>' : ''}
          <button class="btn btn-secondary btn-sm" id="saveSchemaBtn">💾 保存 schema</button>
        </div>`}
      </div>
    `;
    bind();
  }

  function commit(next: ParamsSchemas): void {
    store.dispatch({ type: 'SCHEMA_PATCH', payload: next });
  }

  function writeFields(schemas: ParamsSchemas, key: string, fields: ParamsFieldDef[]): ParamsSchemas {
    return { ...schemas, [key]: fields };
  }

  function bind(): void {
    const targetKey = selectedKey;
    root.querySelector('#schemaKeySelect')?.addEventListener('change', (e) => {
      selectedKey = (e.target as HTMLSelectElement).value;
      render();
    });
    root.querySelector('#addFieldBtn')?.addEventListener('click', () => {
      const schemas = selectSettings(store.getState()).paramsSchemas;
      const cur = schemas[targetKey] ?? [];
      let n = 1;
      while (cur.some((f) => f.key === `field${n}`)) n++;
      commit(writeFields(schemas, targetKey, [...cur, { key: `field${n}`, fieldType: 'text' }]));
    });
    root.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      const row = parseInt(el.dataset.row!, 10);
      const prop = el.dataset.prop!;
      el.addEventListener('change', () => {
        const schemas = selectSettings(store.getState()).paramsSchemas;
        const cur = (schemas[targetKey] ?? []).map((f) => ({ ...f }));
        const f = cur[row];
        if (!f) return;
        const input = el as HTMLInputElement;
        const select = el as HTMLSelectElement;
        if (prop === 'required') f.required = input.checked;
        else if (prop === 'key') f.key = input.value;
        else if (prop === 'fieldType') f.fieldType = select.value;
        else if (prop === 'default') f.default = input.value;
        commit(writeFields(schemas, targetKey, cur));
      });
    });
    root.querySelectorAll<HTMLElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.del!, 10);
        const schemas = selectSettings(store.getState()).paramsSchemas;
        const cur = schemas[targetKey] ?? [];
        const target = cur[idx];
        if (!target) return;
        if (!confirm(`删除字段「${target.key}」？`)) return;
        commit(writeFields(schemas, targetKey, cur.filter((_, i) => i !== idx)));
      });
    });
    root.querySelector('#clearSchemaBtn')?.addEventListener('click', () => {
      if (!confirm(`清空 activityKey「${targetKey}」的 schema？`)) return;
      const schemas = selectSettings(store.getState()).paramsSchemas;
      const next = { ...schemas };
      delete next[targetKey];
      commit(next);
    });
    root.querySelector('#saveSchemaBtn')?.addEventListener('click', () => {
      const v = validateParamsSchema(selectSettings(store.getState()).paramsSchemas);
      if (v.errors.length) {
        alert('schema 校验未通过：' + v.errors.map((e) => e.message).join('；'));
        return;
      }
      alert('schema 已保存（SCHEMA_PATCH 入独立 history 栈）');
    });
  }

  render();
  store.subscribe((s) => s.settings.paramsSchemas, render);
  store.subscribe((s) => s.settings.activityMeta, render);
}

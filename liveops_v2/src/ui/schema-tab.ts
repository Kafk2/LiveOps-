/**
 * ui/schema-tab.ts — params schema 策划编辑器（迭代4 完善：per-key 覆盖）
 *
 * 两种编辑目标：
 * - 类型默认（byType）：按 activityType 配置默认 params 字段
 * - 活动覆盖（overrides）：按 activityKey 配置专属 params（完整覆盖所属 type 默认）
 *
 * resolve 时 per-key 覆盖优先，否则用 type 默认。form params 区按 resolve 结果渲染。
 * 防护：key 唯一校验、删除确认、SCHEMA_PATCH 独立 history 栈。
 */

import type { Store } from '@/core/store';
import type { ParamsFieldDef, ParamsSchemaRoot } from '@/core/types';
import { selectSettings } from '@/core/selectors';
import { validateParamsSchema } from '@/schema/params-schema';

const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'time', 'enum', 'json'];

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderSchemaTab(store: Store, root: HTMLElement): void {
  let editMode: 'type' | 'key' = 'type';
  let selectedType = '';
  let selectedKey = '';

  function render(): void {
    const settings = selectSettings(store.getState());
    const schemaRoot = settings.paramsSchemas;
    const meta = settings.activityMeta;
    const types = Array.from(new Set(meta.map((m) => m.activityType)));
    const keys = meta.map((m) => m.activityKey);
    if (editMode === 'type' && !selectedType && types.length > 0) selectedType = types[0]!;
    if (editMode === 'key' && !selectedKey && keys.length > 0) selectedKey = keys[0]!;

    const bucket: 'byType' | 'overrides' = editMode === 'type' ? 'byType' : 'overrides';
    const targetKey = editMode === 'type' ? selectedType : selectedKey;
    const store2 = bucket === 'byType' ? schemaRoot.byType : schemaRoot.overrides;
    const fields: ParamsFieldDef[] = store2[targetKey] ?? [];
    const validation = validateParamsSchema(schemaRoot);
    const affectedCount =
      editMode === 'key'
        ? meta.filter((m) => m.activityKey === selectedKey).length
        : meta.filter((m) => m.activityType === selectedType).length;

    root.innerHTML = `
      <div style="padding:20px;">
        <div class="section-title">Params Schema 编辑器</div>
        <div style="display:flex;gap:16px;margin-bottom:12px;align-items:center;">
          <label><input type="radio" name="editMode" value="type"${editMode === 'type' ? ' checked' : ''}> 类型默认</label>
          <label><input type="radio" name="editMode" value="key"${editMode === 'key' ? ' checked' : ''}> 活动覆盖（按 activityKey）</label>
        </div>
        <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
          ${
            editMode === 'type'
              ? `<label>活动类型：</label><select id="schemaTypeSelect" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;min-width:160px;">${types.map((t) => `<option value="${escapeHtml(t)}"${t === selectedType ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>`
              : `<label>activityKey：</label><select id="schemaKeySelect" style="padding:6px;border:1px solid var(--color-border);border-radius:4px;min-width:220px;">${keys.map((k) => `<option value="${escapeHtml(k)}"${k === selectedKey ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('')}</select>`
          }
          <span style="font-size:12px;color:var(--color-text-secondary);">${editMode === 'key' ? `该 activityKey ${affectedCount} 个配置` : `该类型 ${affectedCount} 个活动`}；当前 ${fields.length} 字段${editMode === 'key' ? `${fields.length > 0 ? '（覆盖类型默认）' : '（无覆盖，用类型默认）'}` : ''}</span>
        </div>

        <div id="schemaValidation">${validation.errors.length ? `<div style="color:var(--color-danger);font-size:12px;">${validation.errors.map((e) => escapeHtml(e.message)).join('；')}</div>` : '<div style="color:var(--color-success);font-size:12px;">schema 校验通过</div>'}</div>

        ${editMode === 'key' && fields.length === 0 ? `<div style="margin:12px 0;"><button class="btn btn-secondary btn-sm" id="initOverrideBtn">从此类型的默认 schema 初始化覆盖</button></div>` : ''}

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
          ${editMode === 'key' ? '<button class="btn btn-danger btn-sm" id="clearOverrideBtn">清除覆盖（恢复用类型默认）</button>' : ''}
          <button class="btn btn-secondary btn-sm" id="saveSchemaBtn">💾 保存 schema</button>
        </div>
      </div>
    `;
    bind(schemaRoot, bucket, targetKey);
  }

  function commit(newRoot: ParamsSchemaRoot): void {
    store.dispatch({ type: 'SCHEMA_PATCH', payload: newRoot });
  }

  function writeFields(schemaRoot: ParamsSchemaRoot, bucket: 'byType' | 'overrides', key: string, fields: ParamsFieldDef[]): ParamsSchemaRoot {
    const store2 = bucket === 'byType' ? schemaRoot.byType : schemaRoot.overrides;
    const nextStore = { ...store2, [key]: fields };
    return bucket === 'byType' ? { ...schemaRoot, byType: nextStore } : { ...schemaRoot, overrides: nextStore };
  }

  function bind(schemaRoot: ParamsSchemaRoot, bucket: 'byType' | 'overrides', targetKey: string): void {
    root.querySelectorAll<HTMLInputElement>('input[name="editMode"]').forEach((r) => {
      r.addEventListener('change', () => {
        editMode = r.value as 'type' | 'key';
        render();
      });
    });
    root.querySelector('#schemaTypeSelect')?.addEventListener('change', (e) => {
      selectedType = (e.target as HTMLSelectElement).value;
      render();
    });
    root.querySelector('#schemaKeySelect')?.addEventListener('change', (e) => {
      selectedKey = (e.target as HTMLSelectElement).value;
      render();
    });
    root.querySelector('#initOverrideBtn')?.addEventListener('click', () => {
      // 用所属 type 默认初始化覆盖
      const meta = selectSettings(store.getState()).activityMeta;
      const type = meta.find((m) => m.activityKey === selectedKey)?.activityType ?? '';
      const base = selectSettings(store.getState()).paramsSchemas.byType[type] ?? [];
      commit(writeFields(schemaRoot, 'overrides', selectedKey, base.map((f) => ({ ...f }))));
    });
    root.querySelector('#clearOverrideBtn')?.addEventListener('click', () => {
      if (!confirm(`清除 activityKey「${selectedKey}」的覆盖？（恢复使用类型默认）`)) return;
      const nextOverrides = { ...schemaRoot.overrides };
      delete nextOverrides[selectedKey];
      commit({ ...schemaRoot, overrides: nextOverrides });
    });
    root.querySelector('#addFieldBtn')?.addEventListener('click', () => {
      const cur = (bucket === 'byType' ? schemaRoot.byType : schemaRoot.overrides)[targetKey] ?? [];
      let n = 1;
      while (cur.some((f) => f.key === `field${n}`)) n++;
      commit(writeFields(schemaRoot, bucket, targetKey, [...cur, { key: `field${n}`, fieldType: 'text' }]));
    });
    root.querySelectorAll<HTMLElement>('[data-row]').forEach((el) => {
      const row = parseInt(el.dataset.row!, 10);
      const prop = el.dataset.prop!;
      el.addEventListener('change', () => {
        const cur = ((bucket === 'byType' ? schemaRoot.byType : schemaRoot.overrides)[targetKey] ?? []).map((f) => ({ ...f }));
        const f = cur[row];
        if (!f) return;
        const input = el as HTMLInputElement;
        const select = el as HTMLSelectElement;
        if (prop === 'required') f.required = input.checked;
        else if (prop === 'key') f.key = input.value;
        else if (prop === 'fieldType') f.fieldType = select.value;
        else if (prop === 'default') f.default = input.value;
        commit(writeFields(schemaRoot, bucket, targetKey, cur));
      });
    });
    root.querySelectorAll<HTMLElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.del!, 10);
        const cur = (bucket === 'byType' ? schemaRoot.byType : schemaRoot.overrides)[targetKey] ?? [];
        const target = cur[idx];
        if (!target) return;
        if (!confirm(`删除字段「${target.key}」？`)) return;
        commit(writeFields(schemaRoot, bucket, targetKey, cur.filter((_, i) => i !== idx)));
      });
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

/**
 * schema/field-types/index.ts — 注册全部内置字段类型
 *
 * main.ts 启动时调用 registerAllFieldTypes()，之后 csv-schema / params-schema / form-renderer
 * 都能通过 getFieldType(key) 拿到类型实例。
 */

import { registerPrimitives } from './primitives';
import { registerAdvanced } from './advanced';

export * from './registry';

export function registerAllFieldTypes(): void {
  registerPrimitives();
  registerAdvanced();
}

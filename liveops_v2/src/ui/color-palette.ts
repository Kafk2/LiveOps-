/**
 * ui/color-palette.ts — 颜色板 + 颜色工具（自 v1 index.html 移植）
 *
 * TL_COLOR_PALETTE：Ant Design 12 色 × 10 级，barColor 选择器与时间轴共用。
 * getTypeGroupColor：内置 4 类型固定色，自定义类型用字符串 hash 生成（与 v1 一致）。
 * lightenColor / rgbToHex：颜色按钮渐变与色板命中比较用。
 */

/** Ant Design 12色 × 10级渐变色板（row=level 1~10 浅→深） */
export const TL_COLOR_PALETTE: string[][] = [
  ['#FFF1F0', '#FFF2E8', '#FFF7E6', '#FFFBE6', '#FEFFE6', '#FCFFE6', '#F6FFED', '#E6FFFB', '#E6F4FF', '#F0F5FF', '#F9F0FF', '#FFF0F6'],
  ['#FFCCC7', '#FFD8BF', '#FFE7BA', '#FFF1B8', '#FFFFB8', '#F4FFB8', '#D9F7BE', '#B5F5EC', '#BAE0FF', '#D6E4FF', '#EFDBFF', '#FFD6E7'],
  ['#FFA39E', '#FFBB96', '#FFD591', '#FFE58F', '#FFFB8F', '#EAFF8F', '#B7EB8F', '#87E8DE', '#91CAFF', '#ADC6FF', '#D3ADF7', '#FFADD2'],
  ['#FF7875', '#FF9C6E', '#FFC069', '#FFD666', '#FFF566', '#D3F261', '#95DE64', '#5CDBD3', '#69B1FF', '#85A5FF', '#B37FEB', '#FF85C0'],
  ['#FF4D4F', '#FF7A45', '#FFA940', '#FFC53D', '#FFEC3D', '#BAE637', '#73D13D', '#36CFC9', '#4096FF', '#597EF7', '#9254DE', '#F759AB'],
  ['#F5222D', '#FA541C', '#FA8C16', '#FAAD14', '#FADB14', '#A0D911', '#52C41A', '#13C2C2', '#1677FF', '#2F54EB', '#722ED1', '#EB2F96'],
  ['#CF1322', '#D4380D', '#D46B08', '#D48806', '#D4B106', '#7CB305', '#389E0D', '#08979C', '#0958D9', '#1D39C4', '#531DAB', '#C41D7F'],
  ['#A8071A', '#AD2102', '#AD4E00', '#AD6800', '#AD8B00', '#5A8F00', '#237804', '#006D75', '#003EB3', '#10239E', '#391085', '#9E1068'],
  ['#820014', '#871400', '#873800', '#874D00', '#876800', '#3F6600', '#135200', '#00474F', '#002C8C', '#061178', '#22075E', '#780650'],
  ['#5C0011', '#610B00', '#612500', '#614700', '#614700', '#254000', '#092B00', '#002329', '#001D66', '#030852', '#120338', '#520339'],
];

/** 内置活动类型固定色（v1 tlTypeGroupColors） */
export const BUILTIN_TYPE_COLORS: Record<string, string> = {
  default: '#FAAD14',
  festival: '#F5222D',
  gift: '#1677FF',
  feature: '#EB2F96',
};

const customTypeColorCache: Record<string, string> = {};

/** 活动类型 → 颜色（内置固定；自定义用字符串 hash，v1 getTypeGroupColor 保真） */
export function getTypeGroupColor(type: string): string {
  if (BUILTIN_TYPE_COLORS[type]) return BUILTIN_TYPE_COLORS[type];
  if (customTypeColorCache[type]) return customTypeColorCache[type];
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = (hash << 5) - hash + type.charCodeAt(i);
    hash |= 0; // 转 32 位整数
  }
  hash = Math.abs(hash);
  let r = (hash & 0xff0000) >> 16;
  let g = (hash & 0x00ff00) >> 8;
  let b = hash & 0x0000ff;
  r = Math.max(80, Math.min(200, r));
  g = Math.max(80, Math.min(200, g));
  b = Math.max(80, Math.min(200, b));
  const hex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  customTypeColorCache[type] = hex;
  return hex;
}

/** hex → {r,g,b} */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** 颜色提亮（混入白色），percent 0~100。v1 lightenColor 保真 */
export function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const p = Math.max(0, Math.min(100, percent)) / 100;
  const r = Math.round(rgb.r + (255 - rgb.r) * p);
  const g = Math.round(rgb.g + (255 - rgb.g) * p);
  const b = Math.round(rgb.b + (255 - rgb.b) * p);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/** rgb(x,y,z) → #hex（色板命中比较用） */
export function rgbToHex(rgb: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return rgb;
  const r = parseInt(m[1]!, 10);
  const g = parseInt(m[2]!, 10);
  const b = parseInt(m[3]!, 10);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/** 颜色按钮背景：有色用渐变，无色用默认蓝紫渐变（v1 updateColorBtn 保真） */
export function colorBtnBackground(color: string): string {
  if (!color) return 'linear-gradient(135deg, #346CE5, #5381EB)';
  return `linear-gradient(135deg, ${color}, ${lightenColor(color, 30)})`;
}

/** 标题栏淡渐变色带：有色用 ${color}18→${color}08→transparent（hex alpha） */
export function titleBarBackground(color: string): string {
  if (!color) return '';
  return `linear-gradient(to bottom, ${color}18, ${color}08, transparent)`;
}

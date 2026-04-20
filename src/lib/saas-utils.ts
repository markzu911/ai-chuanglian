/**
 * SaaS 对接工具函数
 */
import type { SaasApiResponse } from '@/lib/saas-types';

export const SAAS_API_BASE_URL = 'http://aibigtree.com';

/**
 * ID 过滤：排除 "null" / "undefined" / 空字符串，返回 null 或原值
 */
export function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return null;
  return trimmed;
}

/**
 * 宽松成功判定：只要 success 或 valid 为 true 即通过
 */
export function isLenientSuccess<T>(payload: SaasApiResponse<T> | null | undefined): boolean {
  if (!payload) return false;
  return payload.success === true || payload.valid === true;
}

/**
 * 提示词合成：SaaS context + SaaS prompt[] 追加到基础提示词后
 */
export function buildSaasPromptAddon(context?: string, prompt?: string[]): string {
  const parts: string[] = [];
  if (typeof context === 'string' && context.trim()) {
    parts.push(context.trim());
  }
  if (Array.isArray(prompt) && prompt.length > 0) {
    const tags = prompt
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    if (tags.length > 0) {
      parts.push(tags.join(', '));
    }
  }
  return parts.join(' ');
}

/**
 * 合成最终提示词：内部预设风格 + SaaS 内容主体 + SaaS 补充关键词
 */
export function mergePromptWithSaas(
  baseStyle: string | undefined,
  context?: string,
  prompt?: string[]
): string {
  const base = typeof baseStyle === 'string' ? baseStyle.trim() : '';
  const addon = buildSaasPromptAddon(context, prompt);
  return [base, addon].filter((s) => s.length > 0).join(' ');
}

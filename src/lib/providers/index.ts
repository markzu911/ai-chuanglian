/**
 * Provider 工厂
 *
 * 根据环境变量 IMAGE_PROVIDER 返回对应的 provider 实例。
 * 默认使用 'ark'（火山方舟 Seedream）。
 *
 * 切换到 Gemini：设置 IMAGE_PROVIDER=gemini 并填 GEMINI_API_KEY。
 */
import { arkProvider } from './ark';
import { geminiProvider } from './gemini';
import type { ImageProvider } from './types';

export type ProviderName = 'ark' | 'gemini';

const PROVIDERS: Record<ProviderName, ImageProvider> = {
  ark: arkProvider,
  gemini: geminiProvider,
};

export function getImageProvider(): ImageProvider {
  const raw = (process.env.IMAGE_PROVIDER || 'ark').toLowerCase().trim();
  const name: ProviderName = raw in PROVIDERS ? (raw as ProviderName) : 'ark';
  return PROVIDERS[name];
}

export type { ImageProvider, GenerationResult } from './types';
export { arkProvider, geminiProvider };

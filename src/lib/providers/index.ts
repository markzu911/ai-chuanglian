/**
 * Provider 工厂
 *
 * - IMAGE_PROVIDER：场景替换/挂装用的图像生成 provider
 * - SHOWCASE_PROVIDER：电商展示图用的图像生成 provider，可单独覆盖
 * - SCENE_ANALYSIS_PROVIDER：场景分析 provider，可单独覆盖
 *
 * 默认都使用 'ark'（火山方舟）。
 */
import { arkProvider } from './ark';
import { geminiProvider } from './gemini';
import type { ImageProvider } from './types';

export type ProviderName = 'ark' | 'gemini';

const PROVIDERS: Record<ProviderName, ImageProvider> = {
  ark: arkProvider,
  gemini: geminiProvider,
};

function resolveProviderName(rawValue: string | undefined): ProviderName {
  const raw = (rawValue || 'ark').toLowerCase().trim();
  const name: ProviderName = raw in PROVIDERS ? (raw as ProviderName) : 'ark';
  return name;
}

export function getGenerationProvider(): ImageProvider {
  return PROVIDERS[resolveProviderName(process.env.IMAGE_PROVIDER)];
}

export function getShowcaseGenerationProvider(): ImageProvider {
  return PROVIDERS[
    resolveProviderName(process.env.SHOWCASE_PROVIDER || process.env.IMAGE_PROVIDER)
  ];
}

export function getSceneAnalysisProvider(): ImageProvider {
  return PROVIDERS[
    resolveProviderName(process.env.SCENE_ANALYSIS_PROVIDER || process.env.IMAGE_PROVIDER)
  ];
}

export function getImageProvider(): ImageProvider {
  return getGenerationProvider();
}

export type { ImageProvider, GenerationResult } from './types';
export { arkProvider, geminiProvider };

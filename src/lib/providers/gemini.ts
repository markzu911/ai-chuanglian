/**
 * Google Gemini Provider
 * - Vision：gemini-2.5-flash（默认）
 * - 图像生成：gemini-2.5-flash-image（默认，Nano Banana，支持图生图、多图融合）
 *
 * API 文档：https://ai.google.dev/api/generate-content
 */
import type { CurtainReference, SceneAnalysisResult } from '@/lib/curtain-ai-types';
import type {
  GenerationResult,
  ImageAspectRatio,
  ImageGenerationPrompt,
  ImageProvider,
} from './types';
import { extractJsonFromResponse, resolveImageInput, toInlineData } from './shared';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function gemDebugLog(tag: string, payload: unknown): void {
  try {
    const logPath =
      process.env.CURTAIN_DEBUG_LOG || join(process.cwd(), 'tmp', 'curtain-debug.log');
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    appendFileSync(logPath, `[${new Date().toISOString()}][${tag}]\n${body}\n\n`);
  } catch {
    /* ignore */
  }
}

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 120000);

const SCENE_ANALYSIS_SYSTEM_PROMPT =
  '你是一个专业的室内空间视觉分析系统，专注于窗户检测与窗帘状态识别。' +
  '请对用户上传的室内照片进行精确的几何分析：定位所有可见窗户对应的完整窗帘挂装覆盖区，判断当前窗帘安装状态，并推断最合适的改造模式。' +
  '所有坐标均以图片宽高的百分比表示（0-100）。' +
  '你的输出必须是严格合法的 JSON 对象，不包含任何注释、Markdown 标记或额外文字。';

const SCENE_ANALYSIS_USER_PROMPT = `请分析上方室内照片，完成以下任务：

1. 检测图中所有窗户（含遮挡、侧面、远景窗户）
2. 用百分比坐标标注每个窗户对应的完整窗帘挂装覆盖区
3. 边界框不能只覆盖窗洞玻璃或窗框，必须覆盖整套窗帘最终会占据的范围，包括左右堆帘区、顶部轨道/帘盒下沿、底部落地或堆地部分
4. 判断每个窗户当前是否已挂有窗帘，以及窗帘层数
   - 如果中心主要看到纱帘，但两侧、顶部或边缘还能看到收开的布帘/厚帘，也必须判定为 "double"
   - 不能因为中间薄纱最显眼，就忽略两侧布帘的存在
5. 判断整体空间风格，用于后续窗帘配色参考
6. 推荐操作模式：若窗户已有旧帘则选 "replace"，若窗户完全裸露则选 "add"

请严格按以下 JSON 结构返回，不要输出任何其他内容：
{
  "hasCurtain": true,
  "windowRegions": [
    { "x": 20, "y": 10, "width": 30, "height": 50, "hasCurtain": true, "curtainType": "double" }
  ],
  "recommendedMode": "replace",
  "sceneStyle": "现代简约",
  "sceneDescription": "一间采光良好的现代客厅，落地窗位于画面右侧三分之一处，中间是白色纱帘，两侧还能看到收开的灰色布帘，属于双层窗帘"
}`;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function geminiEndpoint(model: string, apiKey: string): string {
  return `${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function isNativeGeminiApi(): boolean {
  return GEMINI_API_BASE.includes('generativelanguage.googleapis.com');
}

function gatewayEndpoint(path: string): string {
  const base = GEMINI_API_BASE.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutLabel: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(timeoutLabel)), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function formatGeminiError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return error.message || fallback;
    }
    return error.message;
  }

  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeminiRateLimited(status: number, bodyText: string): boolean {
  if (status === 429) {
    return true;
  }

  return [
    'RESOURCE_EXHAUSTED',
    'rate limit',
    'quota',
    'Too Many Requests',
    '429',
  ].some((signal) => bodyText.includes(signal));
}

function rateLimitMessage(bodyText: string): string {
  return bodyText || 'Gemini 免费额度/并发被限流，请稍后重试';
}

function formatErrorForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { value: String(error) };
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  return {
    name: error.name,
    message: error.message,
    cause: cause instanceof Error
      ? { name: cause.name, message: cause.message }
      : cause ? String(cause) : undefined,
  };
}

function isFetchFailedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause || '');
  return [
    error.message,
    causeText,
  ].some((text) =>
    [
      'fetch failed',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'UND_ERR',
      'other side closed',
    ].some((signal) => text.includes(signal))
  );
}

function gatewayRatioToken(aspectRatio: ImageAspectRatio): string {
  switch (aspectRatio) {
    case '4:3':
      return '4x3';
    case '3:4':
      return '3x4';
    case '16:9':
      return '16x9';
    case '9:16':
      return '9x16';
    case '1:1':
    default:
      return '1x1';
  }
}

function resolveGatewayModel(model: string, aspectRatio?: ImageAspectRatio): string {
  if (!aspectRatio) {
    return model;
  }

  const ratioToken = gatewayRatioToken(aspectRatio);
  if (/^nano-banana(?:-pro|2)?-\d+k-(?:1x1|4x3|3x4|16x9|9x16)$/i.test(model)) {
    return model.replace(/(?:1x1|4x3|3x4|16x9|9x16)$/i, ratioToken);
  }

  return model;
}

async function analyzeScene(sceneImageUrl: string): Promise<SceneAnalysisResult> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

    if (!apiKey) {
      throw new Error('未配置 GEMINI_API_KEY');
    }

    const inlineData = await toInlineData(sceneImageUrl);

    const response = await fetchWithTimeout(geminiEndpoint(model, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SCENE_ANALYSIS_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData },
              { text: SCENE_ANALYSIS_USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }, GEMINI_REQUEST_TIMEOUT_MS, `Gemini 场景分析超时（${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)} 秒）`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini Vision API 失败: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) {
      throw new Error('Gemini Vision 返回为空');
    }

    const jsonStr = extractJsonFromResponse(text);
    return JSON.parse(jsonStr) as SceneAnalysisResult;
  } catch (error) {
    console.warn('Gemini 场景分析失败，使用默认值:', error instanceof Error ? error.message : error);
    return {
      hasCurtain: true,
      windowRegions: [],
      recommendedMode: 'replace',
      sceneDescription: '分析失败，使用默认配置',
    };
  }
}

async function generateImage(
  promptInput: string | ImageGenerationPrompt,
  sceneImage: string,
  curtainReferences: CurtainReference[]
): Promise<GenerationResult> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_IMAGE_MODEL ||
      (isNativeGeminiApi() ? 'gemini-2.5-flash-image' : 'nano-banana-1k-1x1');

    if (!apiKey) {
      return { imageUrl: '', success: false, error: '未配置 GEMINI_API_KEY 环境变量' };
    }

    // 统一处理 prompt 格式：string 或 {prompt, negative_prompt}
    const finalPrompt = typeof promptInput === 'string' ? promptInput : promptInput.prompt;
    const negativePrompt = typeof promptInput === 'object' ? promptInput.negative_prompt : undefined;
    const aspectRatio = typeof promptInput === 'object' ? promptInput.aspect_ratio : undefined;

    // 构建最终发给 Gemini 的文本（Gemini 没有原生 negative_prompt，追加到正向提示词末尾）
    const promptText = negativePrompt
      ? `${finalPrompt}\n\n请避免出现以下内容：${negativePrompt}`
      : finalPrompt;

    if (!isNativeGeminiApi()) {
      return generateImageViaGateway(
        resolveGatewayModel(model, aspectRatio),
        apiKey,
        promptText,
        sceneImage,
        curtainReferences
      );
    }

    const parts: GeminiPart[] = [];

    if (sceneImage) {
      parts.push({ inlineData: await toInlineData(sceneImage) });
    }
    for (const reference of curtainReferences) {
      if (reference?.url) {
        parts.push({ inlineData: await toInlineData(reference.url) });
      }
    }
    parts.push({ text: promptText });
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetchWithTimeout(geminiEndpoint(model, apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: aspectRatio ? { aspectRatio } : undefined,
          },
        }),
      }, GEMINI_REQUEST_TIMEOUT_MS, `Gemini 图片生成超时（${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)} 秒）`);

      if (!response.ok) {
        const errorText = await response.text();
        if (attempt < maxAttempts && isGeminiRateLimited(response.status, errorText)) {
          await sleep(2000 * attempt);
          continue;
        }
        return {
          imageUrl: '',
          success: false,
          error: isGeminiRateLimited(response.status, errorText)
            ? rateLimitMessage(errorText)
            : `Gemini API 请求失败: ${response.status} - ${errorText}`,
        };
      }

      const data = (await response.json()) as GeminiResponse;

      if (data.promptFeedback?.blockReason) {
        return {
          imageUrl: '',
          success: false,
          error: `Gemini 拒绝生成：${data.promptFeedback.blockReason}`,
        };
      }

      const resultParts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = resultParts.find((p) => p.inlineData?.data);

      if (!imagePart?.inlineData) {
        const textFeedback = resultParts.map((p) => p.text || '').join('').trim();
        if (attempt < maxAttempts && isGeminiRateLimited(200, textFeedback)) {
          await sleep(2000 * attempt);
          continue;
        }
        return {
          imageUrl: '',
          success: false,
          error: data.error?.message || textFeedback || 'Gemini 未返回图片',
        };
      }

      const { mimeType, data: base64 } = imagePart.inlineData;
      return {
        imageUrl: `data:${mimeType};base64,${base64}`,
        success: true,
      };
    }

    return {
      imageUrl: '',
      success: false,
      error: 'Gemini 免费额度/并发被限流，请稍后重试',
    };
  } catch (error) {
    const errorMessage = formatGeminiError(
      error,
      `Gemini 图片生成失败，请稍后重试（超时阈值 ${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)} 秒）`
    );
    return { imageUrl: '', success: false, error: errorMessage };
  }
}

async function generateImageViaGateway(
  model: string,
  apiKey: string,
  prompt: string,
  sceneImage: string,
  curtainReferences: CurtainReference[]
): Promise<GenerationResult> {
  const images: string[] = [];

  if (sceneImage) {
    images.push(await resolveImageInput(sceneImage));
  }

  for (const reference of curtainReferences) {
    if (reference?.url) {
      images.push(await resolveImageInput(reference.url));
    }
  }

  const requestBody: Record<string, unknown> = {
    model,
    prompt,
  };

  if (images.length === 1) {
    requestBody.image = images[0];
  } else if (images.length > 1) {
    requestBody.image = images;
  }

  const summary: Record<string, unknown> = { ...requestBody };
  if (Array.isArray(summary.image)) {
    summary.image = (summary.image as string[]).map((s) =>
      typeof s === 'string' && s.startsWith('data:image/')
        ? `${s.slice(0, 48)}... (data-url ${s.length} chars)`
        : s
    );
  } else if (typeof summary.image === 'string' && (summary.image as string).startsWith('data:image/')) {
    summary.image = `${(summary.image as string).slice(0, 48)}... (data-url ${(summary.image as string).length} chars)`;
  }
  if (typeof summary.prompt === 'string' && summary.prompt.length > 400) {
    summary.prompt = `${(summary.prompt as string).slice(0, 400)}... (total ${(summary.prompt as string).length} chars)`;
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      gemDebugLog('gemini.gateway request', {
        endpoint: gatewayEndpoint('/v1/images/generations'),
        attempt,
        summary,
      });

      const response = await fetchWithTimeout(gatewayEndpoint('/v1/images/generations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      }, GEMINI_REQUEST_TIMEOUT_MS, `图片生成超时（${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)} 秒），请稍后重试`);

      const data = await response.json() as {
        data?: Array<{ url?: string; b64_json?: string }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        gemDebugLog('gemini.gateway http-error', { attempt, status: response.status, data });
        if (attempt < maxAttempts && isGeminiRateLimited(response.status, JSON.stringify(data))) {
          await sleep(2500 * attempt);
          continue;
        }
        return {
          imageUrl: '',
          success: false,
          error: data.error?.message || `Gemini 网关请求失败: ${response.status}`,
        };
      }

      const firstImage = data.data?.[0];
      if (firstImage?.url) {
        gemDebugLog('gemini.gateway success', { attempt, url: firstImage.url });
        return {
          imageUrl: firstImage.url,
          success: true,
        };
      }

      if (firstImage?.b64_json) {
        gemDebugLog('gemini.gateway success', { attempt, b64: true, len: firstImage.b64_json.length });
        return {
          imageUrl: `data:image/png;base64,${firstImage.b64_json}`,
          success: true,
        };
      }

      gemDebugLog('gemini.gateway biz-error', { attempt, data });
      return {
        imageUrl: '',
        success: false,
        error: data.error?.message || 'Gemini 网关未返回图片',
      };
    } catch (error) {
      gemDebugLog('gemini.gateway fetch-error', {
        attempt,
        error: formatErrorForLog(error),
      });

      if (attempt < maxAttempts && isFetchFailedError(error)) {
        await sleep(3000 * attempt);
        continue;
      }

      return {
        imageUrl: '',
        success: false,
        error: isFetchFailedError(error)
          ? 'Gemini 网关连接失败或上游断开，请稍后重试'
          : formatGeminiError(
            error,
            `Gemini 网关图片生成失败，请稍后重试（超时阈值 ${Math.round(GEMINI_REQUEST_TIMEOUT_MS / 1000)} 秒）`
          ),
      };
    }
  }

  return {
    imageUrl: '',
    success: false,
    error: 'Gemini 网关连接失败或上游断开，请稍后重试',
  };
}

export const geminiProvider: ImageProvider = {
  name: 'gemini',
  analyzeScene,
  generateImage,
};

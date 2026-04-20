/**
 * Google Gemini Provider
 * - Vision：gemini-2.5-flash（默认）
 * - 图像生成：gemini-2.5-flash-image（即 nano-banana，支持图生图、多图融合）
 *
 * API 文档：https://ai.google.dev/api/generate-content
 */
import type { CurtainReference, SceneAnalysisResult } from '@/lib/curtain-ai-types';
import type { GenerationResult, ImageProvider } from './types';
import { extractJsonFromResponse, toInlineData } from './shared';

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

const SCENE_ANALYSIS_SYSTEM_PROMPT =
  '你是一个专业的室内空间视觉分析系统，专注于窗户检测与窗帘状态识别。' +
  '请对用户上传的室内照片进行精确的几何分析：定位所有可见窗户的坐标范围，判断当前窗帘安装状态，并推断最合适的改造模式。' +
  '所有坐标均以图片宽高的百分比表示（0-100）。' +
  '你的输出必须是严格合法的 JSON 对象，不包含任何注释、Markdown 标记或额外文字。';

const SCENE_ANALYSIS_USER_PROMPT = `请分析上方室内照片，完成以下任务：

1. 检测图中所有窗户（含遮挡、侧面、远景窗户）
2. 用百分比坐标标注每个窗户的边界框
3. 判断每个窗户当前是否已挂有窗帘，以及窗帘层数
4. 判断整体空间风格，用于后续窗帘配色参考
5. 推荐操作模式：若窗户已有旧帘则选 "replace"，若窗户完全裸露则选 "add"

请严格按以下 JSON 结构返回，不要输出任何其他内容：
{
  "hasCurtain": true,
  "windowRegions": [
    { "x": 20, "y": 10, "width": 30, "height": 50, "hasCurtain": true, "curtainType": "double" }
  ],
  "recommendedMode": "replace",
  "sceneStyle": "现代简约",
  "sceneDescription": "一间采光良好的现代客厅，落地窗位于画面右侧三分之一处，当前挂有白色单层薄纱帘"
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

async function analyzeScene(sceneImageUrl: string): Promise<SceneAnalysisResult> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

    if (!apiKey) {
      throw new Error('未配置 GEMINI_API_KEY');
    }

    const inlineData = await toInlineData(sceneImageUrl);

    const response = await fetch(geminiEndpoint(model, apiKey), {
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
    });

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
  prompt: string,
  sceneImage: string,
  curtainReferences: CurtainReference[]
): Promise<GenerationResult> {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

    if (!apiKey) {
      return { imageUrl: '', success: false, error: '未配置 GEMINI_API_KEY 环境变量' };
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
    parts.push({ text: prompt });

    const response = await fetch(geminiEndpoint(model, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        // 图像生成模型必须显式声明允许返回 IMAGE
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        imageUrl: '',
        success: false,
        error: `Gemini API 请求失败: ${response.status} - ${errorText}`,
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return { imageUrl: '', success: false, error: errorMessage };
  }
}

export const geminiProvider: ImageProvider = {
  name: 'gemini',
  analyzeScene,
  generateImage,
};

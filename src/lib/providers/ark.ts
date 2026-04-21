/**
 * 火山方舟 Seedream Provider
 * - Vision：Chat Completions（ARK_VISION_MODEL_ID）
 * - 图像生成：images/generations（ARK_IMAGE_MODEL_ID）
 */
import type { CurtainReference, SceneAnalysisResult } from '@/lib/curtain-ai-types';
import type { GenerationResult, ImageAspectRatio, ImageGenerationPrompt, ImageProvider } from './types';
import { extractJsonFromResponse, resolveImageInput } from './shared';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ARK_API_BASE = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';

function mapAspectRatioToArkSize(aspectRatio: ImageAspectRatio): string {
  switch (aspectRatio) {
    case '1:1':
      return '2048x2048';
    case '4:3':
      return '2304x1728';
    case '3:4':
      return '1728x2304';
    case '16:9':
      return '2560x1440';
    case '9:16':
      return '1440x2560';
    default:
      return '2K';
  }
}

const SCENE_ANALYSIS_SYSTEM_PROMPT =
  '你是一个专业的室内空间视觉分析系统，专注于窗户检测与窗帘状态识别。' +
  '请对用户上传的室内照片进行精确的几何分析：定位所有可见窗户对应的完整窗帘挂装覆盖区，判断当前窗帘安装状态，并推断最合适的改造模式。' +
  '所有坐标均以图片宽高的百分比表示（0-100）。' +
  '你的输出必须是严格合法的 JSON 对象，不包含任何注释、Markdown 标记或额外文字。';

const SCENE_ANALYSIS_USER_PROMPT = `请分析上方室内照片，完成以下任务：

1. 检测图中所有窗户（包括主窗、侧窗、甚至远处隐约可见的窗户）。
2. 用百分比坐标 [x, y, width, height] 标注每个窗户对应的完整窗帘挂装覆盖区。x, y 是左上角坐标，范围 0-100。
3. **坐标精度至关重要**：边界框不能只框玻璃或窗框，必须覆盖整套窗帘最终会占据的范围，包括左右堆帘区、顶部轨道/帘盒下沿、底部落地或堆地部分。
4. 判断每个窗户当前的状态（是否有帘、单层还是双层）。
   - 如果能看到外层厚布帘和内层薄纱帘同时存在，必须标为 "double"。
   - 如果只有一层布或一层纱，标为 "single"。
   - **特别注意**：很多中式或奶油风场景会同时挂装布帘和纱帘，即便布帘被拉开堆在两侧，只要它存在，就属于 "double" 结构。
   - **重点补充**：如果画面中心主要看到的是纱帘，但窗户左右两侧、顶部、边缘仍能看到收开的布帘、厚帘、遮光帘，也必须判定为 "double"，绝不能因为中间纱帘更显眼就误判成单层。
5. 识别空间的整体风格（如：现代简约、奶油风、法式、中古、中式、轻奢等）。
6. 推荐模式：replace (替换旧帘) 或 add (在空窗上安装)。

请严格按以下 JSON 结构返回，不要输出任何辅助文字：
{
  "hasCurtain": true,
  "windowRegions": [
    {
      "x": 20.5,
      "y": 15.0,
      "width": 40.0,
      "height": 70.5,
      "hasCurtain": true,
      "curtainType": "double"
    }
  ],
  "recommendedMode": "replace",
  "sceneStyle": "奶油风",
  "sceneDescription": "一间奶油色调的卧室，大面积落地窗位于正前方，中间是白色纱帘，两侧收着浅灰色布帘，属于双层窗帘结构。"
}`;

function arkDebugLog(tag: string, payload: unknown): void {
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

function summarizeRequestBody(requestBody: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = { ...requestBody };
  const truncate = (v: string) =>
    v.startsWith('data:image/')
      ? `${v.slice(0, 48)}... (data-url, ${v.length} chars)`
      : v.length > 200
      ? `${v.slice(0, 200)}... (${v.length} chars)`
      : v;
  if (Array.isArray(summary.image)) {
    summary.image = summary.image.map((item) =>
      typeof item === 'string' ? truncate(item) : item
    );
  } else if (typeof summary.image === 'string') {
    summary.image = truncate(summary.image);
  }
  if (typeof summary.prompt === 'string' && summary.prompt.length > 400) {
    summary.prompt = `${(summary.prompt as string).slice(0, 400)}... (total ${(summary.prompt as string).length} chars)`;
  }
  if (typeof summary.negative_prompt === 'string' && summary.negative_prompt.length > 200) {
    summary.negative_prompt = `${(summary.negative_prompt as string).slice(0, 200)}... (total ${(summary.negative_prompt as string).length} chars)`;
  }
  return summary;
}

async function analyzeScene(sceneImageUrl: string): Promise<SceneAnalysisResult> {
  try {
    const apiKey = process.env.ARK_API_KEY;
    const modelId = process.env.ARK_VISION_MODEL_ID || 'ep-20260417144640-6dczg';

    if (!apiKey) {
      throw new Error('未配置 ARK_API_KEY');
    }

    const finalImageUrl = await resolveImageInput(sceneImageUrl);
    const response = await fetch(`${ARK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: SCENE_ANALYSIS_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: finalImageUrl } },
              { type: 'text', text: SCENE_ANALYSIS_USER_PROMPT },
            ],
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ark Vision API 失败: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonStr = extractJsonFromResponse(content);
    return JSON.parse(jsonStr) as SceneAnalysisResult;
  } catch (error) {
    console.warn('场景分析失败，使用默认值:', error instanceof Error ? error.message : error);
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
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) {
      return { imageUrl: '', success: false, error: '未配置 ARK_API_KEY 环境变量' };
    }

    const { prompt: finalPrompt, negative_prompt, aspect_ratio } = typeof promptInput === 'string'
      ? { prompt: promptInput, negative_prompt: undefined, aspect_ratio: undefined as ImageAspectRatio | undefined }
      : promptInput;

    const requestBody: Record<string, unknown> = {
      model: process.env.ARK_IMAGE_MODEL_ID || 'doubao-seedream-5-0-260128',
      prompt: finalPrompt,
      negative_prompt,
      response_format: 'url',
      size: aspect_ratio ? mapAspectRatioToArkSize(aspect_ratio) : '2K',
      stream: false,
      watermark: false,
      // 多图输入时必须设为 disabled，否则会生成组图而不是单张融合图
      sequential_image_generation: 'disabled',
    };

    const curtainImages = curtainReferences.map((reference) => reference.url);

    if (curtainImages.length > 0) {
      const processedCurtains = await Promise.all(curtainImages.map(resolveImageInput));
      if (sceneImage) {
        const processedScene = await resolveImageInput(sceneImage);
        // 顺序重要：图1=场景（背景），图2=主窗帘，图3=纱帘（如有）
        requestBody.image = [processedScene, ...processedCurtains];
      } else {
        requestBody.image = processedCurtains.length === 1 ? processedCurtains[0] : processedCurtains;
      }
    } else if (sceneImage) {
      requestBody.image = await resolveImageInput(sceneImage);
    }

    arkDebugLog('ark.generateImage request', summarizeRequestBody(requestBody));

    const response = await fetch(`${ARK_API_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      arkDebugLog('ark.generateImage http-error', { status: response.status, body: errorText });
      console.error(`Ark API 请求失败: ${response.status} - ${errorText}`);
      return {
        imageUrl: '',
        success: false,
        error: `Ark API 请求失败: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      arkDebugLog('ark.generateImage success', { url: data.data[0].url });
      return { imageUrl: data.data[0].url, success: true };
    }

    arkDebugLog('ark.generateImage biz-error', data);
    return {
      imageUrl: '',
      success: false,
      error: data.error?.message || '生成失败，未获取到图片',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    arkDebugLog('ark.generateImage throw', errorMessage);
    return { imageUrl: '', success: false, error: errorMessage };
  }
}

export const arkProvider: ImageProvider = {
  name: 'ark',
  analyzeScene,
  generateImage,
};

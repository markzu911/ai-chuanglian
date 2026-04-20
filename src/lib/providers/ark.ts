/**
 * 火山方舟 Seedream Provider
 * - Vision：Chat Completions（ARK_VISION_MODEL_ID）
 * - 图像生成：images/generations（ARK_IMAGE_MODEL_ID）
 */
import type { CurtainReference, SceneAnalysisResult } from '@/lib/curtain-ai-types';
import type { GenerationResult, ImageProvider } from './types';
import { extractJsonFromResponse, resolveImageInput } from './shared';

const ARK_API_BASE = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';

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
    {
      "x": 20,
      "y": 10,
      "width": 30,
      "height": 50,
      "hasCurtain": true,
      "curtainType": "double"
    }
  ],
  "recommendedMode": "replace",
  "sceneStyle": "现代简约",
  "sceneDescription": "一间采光良好的现代客厅，落地窗位于画面右侧三分之一处，当前挂有白色单层薄纱帘"
}

字段说明：
- windowRegions[].x / y：窗户左上角坐标（图片百分比）
- windowRegions[].width / height：窗户宽高（图片百分比）
- windowRegions[].curtainType：窗帘层数，"single" 或 "double"，无帘时填 "none"
- sceneStyle：空间主要装修风格（如：现代简约、北欧、轻奢、中式、奶油风等）
- sceneDescription：100字以内，描述空间氛围、窗户位置、采光条件及当前窗帘状态`;

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
  prompt: string,
  sceneImage: string,
  curtainReferences: CurtainReference[]
): Promise<GenerationResult> {
  try {
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) {
      return { imageUrl: '', success: false, error: '未配置 ARK_API_KEY 环境变量' };
    }

    const requestBody: Record<string, unknown> = {
      model: process.env.ARK_IMAGE_MODEL_ID || 'ep-20260417093524-5qxv2',
      prompt,
      response_format: 'url',
      size: '2K',
      stream: false,
      watermark: false,
    };

    const curtainImages = curtainReferences.map((reference) => reference.url);

    if (curtainImages.length > 0) {
      const processedCurtains = await Promise.all(curtainImages.map(resolveImageInput));
      if (sceneImage) {
        const processedScene = await resolveImageInput(sceneImage);
        requestBody.image = [processedScene, ...processedCurtains];
      } else {
        requestBody.image = processedCurtains.length === 1 ? processedCurtains[0] : processedCurtains;
      }
    } else if (sceneImage) {
      requestBody.image = await resolveImageInput(sceneImage);
    }

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
      return {
        imageUrl: '',
        success: false,
        error: `Ark API 请求失败: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();

    if (data.data && data.data.length > 0) {
      return { imageUrl: data.data[0].url, success: true };
    }

    return {
      imageUrl: '',
      success: false,
      error: data.error?.message || '生成失败，未获取到图片',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return { imageUrl: '', success: false, error: errorMessage };
  }
}

export const arkProvider: ImageProvider = {
  name: 'ark',
  analyzeScene,
  generateImage,
};

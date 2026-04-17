/**
 * Coze SDK 封装
 * 提供 LLM 和图像生成能力
 */
import { LLMClient, ImageGenerationClient, Config } from 'coze-coding-dev-sdk';

const config = new Config({
  apiKey: process.env.COZE_WORKLOAD_IDENTITY_API_KEY,
  baseUrl: process.env.COZE_INTEGRATION_BASE_URL || 'https://api.coze.com',
  modelBaseUrl: process.env.COZE_INTEGRATION_MODEL_BASE_URL || 'https://model.coze.com',
});

/**
 * LLM 客户端单例
 */
export const llmClient = new LLMClient(config);

/**
 * 图像生成客户端单例
 */
export const imageClient = new ImageGenerationClient(config);

/**
 * 场景分析请求
 */
export interface SceneAnalysisResult {
  hasCurtain: boolean;
  windowRegions: WindowRegion[];
  recommendedMode: 'replace' | 'add';
  sceneDescription: string;
}

export interface WindowRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  hasCurtain: boolean;
  curtainType?: 'single' | 'double';
}

/**
 * 分析客户现场照片
 * 识别窗户区域和窗帘状态
 */
export async function analyzeScene(sceneImageUrl: string): Promise<SceneAnalysisResult> {
  const response = await llmClient.invoke(
    [
      {
        role: 'system',
        content: `你是一个专业的室内装修 AI 助手。你的任务是分析客户现场照片，识别窗户区域和窗帘状态。
请用 JSON 格式返回分析结果：
{
  "hasCurtain": true/false,  // 是否已有窗帘
  "windowRegions": [          // 窗户区域列表
    {
      "x": 0-100,              // 相对位置 X
      "y": 0-100,              // 相对位置 Y
      "width": 0-100,          // 宽度占比
      "height": 0-100,         // 高度占比
      "hasCurtain": true/false,
      "curtainType": "single"/"double"  // 单层/双层窗帘
    }
  ],
  "recommendedMode": "replace"/"add",  // 推荐模式
  "sceneDescription": "场景描述"         // 简短描述
}
只返回 JSON，不要其他内容。`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: sceneImageUrl,
            },
          },
        ],
      },
    ],
    {
      model: 'doubao-seed-1-6-vision-250815',
    }
  );

  try {
    const jsonStr = extractJsonFromResponse(response.content);
    return JSON.parse(jsonStr) as SceneAnalysisResult;
  } catch {
    // 默认值，解析失败时使用
    return {
      hasCurtain: true,
      windowRegions: [],
      recommendedMode: 'replace',
      sceneDescription: '已分析场景',
    };
  }
}

/**
 * 生成窗帘效果图
 */
export interface GenerateOptions {
  sceneImage: string;
  curtainImages: string[];
  mode: 'replace' | 'add' | 'auto';
  style?: string;
}

export interface GenerationResult {
  imageUrl: string;
  success: boolean;
  error?: string;
}

/**
 * 生成窗帘效果图（带进度回调）
 */
export async function generateCurtainImage(
  options: GenerateOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult> {
  try {
    onProgress?.(10, '正在分析场景...');

    // 分析场景
    const sceneAnalysis = await analyzeScene(options.sceneImage);
    onProgress?.(20, `检测到${sceneAnalysis.windowRegions.length}个窗户区域`);

    // 构建提示词
    const prompt = buildPrompt(options, sceneAnalysis);
    onProgress?.(30, '正在生成效果图...');

    // 调用图像生成 API
    const response = await imageClient.generate({
      prompt,
      image: [options.sceneImage, ...options.curtainImages],
      size: '2K',
      watermark: false,
    });

    const helper = imageClient.getResponseHelper(response);

    if (helper.success && helper.imageUrls.length > 0) {
      onProgress?.(100, '生成完成');
      return {
        imageUrl: helper.imageUrls[0],
        success: true,
      };
    } else {
      return {
        imageUrl: '',
        success: false,
        error: helper.errorMessages?.[0] || '生成失败',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return {
      imageUrl: '',
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 批量生成多方案
 */
export async function generateMultipleSchemes(
  options: GenerateOptions,
  count: number = 3,
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];

  for (let i = 0; i < count; i++) {
    onProgress?.(((i + 1) / count) * 100, `正在生成方案 ${i + 1}/${count}...`);
    const result = await generateCurtainImage(options, (progress) => {
      onProgress?.(((i + progress / 100) / count) * 100, `方案 ${i + 1}: ${Math.round(progress)}%`);
    });
    results.push(result);
  }

  return results;
}

/**
 * 构建生成提示词
 */
function buildPrompt(
  options: GenerateOptions,
  sceneAnalysis: SceneAnalysisResult
): string {
  const modeMap = {
    replace: '替换已有窗帘',
    add: '新增挂装窗帘',
    auto: '根据场景自动匹配窗帘',
  };

  const styleHints: Record<string, string> = {
    奶油风: '暖色调、柔软质感、浅色系',
    现代简约: '简洁线条、纯色面料、中性色调',
    轻奢: '金属装饰、高贵面料、深色系',
    北欧: '自然材质、简约设计、浅木色',
    中式: '传统图案、丝绸面料、红色或米色',
  };

  let prompt = `窗帘效果图生成：一张专业的室内设计效果图，展示${modeMap[options.mode]}的效果。

场景分析：
- 窗户数量：${sceneAnalysis.windowRegions.length}个
- 当前状态：${sceneAnalysis.hasCurtain ? '已有窗帘' : '无窗帘'}
- 场景描述：${sceneAnalysis.sceneDescription}`;

  if (options.curtainImages.length > 0) {
    prompt += `
窗帘商品参考：用户提供的窗帘样式，需要将此窗帘样式应用到场景中。
重点要求：
1. 保持原空间结构不变
2. 窗户位置和形状不变
3. 窗帘颜色、材质、款式特征尽量保留
4. 窗帘挂装位置和长度要合理自然
5. 布帘与纱帘的双层关系要正确呈现
6. 光影效果要自然协调`;
  } else if (options.style) {
    prompt += `
风格方向：${options.style}
${styleHints[options.style] || ''}
需要生成符合该风格的专业窗帘效果。`;
  }

  prompt += `
图片质量要求：
- 高清细节
- 真实的光影效果
- 自然的空间融合
- 专业的室内设计感`;

  return prompt;
}

/**
 * 从 LLM 响应中提取 JSON
 */
function extractJsonFromResponse(content: string): string {
  // 尝试提取 ```json ... ``` 包裹的内容
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  // 尝试提取 ``` ... ``` 包裹的内容
  const codeMatch = content.match(/```\s*([\s\S]*?)\s*```/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }

  // 尝试提取 { ... } 包裹的内容
  const objMatch = content.match(/\{[\s\S]*\}/);
  if (objMatch) {
    return objMatch[0];
  }

  return content;
}

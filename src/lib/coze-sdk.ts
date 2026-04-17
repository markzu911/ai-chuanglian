/**
 * 火山方舟 Seedream 图像生成 API 封装
 * 基于火山方舟 v3 API
 */
import { LLMClient, Config } from 'coze-coding-dev-sdk';

const config = new Config({
  apiKey: process.env.COZE_WORKLOAD_IDENTITY_API_KEY,
  baseUrl: process.env.COZE_INTEGRATION_BASE_URL || 'https://api.coze.com',
  modelBaseUrl: process.env.COZE_INTEGRATION_MODEL_BASE_URL || 'https://model.coze.com',
});

/**
 * LLM 客户端单例（用于场景分析）
 */
export const llmClient = new LLMClient(config);

/**
 * 火山方舟 API 配置
 */
const ARK_API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

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
 * 生成请求配置
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
 * 调用火山方舟 Seedream 生成图像
 * 支持图生图：将窗帘商品样式应用到场景中
 */
async function callArkImageGeneration(
  prompt: string,
  sceneImage: string,
  curtainImages: string[] = [],
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult> {
  try {
    onProgress?.(10, '正在调用火山方舟 API...');

    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) {
      return {
        imageUrl: '',
        success: false,
        error: '未配置 ARK_API_KEY 环境变量',
      };
    }

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      model: 'ep-20260417093524-5qxv2',
      prompt,
      response_format: 'url',
      size: '2K',
      stream: false,
      watermark: false,
    };

    // 图生图：传入参考图片
    // Seedream 支持 image 参数，第一个是场景图，后面的是窗帘商品图
    if (curtainImages.length > 0) {
      // 同时传入场景图和窗帘商品图
      requestBody.image = [sceneImage, ...curtainImages];
      onProgress?.(15, '已加载参考图片');
    } else if (sceneImage) {
      // 只有场景图（用于新增挂装或风格生成）
      requestBody.image = sceneImage;
      onProgress?.(15, '已加载场景图片');
    }

    onProgress?.(20, '正在生成...');

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
        error: `API 请求失败: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();

    onProgress?.(90, '处理结果...');

    if (data.data && data.data.length > 0) {
      return {
        imageUrl: data.data[0].url,
        success: true,
      };
    } else {
      return {
        imageUrl: '',
        success: false,
        error: data.error?.message || '生成失败，未获取到图片',
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
 * 生成窗帘效果图
 */
export async function generateCurtainImage(
  options: GenerateOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult> {
  try {
    onProgress?.(5, '正在分析场景...');

    // 分析场景
    const sceneAnalysis = await analyzeScene(options.sceneImage);
    onProgress?.(15, `检测到${sceneAnalysis.windowRegions.length}个窗户区域`);

    // 构建提示词
    const prompt = buildPrompt(options, sceneAnalysis);
    onProgress?.(25, '正在生成效果图...');

    // 调用火山方舟 API，传入场景图和窗帘商品图
    const result = await callArkImageGeneration(
      prompt,
      options.sceneImage,
      options.curtainImages,
      (progress, message) => {
        onProgress?.(25 + progress * 0.7, message);
      }
    );

    if (result.success) {
      onProgress?.(100, '生成完成');
    }

    return result;
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
    onProgress?.(((i) / count) * 100, `正在生成方案 ${i + 1}/${count}...`);
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
  const curtainCount = options.curtainImages.length;
  const hasStyle = !!options.style;

  // ========================================
  // 场景一：商品替换（有窗帘商品图）
  // ========================================
  if (curtainCount > 0) {
    // 双商品绑定版：布帘 + 纱帘分开替换
    if (curtainCount >= 2) {
      return `请基于客户现场照片进行双层窗帘商品替换。
【商品绑定要求】
- 布帘：严格参考商品图A的样式
- 纱帘：严格参考商品图B的样式
- 两者必须材质不同、透光性不同、层次清晰

【原图结构要求】
- 外层为布帘（厚重、有遮光感）
- 内层为纱帘（轻薄、半透明、透光）
- 左右两侧为收拢布帘
- 中间为展开纱帘
- 保持原有单双层关系和开合逻辑

【核心限制】
- 只替换窗帘，不要改动其他区域
- 必须尽量还原商品本身的颜色、材质、纹理、花型、褶皱、厚薄感和整体款式
- 不要把双层窗帘错误合并成单层
- 不要把布帘和纱帘混成同一种材质
- 不要改变窗户位置、墙面、地面、家具
- 窗帘尺寸比例合理，挂装位置正确，长度自然
- 不要漂浮，不要变形，不要失真，不要过度美化
- 不要生成多余装饰、背景变化或额外设计元素
- 不要整图重绘

【商品一致性优先于画面创意】
【严格参考商品图，不要自行改变花型和材质】
【如果商品图与场景冲突，优先保留商品特征】

【输出目标】
生成一张可直接用于销售沟通的真实窗帘效果图。`;
    }

    // 单商品版：替换布帘，保留纱帘
    return `请基于客户现场照片进行窗帘商品替换。
【任务说明】
- 这是一个商品级替换任务，不是自由创作任务，也不是风格参考任务
- 核心目标：把我提供的窗帘商品，真实地安装到客户空间中

【商品绑定要求】
- 严格参考商品图的样式进行生成
- 必须尽量还原商品本身的颜色、材质、纹理、花型、褶皱、厚薄感和整体款式
- 不要只保留颜色，请同时保留款式和纹理

【原图结构要求】
- 如果原图已有窗帘，请在原位置进行替换
- 保留原有窗帘的大致挂装结构和开合状态
- 如果是双层窗帘（外层布帘 + 内层纱帘），请分清层级：
  * 外层布帘：厚重、有遮光感、明确褶皱
  * 内层纱帘：轻薄、半透明、透光自然
- 不要随意改变原本是单层还是双层的关系
- 不要把双层窗帘误生成单层窗帘

【核心限制】
- 只修改窗帘区域，其他区域尽量保持不变
- 不要重绘整个房间
- 不要改变窗户位置、墙面、地面、家具和原有空间结构
- 窗帘不能漂浮，不能变形，不能比例失真
- 效果要真实，像实际安装后的照片
- 不要生成新的家具、墙饰或背景元素

【商品一致性优先于画面创意】
【严格参考商品图，不要自行改变花型和材质】
【不要只保留颜色，请同时保留款式和纹理】
【这是商品替换，不是灵感创作】

【输出目标】
生成一张可直接用于销售沟通的真实窗帘效果图。`;
  }

  // ========================================
  // 场景二：空窗新增挂装（无窗帘商品图，有风格）
  // ========================================
  if (hasStyle) {
    const styleMap: Record<string, string> = {
      奶油风: '奶油温柔风，暖色调、柔软质感、浅色系、奶白色、米色',
      现代简约: '现代简约风，简洁线条、纯色面料、中性色调',
      轻奢: '轻奢高级风，金属装饰、高贵面料、深色系',
      北欧: '原木自然风，浅木色、白色、灰色、自然材质',
      中式: '中式优雅风，传统图案、丝绸面料、红色或米色',
    };

    const style = options.style || '现代简约';
    const styleHint = styleMap[style] || `${style}风格`;

    return `请基于客户现场照片进行新增挂装窗帘生成。
【任务说明】
- 在窗户区域安装合理的新窗帘
- 生成真实效果图，用于销售推荐

【风格方向】
${styleHint}

【挂装要求】
- 识别窗户区域，在合理位置新增挂装窗帘
- 窗帘顶部挂点、左右边界、长度比例合理
- 如果原图有窗户没有窗帘，请生成适合该空间的窗帘

【核心限制】
- 保持原始房间结构不变
- 保持窗户、墙面、地面、家具和光影基本不变
- 窗帘颜色、材质和风格要与整体空间协调
- 挂装位置、长度、褶皱和垂感合理
- 效果要真实，可用于客户沟通
- 不要自由发挥成其他款式
- 不要生成额外家具和装饰
- 不要做成概念效果图或夸张设计图

【输出目标】
生成可直接用于销售沟通的真实窗帘效果图。`;
  }

  // ========================================
  // 场景三：自动风格生成（无商品图，无指定风格）
  // ========================================
  return `请基于客户现场照片生成窗帘方案图，用于销售推荐。
【任务说明】
- 目标是根据空间环境生成与空间协调的窗帘效果
- 不要重绘整个房间

【生成要求】
- 保持原始房间结构不变
- 保持窗户位置、墙面、地面、家具基本不变
- 只在窗户区域生成合理的窗帘效果
- 窗帘颜色、材质和风格要与整体空间协调
- 挂装位置、长度、褶皱和垂感合理
- 效果真实，可用于客户沟通
- 不要整图重绘
- 不要生成额外家具、背景或装饰物

【输出目标】
生成3套不同方向的窗帘方案：
1. 奶油温柔风
2. 现代简约风
3. 轻奢高级风

请生成一套与空间最协调的方案作为最终输出。`;
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

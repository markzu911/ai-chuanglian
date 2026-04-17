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
 * 构建生成提示词 - Seedream 窗帘替换专用模板
 */
function buildPrompt(
  options: GenerateOptions,
  sceneAnalysis: SceneAnalysisResult
): string {
  const curtainCount = options.curtainImages.length;
  const hasStyle = !!options.style;

  // ========================================
  // 场景一：单层窗帘替换（1张商品图）
  // ========================================
  if (curtainCount === 1) {
    return `请基于原始客户现场照片进行单层窗帘商品替换。
这是一个局部替换任务，不是重新生成新房间，也不是重新设计整个空间。

核心目标：在同一房间、同一视角、同一构图、同一透视关系下，只替换原图中的窗帘。

严格要求：
- 保持同一房间、同一相机视角、同一构图、同一透视关系
- 不要改变镜头位置，不要改变取景范围
- 不要改变房间结构、窗户位置、墙面、地面、吊顶、家具和光影方向
- 只替换窗帘区域，不要重绘整个房间
- 不要生成新的空间布局
- 输出结果必须看起来像在原图基础上完成局部窗帘替换

商品要求：
- 严格按照我提供的窗帘商品图生成
- 尽量保留商品的颜色、材质、纹理、花型、褶皱和整体款式
- 不要只参考颜色，必须同时保留材质和款式特征
- 商品一致性优先于画面创意

结果要求：
- 窗帘挂装位置合理，长度比例合理，褶皱自然
- 不漂浮、不变形、不失真
- 效果真实，像实际安装后的照片

补充约束：
same room, same camera view, same composition, same perspective
curtain-only replacement, do not regenerate the whole room
preserve original room, original architecture, original lighting

严格参考商品图本身，不要只参考风格。
商品一致性优先于审美优化。
This is a curtain-only replacement task.`;
  }

  // ========================================
  // 场景二：双层窗帘替换（2张商品图）
  // ========================================
  if (curtainCount >= 2) {
    return `请基于原始客户现场照片进行双层窗帘商品替换。
这是一个局部替换任务，不是重新生成新房间，也不是重绘整个场景。

核心目标：在同一房间、同一视角、同一构图下，只替换原图中的双层窗帘，并保留原有层级关系。

严格要求：
- 保持同一房间、同一相机视角、同一构图、同一透视关系
- 不要改变镜头位置、取景范围和空间比例
- 不要改变房间结构、窗户位置、墙面、地面、吊顶、家具和光影方向
- 只替换窗帘区域，不要整图重绘
- 不要生成新的房间布局

双层结构要求：
- 保留原图的双层窗帘关系
- 外层为布帘，内层为纱帘
- 左右两侧布帘收拢，中间纱帘展开
- 不要把双层窗帘误生成单层窗帘
- 不要把布帘和纱帘混成同一种材质
- 布帘必须有厚重感和明确褶皱
- 纱帘必须轻薄、半透明、透光自然

商品绑定要求：
- 布帘按商品图A生成
- 纱帘按商品图B生成
- 严格保留商品的的颜色、材质、纹理、花型、褶皱和整体风格
- 商品一致性优先于画面创意

结果要求：
- 视角不变、房间不变、双层关系清晰
- 挂装自然，效果真实，像实际安装后的照片

补充约束：
same room, same camera view, same composition, same perspective
preserve double-layer curtain structure
do not merge fabric curtain and sheer curtain
curtain-only replacement, do not regenerate the whole room

不要自行改变花型、材质和层级结构。
如果商品图与场景冲突，优先保留商品特征。
不要将商品图转化为相似款，要尽量还原原商品。
This is a curtain-only replacement task.`;
  }

  // ========================================
  // 场景三：空窗新增挂装（有风格方向，无商品图）
  // ========================================
  if (hasStyle && options.style) {
    const styleMap: Record<string, string> = {
      奶油风: '奶油温柔风，暖色调、柔软质感、浅色系、奶白色、米色',
      现代简约: '现代简约风，简洁线条、纯色面料、中性色调',
      轻奢: '轻奢高级风，金属装饰、高贵面料、深色系',
      北欧: '原木自然风，浅木色、白色、灰色、自然材质',
      中式: '中式优雅风，传统图案、丝绸面料、红色或米色',
    };

    const styleHint = styleMap[options.style] || `${options.style}风格`;

    return `请基于原始客户现场照片进行新增挂装窗帘生成。
这是在原图窗户区域新增窗帘，不是重新生成新房间，也不是重绘整个空间。

核心目标：在同一房间、同一视角、同一构图下，把合适的窗帘真实地安装到窗户区域。

风格方向：${styleHint}

严格要求：
- 保持同一房间、同一相机视角、同一构图、同一透视关系
- 不要改变房间结构、窗户位置、墙面、地面、吊顶、家具和光影方向
- 不要重绘整个房间，不要生成新的布局
- 只在窗户区域新增挂装窗帘

挂装要求：
- 顶部挂装位置合理，左右边界合理
- 长度比例合理，垂感自然
- 不漂浮、不变形、不失真
- 效果要像真实安装后的照片

结果要求：
- 窗帘颜色、材质和风格要与整体空间协调
- 褶皱和垂感自然
- 可直接用于客户沟通

补充约束：
same room, same camera view, same composition, same perspective
add curtain only in window area, do not regenerate the whole room
preserve original room, original architecture, original lighting`;
  }

  // ========================================
  // 场景四：自动风格生成（无商品图，无风格）
  // ========================================
  return `请基于原始客户现场照片生成窗帘风格方案图。
这是一个原场景保留的方案生成任务，不是重新设计整个房间。

核心目标：在同一房间、同一视角、同一构图下，只在窗户区域生成适合该空间的窗帘方案。

严格要求：
- 保持同一房间、同一相机视角、同一构图、同一透视关系
- 不要改变房间结构、窗户位置、墙面、地面、吊顶、家具和光影方向
- 不要重绘整个房间，只在窗户区域生成窗帘效果

风格方案：
请生成适合该空间的窗帘方案：
1. 奶油温柔风 - 暖色调、柔软质感、浅色系
2. 现代简约风 - 简洁线条、纯色面料、中性色调
3. 轻奢高级风 - 高贵面料、深色系、优雅气质

结果要求：
- 风格与空间协调，颜色搭配自然
- 挂装位置合理，垂感和褶皱自然
- 效果真实，可直接用于客户沟通

补充约束：
same room, same camera view, same composition, same perspective
curtain-only generation, preserve original layout
do not regenerate the whole room`;
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

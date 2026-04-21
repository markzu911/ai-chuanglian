/**
 * 窗帘 AI 生成核心逻辑
 * - Prompt 构建 & 窗户区域语义化
 * - 通过 provider 层（src/lib/providers/*）调用底层模型
 *   当前支持 Ark Seedream / Google Gemini，由 IMAGE_PROVIDER env 切换
 */
import { Config, LLMClient } from 'coze-coding-dev-sdk';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CurtainReference,
  CurtainStructure,
  SceneAnalysisResult,
  ShowcaseAngle,
  WindowRegion,
} from '@/lib/curtain-ai-types';
import {
  getGenerationProvider,
  getSceneAnalysisProvider,
  getShowcaseGenerationProvider,
} from '@/lib/providers';
import { extractJsonFromResponse, resolveImageInput, toInlineData } from '@/lib/providers/shared';
import type { GenerationResult, ImageAspectRatio } from '@/lib/providers/types';

const config = new Config({
  apiKey: process.env.COZE_WORKLOAD_IDENTITY_API_KEY,
  baseUrl: process.env.COZE_INTEGRATION_BASE_URL || 'https://api.coze.com',
  modelBaseUrl: process.env.COZE_INTEGRATION_MODEL_BASE_URL || 'https://model.coze.com',
});

export const llmClient = new LLMClient(config);

const DEBUG_LOG_PATH = process.env.CURTAIN_DEBUG_LOG || join(process.cwd(), 'tmp', 'curtain-debug.log');

function debugLog(tag: string, payload: unknown): void {
  const timestamp = new Date().toISOString();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const line = `[${timestamp}][${tag}]\n${body}\n\n`;
  console.log(`[${tag}]`, body);
  try {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
    appendFileSync(DEBUG_LOG_PATH, line);
  } catch (error) {
    console.warn('debugLog 写盘失败:', error instanceof Error ? error.message : error);
  }
}

export interface GenerateOptions {
  sceneImage: string;
  curtainReferences: CurtainReference[];
  mode: 'replace' | 'add' | 'auto' | 'showcase';
  style?: string;
  curtainStructure?: CurtainStructure;
  sceneAnalysisOverride?: SceneAnalysisResult;
}

export interface ShowcaseOptions {
  curtainImage: string;
  style?: string;
  angle?: ShowcaseAngle | 'all';
  angles?: ShowcaseAngle[];
}

interface CurtainProductFingerprint {
  isCloseUpSample: boolean;
  structure: 'single' | 'double';
  productDescription: string;
  fabricDescription?: string;
  sheerDescription?: string;
  motifType:
    | 'cross-stitch'
    | 'star'
    | 'diamond'
    | 'dot'
    | 'damask'
    | 'floral'
    | 'geometric'
    | 'stripe'
    | 'abstract'
    | 'solid';
  motifDensity: 'sparse' | 'medium' | 'dense';
  secondaryMotif: 'grid' | 'stripe' | 'lattice' | 'background-wash' | 'none';
}

interface ShowcaseArtifactCheckResult {
  hasForbiddenArtifacts: boolean;
  evidence: string[];
}

interface ShowcaseAngleCheckResult {
  matchesAngle: boolean;
  evidence: string[];
}

interface ShowcaseFidelityCheckResult {
  matchesProduct: boolean;
  scores: {
    color: number;
    motif: number;
    material: number;
    layer: number;
    trim: number;
  };
  evidence: string[];
}

interface ShowcaseDiversitySeed {
  roomStyle: string;
  cameraAngle: string;
  lighting: string;
  decor: string;
}

interface ShowcaseArtifactCrop {
  label: string;
  imageUrl: string;
}

interface CurtainSubjectRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type { GenerationResult } from '@/lib/providers/types';

const SHOWCASE_ARTIFACT_CHECK_SYSTEM_PROMPT =
  '你是一个电商图片质检助手。你只负责检查图片里是否出现社交媒体、直播、相册、轮播、截图或平台 UI 痕迹。' +
  '你必须返回严格 JSON，不要输出任何解释。';

const SHOWCASE_ARTIFACT_CHECK_USER_PROMPT =
  '请检查这张图片是否出现任何不允许的 UI/平台痕迹，包括但不限于：LIVE 标、直播角标、页码计数器（如 1/3、1/2）、左右切换箭头、底部分页点、评论点赞收藏分享图标、购物车、价格标签、水印、logo、截图边框、拼图/轮播样式。' +
  '请严格返回 JSON：{"hasForbiddenArtifacts": boolean, "evidence": string[]}。如果有问题，evidence 里只列出看见的具体痕迹关键词。';

const SHOWCASE_ANGLE_CHECK_SYSTEM_PROMPT =
  '你是一个电商图片构图质检助手。你只负责判断图片是否符合指定的展示角度要求。你必须返回严格 JSON，不要输出解释。';

const SHOWCASE_FIDELITY_CHECK_SYSTEM_PROMPT =
  '你是一个电商窗帘商品保真度质检助手。你只负责判断生成图里的窗帘是否与参考图里的窗帘是同一款商品（颜色、花型、材质、双层结构完全一致）。' +
  '你必须返回严格 JSON，不要输出解释。';

const SHOWCASE_FIDELITY_CHECK_USER_PROMPT =
  '请对比两张图里的窗帘是否是同一款商品。第一张是原商品参考图，第二张是 AI 生成的新场景图。' +
  '请对下列 5 个维度各打 0-5 分（0 = 完全错误/丢失，5 = 完全一致）：' +
  'color（主色/色相/饱和度是否一致）、' +
  'motif（花型/图案是否一致，必须做双层检查：(a) 底层背景图案——原图若有淡色格纹/条纹/水洗纹，生成图必须同样有；如果生成图把格纹底错画成纯素底，motif 项最多给 2 分；(b) 前景主 motif——务必严格区分"十字绣/X 形刺绣" vs "圆点" vs "菱形" vs "花朵" vs "几何" vs "条纹" vs "素面"。如果生成图把原图的十字绣误渲成圆点或菱形，motif 项最多给 1 分。两层都丢或误换都是最低分）、' +
  'material（面料厚薄、透光度、质地肌理是否一致——厚重棉麻不能变薄纱，印花不能变纯色）、' +
  'layer（双层结构是否保留——原图双层生成图只剩一层，或反之，layer 项给 0 分）、' +
  'trim（边缘装饰如流苏/绒球/包边/帘头是否保留，且颜色、球径/长度也要对得上）。' +
  '打分必须严格：完美一致才给 5，略有偏差给 3-4，明显偏差给 1-2，完全错误给 0。' +
  '请严格返回 JSON：{"scores": {"color": number, "motif": number, "material": number, "layer": number, "trim": number}, "evidence": string[]}。' +
  'evidence 只写具体偏离关键词，比如 "格纹底丢失"、"motif 从十字绣变为圆点"、"底色偏暖变橙色"、"毛球丢失"、"双层变单层"。';

const CURTAIN_FINGERPRINT_SYSTEM_PROMPT =
  '你是一个电商窗帘商品视觉解析助手。你的任务是从商品图中提炼只属于窗帘本体的特征，并忽略拍摄构图、文案、水印、人物和背景。' +
  '你必须返回严格 JSON，不要输出 Markdown 或额外解释。';

const CURTAIN_FINGERPRINT_USER_PROMPT =
  '请只分析这张图中的窗帘商品本体，忽略手、人物、模特、姿势、墙角、背景、窗框、机位、裁切、拍摄方式、叠加文案、logo、角标、页码和 UI。' +
  '必须优先判断这是不是双层窗帘系统：如果图片里同时有外层布帘和内层纱帘，structure 必须返回 "double"，不能只描述最显眼的一层。' +
  '必须做双层 motif 分析——先看底层背景图案（secondaryMotif），再看主前景 motif（motifType）：' +
  'secondaryMotif 枚举（必须从中选一个）：' +
  '"grid"（布面底层有淡色细线构成的棋盘/方格纹，类似 graph paper）、' +
  '"stripe"（布面底层有淡色条纹，竖条或横条）、' +
  '"lattice"（布面底层有菱形格/十字格斜交叉纹）、' +
  '"background-wash"（布面底层有晕染/水彩斑驳/脏色水洗效果）、' +
  '"none"（布面底层是纯净无纹理的素色底）。' +
  '特别提醒：很多中式/田园/奶油风窗帘是"淡色格纹底 + 少量十字绣点缀"的复合结构，千万不要只报 cross-stitch 而漏掉 grid 底层；也不要只报 grid 而漏掉前景刺绣。' +
  'motifType 枚举（前景主图案，必须从中选一个）：' +
  '"cross-stitch"（十字形/星形小刺绣，像 ✕ 或 ✳ 的线绣）、' +
  '"star"（明确的星星、雪花或星形轮廓）、' +
  '"diamond"（菱形/钻石格点）、' +
  '"dot"（纯圆点/波点，没有十字或星角）、' +
  '"damask"（低对比同色系提花/暗纹/织锦花纹/欧式蔓草纹，图案像织在布里，不是清晰绿色叶子印花）、' +
  '"floral"（花朵/植物/叶片）、' +
  '"geometric"（三角/正方/六边形/大块几何）、' +
  '"stripe"（主视觉是粗条纹）、' +
  '"abstract"（抽象水墨/艺术晕染）、' +
  '"solid"（无前景图案，只有底层或纯素面）。' +
  '务必严格区分 cross-stitch 和 dot——小十字刺绣必须选 cross-stitch，只有真正的填充圆点才选 dot。' +
  '如果外层布帘是低对比、同色系、覆盖整片布面的提花/暗纹/织锦/蔓草纹，motifType 必须选 "damask"，motifDensity 通常应为 "dense" 或 "medium"，不要误判为 sparse floral；只有清晰彩色花朵/绿色叶片印花才选 floral。' +
  '同时输出 motifDensity，从 "sparse"（每 5-10cm 才一个孤立前景 motif）/"medium"（每 2-5cm 一个）/"dense"（连续暗纹/提花/密集重复纹覆盖大部分布面）里选一个。' +
  '请严格返回 JSON：{"isCloseUpSample": boolean, "structure": "single" | "double", "secondaryMotif": string, "motifType": string, "motifDensity": string, "productDescription": string, "fabricDescription"?: string, "sheerDescription"?: string}。' +
  'productDescription 用一段中文详述：主色、底层背景图案（如有）、前景 motif 形状和颜色、疏密、面料材质、透光、褶皱、帘头、边缘装饰（绒球/流苏/包边要具体说颜色数量和尺寸）、关键保真细节。描述里必须同时提到底层和前景两层 motif（如果底层是 none 就明说"无底纹"）。' +
  '如果 structure = "double"，fabricDescription 单独描述外层布帘，sheerDescription 单独描述内层纱帘。' +
  '如果是近景、手持样布、局部裁切、非完整挂装图，isCloseUpSample 设为 true。';

const CURTAIN_SUBJECT_REGION_SYSTEM_PROMPT =
  '你是一个窗帘商品图裁切助手。你的任务是只框出图片里最核心的窗帘主体区域，尽量排除人物、模特、家具、墙面装饰、文字、水印、logo、角标、页码和 UI。' +
  '你必须返回严格 JSON，不要输出任何额外解释。';

const CURTAIN_SUBJECT_REGION_USER_PROMPT =
  '请只返回完整窗帘系统的裁切框，目标是让后续模型主要看到整套窗帘本身，而不是原始场景构图。' +
  '返回 JSON：{"x": number, "y": number, "width": number, "height": number}，所有值都是 0-100 的百分比。' +
  '裁切框必须覆盖完整的窗帘系统，包括外层布帘、内层纱帘、帘头、边缘装饰和主要褶皱。绝对不能只框最显眼的一层，也不能只框中间纱帘。请尽量避开文字、logo、人物和家具。';

export async function analyzeScene(sceneImageUrl: string): Promise<SceneAnalysisResult> {
  const result = await getSceneAnalysisProvider().analyzeScene(sceneImageUrl);
  return normalizeSceneAnalysis(result);
}

export async function generateCurtainImage(
  options: GenerateOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult> {
  try {
    const provider = getGenerationProvider();
    onProgress?.(5, '正在分析场景...');

    const sceneAnalysis = normalizeSceneAnalysis(
      options.sceneAnalysisOverride || await analyzeScene(options.sceneImage)
    );
    onProgress?.(15, `检测到 ${sceneAnalysis.windowRegions.length} 个窗户区域`);

    const { prompt, negative_prompt } = buildStructuredPrompt(options, sceneAnalysis, provider.name);
    onProgress?.(25, '正在生成效果图...');

    const result = await provider.generateImage(
      { prompt, negative_prompt },
      options.sceneImage,
      options.curtainReferences
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

export async function generateMultipleSchemes(
  options: GenerateOptions,
  count: number,
  onProgress?: (progress: number, message: string) => void,
  onImageGenerated?: (imageUrl: string, index: number) => void
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];
  const maxAttempts = Math.max(count + 2, count * 2);
  let attempts = 0;

  while (results.filter((result) => result.success && result.imageUrl).length < count && attempts < maxAttempts) {
    const successCount = results.filter((result) => result.success && result.imageUrl).length;
    const attemptIndex = attempts + 1;
    onProgress?.(
      Math.min(95, 10 + Math.round((successCount / Math.max(count, 1)) * 80)),
      `正在生成第 ${successCount + 1}/${count} 个方案（尝试 ${attemptIndex}/${maxAttempts}）...`
    );

    const result = await generateCurtainImage(options, (progress, message) => {
      const normalized = ((successCount + progress / 100) / Math.max(count, 1)) * 100;
      onProgress?.(Math.min(95, 10 + normalized * 0.8), message);
    });

    if (result.success && result.imageUrl) {
      onImageGenerated?.(result.imageUrl, successCount);
    }
    results.push(result);
    attempts += 1;
  }

  const successResults = results.filter((result) => result.success && result.imageUrl);
  onProgress?.(
    100,
    successResults.length >= count
      ? '多方案生成完成'
      : `多方案生成完成，成功 ${successResults.length}/${count} 张`
  );
  return results;
}

/**
 * 构造结构化提示词（支持正向和负向分离）
 */
function buildStructuredPrompt(
  options: GenerateOptions,
  sceneAnalysis: SceneAnalysisResult,
  providerName: string
): { prompt: string; negative_prompt: string } {
  if (providerName === 'gemini') {
    return buildGeminiStructuredPrompt(options, sceneAnalysis);
  }

  return buildArkStructuredPrompt(options, sceneAnalysis);
}

function buildArkStructuredPrompt(
  options: GenerateOptions,
  sceneAnalysis: SceneAnalysisResult
): { prompt: string; negative_prompt: string } {
  const curtainCount = options.curtainReferences.length;
  const finalMode = options.mode === 'auto' ? sceneAnalysis.recommendedMode : options.mode;
  const curtainCoverageGuidance = formatCurtainCoverageHints(sceneAnalysis.windowRegions);
  const structureRequirement = buildCurtainStructureRequirement(
    options.curtainStructure,
    options.curtainReferences,
    sceneAnalysis
  );

  // 1. 核心指令：使用官方文档验证过的"将图1的X替换为图2的X"格式

  let coreInstruction = '';
  if (finalMode === 'replace') {
    // 官方文档示例："将图1的服装换为图2的服装" —— 这是 Seedream 多图融合的正确姿势
    coreInstruction = curtainCount > 1
      ? '将图1中的窗帘全部替换为图2所示的布帘和图3所示的纱帘效果，完全保留图1的房间结构、墙面、地板、家具、灯光不变，只修改窗帘部分。'
      : '将图1中的全部窗帘替换为图2所示的窗帘，完全保留图1的房间结构、墙面、地板、家具、灯光不变，只修改窗帘部分。';
  } else if (finalMode === 'add') {
    coreInstruction = curtainCount > 0
      ? '在图1的窗户上安装图2所示的窗帘，窗帘自然垂挂至落地，完全保留图1的房间结构、墙面、地板、家具、灯光不变。'
      : '在图1的窗户上安装适合该空间风格的窗帘，窗帘自然垂挂至落地，完全保留图1的房间结构、墙面、地板、家具、灯光不变。';
  } else {
    coreInstruction = '将图1中的窗帘替换为图2所示的窗帘，保留图1的房间整体结构和装修风格不变。';
  }

  // 2. 风格补充（柔性，只影响氛围不影响商品颜色）
  const styleNote = options.style
    ? `整体氛围参考"${options.style}"风格，但窗帘的颜色、图案、材质必须严格与图2保持一致，不得因风格偏好改变窗帘本体颜色。`
    : '';

  // 3. 窗帘商品还原要求
  const curtainFidelity = curtainCount > 0
    ? '图2窗帘的颜色、花纹、面料质感、褶皱、垂感必须在输出图中完整还原，严禁因为场景光线或风格偏好而改变窗帘颜色或替换为其他款式。'
    : '';

  // 4. 汇总正向提示词（简洁、直接，避免过多约束导致模型混乱）
  const positivePrompt = [
    coreInstruction,
    curtainCoverageGuidance,
    structureRequirement,
    '双层识别规则：如果窗户中间能看到纱帘，同时左右两侧、顶部或边缘还能看到被收开的布帘，也必须视为完整双层窗帘系统；替换时两层都要一起替掉，不能只替换中间纱帘。',
    finalMode === 'replace'
      ? '替换范围必须覆盖整套旧窗帘的可见区域，而不只是窗洞玻璃部分：包括左右堆帘区、顶部轨道/帘盒下沿、底部垂地或堆地部分。任何旧帘残留都视为失败。'
      : '挂装范围必须覆盖完整安装后的窗帘占位，而不只是窗洞玻璃部分：包括左右堆帘展开后的占位、顶部安装结构和底部自然落地部分。',
    curtainFidelity,
    styleNote,
    '输出图要求：真实的室内摄影质感，8K高清，窗帘褶皱自然饱满，光影真实，与空间融合自然，无任何水印、文字或UI元素。',
  ].filter(Boolean).join('\n');

  // 5. 负向提示词
  const negativePrompt = '两种窗帘, 旧帘保留, 局部旧帘未替换干净, 左右边残留旧帘, 顶部残留旧轨道窗帘, 底部残留旧窗帘, 只保留中间纱帘, 丢失两侧布帘, 双层被误生成单层, 颜色错误, 颜色偏移, 换色, 改变墙面, 改变地板, 改变家具, 家具变形, 构图变化, 水印, logo, 文字, 社交媒体图标, 页码, 低质量, 模糊, 塑料质感, 漂浮布料, 褶皱断裂, multiple curtain styles, wrong curtain color, changed furniture, changed walls.';

  return { prompt: positivePrompt, negative_prompt: negativePrompt };
}

function buildGeminiStructuredPrompt(
  options: GenerateOptions,
  sceneAnalysis: SceneAnalysisResult
): { prompt: string; negative_prompt: string } {
  const curtainCount = options.curtainReferences.length;
  const finalMode = options.mode === 'auto' ? sceneAnalysis.recommendedMode : options.mode;

  const imageOrderLines = [
    '图片顺序说明：',
    '第一张图（the first image）是客户现场空间图，也是最终输出必须保留的底图。',
    curtainCount > 0
      ? `第二张图（the second image）是${describeCurtainReference(options.curtainReferences[0], 0)}。`
      : '如果没有额外参考图，请基于空间风格自行生成适配的窗帘方案。',
    curtainCount > 1
      ? `第三张图（the third image）是${describeCurtainReference(options.curtainReferences[1], 1)}。`
      : '',
  ].filter(Boolean);

  const windowGuidance = sceneAnalysis.windowRegions.length > 0
    ? `窗帘挂装覆盖区参考：第一张图里共检测到 ${sceneAnalysis.windowRegions.length} 个重点区域，替换/新增时请覆盖完整窗帘占位，大致为 ${formatCurtainCoverageHints(sceneAnalysis.windowRegions)}。`
    : '如果窗框存在遮挡，请根据第一张图的真实透视关系推断完整挂装区域。';

  const existingCurtainNote = sceneAnalysis.hasCurtain
    ? '第一张图中的旧窗帘可以完全移除，但不能保留旧帘残影、重复窗帘或双重叠加。'
    : '第一张图中的窗户当前没有旧帘，需要在真实可挂装的位置新增窗帘。';

  let taskInstruction = '';
  if (finalMode === 'replace') {
    taskInstruction = curtainCount > 1
      ? '请编辑第一张图：将原有窗帘完整替换为参考图中的双层窗帘效果，并让布帘与纱帘关系自然、结构准确。'
      : curtainCount > 0
        ? '请编辑第一张图：将原有窗帘完整替换为参考图中的窗帘款式。'
        : '请编辑第一张图：将原有窗帘替换为适合该空间风格的新窗帘。';
  } else {
    taskInstruction = curtainCount > 1
      ? '请编辑第一张图：在窗户区域新增参考图中的双层窗帘效果，保证安装位置合理、垂坠自然。'
      : curtainCount > 0
        ? '请编辑第一张图：在窗户区域新增参考图中的窗帘，保证安装位置合理、垂坠自然。'
        : '请编辑第一张图：在窗户区域新增适合该空间风格的新窗帘。';
  }

  const structureRequirement = buildCurtainStructureRequirement(
    options.curtainStructure,
    options.curtainReferences,
    sceneAnalysis
  );

  const styleReference = options.style
    ? `整体氛围可以参考“${options.style}”，但窗帘本体的颜色、花纹、材质必须优先遵循参考图。`
    : sceneAnalysis.sceneStyle
      ? `空间当前风格接近“${sceneAnalysis.sceneStyle}”，请让新窗帘与该风格自然融合。`
      : '';

  const curtainFidelity = curtainCount > 0
    ? '必须高保真保留参考窗帘的颜色、花纹、面料纹理、透光感、褶皱、厚薄、边缘细节和垂感，不得擅自换色、换材质或改款。'
    : '生成的窗帘应符合真实家装逻辑，比例正确，材质可信。';

  const scenePreservation =
    '除窗帘与必要的挂装结构外，不要改变第一张图中的房间结构、窗户尺寸、相机视角、墙面、地板、天花、家具、摆件、灯光和整体构图。';

  const qualityRequirement =
    '输出为真实室内摄影效果图，比例准确，窗帘与窗户尺度匹配，光影方向一致，阴影自然，不能出现漂浮布料、破碎褶皱、错位安装或不合理遮挡。';
  const curtainCoverageRequirement =
    finalMode === 'replace'
      ? '必须完整替换整套旧窗帘的所有可见部分，不能只替换中间窗洞区域。左右堆帘、顶部帘头、底部垂地/堆地、靠墙侧边残留都必须一并被新窗帘接管。'
      : '新增挂装时要按完整窗帘覆盖区来生成，左右展开宽度、顶部安装位和底部自然落地都要合理覆盖。';
  const doubleLayerCue =
    '双层判断补充：如果画面中心是纱帘，但左右两边或顶部仍能看到收开的厚布帘，也必须按双层窗帘处理；替换时外层布帘和内层纱帘都要完整存在或被完整替换。';

  const positivePrompt = [
    ...imageOrderLines,
    taskInstruction,
    windowGuidance,
    existingCurtainNote,
    structureRequirement,
    doubleLayerCue,
    styleReference,
    curtainFidelity,
    curtainCoverageRequirement,
    scenePreservation,
    qualityRequirement,
  ].filter(Boolean).join('\n');

  const negativePrompt =
    '不要出现两套窗帘同时存在、旧帘残留、只替换中间窗洞未替换左右边帘、顶部或底部旧帘残留、只保留中间纱帘而丢失两侧布帘、把双层误生成单层、窗帘颜色错误、图案错误、材质塑料感、窗户位置错位、墙面或家具被改动、构图变化、水印、logo、文字、社交媒体图标、模糊、低清晰度、拼贴感或非真实摄影效果。';

  return { prompt: positivePrompt, negative_prompt: negativePrompt };
}

/**
 * 构造电商展示提示词
 */
function describeMotifLock(fingerprint: CurtainProductFingerprint | null | undefined): string {
  if (!fingerprint) return '';
  const { motifType, motifDensity, secondaryMotif } = fingerprint;

  const typeLabels: Record<CurtainProductFingerprint['motifType'], string> = {
    'cross-stitch':
      'small cross-stitch / X-shaped embroidery — tiny plus signs, X marks, or 4-arm starlets stitched in colored thread. Must be distinctly recognizable as cross-shaped stitching; NEVER render as round dots, NEVER as diamonds, NEVER as solid circles',
    star:
      'small star-shaped motif (5-point or 6-point star outlines). Not generic dots, not cross-stitches',
    diamond:
      'small diamond / rhombus-shaped motif laid on a regular grid. Must be clearly angular, not round',
    dot:
      'plain round polka dots only. No stitching, no cross arms, no star points — just filled circles',
    damask:
      'tone-on-tone jacquard / damask / woven ornamental vine pattern embedded in the fabric. Low-contrast muted pattern, light desaturated grey-taupe / grey-brown / grey-mauve color, not dark coffee brown, not chocolate brown, not printed green leaves, not fresh botanical illustration, not high-saturation foliage',
    floral:
      'floral print with flowers, petals, or botanical shapes. Preserve the exact color from IMAGE 1; do not turn it into green leaf illustration',
    geometric:
      'geometric repeat (triangles, squares, hexagons, trellis, chevron). Not organic, not floral',
    stripe: 'vertical or horizontal stripes only, no secondary motif',
    abstract: 'abstract watercolor / artistic wash. Not a repeated geometric motif',
    solid: 'no foreground motif',
  };

  const densityLabel: Record<CurtainProductFingerprint['motifDensity'], string> = {
    sparse: 'sparse — large gap between motifs, each motif clearly isolated',
    medium: 'medium — moderate spacing between motifs',
    dense: 'dense — tightly packed repeat, motifs almost touching',
  };

  const secondaryLabels: Record<CurtainProductFingerprint['secondaryMotif'], string> = {
    grid:
      'a thin-line check/grid pattern in muted pale colors (like a pale graph-paper plaid in brown/blue/grey); the grid must be visibly present across the entire fabric as the underlying layer',
    stripe:
      'thin vertical or horizontal pinstripes in muted tones forming the base layer',
    lattice:
      'a diagonal diamond lattice of thin lines across the fabric',
    'background-wash':
      'a subtle watercolor / dye-wash / slub texture across the base fabric',
    none: '',
  };

  if (motifType === 'solid' && secondaryMotif === 'none') {
    return 'CRITICAL MOTIF LOCK: the curtain has a solid-color surface with no printed or embroidered motif. Do not invent any pattern, dots, grid, or embroidery.';
  }

  const lines: string[] = [];
  lines.push('CRITICAL MOTIF LOCK (two-layer analysis, both layers must appear together):');
  if (secondaryMotif !== 'none') {
    lines.push(`- BASE LAYER (background pattern): ${secondaryLabels[secondaryMotif]}. This base layer must be visibly rendered; do not simplify the fabric to a plain solid color.`);
  } else {
    lines.push('- BASE LAYER: plain solid base fabric with no background pattern.');
  }
  if (motifType !== 'solid') {
    lines.push(`- FOREGROUND MOTIF: ${typeLabels[motifType]}. Density: ${densityLabel[motifDensity]}.`);
  } else {
    lines.push('- FOREGROUND MOTIF: none — only the base layer, no additional printed or stitched motif.');
  }
  lines.push(
    'STRICT RULE: reproduce BOTH the base layer and the foreground motif exactly as described. Do NOT drop either layer; do NOT substitute motif shape; do NOT change motif density; do NOT render foreground embroidery as solid dots or diamonds if it is described as cross-stitch. Do NOT turn muted jacquard/damask into green botanical leaf print.'
  );
  const motifLockText = lines.join('\n');
  debugLog('motifLock', motifLockText);
  return motifLockText;
}

function buildShowcaseStructuredPrompt(
  style?: string,
  providerName?: string,
  productDescription?: string,
  referenceFallbackMode = false,
  productFingerprint?: CurtainProductFingerprint | null
): { prompt: string; negative_prompt: string } {
  if (providerName === 'gemini') {
    const styleInstruction = style
      ? `整体视觉氛围可以参考“${style}”，但商品本体必须 100% 服从参考图，不得因为风格化而改动窗帘本身。`
      : '';
    const productSpecInstruction = productDescription
      ? `PRODUCT CHECKLIST FROM REFERENCE IMAGE: ${productDescription}`
      : '';
    const doubleLayerInstruction =
      productFingerprint?.structure === 'double'
        ? `DOUBLE LAYER REQUIREMENT: this product is a double-layer curtain system. You must preserve both layers together. OUTER FABRIC CURTAIN: ${productFingerprint.fabricDescription || '保持外层布帘存在并可见'} INNER SHEER CURTAIN: ${productFingerprint.sheerDescription || '保持内层纱帘存在并可见'}`
        : '';
    const motifLockInstruction = describeMotifLock(productFingerprint);
    const noisyReferenceInstruction = referenceFallbackMode
      ? 'INPUT WARNING: the reference image may contain text overlays, logos, models, room styling, UI, or original composition noise. Treat all of those as irrelevant noise and preserve only the curtain design itself.'
      : '';

    const positivePrompt = [
      'ROLE: You are a professional ecommerce product photographer and set designer.',
      'INPUT RULE: the first reference image is always the primary source of truth for the curtain design.',
      'If additional reference images are provided, they are cleaned detail references of the same SKU and must be used only to reinforce fine details from the original reference, never to replace it.',
      productDescription
        ? 'TEXT RULE: the provided product checklist is only a fidelity checklist extracted from the reference image. If the checklist is incomplete or ambiguous, trust the reference image over the text.'
        : 'TEXT RULE: if no checklist is available, infer conservatively from the reference image and do not invent missing design changes.',
      noisyReferenceInstruction,
      'TASK: create a brand-new ecommerce lifestyle photo featuring the same curtain product in a new environment.',
      'CRITICAL DISTINCTION: preserve the curtain product identity, but do not preserve the original photo composition.',
      'BACKGROUND RULE: the room styling may change, but it must stay visually quiet. Background props must never introduce new patterns, botanical themes, or colors onto the curtain.',
      'If the source material is a close-up sample, in-hand fabric shot, partial hanging shot, or a cropped detail, you must infer how the same curtain would look when fully installed on a real window in a new room. Do not simply reuse the crop.',
      motifLockInstruction,
      productSpecInstruction,
      doubleLayerInstruction,
      'COLOR LOCK: copy the curtain fabric color from IMAGE 1 pixel-for-pixel as much as possible. Do not warm it, darken it, sepia-tone it, or recolor it to match the new room lighting.',
      'LIGHTNESS LOCK: the outer fabric must stay light-to-medium, low-saturation grey-taupe / grey-brown as in IMAGE 1. Keep shadow contrast gentle; the curtain must never become dark chocolate, espresso, black-brown, or heavy dark velvet.',
      'PRESERVE EXACTLY: base fabric color, embroidery/print pattern, pattern spacing, motif scale, motif direction, fabric texture, transparency, pleat rhythm, all visible edge treatments, top heading style, bottom drape, overall material feel.',
      'PATTERN LOCK: never simplify a dense print into sparse embroidery, never replace a floral or botanical motif with a different motif, and never convert opaque woven drapery into translucent sheer unless the reference clearly shows that transparency.',
      'EDGE LOCK: reproduce only the edge decoration that is actually visible in IMAGE 1. If IMAGE 1 does not clearly show pom-poms, tassels, fringe, trim, or border tape, do not invent them.',
      'NO MOTIF CONTAMINATION: ignore plants, chairs, rugs, pillows, wall art, and decor when deciding curtain pattern. Never copy room decor motifs onto the curtain fabric.',
      'IGNORE COMPLETELY: any hand, arm, person, model, mannequin, overlay text, logo, slogan, badge, wall corner, original rod, original window frame, background, crop, sample staging, and camera perspective from the reference photo unless explicitly requested.',
      'CHANGE CONSERVATIVELY: adjust only room, wall, floor, furniture, camera angle, framing, and lighting after the curtain product has been copied. Product fidelity is more important than scene novelty.',
      'SUCCESS CRITERION: the result should feel like a new commercial shoot of the same SKU, not a retouch of the original image.',
      styleInstruction,
      'If any detail is ambiguous, preserve conservatively from the reference instead of inventing a new design.',
      'OUTPUT STYLE: premium ecommerce photography, believable installation, physically correct folds, natural lighting, clean visual hierarchy, product-first composition.',
      'GOOD EXAMPLE: same curtain pattern and trim, but now shown as a full installed curtain in a bright new bedroom with a different camera angle.',
      'BAD EXAMPLE: almost the same wall corner, same hand, same crop, same curtain rod position, same close-up framing, or a newly invented curtain pattern.',
    ].filter(Boolean).join('\n');

    const negativePrompt =
      'Do not change the curtain design, fabric, pattern, edge treatment, material, or color. Do not darken the curtain into dark coffee, espresso, chocolate brown, black-brown, muddy brown, or heavy dark velvet. Do not create green leaf curtains, botanical illustration curtains, tropical foliage prints, olive leaves, monstera leaves, or fresh plant patterns unless IMAGE 1 clearly shows that exact motif. Do not make the curtain brown, taupe, gray, golden, or warm-toned unless IMAGE 1 clearly has that color. Do not invent pom-poms, tassels, fringe, or border tape unless IMAGE 1 clearly shows them. Do not invent a new motif. Do not simplify floral print into faint embroidery. Do not convert printed fabric into voile, lace, gauze, or translucent sheer unless the reference clearly shows that. Do not keep or recreate the same hand, arm, person, mannequin, room corner, rod placement, window frame, crop, camera angle, perspective, or framing from the reference image. Do not output a minor retouch, near-duplicate, collage, watermark, logo, text overlay, price tag, UI element, blurry image, plastic texture, or unrealistic floating fabric.';

    return { prompt: positivePrompt, negative_prompt: negativePrompt };
  }

  const styleInstruction = style
    ? `STYLE REFERENCE: the overall visual mood may reference "${style}", but the curtain itself must 100% follow the reference image and must not be altered for any stylistic preference.`
    : '';
  const productSpecInstruction = productDescription
    ? `PRODUCT CHECKLIST FROM REFERENCE IMAGE: ${productDescription}`
    : '';
  const doubleLayerInstruction =
    productFingerprint?.structure === 'double'
      ? `DOUBLE LAYER REQUIREMENT: this product is a double-layer curtain system. You must preserve both layers together. OUTER FABRIC CURTAIN: ${productFingerprint.fabricDescription || 'keep the outer fabric curtain visible and intact'}. INNER SHEER CURTAIN: ${productFingerprint.sheerDescription || 'keep the inner sheer curtain visible and intact'}.`
      : '';
  const motifLockInstruction = describeMotifLock(productFingerprint);
  const noisyReferenceInstruction = referenceFallbackMode
    ? 'INPUT WARNING: the reference image may contain text overlays, logos, models, room styling, UI, or original composition noise. Treat all of those as irrelevant noise and preserve only the curtain design itself.'
    : '';

  const positivePrompt = [
    'ROLE: You are a professional ecommerce product photographer and set designer.',
    'INPUT RULE: IMAGE 1 is always the primary source of truth for the curtain design.',
    productDescription
      ? 'TEXT RULE: the provided product checklist is only a fidelity checklist extracted from the reference image. If the checklist is incomplete or ambiguous, trust the reference image over the text.'
      : 'TEXT RULE: if no checklist is available, infer conservatively from the reference image and do not invent missing design changes.',
    noisyReferenceInstruction,
    'TASK: create a brand-new ecommerce lifestyle photo featuring the same curtain product in a new environment.',
    'CRITICAL DISTINCTION: preserve the curtain product identity, but do not preserve the original photo composition.',
    'BACKGROUND RULE: the room styling may change, but it must stay visually quiet. Background props must never introduce new patterns, botanical themes, or colors onto the curtain.',
    'If the source material is a close-up sample, in-hand fabric shot, partial hanging shot, or a cropped detail, you must infer how the same curtain would look when fully installed on a real window in a new room. Do not simply reuse the crop.',
    motifLockInstruction,
    productSpecInstruction,
    doubleLayerInstruction,
    'COLOR LOCK: copy the curtain fabric color from IMAGE 1 pixel-for-pixel as much as possible. Do not warm it, darken it, sepia-tone it, or recolor it to match the new room lighting.',
    'LIGHTNESS LOCK: the outer fabric must stay light-to-medium, low-saturation grey-taupe / grey-brown as in IMAGE 1. Keep shadow contrast gentle; the curtain must never become dark chocolate, espresso, black-brown, or heavy dark velvet.',
    'PRESERVE EXACTLY: base fabric color, embroidery/print pattern, pattern spacing, motif scale, motif direction, fabric texture, transparency, pleat rhythm, all visible edge treatments, top heading style, bottom drape, overall material feel.',
    'PATTERN LOCK: never simplify a dense print into sparse embroidery, never replace a floral or botanical motif with a different motif, and never convert opaque woven drapery into translucent sheer unless the reference clearly shows that transparency.',
    'EDGE LOCK: reproduce only the edge decoration that is actually visible in IMAGE 1. If IMAGE 1 does not clearly show pom-poms, tassels, fringe, trim, or border tape, do not invent them.',
    'NO MOTIF CONTAMINATION: ignore plants, chairs, rugs, pillows, wall art, and decor when deciding curtain pattern. Never copy room decor motifs onto the curtain fabric.',
    'IGNORE COMPLETELY: any hand, arm, person, model, mannequin, overlay text, logo, slogan, badge, wall corner, original rod, original window frame, background, crop, sample staging, and camera perspective from the reference photo unless explicitly requested.',
    'CHANGE CONSERVATIVELY: adjust only room, wall, floor, furniture, camera angle, framing, and lighting after the curtain product has been copied. Product fidelity is more important than scene novelty.',
    'SUCCESS CRITERION: the result should feel like a new commercial shoot of the same SKU, not a retouch of the original image.',
    styleInstruction,
    'If any detail is ambiguous, preserve conservatively from the reference instead of inventing a new design.',
    'OUTPUT STYLE: premium ecommerce photography, believable installation, physically correct folds, natural lighting, clean visual hierarchy, product-first composition.',
    'GOOD EXAMPLE: same curtain pattern and trim, but now shown as a full installed curtain in a bright new bedroom with a different camera angle.',
    'BAD EXAMPLE: almost the same wall corner, same hand, same crop, same curtain rod position, same close-up framing, or a newly invented curtain pattern.',
  ].filter(Boolean).join('\n');

  const negativePrompt =
    'Do not change the curtain design, fabric, pattern, edge treatment, material, or color. Do not darken the curtain into dark coffee, espresso, chocolate brown, black-brown, muddy brown, or heavy dark velvet. Do not create green leaf curtains, botanical illustration curtains, tropical foliage prints, olive leaves, monstera leaves, or fresh plant patterns unless IMAGE 1 clearly shows that exact motif. Do not make the curtain brown, taupe, gray, golden, or warm-toned unless IMAGE 1 clearly has that color. Do not invent pom-poms, tassels, fringe, or border tape unless IMAGE 1 clearly shows them. Do not invent a new motif. Do not simplify floral print into faint embroidery. Do not convert printed fabric into voile, lace, gauze, or translucent sheer unless the reference clearly shows that. Do not keep or recreate the same hand, arm, person, mannequin, room corner, rod placement, window frame, crop, camera angle, perspective, or framing from the reference image. Do not output a minor retouch, near-duplicate, collage, watermark, logo, text overlay, price tag, UI element, blurry image, plastic texture, or unrealistic floating fabric.';

  return { prompt: positivePrompt, negative_prompt: negativePrompt };
}

function buildShowcaseReferences(
  providerName: string,
  originalCurtainImage: string,
  sanitizedCurtainReference: string | null,
  referenceFallbackMode: boolean
): CurtainReference[] {
  // 代理网关只能稳定吃一张图：必须优先用完整商品图，避免裁切图误导颜色/层次。
  const references: CurtainReference[] = [
    { url: originalCurtainImage, role: 'generic' },
  ];

  // 注意：Gemini 网关（如 bafang.me / fal）对 body 大小很敏感，双 data URL 会触发 401。
  // 只在 Gemini 官方 API 下才追加原图做补充细节参考。
  const isNativeGemini = isNativeGeminiApiConfigured();
  if (
    providerName === 'gemini' &&
    isNativeGemini &&
    sanitizedCurtainReference &&
    sanitizedCurtainReference !== originalCurtainImage
  ) {
    references.push({ url: originalCurtainImage, role: 'generic' });
  }

  if (referenceFallbackMode && references.length === 0) {
    references.push({ url: originalCurtainImage, role: 'generic' });
  }

  return references;
}

function parseCurtainProductFingerprint(raw: string): CurtainProductFingerprint | null {
  const parsed = JSON.parse(extractJsonFromResponse(raw)) as Partial<CurtainProductFingerprint>;
  if (!parsed.productDescription || typeof parsed.productDescription !== 'string') {
    return null;
  }

  const allowedMotifTypes: CurtainProductFingerprint['motifType'][] = [
    'cross-stitch',
    'star',
    'diamond',
    'dot',
    'damask',
    'floral',
    'geometric',
    'stripe',
    'abstract',
    'solid',
  ];
  const allowedDensities: CurtainProductFingerprint['motifDensity'][] = ['sparse', 'medium', 'dense'];
  const allowedSecondaryMotifs: CurtainProductFingerprint['secondaryMotif'][] = [
    'grid',
    'stripe',
    'lattice',
    'background-wash',
    'none',
  ];
  let motifType = allowedMotifTypes.includes(parsed.motifType as CurtainProductFingerprint['motifType'])
    ? (parsed.motifType as CurtainProductFingerprint['motifType'])
    : 'abstract';
  let motifDensity = allowedDensities.includes(parsed.motifDensity as CurtainProductFingerprint['motifDensity'])
    ? (parsed.motifDensity as CurtainProductFingerprint['motifDensity'])
    : 'medium';
  const secondaryMotif = allowedSecondaryMotifs.includes(
    parsed.secondaryMotif as CurtainProductFingerprint['secondaryMotif']
  )
    ? (parsed.secondaryMotif as CurtainProductFingerprint['secondaryMotif'])
    : 'none';
  const descriptionText = [
    parsed.productDescription,
    parsed.fabricDescription,
    parsed.sheerDescription,
  ].filter(Boolean).join(' ');
  const looksLikeToneOnToneJacquard = [
    '提花',
    '暗纹',
    '织锦',
    '同色',
    '主色较为接近',
    '颜色与布帘主色较为接近',
    '绒质',
    '绒感',
    '低对比',
  ].some((signal) => descriptionText.includes(signal));
  if (motifType === 'floral' && looksLikeToneOnToneJacquard) {
    motifType = 'damask';
    motifDensity = motifDensity === 'sparse' ? 'medium' : motifDensity;
  }
  const productDescription = normalizeShowcaseColorDescription(parsed.productDescription.trim(), motifType);
  const fabricDescription = typeof parsed.fabricDescription === 'string'
    ? normalizeShowcaseColorDescription(parsed.fabricDescription.trim(), motifType)
    : undefined;
  const sheerDescription = typeof parsed.sheerDescription === 'string'
    ? parsed.sheerDescription.trim()
    : undefined;

  return {
    isCloseUpSample: Boolean(parsed.isCloseUpSample),
    structure: parsed.structure === 'double' ? 'double' : 'single',
    productDescription,
    fabricDescription,
    sheerDescription,
    motifType,
    motifDensity,
    secondaryMotif,
  };
}

function normalizeShowcaseColorDescription(
  description: string,
  motifType: CurtainProductFingerprint['motifType']
): string {
  if (motifType !== 'damask') {
    return description;
  }

  const normalized = description
    .replaceAll('深棕色', '浅灰褐色')
    .replaceAll('深咖色', '浅灰褐色')
    .replaceAll('咖啡色', '浅灰褐色')
    .replaceAll('棕色', '浅灰褐色')
    .replaceAll('浅棕色', '浅灰褐色');

  return `${normalized} 颜色锁定：外层布帘必须是低饱和浅灰褐/浅灰棕/灰紫褐调，亮度接近参考图，不能变成深咖啡、巧克力棕、黑褐或高对比深色。`;
}

function parseCurtainSubjectRegion(raw: string): CurtainSubjectRegion | null {
  const parsed = JSON.parse(extractJsonFromResponse(raw)) as Partial<CurtainSubjectRegion>;
  if (
    typeof parsed.x !== 'number' ||
    typeof parsed.y !== 'number' ||
    typeof parsed.width !== 'number' ||
    typeof parsed.height !== 'number'
  ) {
    return null;
  }

  return {
    x: clampPercent(parsed.x),
    y: clampPercent(parsed.y),
    width: clampPercent(parsed.width),
    height: clampPercent(parsed.height),
  };
}

function expandCurtainSubjectRegion(region: CurtainSubjectRegion): CurtainSubjectRegion {
  const horizontalPadding = Math.max(region.width * 0.12, 4);
  const topPadding = Math.max(region.height * 0.06, 3);
  const bottomPadding = Math.max(region.height * 0.08, 4);
  const x = clampPercent(region.x - horizontalPadding);
  const y = clampPercent(region.y - topPadding);
  const right = clampPercent(region.x + region.width + horizontalPadding);
  const bottom = clampPercent(region.y + region.height + bottomPadding);

  return {
    x,
    y,
    width: clampPercent(right - x),
    height: clampPercent(bottom - y),
  };
}

async function describeCurtainProductWithArk(
  curtainImage: string
): Promise<CurtainProductFingerprint | null> {
  const apiKey = process.env.ARK_API_KEY;
  const modelId = process.env.ARK_VISION_MODEL_ID || 'ep-20260417144640-6dczg';
  const arkBase = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!apiKey) {
    return null;
  }

  const finalImageUrl = await resolveImageInput(curtainImage);
  const response = await fetch(`${arkBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: CURTAIN_FINGERPRINT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: finalImageUrl } },
            { type: 'text', text: CURTAIN_FINGERPRINT_USER_PROMPT },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    return null;
  }

  return parseCurtainProductFingerprint(content);
}

async function detectCurtainSubjectRegionWithArk(
  curtainImage: string
): Promise<CurtainSubjectRegion | null> {
  const apiKey = process.env.ARK_API_KEY;
  const modelId = process.env.ARK_VISION_MODEL_ID || 'ep-20260417144640-6dczg';
  const arkBase = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!apiKey) {
    return null;
  }

  const finalImageUrl = await resolveImageInput(curtainImage);
  const response = await fetch(`${arkBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: CURTAIN_SUBJECT_REGION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: finalImageUrl } },
            { type: 'text', text: CURTAIN_SUBJECT_REGION_USER_PROMPT },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    return null;
  }

  return parseCurtainSubjectRegion(content);
}

async function detectCurtainSubjectRegionWithGeminiNative(
  curtainImage: string
): Promise<CurtainSubjectRegion | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const geminiBase = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

  if (!apiKey || !geminiBase.includes('generativelanguage.googleapis.com')) {
    return null;
  }

  const inlineData = await toInlineData(curtainImage);
  const response = await fetch(
    `${geminiBase}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CURTAIN_SUBJECT_REGION_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData },
              { text: CURTAIN_SUBJECT_REGION_USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) {
    return null;
  }

  return parseCurtainSubjectRegion(text);
}

async function createSanitizedCurtainReference(
  curtainImage: string
): Promise<string | null> {
  const detectedRegion =
    (await detectCurtainSubjectRegionWithArk(curtainImage)) ||
    (await detectCurtainSubjectRegionWithGeminiNative(curtainImage));

  if (!detectedRegion) {
    return null;
  }

  const region = expandCurtainSubjectRegion(detectedRegion);

  const imageBuffer = await loadImageBuffer(curtainImage);
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const { randomUUID } = await import('crypto');
  const { execFile } = await import('child_process');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'curtain-subject-'));
  const inputPath = path.join(tempDir, `${randomUUID()}.png`);

  try {
    await fs.writeFile(inputPath, imageBuffer);

    const pythonScript = `
import base64
import io
import json
import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert("RGB")
w, h = img.size
region = json.loads(sys.argv[2])

x = max(0, min(w - 1, int(w * region["x"] / 100.0)))
y = max(0, min(h - 1, int(h * region["y"] / 100.0)))
crop_w = max(1, int(w * region["width"] / 100.0))
crop_h = max(1, int(h * region["height"] / 100.0))
right = min(w, x + crop_w)
bottom = min(h, y + crop_h)

cropped = img.crop((x, y, right, bottom))
buf = io.BytesIO()
cropped.save(buf, format="PNG")
print("data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8"))
`;

    const croppedDataUrl = await new Promise<string>((resolve, reject) => {
      execFile(
        'python3',
        ['-c', pythonScript, inputPath, JSON.stringify(region)],
        { maxBuffer: 20 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        }
      );
    });

    return croppedDataUrl.startsWith('data:image/') ? croppedDataUrl : null;
  } catch (error) {
    console.warn('裁切净化后的窗帘参考图失败:', error);
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function createCompressedCurtainReference(
  curtainImage: string
): Promise<string | null> {
  const imageBuffer = await loadImageBuffer(curtainImage);
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const { randomUUID } = await import('crypto');
  const { execFile } = await import('child_process');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'curtain-full-'));
  const inputPath = path.join(tempDir, `${randomUUID()}.png`);

  try {
    await fs.writeFile(inputPath, imageBuffer);

    const pythonScript = `
import base64
import io
import sys
from PIL import Image, ImageOps

img = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")
max_side = 1200
w, h = img.size
scale = min(1.0, max_side / float(max(w, h)))
if scale < 1.0:
    img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)

buf = io.BytesIO()
img.save(buf, format="JPEG", quality=88, optimize=True, progressive=True)
print("data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8"))
`;

    const compressedDataUrl = await new Promise<string>((resolve, reject) => {
      execFile(
        'python3',
        ['-c', pythonScript, inputPath],
        { maxBuffer: 20 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        }
      );
    });

    return compressedDataUrl.startsWith('data:image/jpeg') ? compressedDataUrl : null;
  } catch (error) {
    console.warn('压缩完整窗帘参考图失败:', error);
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function describeCurtainProductWithGeminiNative(
  curtainImage: string
): Promise<CurtainProductFingerprint | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const geminiBase = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

  if (!apiKey || !geminiBase.includes('generativelanguage.googleapis.com')) {
    return null;
  }

  const inlineData = await toInlineData(curtainImage);
  const response = await fetch(
    `${geminiBase}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CURTAIN_FINGERPRINT_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData },
              { text: CURTAIN_FINGERPRINT_USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) {
    return null;
  }

  return parseCurtainProductFingerprint(text);
}

async function describeCurtainProductForShowcase(
  curtainImage: string
): Promise<CurtainProductFingerprint | null> {
  try {
    const arkFingerprint = await describeCurtainProductWithArk(curtainImage);
    if (arkFingerprint?.productDescription) {
      debugLog('fingerprint ark', arkFingerprint);
      return arkFingerprint;
    }

    const geminiFingerprint = await describeCurtainProductWithGeminiNative(curtainImage);
    if (geminiFingerprint?.productDescription) {
      debugLog('fingerprint gemini', geminiFingerprint);
      return geminiFingerprint;
    }

    const response = await llmClient.invoke(
      [
        {
          role: 'system',
          content: CURTAIN_FINGERPRINT_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: curtainImage,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: CURTAIN_FINGERPRINT_USER_PROMPT,
            },
          ],
        },
      ],
      {
        temperature: 0.1,
        streaming: false,
      }
    );

    const fallbackFingerprint = parseCurtainProductFingerprint(response.content);
    if (fallbackFingerprint) {
      debugLog('fingerprint coze-fallback', fallbackFingerprint);
    } else {
      debugLog('fingerprint coze-fallback', `parse failed, raw: ${response.content}`);
    }
    return fallbackFingerprint;
  } catch (error) {
    console.warn('提取窗帘商品指纹失败:', error);
    return null;
  }
}

function buildShowcaseNoUiDirective(): string {
  return [
    'HARD OUTPUT RULE: output one single clean standalone photograph only.',
    'ABSOLUTELY FORBIDDEN: LIVE badge, page counter such as 1/3 or 1/2, left/right arrows, pagination dots, collage layout, screenshot frame, app chrome, social media overlay, price tag, shopping cart icon, logo, watermark, subtitle, sticker, or any platform UI.',
    'The final image must look like an original camera photo, not a screenshot, not a livestream cover, not a carousel cover, and not a social media post.',
  ].join('\n');
}

async function detectShowcaseArtifactsWithArk(imageUrl: string): Promise<ShowcaseArtifactCheckResult | null> {
  const apiKey = process.env.ARK_API_KEY;
  const modelId = process.env.ARK_VISION_MODEL_ID || 'ep-20260417144640-6dczg';
  const arkBase = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!apiKey) {
    return null;
  }

  const finalImageUrl = await resolveImageInput(imageUrl);
  const response = await fetch(`${arkBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: SHOWCASE_ARTIFACT_CHECK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: finalImageUrl } },
            { type: 'text', text: SHOWCASE_ARTIFACT_CHECK_USER_PROMPT },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    return null;
  }

  const parsed = JSON.parse(extractJsonFromResponse(content)) as Partial<ShowcaseArtifactCheckResult>;
  return {
    hasForbiddenArtifacts: Boolean(parsed.hasForbiddenArtifacts),
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

async function detectShowcaseArtifactsWithGemini(imageUrl: string): Promise<ShowcaseArtifactCheckResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const geminiBase = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

  if (!apiKey || !geminiBase.includes('generativelanguage.googleapis.com')) {
    return null;
  }

  const inlineData = await toInlineData(imageUrl);
  const response = await fetch(
    `${geminiBase}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SHOWCASE_ARTIFACT_CHECK_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData },
              { text: SHOWCASE_ARTIFACT_CHECK_USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) {
    return null;
  }

  const parsed = JSON.parse(extractJsonFromResponse(text)) as Partial<ShowcaseArtifactCheckResult>;
  return {
    hasForbiddenArtifacts: Boolean(parsed.hasForbiddenArtifacts),
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function buildShowcaseAngleCheckPrompt(angle: ShowcaseAngle): string {
  switch (angle) {
    case 'detail':
      return [
        '请判断这张图是否符合"材质细节图"的要求。',
        '合格标准：窗帘主体必须占画面大部分面积，最好超过 60%。',
        '合格标准：重点能看清面料纹理、织法、印花/提花、包边、流苏、绒球边或褶皱细节。',
        '不合格情况：整屋远景、完整床/沙发/地毯占很大面积、窗帘只是背景、主要在展示房间而不是展示窗帘细节。',
        '请返回 JSON：{"matchesAngle": boolean, "evidence": string[]}。如果不合格，evidence 只写具体问题关键词。',
      ].join('');
    case 'hero':
      return [
        '请判断这张图是否符合"远景整屋展示图"的要求。',
        '合格标准：画面中能看到完整的窗帘挂装效果，从帘头到垂地底部；窗帘周围有可辨识的房间环境（地面、墙面、部分家具），形成比例参考。',
        '不合格情况：镜头过近只拍到窗帘局部、只拍到窗户不见房间环境、窗帘被严重裁切、整屋虚焦看不清窗帘位置。',
        '请返回 JSON：{"matchesAngle": boolean, "evidence": string[]}。evidence 只写具体问题关键词，比如"窗帘被裁切"、"看不到地面"、"缺乏环境参考"。',
      ].join('');
    case 'lifestyle':
      return [
        '请判断这张图是否符合"中近景生活场景图"的要求。',
        '合格标准：画面既能看清窗帘局部（褶皱、垂感、边缘装饰），又能带出一部分空间氛围（窗边一角、家具局部、装饰物）；景别介于特写和整屋之间。',
        '不合格情况：纯微距特写看不到任何环境、整屋远景窗帘只占很小比例、只有窗帘纯色背景缺乏场景感。',
        '请返回 JSON：{"matchesAngle": boolean, "evidence": string[]}。evidence 只写具体问题关键词。',
      ].join('');
    case 'layered':
      return [
        '请判断这张图是否符合"遮光/透光效果展示图"的要求。',
        '合格标准：画面明确呈现透光或遮光的光影对比——要么强光从窗帘透入形成光束/透光梯度，要么室内明显比室外暗体现遮光效果，要么双层中纱帘和布帘的透光差异可见。',
        '不合格情况：光线平淡看不出遮光/透光差异、只是普通室内照不强调光学效果、窗帘透光与否无法从图中判断。',
        '请返回 JSON：{"matchesAngle": boolean, "evidence": string[]}。evidence 只写具体问题关键词。',
      ].join('');
    default:
      return '请判断这张图是否符合指定展示角度。返回 JSON：{"matchesAngle": boolean, "evidence": string[]}。';
  }
}

async function detectShowcaseAngleWithArk(
  imageUrl: string,
  angle: ShowcaseAngle
): Promise<ShowcaseAngleCheckResult | null> {
  const apiKey = process.env.ARK_API_KEY;
  const modelId = process.env.ARK_VISION_MODEL_ID || 'ep-20260417144640-6dczg';
  const arkBase = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!apiKey) {
    return null;
  }

  const finalImageUrl = await resolveImageInput(imageUrl);
  const response = await fetch(`${arkBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: SHOWCASE_ANGLE_CHECK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: finalImageUrl } },
            { type: 'text', text: buildShowcaseAngleCheckPrompt(angle) },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    return null;
  }

  const parsed = JSON.parse(extractJsonFromResponse(content)) as Partial<ShowcaseAngleCheckResult>;
  return {
    matchesAngle: Boolean(parsed.matchesAngle),
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

async function detectShowcaseAngleWithGemini(
  imageUrl: string,
  angle: ShowcaseAngle
): Promise<ShowcaseAngleCheckResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const geminiBase = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

  if (!apiKey || !geminiBase.includes('generativelanguage.googleapis.com')) {
    return null;
  }

  const inlineData = await toInlineData(imageUrl);
  const response = await fetch(
    `${geminiBase}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SHOWCASE_ANGLE_CHECK_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData },
              { text: buildShowcaseAngleCheckPrompt(angle) },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) {
    return null;
  }

  const parsed = JSON.parse(extractJsonFromResponse(text)) as Partial<ShowcaseAngleCheckResult>;
  return {
    matchesAngle: Boolean(parsed.matchesAngle),
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function mergeArtifactChecks(
  checks: Array<ShowcaseArtifactCheckResult | null>,
  labels?: string[]
): ShowcaseArtifactCheckResult | null {
  const evidences = new Set<string>();
  let hasForbiddenArtifacts = false;

  checks.forEach((check, index) => {
    if (!check) {
      return;
    }

    if (check.hasForbiddenArtifacts) {
      hasForbiddenArtifacts = true;
      const label = labels?.[index];
      check.evidence.forEach((item) => {
        evidences.add(label ? `${label}:${item}` : item);
      });
    }
  });

  if (!hasForbiddenArtifacts) {
    return null;
  }

  return {
    hasForbiddenArtifacts: true,
    evidence: Array.from(evidences),
  };
}

async function loadImageBuffer(imageUrl: string): Promise<Buffer> {
  const resolved = await resolveImageInput(imageUrl);
  const dataUrlMatch = resolved.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return Buffer.from(dataUrlMatch[2], 'base64');
  }

  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`下载待检测图片失败: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function createShowcaseArtifactCrops(imageUrl: string): Promise<ShowcaseArtifactCrop[]> {
  const imageBuffer = await loadImageBuffer(imageUrl);
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const { randomUUID } = await import('crypto');
  const { execFile } = await import('child_process');

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'showcase-artifact-'));
  const inputPath = path.join(tempDir, `${randomUUID()}.png`);

  try {
    await fs.writeFile(inputPath, imageBuffer);

    const pythonScript = `
import base64
import io
import json
import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert("RGB")
w, h = img.size

def box(x1, y1, x2, y2):
    return (
        max(0, min(w, int(w * x1))),
        max(0, min(h, int(h * y1))),
        max(1, min(w, int(w * x2))),
        max(1, min(h, int(h * y2))),
    )

regions = {
    "top_left": box(0.00, 0.00, 0.26, 0.18),
    "top_middle": box(0.35, 0.00, 0.65, 0.18),
    "top_right": box(0.74, 0.00, 1.00, 0.18),
    "left_middle": box(0.00, 0.34, 0.18, 0.68),
    "right_middle": box(0.82, 0.34, 1.00, 0.68),
    "bottom_center": box(0.35, 0.82, 0.65, 1.00),
}

result = {}
for name, region in regions.items():
    crop = img.crop(region)
    buf = io.BytesIO()
    crop.save(buf, format="PNG")
    result[name] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

print(json.dumps(result))
`;

    const cropJson = await new Promise<string>((resolve, reject) => {
      execFile('python3', ['-c', pythonScript, inputPath], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      });
    });

    const parsed = JSON.parse(cropJson) as Record<string, string>;
    return Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].startsWith('data:image/'))
      .map(([label, cropImageUrl]) => ({ label, imageUrl: cropImageUrl }));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function detectShowcaseArtifacts(imageUrl: string): Promise<ShowcaseArtifactCheckResult | null> {
  try {
    const sceneProvider = getSceneAnalysisProvider();
    const detectSingle = async (targetImageUrl: string): Promise<ShowcaseArtifactCheckResult | null> => {
      if (sceneProvider.name === 'gemini') {
        return detectShowcaseArtifactsWithGemini(targetImageUrl);
      }

      return detectShowcaseArtifactsWithArk(targetImageUrl);
    };

    const fullCheck = await detectSingle(imageUrl);
    const crops = await createShowcaseArtifactCrops(imageUrl);
    const cropChecks: Array<ShowcaseArtifactCheckResult | null> = [];
    for (const crop of crops) {
      cropChecks.push(await detectSingle(crop.imageUrl));
    }

    return mergeArtifactChecks(
      [fullCheck, ...cropChecks],
      ['full', ...crops.map((crop) => crop.label)]
    );
  } catch (error) {
    console.warn('电商图 UI 痕迹检测失败，跳过自动重试:', error);
    return null;
  }
}

async function detectShowcaseAngleMismatch(
  imageUrl: string,
  angle: ShowcaseAngle
): Promise<ShowcaseAngleCheckResult | null> {
  try {
    const sceneProvider = getSceneAnalysisProvider();
    if (sceneProvider.name === 'gemini') {
      return detectShowcaseAngleWithGemini(imageUrl, angle);
    }

    return detectShowcaseAngleWithArk(imageUrl, angle);
  } catch (error) {
    console.warn('电商图角度质检失败，跳过自动重试:', error);
    return null;
  }
}

function normalizeArtifactEvidence(evidence: string[]): string[] {
  return evidence
    .map((item) => item.trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
}

function buildArtifactRetryPrompt(baseAnglePrompt: string, evidence: string[]): string {
  return [
    baseAnglePrompt,
    `RETRY REQUIREMENT: the previous attempt contained forbidden overlay artifacts: ${normalizeArtifactEvidence(evidence).join(', ') || 'UI overlay'}.`,
    'Regenerate from scratch as a clean photograph with zero overlay artifacts.',
    'Pay extra attention to the top-left, top-right, right-middle, and bottom-center areas. Those areas must contain no overlay badges, counters, arrows, or dots.',
  ].join('\n');
}

function labelShowcaseAngle(angle: ShowcaseAngle): string {
  switch (angle) {
    case 'hero':
      return '远景展示';
    case 'lifestyle':
      return '中近景展示';
    case 'detail':
      return '材质细节';
    case 'layered':
      return '遮光效果';
    default:
      return angle;
  }
}

function buildFailedAngleRetryPrompt(baseAnglePrompt: string, angle: ShowcaseAngle): string {
  return [
    baseAnglePrompt,
    `RETRY REQUIREMENT: regenerate the ${labelShowcaseAngle(angle)} image from scratch.`,
    'The curtain style must stay the same, but the background styling must be new and intentionally different from the reference image.',
    'Do not output a near-duplicate. Use a fresh composition, fresh decor, and a fresh photographic setup.',
  ].join('\n');
}

function buildAngleMismatchRetryPrompt(
  baseAnglePrompt: string,
  angle: ShowcaseAngle,
  evidence: string[]
): string {
  const evidenceText = normalizeArtifactEvidence(evidence).join(', ');

  if (angle === 'detail') {
    return [
      baseAnglePrompt,
      `RETRY REQUIREMENT: the previous result failed the ${labelShowcaseAngle(angle)} framing check: ${evidenceText || 'too wide'}.`,
      'Regenerate as a true close-up detail photograph.',
      'The curtain fabric, print, trim, weave, folds, and material texture must dominate the frame.',
      'Curtain subject should fill most of the image. Avoid full-room composition, avoid wide bed or sofa view, avoid distant whole-window shot.',
    ].join('\n');
  }

  if (angle === 'hero') {
    return [
      baseAnglePrompt,
      `RETRY REQUIREMENT: the previous result failed the ${labelShowcaseAngle(angle)} framing check: ${evidenceText || 'framing too tight or missing environment'}.`,
      'Regenerate as a true wide establishing shot of the curtain fully installed on the window.',
      'Show the complete curtain from the top heading down to where it meets the floor, with visible floor, wall, and at least one recognizable furniture element nearby to give a sense of scale.',
      'Do not crop the curtain. Do not output a close-up. Do not hide the environment behind heavy blur.',
    ].join('\n');
  }

  if (angle === 'lifestyle') {
    return [
      baseAnglePrompt,
      `RETRY REQUIREMENT: the previous result failed the ${labelShowcaseAngle(angle)} framing check: ${evidenceText || 'framing too tight or too wide'}.`,
      'Regenerate as a medium three-quarter lifestyle shot that balances curtain detail with a sense of place.',
      'The curtain fold, drape, and edge trim must be clearly visible, while the surrounding room corner, a piece of furniture, or a decorative prop gives context.',
      'Do not output a pure macro close-up. Do not output a wide full-room shot with the curtain shrunk to a tiny element.',
    ].join('\n');
  }

  if (angle === 'layered') {
    return [
      baseAnglePrompt,
      `RETRY REQUIREMENT: the previous result failed the ${labelShowcaseAngle(angle)} light check: ${evidenceText || 'no visible light contrast'}.`,
      'Regenerate with a clear optical story: either strong backlight streaming through a sheer layer, or a distinct blackout contrast where the interior is visibly darker than the exterior, or a visible brightness gradient between inner sheer and outer fabric layers.',
      'The transparency or opacity of the curtain must be unambiguous in the final image.',
    ].join('\n');
  }

  return [
    baseAnglePrompt,
    `RETRY REQUIREMENT: the previous result did not match the requested ${labelShowcaseAngle(angle)} angle.`,
  ].join('\n');
}

async function rerunFailedShowcaseAngle(
  provider: ReturnType<typeof getShowcaseGenerationProvider>,
  currentAngle: ShowcaseAngle,
  result: GenerationResult,
  baseAnglePrompt: string,
  baseNegativePrompt: string,
  showcaseReferences: CurtainReference[]
): Promise<GenerationResult> {
  if (result.success) {
    return result;
  }

  return provider.generateImage(
    {
      prompt: buildFailedAngleRetryPrompt(baseAnglePrompt, currentAngle),
      negative_prompt: `${baseNegativePrompt} Reject any result that looks like the same room, the same staging, or the same crop as the reference image.`,
      aspect_ratio: getShowcaseAspectRatio(currentAngle),
    },
    '',
    showcaseReferences
  );
}

function normalizeFidelityScores(raw: string): ShowcaseFidelityCheckResult {
  const parsed = JSON.parse(extractJsonFromResponse(raw)) as {
    scores?: Partial<ShowcaseFidelityCheckResult['scores']>;
    evidence?: unknown;
  };
  const rawScores = parsed.scores || {};
  const clampScore = (v: unknown): number => {
    const num = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(5, num));
  };
  const scores: ShowcaseFidelityCheckResult['scores'] = {
    color: clampScore(rawScores.color),
    motif: clampScore(rawScores.motif),
    material: clampScore(rawScores.material),
    layer: clampScore(rawScores.layer),
    trim: clampScore(rawScores.trim),
  };

  // motif 严格阈值 4，其余维度阈值 3
  const motifOk = scores.motif >= 4;
  const othersOk =
    scores.color >= 3 && scores.material >= 3 && scores.layer >= 3 && scores.trim >= 3;
  const matchesProduct = motifOk && othersOk;

  const userEvidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.filter((item): item is string => typeof item === 'string')
    : [];
  // 自动补充低分项作为重试 evidence
  const lowScoreLabels: string[] = [];
  if (scores.motif < 4) lowScoreLabels.push(`motif=${scores.motif}/5（花型偏离）`);
  if (scores.color < 3) lowScoreLabels.push(`color=${scores.color}/5（底色偏离）`);
  if (scores.material < 3) lowScoreLabels.push(`material=${scores.material}/5（材质偏离）`);
  if (scores.layer < 3) lowScoreLabels.push(`layer=${scores.layer}/5（层数偏离）`);
  if (scores.trim < 3) lowScoreLabels.push(`trim=${scores.trim}/5（边饰偏离）`);

  return {
    matchesProduct,
    scores,
    evidence: [...userEvidence, ...lowScoreLabels],
  };
}

async function detectShowcaseFidelityWithArk(
  referenceImageUrl: string,
  generatedImageUrl: string
): Promise<ShowcaseFidelityCheckResult | null> {
  const apiKey = process.env.ARK_API_KEY;
  const modelId = process.env.ARK_VISION_MODEL_ID || 'ep-20260417144640-6dczg';
  const arkBase = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!apiKey) {
    return null;
  }

  const [referenceResolved, generatedResolved] = await Promise.all([
    resolveImageInput(referenceImageUrl),
    resolveImageInput(generatedImageUrl),
  ]);

  const response = await fetch(`${arkBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: SHOWCASE_FIDELITY_CHECK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: referenceResolved } },
            { type: 'image_url', image_url: { url: generatedResolved } },
            { type: 'text', text: SHOWCASE_FIDELITY_CHECK_USER_PROMPT },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    return null;
  }

  return normalizeFidelityScores(content);
}

async function detectShowcaseFidelityWithGemini(
  referenceImageUrl: string,
  generatedImageUrl: string
): Promise<ShowcaseFidelityCheckResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const geminiBase = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

  if (!apiKey || !geminiBase.includes('generativelanguage.googleapis.com')) {
    return null;
  }

  const [referenceInline, generatedInline] = await Promise.all([
    toInlineData(referenceImageUrl),
    toInlineData(generatedImageUrl),
  ]);

  const response = await fetch(
    `${geminiBase}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SHOWCASE_FIDELITY_CHECK_SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: referenceInline },
              { inlineData: generatedInline },
              { text: SHOWCASE_FIDELITY_CHECK_USER_PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) {
    return null;
  }

  return normalizeFidelityScores(text);
}

async function detectShowcaseFidelityMismatch(
  referenceImageUrl: string,
  generatedImageUrl: string
): Promise<ShowcaseFidelityCheckResult | null> {
  try {
    const sceneProvider = getSceneAnalysisProvider();
    if (sceneProvider.name === 'gemini') {
      return detectShowcaseFidelityWithGemini(referenceImageUrl, generatedImageUrl);
    }

    return detectShowcaseFidelityWithArk(referenceImageUrl, generatedImageUrl);
  } catch (error) {
    console.warn('商品保真度质检失败，跳过自动重试:', error);
    return null;
  }
}

function buildFidelityRetryPrompt(baseAnglePrompt: string, evidence: string[]): string {
  return [
    baseAnglePrompt,
    `RETRY REQUIREMENT: the previous attempt deviated from the reference curtain product: ${normalizeArtifactEvidence(evidence).join(', ') || 'product fidelity mismatch'}.`,
    'Regenerate from scratch with stronger fidelity to IMAGE 1. Reproduce the exact curtain color, print/pattern, motif density, material texture, transparency, edge trim, and layer structure.',
    'Do not invent a new motif, do not simplify the print, and do not convert the fabric opacity. The curtain product must be immediately recognizable as the same SKU.',
  ].join('\n');
}

function isTransientTimeoutError(error: string | undefined): boolean {
  if (!error) return false;
  const signals = [
    '408',
    'timeout',
    'Timeout',
    'timed out',
    'Gateway timeout',
    'gateway_timeout',
    'upstream error',
    'do request failed',
    'poll failed',
  ];
  return signals.some((signal) => error.includes(signal));
}

function isRateLimitError(error: string | undefined): boolean {
  if (!error) return false;
  const signals = [
    '429',
    'rate limit',
    'rate_limit',
    'Rate limit',
    'quota exceeded',
    'too many requests',
    'Too Many Requests',
    'RATE_LIMIT_EXCEEDED',
  ];
  return signals.some((signal) => error.includes(signal));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRunShowcaseQualityChecks(): boolean {
  return getShowcaseQualityMode() !== 'off';
}

function getShowcaseQualityMode(): 'off' | 'fidelity' | 'full' {
  const mode = (process.env.SHOWCASE_QUALITY_MODE || '').toLowerCase().trim();
  if (mode === 'off' || mode === 'false' || process.env.SHOWCASE_QUALITY_CHECKS === 'false') {
    return 'off';
  }
  if (mode === 'full' || process.env.SHOWCASE_QUALITY_CHECKS === 'true') {
    return 'full';
  }
  return 'fidelity';
}

function shouldSanitizeShowcaseReference(): boolean {
  return process.env.SHOWCASE_SANITIZE_REFERENCE !== 'false';
}

function isNativeGeminiApiConfigured(): boolean {
  return (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com').includes(
    'generativelanguage.googleapis.com'
  );
}

function shouldUseShowcaseTextChecklist(providerName: string): boolean {
  const override = process.env.SHOWCASE_USE_TEXT_CHECKLIST?.toLowerCase().trim();
  if (override === 'true') {
    return true;
  }
  if (override === 'false') {
    return false;
  }

  // 仅靠 bafang 的 image reference 容易漂移；保留一份更具体的商品 checklist 来锁花型/边饰。
  return true;
}

function shouldCreateSanitizedShowcaseReference(providerName: string): boolean {
  return shouldSanitizeShowcaseReference() && providerName === 'gemini' && isNativeGeminiApiConfigured();
}

interface ShowcaseSingleAngleContext {
  provider: ReturnType<typeof getShowcaseGenerationProvider>;
  angle: ShowcaseAngle;
  referenceImageUrl: string;
  baseAnglePrompt: string;
  baseNegativePrompt: string;
  showcaseReferences: CurtainReference[];
  onImageGenerated?: (imageUrl: string, angle: ShowcaseAngle) => void;
  onProgress?: (progress: number, message: string) => void;
  progressBaseline: number;
}

async function generateShowcaseSingleAngle(
  ctx: ShowcaseSingleAngleContext
): Promise<GenerationResult> {
  const {
    provider,
    angle,
    referenceImageUrl,
    baseAnglePrompt,
    baseNegativePrompt,
    showcaseReferences,
    onImageGenerated,
    onProgress,
    progressBaseline,
  } = ctx;

  let result = await provider.generateImage(
    {
      prompt: baseAnglePrompt,
      negative_prompt: baseNegativePrompt,
      aspect_ratio: getShowcaseAspectRatio(angle),
    },
    '',
    showcaseReferences
  );

  // 初版预览：生成成功立刻推给前端先看着
  if (result.success && result.imageUrl) {
    onImageGenerated?.(result.imageUrl, angle);
  }

  // 超时类错误直接止损
  if (!result.success && isTransientTimeoutError(result.error)) {
    return {
      ...result,
      error: `${labelShowcaseAngle(angle)}生成失败（上游模型超时），建议稍后单独重试`,
    };
  }

  // 限流错误直接止损（并发时常见）
  if (!result.success && isRateLimitError(result.error)) {
    return {
      ...result,
      error: `${labelShowcaseAngle(angle)}生成失败（并发被限流），建议稍后单独重试`,
    };
  }

  // 生成成功 → 3 项 VLM 质检并发 + 最多一次重试
  if (result.success && result.imageUrl) {
    if (!shouldRunShowcaseQualityChecks()) {
      return result;
    }

    onProgress?.(progressBaseline + 1, `${labelShowcaseAngle(angle)}质检中...`);

    let qualityOutcome = await runShowcaseQualityChecks(
      referenceImageUrl,
      result.imageUrl,
      angle,
      baseAnglePrompt,
      baseNegativePrompt
    );

    // 保真度质检最多重试 2 次，其它质检 1 次
    const maxRetries = qualityOutcome.retryReason === 'fidelity' ? 2 : 1;
    let attempt = 0;

    while (qualityOutcome.needsRetry && attempt < maxRetries) {
      attempt += 1;
      onProgress?.(
        progressBaseline + 2,
        `${labelShowcaseAngle(angle)}${qualityOutcome.retryLabel}，重试中（${attempt}/${maxRetries}）...`
      );

      const retryResult = await provider.generateImage(
        {
          prompt: qualityOutcome.retryPrompt,
          negative_prompt: qualityOutcome.retryNegativePrompt,
          aspect_ratio: getShowcaseAspectRatio(angle),
        },
        '',
        showcaseReferences
      );

      if (!retryResult.success || !retryResult.imageUrl) {
        // 重试失败或超时：保留上一版，不再循环
        break;
      }

      result = retryResult;
      onImageGenerated?.(retryResult.imageUrl, angle);

      // 保真度重试后复查一次，决定是否再试
      if (qualityOutcome.retryReason !== 'fidelity' || attempt >= maxRetries) {
        break;
      }
      qualityOutcome = await runShowcaseQualityChecks(
        referenceImageUrl,
        result.imageUrl,
        angle,
        baseAnglePrompt,
        baseNegativePrompt
      );
    }
  } else {
    // 非超时/非限流的生成失败：兜底再试一次
    result = await rerunFailedShowcaseAngle(
      provider,
      angle,
      result,
      baseAnglePrompt,
      baseNegativePrompt,
      showcaseReferences
    );
    if (result.success && result.imageUrl) {
      onImageGenerated?.(result.imageUrl, angle);
    }
  }

  if (result.success && result.imageUrl) {
    return result;
  }

  return {
    ...result,
    error: `${labelShowcaseAngle(angle)}生成失败：${result.error || '未知错误'}`,
  };
}

interface ShowcaseQualityOutcome {
  needsRetry: boolean;
  retryReason: 'artifact' | 'angle' | 'fidelity' | 'none';
  retryLabel: string;
  retryPrompt: string;
  retryNegativePrompt: string;
}

async function runShowcaseQualityChecks(
  referenceImageUrl: string,
  generatedImageUrl: string,
  currentAngle: ShowcaseAngle,
  baseAnglePrompt: string,
  baseNegativePrompt: string
): Promise<ShowcaseQualityOutcome> {
  const qualityMode = getShowcaseQualityMode();
  if (qualityMode === 'fidelity') {
    const fidelityCheck = await detectShowcaseFidelityMismatch(referenceImageUrl, generatedImageUrl);
    if (fidelityCheck && !fidelityCheck.matchesProduct) {
      return {
        needsRetry: true,
        retryReason: 'fidelity',
        retryLabel: '商品保真度不达标',
        retryPrompt: buildFidelityRetryPrompt(baseAnglePrompt, fidelityCheck.evidence),
        retryNegativePrompt: `${baseNegativePrompt} Reject any result with altered curtain color, simplified pattern, missing layer, substituted material, or invented motif.`,
      };
    }

    return {
      needsRetry: false,
      retryReason: 'none',
      retryLabel: '',
      retryPrompt: '',
      retryNegativePrompt: '',
    };
  }

  const sceneProvider = getSceneAnalysisProvider();
  let artifactCheck: ShowcaseArtifactCheckResult | null = null;
  let angleCheck: ShowcaseAngleCheckResult | null = null;
  let fidelityCheck: ShowcaseFidelityCheckResult | null = null;

  if (sceneProvider.name === 'gemini') {
    artifactCheck = await detectShowcaseArtifacts(generatedImageUrl);
    if (artifactCheck?.hasForbiddenArtifacts) {
      return {
        needsRetry: true,
        retryReason: 'artifact',
        retryLabel: '脏图痕迹',
        retryPrompt: buildArtifactRetryPrompt(baseAnglePrompt, artifactCheck.evidence),
        retryNegativePrompt: `${baseNegativePrompt} Reject any result containing LIVE, 1/3, 1/2, 1/4, arrows, dots, comments, likes, logos, or platform chrome.`,
      };
    }

    await sleep(1500);
    angleCheck = await detectShowcaseAngleMismatch(generatedImageUrl, currentAngle);
    if (angleCheck && !angleCheck.matchesAngle) {
      return {
        needsRetry: true,
        retryReason: 'angle',
        retryLabel: '构图不对',
        retryPrompt: buildAngleMismatchRetryPrompt(baseAnglePrompt, currentAngle, angleCheck.evidence),
        retryNegativePrompt: `${baseNegativePrompt} Reject any detail shot that looks like a full room, wide bedroom scene, distant full-window composition, or curtain-as-background framing.`,
      };
    }

    await sleep(1500);
    fidelityCheck = await detectShowcaseFidelityMismatch(referenceImageUrl, generatedImageUrl);
  } else {
    [artifactCheck, angleCheck, fidelityCheck] = await Promise.all([
      detectShowcaseArtifacts(generatedImageUrl),
      detectShowcaseAngleMismatch(generatedImageUrl, currentAngle),
      detectShowcaseFidelityMismatch(referenceImageUrl, generatedImageUrl),
    ]);
  }

  if (artifactCheck?.hasForbiddenArtifacts) {
    return {
      needsRetry: true,
      retryReason: 'artifact',
      retryLabel: '脏图痕迹',
      retryPrompt: buildArtifactRetryPrompt(baseAnglePrompt, artifactCheck.evidence),
      retryNegativePrompt: `${baseNegativePrompt} Reject any result containing LIVE, 1/3, 1/2, 1/4, arrows, dots, comments, likes, logos, or platform chrome.`,
    };
  }

  if (angleCheck && !angleCheck.matchesAngle) {
    return {
      needsRetry: true,
      retryReason: 'angle',
      retryLabel: '构图不对',
      retryPrompt: buildAngleMismatchRetryPrompt(baseAnglePrompt, currentAngle, angleCheck.evidence),
      retryNegativePrompt: `${baseNegativePrompt} Reject any detail shot that looks like a full room, wide bedroom scene, distant full-window composition, or curtain-as-background framing.`,
    };
  }

  if (fidelityCheck && !fidelityCheck.matchesProduct) {
    return {
      needsRetry: true,
      retryReason: 'fidelity',
      retryLabel: '商品保真度不达标',
      retryPrompt: buildFidelityRetryPrompt(baseAnglePrompt, fidelityCheck.evidence),
      retryNegativePrompt: `${baseNegativePrompt} Reject any result with altered curtain color, simplified pattern, missing layer, substituted material, or invented motif.`,
    };
  }

  return {
    needsRetry: false,
    retryReason: 'none',
    retryLabel: '',
    retryPrompt: '',
    retryNegativePrompt: '',
  };
}

export async function generateCurtainShowcase(
  options: ShowcaseOptions,
  onProgress?: (progress: number, message: string) => void,
  onImageGenerated?: (imageUrl: string, angle: ShowcaseAngle) => void
): Promise<GenerationResult[]> {
  try {
    const provider = getShowcaseGenerationProvider();
    let productFingerprint: CurtainProductFingerprint | null = null;
    let referenceFallbackMode = false;
    let sanitizedCurtainReference: string | null = null;
    let compressedCurtainReference: string | null = null;

    // 无论 provider 是什么，都尝试提取窗帘商品特征，以便在高保真还原时有文本依据
    onProgress?.(5, '正在提取窗帘商品特征...');
    productFingerprint = await describeCurtainProductForShowcase(options.curtainImage);
    if (productFingerprint) {
      onProgress?.(
        6,
        `[DEBUG] VLM 识别：前景 motif=${productFingerprint.motifType} / 底纹=${productFingerprint.secondaryMotif} / 密度=${productFingerprint.motifDensity} / 结构=${productFingerprint.structure}`
      );
    }

    if (provider.name === 'gemini') {
      onProgress?.(6, '正在压缩完整商品图参考...');
      compressedCurtainReference = await createCompressedCurtainReference(options.curtainImage);
    }

    // 官方 Gemini 可追加净化细节图；bafang 等网关只发完整商品图，避免裁切图误导且减少耗时。
    if (shouldCreateSanitizedShowcaseReference(provider.name)) {
      onProgress?.(7, '正在净化窗帘参考图...');
      sanitizedCurtainReference = await createSanitizedCurtainReference(options.curtainImage);
    } else {
      onProgress?.(7, '已使用完整商品图作为唯一参考，跳过裁切净化...');
    }
    if (!productFingerprint?.productDescription) {
      referenceFallbackMode = true;
      onProgress?.(8, '商品特征提取失败，退回原参考图模式...');
    }

    const promptFingerprint = shouldUseShowcaseTextChecklist(provider.name) ? productFingerprint : null;
    if (productFingerprint && !promptFingerprint) {
      onProgress?.(8, '已禁用自动商品描述写入 prompt，避免误读覆盖参考图...');
    }

    const { prompt, negative_prompt } = buildShowcaseStructuredPrompt(
      options.style,
      provider.name,
      promptFingerprint?.productDescription,
      referenceFallbackMode,
      promptFingerprint
    );
    const allAngles: ShowcaseAngle[] = ['hero', 'lifestyle', 'detail', 'layered'];
    const angles: ShowcaseAngle[] =
      options.angles && options.angles.length > 0
        ? options.angles
        : options.angle && options.angle !== 'all'
          ? [options.angle]
          : allAngles;
    const showcaseReferences = buildShowcaseReferences(
      provider.name,
      compressedCurtainReference || options.curtainImage,
      sanitizedCurtainReference,
      referenceFallbackMode
    );

    const batchSize = provider.name === 'gemini' ? 1 : 2;
    onProgress?.(
      10,
      provider.name === 'gemini'
        ? `正在生成 ${angles.length} 张电商展示图（Gemini 免费 key 串行生成，更稳）...`
        : `正在生成 ${angles.length} 张电商展示图（2 张一批并发）...`
    );

    const usedRoomStyles = new Set<string>();
    const anglePlans = angles.map((angle) => {
      const diversitySeed = pickShowcaseDiversitySeed(angle, usedRoomStyles);
      const seedDirective = renderShowcaseDiversitySeed(diversitySeed);
      return {
        angle,
        baseAnglePrompt: `${prompt}\n${getShowcaseAngleDirective(angle)}\n${seedDirective}\n${buildShowcaseNoUiDirective()}`,
        baseNegativePrompt: `${negative_prompt} Do not generate LIVE badge, page counter like 1/3, left or right arrow button, pagination dots, shopping UI, social media UI, screenshot overlay, app overlay, or watermark.`,
      };
    });

    const results: GenerationResult[] = [];
    let completedCount = 0;

    for (let i = 0; i < anglePlans.length; i += batchSize) {
      const batch = anglePlans.slice(i, i + batchSize);
      const batchLabel = batch.map((p) => labelShowcaseAngle(p.angle)).join(' + ');
      const batchIndex = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(anglePlans.length / batchSize);
      const progressBaseline = Math.min(92, 10 + Math.round((completedCount / Math.max(anglePlans.length, 1)) * 85));

      onProgress?.(
        progressBaseline,
        batchSize === 1
          ? `第 ${batchIndex}/${totalBatches} 张串行生成：${batchLabel}...`
          : `第 ${batchIndex}/${totalBatches} 批并发生成：${batchLabel}...`
      );

      const settledResults = await Promise.allSettled(
        batch.map((plan) =>
          generateShowcaseSingleAngle({
            provider,
            angle: plan.angle,
            referenceImageUrl: options.curtainImage,
            baseAnglePrompt: plan.baseAnglePrompt,
            baseNegativePrompt: plan.baseNegativePrompt,
            showcaseReferences,
            onImageGenerated,
            onProgress,
            progressBaseline,
          })
        )
      );

      settledResults.forEach((settled, idx) => {
        const plan = batch[idx];
        if (settled.status === 'fulfilled') {
          results.push(settled.value);
        } else {
          const errMsg =
            settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
          results.push({
            imageUrl: '',
            success: false,
            error: `${labelShowcaseAngle(plan.angle)}并发异常：${errMsg}，建议稍后单独重试`,
          });
        }
        completedCount += 1;
      });

      onProgress?.(
        Math.min(95, 10 + Math.round((completedCount / anglePlans.length) * 85)),
        `第 ${batchIndex}/${totalBatches} 批完成（${completedCount}/${anglePlans.length}）`
      );

      if (provider.name === 'gemini' && i + batchSize < anglePlans.length) {
        onProgress?.(
          Math.min(95, 11 + Math.round((completedCount / anglePlans.length) * 85)),
          '等待免费 Gemini 限流窗口释放，准备下一张...'
        );
        await sleep(2500);
      }
    }

    onProgress?.(100, '电商展示生成完成');
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return [{ imageUrl: '', success: false, error: errorMessage }];
  }
}

function describeCurtainReference(reference: CurtainReference | undefined, index: number): string {
  if (!reference) {
    return `第 ${index + 2} 张参考图`;
  }

  if (reference.role === 'fabric') {
    return '主布帘参考图';
  }

  if (reference.role === 'sheer') {
    return '纱帘参考图';
  }

  return '窗帘商品参考图';
}

function clampPercent(value: number): number {
  return Number(Math.max(0, Math.min(100, value)).toFixed(1));
}

function expandWindowRegionToCurtainCoverage(region: WindowRegion): WindowRegion {
  const hasCurtain = region.hasCurtain || region.curtainType === 'single' || region.curtainType === 'double';
  const horizontalPadding = hasCurtain
    ? Math.max(region.width * 0.18, 6)
    : Math.max(region.width * 0.08, 3);
  const topPadding = hasCurtain
    ? Math.max(region.height * 0.06, 3)
    : Math.max(region.height * 0.04, 2);
  const bottomPadding = hasCurtain
    ? Math.max(region.height * 0.14, 6)
    : Math.max(region.height * 0.08, 3);

  const x = clampPercent(region.x - horizontalPadding);
  const y = clampPercent(region.y - topPadding);
  const right = clampPercent(region.x + region.width + horizontalPadding);
  const bottom = clampPercent(region.y + region.height + bottomPadding);

  return {
    ...region,
    x,
    y,
    width: clampPercent(right - x),
    height: clampPercent(bottom - y),
  };
}

function normalizeSceneAnalysis(sceneAnalysis: SceneAnalysisResult): SceneAnalysisResult {
  const inferredDoubleLayer = inferDoubleLayerFromScene(sceneAnalysis);
  const hasCurtainFromRegions = sceneAnalysis.windowRegions.some(
    (region) => region.hasCurtain || region.curtainType === 'single' || region.curtainType === 'double'
  );

  return {
    ...sceneAnalysis,
    hasCurtain: sceneAnalysis.hasCurtain || hasCurtainFromRegions,
    windowRegions: sceneAnalysis.windowRegions.map((region) =>
      expandWindowRegionToCurtainCoverage(
        inferredDoubleLayer && (region.hasCurtain || sceneAnalysis.hasCurtain)
          ? { ...region, hasCurtain: true, curtainType: 'double' }
          : region
      )
    ),
  };
}

function inferDoubleLayerFromScene(sceneAnalysis: SceneAnalysisResult): boolean {
  if (sceneAnalysis.windowRegions.some((region) => region.curtainType === 'double')) {
    return true;
  }

  if (!sceneAnalysis.hasCurtain) {
    return false;
  }

  const description = sceneAnalysis.sceneDescription.trim();
  if (!description) {
    return false;
  }

  return [
    /双层/,
    /布帘.{0,12}纱帘/,
    /纱帘.{0,12}布帘/,
    /厚帘.{0,12}薄纱/,
    /薄纱.{0,12}厚帘/,
    /外层.{0,12}布帘/,
    /两侧.{0,12}布帘/,
    /左右.{0,12}布帘/,
  ].some((pattern) => pattern.test(description));
}

function formatCurtainCoverageHints(windowRegions: WindowRegion[]): string {
  return windowRegions
    .slice(0, 3)
    .map((region, index) =>
      `覆盖区${index + 1}[x=${region.x}%, y=${region.y}%, w=${region.width}%, h=${region.height}%]`
    )
    .join('；');
}

function buildCurtainStructureRequirement(
  curtainStructure: CurtainStructure | undefined,
  curtainReferences: CurtainReference[],
  sceneAnalysis: SceneAnalysisResult
): string {
  if (curtainStructure === 'double') {
    return '窗帘结构必须是双层：布帘在外层，纱帘在内层，层次清晰且安装逻辑真实。';
  }

  if (curtainStructure === 'single') {
    return '窗帘结构必须是单层，不要额外生成第二层纱帘或布帘。';
  }

  const hasFabric = curtainReferences.some((reference) => reference.role === 'fabric');
  const hasSheer = curtainReferences.some((reference) => reference.role === 'sheer');

  if (hasFabric && hasSheer) {
    return '请生成双层窗帘：同时保留主布帘与纱帘，并准确体现两者的层次与材质差异。';
  }

  const detectedDouble = sceneAnalysis.windowRegions.some((region) => region.curtainType === 'double');
  if (detectedDouble) {
    return '若空间原本是双层窗帘结构，请保持合理的双层安装逻辑，但新窗帘仍以参考图为准。';
  }

  return '';
}

function getShowcaseAspectRatio(angle: ShowcaseAngle): ImageAspectRatio {
  switch (angle) {
    case 'hero':
      return '4:3';
    case 'detail':
      return '1:1';
    case 'lifestyle':
    case 'layered':
    default:
      return '3:4';
  }
}

function getShowcaseAngleDirective(angle: ShowcaseAngle): string {
  switch (angle) {
    case 'hero':
      return '输出一张远景商品展示图：完整展示窗帘挂装后的整体效果，最好带真实窗区、地面、部分家具或人物作为比例参考，像淘宝详情页里的完整成品展示图。场景要符合这款窗帘的风格气质，但不能沿用参考图里的原文案、角标、模特姿势或构图。';
    case 'lifestyle':
      return '输出一张中近景商品展示图：重点展示窗帘局部垂感、褶皱、边缘装饰和与空间的搭配关系。可以是窗边一角、局部场景或半身构图，但必须让场景氛围符合这款窗帘的风格定位。';
    case 'detail':
      return '输出一张材质细节展示图：必须是近景或特写，窗帘主体应占画面大部分面积，重点表现面料纹理、编织结构、印花/提花、压纹、垂坠褶皱、包边、流苏或绒球边等细节。禁止输出整屋远景、完整床或沙发大面积入镜、整扇窗完整展示，禁止让房间场景比窗帘细节更抢画面。';
    case 'layered':
      return '输出一张遮光效果展示图：根据这款窗帘的真实材质表现遮光或透光能力。若是厚实遮光布，请体现白天遮光、室内更暗的效果；若是纱帘或透光面料，请体现柔和透光、光影层次和通透感。画面像淘宝详情页里的功能展示图，但不能出现任何文案、数值或图标覆盖。';
    default:
      return '输出一张专业电商商品展示图。';
  }
}

const SHOWCASE_DIVERSITY_SEEDS: Record<ShowcaseAngle, ShowcaseDiversitySeed[]> = {
  hero: [
    {
      roomStyle: 'minimalist Scandinavian bedroom with oak wood floors and neutral linen bedding',
      cameraAngle: 'eye-level wide shot from across the room showing the full window wall',
      lighting: 'soft diffused morning daylight entering from the side',
      decor: 'a low bench seat, plain ceramic decor, and no plants',
    },
    {
      roomStyle: 'modern cream-toned living room with a curved boucle sofa',
      cameraAngle: 'slightly elevated wide shot capturing ceiling-to-floor drapery',
      lighting: 'warm afternoon backlight filtering through the curtains',
      decor: 'a travertine coffee table and a ceramic sculpture vase',
    },
    {
      roomStyle: 'contemporary Japandi study with a walnut desk and low stool',
      cameraAngle: 'symmetrical straight-on composition at standing height',
      lighting: 'overcast diffused daylight for soft even exposure',
      decor: 'a single reading chair with a linen cushion and a floor lamp',
    },
    {
      roomStyle: 'refined French-style primary bedroom with subtle wall mouldings',
      cameraAngle: 'three-quarter view from the doorway with depth layering',
      lighting: 'warm golden-hour light raking in from the left',
      decor: 'a tufted ottoman at the bed foot and a brass floor lamp',
    },
  ],
  lifestyle: [
    {
      roomStyle: 'cozy reading nook with a natural linen armchair and wool throw',
      cameraAngle: 'medium three-quarter shot focused on the window edge',
      lighting: 'gentle side-lit daylight creating soft shadows',
      decor: 'an open hardcover book and a stoneware mug on a side table',
    },
    {
      roomStyle: 'child-friendly light-wood nursery with a rattan rocker',
      cameraAngle: 'slightly low angle highlighting curtain drape above a daybed',
      lighting: 'late-afternoon warm glow filtering inward',
      decor: 'a plain woven basket and no plants',
    },
    {
      roomStyle: 'boutique hotel suite corner with brushed brass hardware',
      cameraAngle: 'medium-close composition beside the curtain fold',
      lighting: 'mixed warm interior and cool exterior light',
      decor: 'a half-visible writing desk and a neatly folded bed throw',
    },
  ],
  detail: [
    {
      roomStyle: 'neutral soft-gradient photography studio backdrop',
      cameraAngle: 'extreme macro close-up on fabric weave and pattern repeat',
      lighting: 'raking side key light revealing texture and thread depth',
      decor: 'none — isolate the fabric surface only',
    },
    {
      roomStyle: 'neutral indoor setting beside a bright window, background blurred',
      cameraAngle: 'tight close-up on edge trim, tassels, and fold break',
      lighting: 'natural daylight at 45 degrees with subtle falloff',
      decor: 'none — keep background fully defocused',
    },
    {
      roomStyle: 'clean white seamless photography backdrop',
      cameraAngle: 'tight crop showing one full pattern repeat',
      lighting: 'studio softbox key with a subtle fill',
      decor: 'none — fabric dominates the frame',
    },
  ],
  layered: [
    {
      roomStyle: 'sunny south-facing living room in mid-afternoon',
      cameraAngle: 'eye-level wide shot showing light streaming through the sheer layer',
      lighting: 'strong directional backlight that reveals the opacity gradient',
      decor: 'faint dust motes visible in the light beam',
    },
    {
      roomStyle: 'dim evening primary bedroom with both curtain layers drawn',
      cameraAngle: 'straight-on composition emphasising the blackout effect',
      lighting: 'low ambient bedside lamp, minimal daylight leak at edges',
      decor: 'a warm amber reading lamp glowing on the nightstand',
    },
    {
      roomStyle: 'modern home-office corner with one curtain half-drawn',
      cameraAngle: 'diagonal angle capturing the light-to-shade falloff line',
      lighting: 'hard outdoor daylight contrasting with the shaded interior',
      decor: 'the silhouette of a desk chair and a mug',
    },
  ],
};

function pickShowcaseDiversitySeed(
  angle: ShowcaseAngle,
  usedRoomStyles: Set<string>
): ShowcaseDiversitySeed {
  const pool = SHOWCASE_DIVERSITY_SEEDS[angle] || SHOWCASE_DIVERSITY_SEEDS.hero;
  const fresh = pool.filter((seed) => !usedRoomStyles.has(seed.roomStyle));
  const candidates = fresh.length > 0 ? fresh : pool;
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  usedRoomStyles.add(picked.roomStyle);
  return picked;
}

function renderShowcaseDiversitySeed(seed: ShowcaseDiversitySeed): string {
  return [
    'COMPOSITION SEED (must be followed, do not ignore):',
    `- Room style: ${seed.roomStyle}.`,
    `- Camera angle: ${seed.cameraAngle}.`,
    `- Lighting: ${seed.lighting}.`,
    `- Decor hints: ${seed.decor}.`,
    'DIVERSITY MANDATE: the four showcase images in this batch should use different rooms, camera angles, and lighting setups, but never at the cost of changing the curtain SKU. Do not introduce plant or botanical decor motifs that could be confused with the curtain pattern.',
  ].join('\n');
}

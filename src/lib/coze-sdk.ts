/**
 * 窗帘 AI 生成核心逻辑
 * - Prompt 构建 & 窗户区域语义化
 * - 通过 provider 层（src/lib/providers/*）调用底层模型
 *   当前支持 Ark Seedream / Google Gemini，由 IMAGE_PROVIDER env 切换
 */
import { Config, LLMClient } from 'coze-coding-dev-sdk';
import type {
  CurtainReference,
  CurtainStructure,
  SceneAnalysisResult,
  WindowRegion,
} from '@/lib/curtain-ai-types';
import { getImageProvider } from '@/lib/providers';
import type { GenerationResult } from '@/lib/providers/types';

const config = new Config({
  apiKey: process.env.COZE_WORKLOAD_IDENTITY_API_KEY,
  baseUrl: process.env.COZE_INTEGRATION_BASE_URL || 'https://api.coze.com',
  modelBaseUrl: process.env.COZE_INTEGRATION_MODEL_BASE_URL || 'https://model.coze.com',
});

export const llmClient = new LLMClient(config);

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
  angle?: 'vertical' | 'horizontal' | 'detail' | 'scene' | 'all';
  angles?: Array<'vertical' | 'horizontal' | 'detail' | 'scene'>;
}

export type { GenerationResult } from '@/lib/providers/types';

export async function analyzeScene(sceneImageUrl: string): Promise<SceneAnalysisResult> {
  return getImageProvider().analyzeScene(sceneImageUrl);
}

export async function generateCurtainImage(
  options: GenerateOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult> {
  try {
    onProgress?.(5, '正在分析场景...');

    const sceneAnalysis = options.sceneAnalysisOverride || await analyzeScene(options.sceneImage);
    onProgress?.(15, `检测到 ${sceneAnalysis.windowRegions.length} 个窗户区域`);

    const prompt = buildPrompt(options, sceneAnalysis);
    onProgress?.(25, '正在生成效果图...');

    const result = await getImageProvider().generateImage(
      prompt,
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
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];

  for (let index = 0; index < count; index += 1) {
    onProgress?.(
      Math.min(95, 10 + Math.round((index / Math.max(count, 1)) * 80)),
      `正在生成第 ${index + 1}/${count} 个方案...`
    );

    const result = await generateCurtainImage(options, (progress, message) => {
      const normalized = ((index + progress / 100) / Math.max(count, 1)) * 100;
      onProgress?.(Math.min(95, 10 + normalized * 0.8), message);
    });

    results.push(result);
  }

  onProgress?.(100, '多方案生成完成');
  return results;
}

function buildPrompt(options: GenerateOptions, sceneAnalysis: SceneAnalysisResult): string {
  const curtainCount = options.curtainReferences.length;
  const finalMode = options.mode === 'auto' ? sceneAnalysis.recommendedMode : options.mode;
  const actionVerb = finalMode === 'replace' ? '替换' : '新增挂装';
  const sceneDesc = sceneAnalysis.sceneDescription || '客户提供的室内现场照片';
  const sceneStyleHint = sceneAnalysis.sceneStyle
    ? `参考图1空间整体风格识别为「${sceneAnalysis.sceneStyle}」，请让窗帘色调、材质与该风格自然融合。`
    : '请先从参考图1的墙面、家具、地板、采光中提取主色调，让窗帘配色与原空间形成自然延续。';

  // 接通已写好的窗区坐标 + 场景锁定 + 局部编辑规则 + 商品输入说明
  const windowRegionsBlock = formatWindowRegions(sceneAnalysis.windowRegions);
  const sceneLockRules = buildSceneLockRules(sceneAnalysis);
  const localEditRules = buildLocalEditRules(sceneAnalysis.windowRegions);
  const referenceSummary = buildCurtainReferenceSummary(options.curtainReferences, options.curtainStructure);

  // 通用品质后缀：电影感商业摄影 + 物理真实 + 严格构图保留 + Negative Prompt
  const qualitySuffix = `

【画面质量基线 · 商业摄影级】
- 整体语言：高级室内商业摄影，杂志大片质感，类似 Architectural Digest / Kinfolk / 安邸 AD 的视觉调性
- 光线：保持原图光源方向与色温，强化自然漫射光的柔和层次感，避免平均亮度的"棚拍味"
- 色彩：色调克制、和谐、有呼吸感，避免过饱和、过曝、塑料感、廉价光泽
- 材质：窗帘的纤维纹理、垂感、褶皱阴影必须符合面料物理特性，针脚与帘头细节真实可信
- 精度：8K 分辨率、锐利但不过度锐化，颗粒感接近真实摄影，不得有数字平滑感

【严格保留原图（最高优先级）】
- 严禁剪裁、缩放或改变画幅尺寸，输出图必须与参考图1宽高比、构图范围完全一致
- 严禁修改房间空间结构、墙体位置、地板范围、天花线条、家具位置、窗框轮廓
- 严禁改变机位、焦距、透视角度——斜视角必须保持斜视角

【Negative Prompt · 必须避免】
塑料感、油画感、卡通化、过曝、过饱和、HDR 痕迹、AI 合成边缘、肌理崩坏、
褶皱不自然、布料漂浮、光影方向冲突、墙体扭曲、家具变形、构图被裁切、
低质灯光、舞台感、彩虹色光晕、廉价丝绸光泽、过度对称的伪豪华`;

  // —— 路径一：指定了风格 ——
  if (options.style) {
    const stylePrompts: Record<string, string> = {
      奶油风:
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，将窗帘${actionVerb}为「奶油温柔风」。` +
        `\n\n【面料与色彩】奶白、米杏、浅燕麦或浅驼色等暖白调，色温偏暖（≈3500K），绝不出现冷色或纯白。` +
        `面料为厚实柔软的天鹅麻、奶绒或亚麻混纺，表面有细腻的天然纤维肌理，逆光时呈现温暖蜂蜜色的漫射光。` +
        `\n\n【褶皱与垂感】采用2.0倍褶宽，自然流畅的竖向波浪褶，垂坠饱满到落地（甚至略微堆地3-5cm），底边可隐约可见细密绒球边或暗纹包边。` +
        `\n\n【光影与氛围】黄金时段侧逆光（晨光或下午4-5点），柔和漫射感，营造"被阳光晒过的旧棉布"那种温柔治愈感。` +
        `参考你给我的那张「自然垂顺·免烫易打理」商品图——就是这种调性。` +
        `${sceneStyleHint}`,

      现代简约:
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，将窗帘${actionVerb}为「现代极简」。` +
        `\n\n【面料与色彩】纯单色冷白、雾灰或浅麻色，绝不出现深色、图案或装饰。` +
        `面料为中等厚度纯棉、棉麻或科技混纺，表面平整细腻，无明显光泽。` +
        `\n\n【褶皱与垂感】1.8-2.0倍褶宽，挺括的竖直平褶或完全无褶平铺，垂线笔直锐利。` +
        `帘头采用极简的暗藏轨道或无痕挂装，看不到任何金属件。` +
        `\n\n【光影与氛围】明亮均匀的自然顶光或柔和正午散射光，画面呼吸感强、留白多，` +
        `参考极简主义建筑摄影（Vincent Van Duysen / John Pawson 的住宅作品）的克制美学。` +
        `${sceneStyleHint}`,

      轻奢:
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，将窗帘${actionVerb}为「都市轻奢」。` +
        `\n\n【面料与色彩】外层选用雾霾蓝、烟灰、深咖、暖墨绿或赤陶色的高支天鹅绒、提花棉麻或绉缎，` +
        `表面有细腻的丝光感（不是廉价亮面），暗部沉稳、高光内敛。如已有双层结构，内层配米白或浅雾灰薄纱。` +
        `\n\n【褶皱与垂感】2.2倍以上褶宽，宫廷宽波浪褶或精致箱褶，落地堆叠5-8cm形成"大片感"垂坠。` +
        `帘头采用哑光铜或金枪色环扣／工字钉，可见但克制。` +
        `\n\n【光影与氛围】低角度暖侧光 + 戏剧性阴影对比，画面有电影感的明暗层次（类似 Kelly Wearstler / 梁志天 室内摄影），` +
        `奢而不炫，沉静有质。${sceneStyleHint}`,

      北欧:
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，将窗帘${actionVerb}为「北欧自然」。` +
        `\n\n【面料与色彩】纯天然原色亚麻、棉麻或粗纺棉，颜色为本白、燕麦、浅烟灰或淡雾蓝，` +
        `面料能透光30-50%，逆光时呈现柔和的米白色漫射光晕。` +
        `\n\n【褶皱与垂感】1.5-1.8倍褶宽，松散随意的自然褶，看起来像被微风轻拂过，刻意保留一点"未经熨烫的生活感"。` +
        `\n\n【光影与氛围】斯堪的纳维亚式柔和北光，色温偏冷但不刺眼（≈5500K），` +
        `画面通透明亮、留白充足，参考 Jonas Bjerre-Poulsen / Note Design Studio 的住宅摄影调性。` +
        `${sceneStyleHint}`,

      中式:
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，将窗帘${actionVerb}为「新中式雅致」。` +
        `\n\n【面料与色彩】真丝绉缎、香云纱、竹纤维或棉麻提花，色调为月白、烟青、墨黛、赭石或胭脂红等沉稳东方色。` +
        `面料表面有细腻丝光，提花纹样可选传统云纹、竹影、缠枝莲、博古纹（纹样克制不喧宾）。` +
        `\n\n【褶皱与垂感】2.0倍褶宽，对称流畅的宽波浪褶，落地齐整，可在边缘点缀手工流苏或铜质帘坠。` +
        `\n\n【光影与氛围】温润的暖侧光（类似午后透过格栅窗的光线），画面有水墨般的虚实层次，` +
        `参考梁建国、琚宾的新中式室内摄影，含蓄、留白、有书卷气。${sceneStyleHint}`,
    };

    const basePrompt =
      stylePrompts[options.style] ||
      `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，将窗帘${actionVerb}为「${options.style}」风格。` +
        `窗帘的造型、色彩、材质、褶皱必须严格符合${options.style}的典型视觉特征，` +
        `并与空间氛围协调融合。${sceneStyleHint}`;

    return [
      basePrompt,
      `\n场景信息：${sceneDesc}`,
      windowRegionsBlock,
      sceneLockRules,
      localEditRules,
      qualitySuffix,
    ]
      .filter((part) => part && part.length > 0)
      .join('\n');
  }

  // —— 路径二：有参考商品图，无指定风格 ——
  if (curtainCount > 0) {
    const roleMap = groupCurtainReferences(options.curtainReferences);

    // 商品还原优先级 + 美学加成（即使是替换，也要拍得像大片）
    const fidelityNote =
      `\n\n【商品还原优先级】颜色 > 纹理 > 款式 > 褶皱。无法确认的细节宁可保守还原，禁止自由创作替代款式。` +
      `\n\n【商业大片要求】虽然是商品替换，但最终成图要达到商家可直接发圈/发详情页的水准——` +
      `光线要有杂志感（柔和侧光优先），褶皱要饱满有垂坠感，与空间原色调形成自然呼应。`;

    let basePrompt = '';

    if (roleMap.fabric.length > 0 && roleMap.sheer.length > 0) {
      basePrompt =
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，` +
        `生成「双层窗帘」效果：外层布帘完全还原参考图2，内层纱帘完全还原参考图3。` +
        `布帘与纱帘的颜色、图案、材质和褶皱纹理必须与对应商品图高度一致，不得混淆或替换。` +
        `双层结构需层次分明：纱帘轻薄透光（透光率30-50%），布帘厚实垂坠（落地堆叠3-5cm），两者叠加时边缘清晰自然。`;
    } else if (roleMap.fabric.length > 0) {
      basePrompt =
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，` +
        `将布帘${actionVerb}，款式严格还原参考图2。` +
        `必须保留商品的颜色、图案（如有）、面料质感、针脚细节和自然褶皱特征；` +
        `垂挂方式符合该面料的物理特性（厚重感/垂感/光泽度），落地堆叠3-5cm。`;
    } else if (roleMap.sheer.length > 0) {
      basePrompt =
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，` +
        `将纱帘${actionVerb}，款式严格还原参考图2。` +
        `必须保留纱帘的颜色、透光程度、面料纹路和悬垂特性；` +
        `阳光透过纱帘时呈现柔和漫射光晕，边缘轮廓轻盈，不得有任何厚重布料感。`;
    } else if (roleMap.generic.length > 0) {
      basePrompt =
        `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，` +
        `将窗帘${actionVerb}，款式严格还原参考图2。` +
        `必须忠实还原商品的颜色、图案、材质、褶皱、帘头细节和整体外观，` +
        `不得以相似款替代，不得改变商品的核心视觉特征。`;
    } else {
      basePrompt = `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，将窗帘${actionVerb}。`;
    }

    return [
      basePrompt + fidelityNote,
      `\n场景信息：${sceneDesc}`,
      sceneStyleHint ? `\n空间风格参考：${sceneStyleHint}` : '',
      referenceSummary,
      windowRegionsBlock,
      sceneLockRules,
      localEditRules,
      qualitySuffix,
    ]
      .filter((part) => part && part.length > 0)
      .join('\n');
  }

  // —— 路径三：无风格、无参考图，自动匹配 ——
  const autoBase =
    `这是一张室内现场照片（参考图1）。请仅对窗区进行局部替换，` +
    `根据空间整体风格自动${actionVerb}最协调的窗帘方案。` +
    `\n\n【自动选款思路】先从参考图1中提取墙面/家具/地板的主色调与材质语言，` +
    `选择在颜色、材质、款式上能形成自然延续的窗帘——优先和谐共生，避免视觉对抗。` +
    `窗帘垂挂自然、褶皱真实饱满（2.0倍褶宽），与空间光影方向高度统一。` +
    `\n\n${sceneStyleHint}`;

  return [
    autoBase,
    `\n场景信息：${sceneDesc}`,
    windowRegionsBlock,
    sceneLockRules,
    localEditRules,
    qualitySuffix,
  ]
    .filter((part) => part && part.length > 0)
    .join('\n');
}

function formatWindowRegions(windowRegions: WindowRegion[]): string {
  if (windowRegions.length === 0) {
    return '';
  }

  const regionLines = windowRegions.map((region, index) => {
    const curtainState = region.hasCurtain ? '当前已有窗帘' : '当前为空窗';
    const curtainType = region.curtainType ? `，结构 ${region.curtainType}` : '';
    return `- 窗区 ${index + 1}：x=${region.x}，y=${region.y}，width=${region.width}，height=${region.height}，${curtainState}${curtainType}`;
  });

  // ✅ 优化：增加"窗区外为锁定区"的正向表述，更明确地告知模型编辑边界
  return `窗区定位（百分比坐标）：
${regionLines.join('\n')}

编辑边界：以上窗区为唯一合法编辑区域，窗区外的所有像素（墙面、地板、天花、家具）视为锁定背景，不得修改。
`;
}

function buildSceneLockRules(sceneAnalysis: SceneAnalysisResult): string {
  const sceneDescription = sceneAnalysis.sceneDescription || '原始客户现场';

  // ✅ 优化：去除重复禁令，改用"必须保持"正向表述为主 + 仅保留最关键的禁止项
  return `构图锁定要求：
- 本任务为窗帘局部替换，不是场景重绘或空间设计，必须以参考图1作为不可变的背景底图。
- 必须严格保持原图的拍摄机位、焦距、透视角度和空间纵深——若原图为斜侧视角，生成图也必须保持斜侧视角。
- 必须保持原图的墙角角度、窗洞比例、吊顶走向、地面反光方向和所有家具的位置与比例。
- 除窗帘覆盖的像素外，其余区域应与参考图1保持最大像素一致性。
- 如果窗帘生成与空间结构产生冲突，优先保留 ${sceneDescription} 的空间结构，而非强行展示窗帘效果。`;
}

function buildLocalEditRules(windowRegions: WindowRegion[]): string {
  if (windowRegions.length === 0) {
    // ✅ 优化：无窗区时给出降级策略，而非空规则
    return `局部编辑要求（降级模式）：
- 当前无法获取精确窗区坐标，请自动识别图中最显著的窗户区域作为编辑目标。
- 编辑范围仅限窗帘挂装的合理物理范围，不得扩散至墙面、地板、天花或家具。
- 若无法确定编辑边界，应保守处理，宁可窗帘范围略小，也不能让修改溢出至背景区域。`;
  }

  const primaryRegion = windowRegions[0];

  return `局部编辑要求：
- 编辑区域严格限定在已标注的窗区坐标范围内，窗区外背景完全锁定。
- 主编辑窗区（窗区 1）：x=${primaryRegion.x}，y=${primaryRegion.y}，width=${primaryRegion.width}，height=${primaryRegion.height}。
- 多窗区场景：每个窗区独立处理，窗区之间的墙面区域不得被修改。
- 窗区外的所有元素——墙面、吊顶、踢脚线、地砖反光、家具边缘及室内采光方向——必须与原图完全一致。
- 若生成过程中发生空间结构漂移，应立即回归原图机位和原图背景，放弃创意扩展。`;
}

function buildCurtainReferenceSummary(
  curtainReferences: CurtainReference[],
  curtainStructure: CurtainStructure | undefined
): string {
  if (curtainReferences.length === 0) {
    return '';
  }

  const roleMap = groupCurtainReferences(curtainReferences);
  const structureText =
    curtainStructure === 'double'
      ? '目标窗帘结构：双层窗帘（布帘 + 纱帘）。\n'
      : curtainStructure === 'single'
        ? '目标窗帘结构：单层窗帘。\n'
        : '';

  const summaryLines = [
    roleMap.fabric.length > 0 ? `- 布帘商品图：${roleMap.fabric.length} 张（对应参考图序号从第2张开始）` : null,
    roleMap.sheer.length > 0 ? `- 纱帘商品图：${roleMap.sheer.length} 张` : null,
    roleMap.generic.length > 0 ? `- 通用商品图：${roleMap.generic.length} 张` : null,
  ].filter(Boolean);

  return `${structureText}商品输入结构：
${summaryLines.join('\n')}

`;
}

function groupCurtainReferences(curtainReferences: CurtainReference[]): Record<'generic' | 'fabric' | 'sheer', CurtainReference[]> {
  return curtainReferences.reduce<Record<'generic' | 'fabric' | 'sheer', CurtainReference[]>>(
    (accumulator, reference) => {
      accumulator[reference.role].push(reference);
      return accumulator;
    },
    {
      generic: [],
      fabric: [],
      sheer: [],
    }
  );
}

// ——— 艺术展示模式（新增功能）———

interface ShowcaseAnglePrompt {
  vertical: string;
  horizontal: string;
  detail: string;
  scene: string;
}

function pickRandom<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildShowcasePrompts(style?: string): ShowcaseAnglePrompt {
  const styleName = style || '自由发挥';

  // 【窗帘样式铁律】——参考图仅用于提取样式信息，其他一切完全忽略
  const curtainLock = `

【参考图使用规则 —— 最高优先级】
- 参考图1是一张商品素材图，仅用来让你【提取窗帘本身的样式信息】：
  仅提取 → 颜色、花纹、面料质感、褶皱形态、装饰（流苏/蕾丝/滚边/绑带）、开合方式、是否双层（纱+布）。
- 必须完全【忽略】参考图1的一切非窗帘属性：
  忽略 → 拍摄视角、镜头焦段、背景颜色、打光方向、房间氛围、构图比例、色调滤镜、任何道具。
- 成片的视角、场景、光线、氛围、色调、风格必须由你根据下方的【本张创作指令】完全重新创作，
  不要让成片看起来像"对参考图1做了微调"，它们应该是完全不同的两张照片——只有窗帘样式一致。

【窗帘样式硬约束】
- 颜色、花纹、面料、褶皱、装饰、开合方式必须与参考图1一致，不得换色/换花/换料/增减装饰。
- 若参考图为双层结构（纱+布），成片保留双层结构。

【成片视角硬约束】
- 一律【人眼平视】：镜头高度≈1.5m，水平方向拍摄，垂直墙线保持垂直。
- 严禁仰拍（天花板入镜、窗帘呈梯形、灭点上移）；严禁俯拍整幅窗帘。
- 参考图1本身若是仰拍商品图，无视其视角，成片必须重新构图。

【画质硬约束】
- 商业摄影级真实质感；禁止塑料感、卡通化、过曝 HDR、AI 合成边缘、塑料光泽。
- 用户选定风格倾向：${styleName}（仅作氛围参考，不限制你对场景/光线的自由创作）。`;

  // 为每个角度准备风格变体池，每次生成时随机抽取一条，确保同角度也不重样
  const verticalVariants = [
    '电影情绪海报风：低饱和暗调、单点戏剧侧光、窗外逆光在窗帘上勾出金色轮廓，画面留大量负空间，构图讲究建筑纵深感。镜头焦段 35mm 全画幅，f/2.8 浅景深，色调偏冷蓝+暖黄对比。',
    '北欧极简画廊风：高调明亮、漫射顶光、墙面纯净大面积留白，窗帘作为画面唯一焦点，地面一道细长光影。镜头 50mm，色调高明度低饱和，近乎黑白。',
    '日系胶片感：午后柔光、颗粒质感、轻微泛黄色调，窗帘前放一张藤编椅或一本摊开的书，氛围慵懒治愈。镜头 40mm f/2，暗角略重。',
  ];

  const horizontalVariants = [
    '建筑摄影杂志大片：广角 24mm 室内全景，对称或三分构图，落地窗从画面一侧延伸到另一侧，窗帘占据画面 1/3，另一侧出现真皮沙发/矮几/艺术画，色调高级灰+原木暖色。',
    '家居生活杂志内页风：35mm 中焦、斜向构图、柔和漫射光，画面里有一个正在泡茶或看书的人物（背影或侧影），窗帘在画面黄金分割点上被自然带出，生活气息浓。',
    '豪华样板间摄影风：28mm 广角、水平构图、大理石+黄铜质感，吊灯反射、落地窗外虚化城市景，窗帘从天花板一直垂到地板，褶皱清晰立体。色调冷白+暖金。',
  ];

  const detailVariants = [
    '时装微距特写：90mm 微距镜头、f/2.8 极浅景深、柔光箱侧光，仅聚焦窗帘褶皱/流苏/蕾丝的 10-20cm 局部，光线勾出面料经纬纹理，背景完全虚化成光斑。',
    '面料样本摄影：平视近距离、正面布光、背景为纯色墙面或哑光木板，窗帘局部自然垂坠，展现材质光泽与手感，构图干净到接近产品摄影但带艺术感。',
    '光影切片美学：窗外射入的阳光在窗帘上形成明暗切片或光斑，镜头 85mm 中距离特写，强调光透过面料的半透明质感，色调偏暖金，颗粒感胶片质地。',
  ];

  const sceneVariants = [
    '纪实人文故事：黄昏时分，一个人物背影站在窗前（或斜倚在飘窗上），暖橙色夕阳透过窗帘洒在木地板上，画面有长阴影和尘埃光束，充满电影感。镜头 35mm f/2。',
    '慢生活静物场景：窗帘前的茶几上有一套刚泡好的茶、一本摊开的书、一只慵懒的猫，晨光从窗帘缝隙漏进来，氛围治愈。镜头 50mm f/1.8，浅景深。',
    '艺术装置感：窗帘旁放置一件雕塑/陶艺/绿植/复古唱机，画面像美术馆展陈，光线干净、构图极简但有故事张力。镜头 40mm，中性色调。',
  ];

  return {
    vertical: `创作一张【竖版 9:16】艺术大片，窗帘作为画面主角但融入整体场景。
【本张创作指令】${pickRandom(verticalVariants)}
场景、道具、模特、房间布局请根据上述指令自由创作，不要参考参考图1的任何构图或氛围。${curtainLock}`,

    horizontal: `创作一张【横版 16:9】艺术大片，构图舒展、空间纵深感强。
【本张创作指令】${pickRandom(horizontalVariants)}
场景、道具、模特、房间布局请根据上述指令自由创作，不要参考参考图1的任何构图或氛围。${curtainLock}`,

    detail: `创作一张【面料特写】艺术照，突出窗帘材质与光影层次。
【本张创作指令】${pickRandom(detailVariants)}
取景、光源、背景请根据上述指令自由创作，不要参考参考图1的整体氛围。${curtainLock}`,

    scene: `创作一张【场景故事大片】，窗帘挂在一个真实有温度的空间里。
【本张创作指令】${pickRandom(sceneVariants)}
人物、道具、时段、色调请根据上述指令自由创作，不要参考参考图1的氛围和视角。${curtainLock}`,
  };
}

export async function generateCurtainShowcase(
  options: ShowcaseOptions,
  onProgress?: (progress: number, message: string) => void
): Promise<GenerationResult[]> {
  try {
    const prompts = buildShowcasePrompts(options.style);
    const allAngles: Array<'vertical' | 'horizontal' | 'detail' | 'scene'> = [
      'vertical',
      'horizontal',
      'detail',
      'scene',
    ];
    const angles: Array<'vertical' | 'horizontal' | 'detail' | 'scene'> =
      options.angles && options.angles.length > 0
        ? options.angles
        : options.angle && options.angle !== 'all'
          ? [options.angle]
          : allAngles;

    const angleLabel = (a: string) =>
      a === 'vertical' ? '竖版展示' : a === 'horizontal' ? '横版展示' : a === 'detail' ? '细节特写' : '场景融合';

    let completed = 0;
    onProgress?.(10, `正在并行生成 ${angles.length} 张艺术图...`);

    const results = await Promise.all(
      angles.map(async (currentAngle) => {
        const prompt = prompts[currentAngle as keyof ShowcaseAnglePrompt];
        const result = await getImageProvider().generateImage(
          prompt,
          '',
          [{ url: options.curtainImage, role: 'generic' }]
        );
        completed += 1;
        onProgress?.(
          Math.min(95, 10 + Math.round((completed / angles.length) * 85)),
          `${angleLabel(currentAngle)}完成（${completed}/${angles.length}）`
        );
        return result;
      })
    );

    onProgress?.(100, '艺术展示生成完成');
    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return [
      {
        imageUrl: '',
        success: false,
        error: errorMessage,
      },
    ];
  }
}

/**
 * 图像生成 Provider 统一接口
 *
 * 目前支持：
 * - ark     火山方舟 Seedream（默认）
 * - gemini  Google Gemini 2.5 系列
 *
 * 通过环境变量 IMAGE_PROVIDER 切换，默认 'ark'。
 */
import type { CurtainReference, SceneAnalysisResult } from '@/lib/curtain-ai-types';

export interface GenerationResult {
  imageUrl: string;
  success: boolean;
  error?: string;
}

export interface ImageProvider {
  /** provider 名字，用于日志和调试 */
  readonly name: string;

  /**
   * 分析场景图片：定位窗户区域、识别风格、判断是否已有窗帘
   */
  analyzeScene(imageUrl: string): Promise<SceneAnalysisResult>;

  /**
   * 图像生成（图生图 / 多图融合 / 文生图）
   *
   * @param prompt          文本指令（由 coze-sdk 的 prompt builder 构建）
   * @param sceneImage      场景图 URL 或 data URL，可为空字符串（纯文生图或 showcase 模式）
   * @param curtainReferences 窗帘参考图列表
   */
  generateImage(
    prompt: string,
    sceneImage: string,
    curtainReferences: CurtainReference[]
  ): Promise<GenerationResult>;
}

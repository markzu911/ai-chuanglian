export type GenerationMode = 'replace' | 'add' | 'auto' | 'showcase';

export type ShowcaseAngle = 'vertical' | 'horizontal' | 'detail' | 'scene';

export type CurtainStructure = 'auto' | 'single' | 'double';

export type CurtainReferenceRole = 'generic' | 'fabric' | 'sheer';

export interface WindowRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  hasCurtain: boolean;
  curtainType?: 'single' | 'double';
}

export interface SceneAnalysisResult {
  hasCurtain: boolean;
  windowRegions: WindowRegion[];
  recommendedMode: 'replace' | 'add';
  sceneDescription: string;
  /** 空间整体装修风格（如：现代简约 / 奶油风 / 轻奢 / 北欧 / 中式），由视觉模型识别后用于自动配色 */
  sceneStyle?: string;
}

export interface CurtainReference {
  url: string;
  name?: string;
  role: CurtainReferenceRole;
}

export interface GenerateRequestPayload {
  sceneImage: string;
  curtainReferences?: CurtainReference[];
  curtainImages?: string[];
  mode?: GenerationMode;
  style?: string;
  count?: number;
  curtainStructure?: CurtainStructure;
  sceneAnalysisOverride?: SceneAnalysisResult;
  showcaseAngles?: ShowcaseAngle[];
}

/**
 * SaaS 积分系统对接类型定义 (V4-3Step)
 * 对应规范：/api/tool/launch, /api/tool/verify, /api/tool/consume
 */

export interface SaasInitPayload {
  type: 'SAAS_INIT';
  userId?: string;
  toolId?: string;
  context?: string;
  prompt?: string[];
  callbackUrl?: string;
}

export interface SaasUserInfo {
  name: string;
  enterprise?: string;
  integral: number;
}

export interface SaasToolInfo {
  name: string;
  integral: number;
}

export interface ToolLaunchResponseData {
  user: SaasUserInfo;
  tool: SaasToolInfo;
}

export interface ToolVerifyResponseData {
  currentIntegral: number;
  requiredIntegral: number;
}

export interface ToolConsumeResponseData {
  currentIntegral: number;
  consumedIntegral: number;
}

export interface SaasApiResponse<T> {
  success: boolean;
  valid?: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export type ToolLaunchResponse = SaasApiResponse<ToolLaunchResponseData>;
export type ToolVerifyResponse = SaasApiResponse<ToolVerifyResponseData>;
export type ToolConsumeResponse = SaasApiResponse<ToolConsumeResponseData>;

export interface ToolApiRequest {
  userId: string;
  toolId: string;
}

export interface SaasContextData {
  userId: string | null;
  toolId: string | null;
  context: string;
  prompt: string[];
  callbackUrl: string | null;
}

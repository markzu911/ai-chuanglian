/**
 * SaaS 积分系统对接 Hook (V4-3Step)
 *
 * 职责：
 * 1. 监听 window.postMessage 的 SAAS_INIT 事件，完全信任不校验 origin
 * 2. 自动调用 /api/tool/launch 拉取用户信息 + 工具消耗 + 初始积分
 * 3. 暴露 verify() 在生成前校验积分是否充足
 * 4. 暴露 consume() 在生成成功后扣除积分并更新本地状态
 *
 * 未接收到 SAAS_INIT 时优雅降级：isConnected=false，不调用后端接口
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeId, isLenientSuccess } from '@/lib/saas-utils';
import type {
  SaasContextData,
  SaasInitPayload,
  SaasToolInfo,
  SaasUserInfo,
  ToolConsumeResponse,
  ToolLaunchResponse,
  ToolVerifyResponse,
} from '@/lib/saas-types';

const INITIAL_CONTEXT: SaasContextData = {
  userId: null,
  toolId: null,
  context: '',
  prompt: [],
  callbackUrl: null,
};

export interface UseSaasReturn {
  /** 是否收到合法的 SAAS_INIT（userId/toolId 均有效） */
  isConnected: boolean;
  /** launch 接口调用是否已完成 */
  isReady: boolean;
  /** SaaS 传入的原始上下文（含 context/prompt，将透传给 /api/generate） */
  context: SaasContextData;
  userInfo: SaasUserInfo | null;
  toolInfo: SaasToolInfo | null;
  /** 当前剩余积分（verify/consume 后会刷新） */
  currentIntegral: number | null;
  /** 当前工具所需积分 */
  requiredIntegral: number | null;
  /** 是否可以生成（积分足够） */
  hasEnoughIntegral: boolean;
  /** 最近一次接口返回的提示信息（积分不足等） */
  message: string | null;
  /** 生成前调用，返回是否可继续 */
  verify: () => Promise<{ ok: boolean; message?: string }>;
  /** 生成成功后调用，扣积分并刷新本地 */
  consume: () => Promise<{ ok: boolean; message?: string }>;
}

export function useSaas(): UseSaasReturn {
  const [context, setContext] = useState<SaasContextData>(INITIAL_CONTEXT);
  const [userInfo, setUserInfo] = useState<SaasUserInfo | null>(null);
  const [toolInfo, setToolInfo] = useState<SaasToolInfo | null>(null);
  const [currentIntegral, setCurrentIntegral] = useState<number | null>(null);
  const [requiredIntegral, setRequiredIntegral] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const launchedRef = useRef<string | null>(null);

  const isConnected = context.userId !== null && context.toolId !== null;

  const callLaunch = useCallback(async (userId: string, toolId: string) => {
    try {
      const response = await fetch('/api/tool/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, toolId }),
      });
      const result = (await response.json()) as ToolLaunchResponse;
      if (isLenientSuccess(result) && result.data) {
        setUserInfo(result.data.user);
        setToolInfo(result.data.tool);
        setCurrentIntegral(result.data.user.integral);
        setRequiredIntegral(result.data.tool.integral);
        setMessage(null);
      } else {
        setMessage(result.message || result.error || 'launch 接口返回异常');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'launch 调用失败');
    } finally {
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: MessageEvent) => {
      const data = event.data as SaasInitPayload | null;
      if (!data || data.type !== 'SAAS_INIT') return;

      const userId = sanitizeId(data.userId);
      const toolId = sanitizeId(data.toolId);
      const promptList = Array.isArray(data.prompt)
        ? data.prompt.filter((item): item is string => typeof item === 'string')
        : [];

      setContext({
        userId,
        toolId,
        context: typeof data.context === 'string' ? data.context : '',
        prompt: promptList,
        callbackUrl: typeof data.callbackUrl === 'string' ? data.callbackUrl : null,
      });

      if (userId && toolId) {
        const key = `${userId}|${toolId}`;
        if (launchedRef.current !== key) {
          launchedRef.current = key;
          void callLaunch(userId, toolId);
        }
      } else {
        setIsReady(true);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [callLaunch]);

  const verify = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (!isConnected || !context.userId || !context.toolId) {
      return { ok: true };
    }
    try {
      const response = await fetch('/api/tool/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: context.userId, toolId: context.toolId }),
      });
      const result = (await response.json()) as ToolVerifyResponse;
      if (isLenientSuccess(result)) {
        if (result.data) {
          setCurrentIntegral(result.data.currentIntegral);
          setRequiredIntegral(result.data.requiredIntegral);
        }
        setMessage(null);
        return { ok: true };
      }
      const errMsg = result.message || result.error || '积分校验失败';
      setMessage(errMsg);
      return { ok: false, message: errMsg };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'verify 调用失败';
      setMessage(errMsg);
      return { ok: false, message: errMsg };
    }
  }, [isConnected, context.userId, context.toolId]);

  const consume = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    if (!isConnected || !context.userId || !context.toolId) {
      return { ok: true };
    }
    try {
      const response = await fetch('/api/tool/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: context.userId, toolId: context.toolId }),
      });
      const result = (await response.json()) as ToolConsumeResponse;
      if (isLenientSuccess(result) && result.data) {
        setCurrentIntegral(result.data.currentIntegral);
        setUserInfo((prev) =>
          prev ? { ...prev, integral: result.data!.currentIntegral } : prev
        );
        setMessage(null);
        return { ok: true };
      }
      const errMsg = result.message || result.error || '扣费失败';
      setMessage(errMsg);
      return { ok: false, message: errMsg };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'consume 调用失败';
      setMessage(errMsg);
      return { ok: false, message: errMsg };
    }
  }, [isConnected, context.userId, context.toolId]);

  const hasEnoughIntegral =
    !isConnected ||
    currentIntegral === null ||
    requiredIntegral === null ||
    currentIntegral >= requiredIntegral;

  return {
    isConnected,
    isReady,
    context,
    userInfo,
    toolInfo,
    currentIntegral,
    requiredIntegral,
    hasEnoughIntegral,
    message,
    verify,
    consume,
  };
}

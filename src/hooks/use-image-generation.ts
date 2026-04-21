/**
 * AI 生图 Hook
 * 处理流式生成逻辑
 */
'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  GenerateRequestPayload,
  SceneAnalysisResult,
} from '@/lib/curtain-ai-types';

export type SceneAnalysis = SceneAnalysisResult;

export interface GenerationState {
  isGenerating: boolean;
  progress: number;
  message: string;
  sceneAnalysis: SceneAnalysis | null;
  generatedImages: string[];
  error: string | null;
}

export type GenerateOptions = GenerateRequestPayload;

function formatGenerationError(error: unknown): string {
  if (!(error instanceof Error)) {
    return '生成失败，请稍后重试';
  }

  if (error.name === 'AbortError') {
    return '已取消';
  }

  if (
    error.message.includes('fetch failed') ||
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError')
  ) {
    return '网络连接中断或服务端响应超时，请稍后重试';
  }

  if (error.message.startsWith('HTTP error:')) {
    return `服务请求失败（${error.message.replace('HTTP error: ', 'HTTP ')})`;
  }

  return error.message;
}

/**
 * AI 生图 Hook
 */
export function useImageGeneration() {
  const [state, setState] = useState<GenerationState>({
    isGenerating: false,
    progress: 0,
    message: '',
    sceneAnalysis: null,
    generatedImages: [],
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * 开始生成
   */
  const startGeneration = useCallback(async (options: GenerateOptions) => {
    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setState({
      isGenerating: true,
      progress: 0,
      message: '正在连接...',
      sceneAnalysis: null,
      generatedImages: [],
      error: null,
    });

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'scene_analysis':
                setState((prev) => ({
                  ...prev,
                  sceneAnalysis: event.data as SceneAnalysis,
                }));
                break;

              case 'progress':
                setState((prev) => ({
                  ...prev,
                  progress: typeof event.progress === 'number' ? event.progress : prev.progress,
                  message: typeof event.data === 'string' ? event.data : prev.message,
                }));
                break;

              case 'image':
                setState((prev) => ({
                  ...prev,
                  generatedImages: event.data as string[],
                  // 如果还没完成，不要强制设置 100% 和 "生成完成"
                  // 进度由 progress 事件控制
                }));
                break;

              case 'error':
                setState((prev) => ({
                  ...prev,
                  error: event.error as string,
                  message: typeof event.error === 'string' ? event.error : prev.message,
                  isGenerating: false,
                }));
                break;

              case 'done':
                setState((prev) => ({
                  ...prev,
                  progress: 100,
                  message: '生成完成',
                  isGenerating: false,
                }));
                break;
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          message: '已取消',
        }));
      } else {
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          error: formatGenerationError(error),
          message: formatGenerationError(error),
        }));
      }
    }
  }, []);

  /**
   * 取消生成
   */
  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    cancelGeneration();
    setState({
      isGenerating: false,
      progress: 0,
      message: '',
      sceneAnalysis: null,
      generatedImages: [],
      error: null,
    });
  }, [cancelGeneration]);

  return {
    ...state,
    startGeneration,
    cancelGeneration,
    reset,
  };
}

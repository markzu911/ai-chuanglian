/**
 * AI 生图 Hook
 * 处理流式生成逻辑
 */
'use client';

import { useState, useCallback, useRef } from 'react';

export interface SceneAnalysis {
  hasCurtain: boolean;
  windowRegions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    hasCurtain: boolean;
    curtainType?: string;
  }>;
  recommendedMode: 'replace' | 'add';
  sceneDescription: string;
}

export interface GenerationState {
  isGenerating: boolean;
  progress: number;
  message: string;
  sceneAnalysis: SceneAnalysis | null;
  generatedImages: string[];
  error: string | null;
}

export interface GenerateOptions {
  sceneImage: string;
  curtainImages?: string[];
  mode?: 'replace' | 'add' | 'auto';
  style?: string;
  count?: number;
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
                  progress: event.data as number,
                  message: typeof event.data === 'string' ? event.data : '',
                }));
                break;

              case 'image':
                setState((prev) => ({
                  ...prev,
                  generatedImages: event.data as string[],
                  progress: 100,
                  message: '生成完成',
                }));
                break;

              case 'error':
                setState((prev) => ({
                  ...prev,
                  error: event.error as string,
                  isGenerating: false,
                }));
                break;

              case 'done':
                setState((prev) => ({
                  ...prev,
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
          error: error instanceof Error ? error.message : '生成失败',
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

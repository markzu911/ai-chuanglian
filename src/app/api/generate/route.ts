/**
 * 窗帘效果图生成 API
 * 支持流式输出（SSE）
 */
import { NextRequest, NextResponse } from 'next/server';
import { analyzeScene, generateCurtainImage, generateMultipleSchemes, SceneAnalysisResult } from '@/lib/coze-sdk';

/**
 * 生成请求
 */
export interface GenerateRequest {
  sceneImage: string; // 客户现场照片（URL）
  curtainImages?: string[]; // 窗帘商品图列表
  mode?: 'replace' | 'add' | 'auto'; // 生成模式
  style?: string; // 风格方向
  count?: number; // 生成数量（多方案模式）
}

/**
 * 生成响应（SSE 事件）
 */
export interface GenerateResponse {
  type: 'scene_analysis' | 'progress' | 'image' | 'error' | 'done';
  data?: SceneAnalysisResult | number | string | string[];
  progress?: number;
  error?: string;
}

/**
 * POST /api/generate
 * 流式生成窗帘效果图
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateRequest;

    // 参数校验
    if (!body.sceneImage) {
      return NextResponse.json(
        { error: '缺少场景图片' },
        { status: 400 }
      );
    }

    const mode = body.mode || 'auto';
    const count = body.count || 1;

    // 创建 SSE 流
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: GenerateResponse) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          // Step 1: 分析场景
          sendEvent({ type: 'progress', progress: 5, data: '正在分析场景...' });

          const sceneAnalysis = await analyzeScene(body.sceneImage);
          sendEvent({
            type: 'scene_analysis',
            data: sceneAnalysis,
          });

          // 确定最终模式
          const finalMode = mode === 'auto' ? sceneAnalysis.recommendedMode : mode;

          if (count === 1) {
            // 单图生成
            sendEvent({ type: 'progress', progress: 10, data: '正在生成效果图...' });

            const result = await generateCurtainImage({
              sceneImage: body.sceneImage,
              curtainImages: body.curtainImages || [],
              mode: finalMode,
              style: body.style,
            });

            if (result.success) {
              sendEvent({
                type: 'image',
                data: [result.imageUrl],
              });
            } else {
              sendEvent({
                type: 'error',
                error: result.error || '生成失败',
              });
            }
          } else {
            // 多方案生成
            sendEvent({ type: 'progress', progress: 10, data: `正在生成 ${count} 个方案...` });

            const results = await generateMultipleSchemes(
              {
                sceneImage: body.sceneImage,
                curtainImages: body.curtainImages || [],
                mode: finalMode,
                style: body.style,
              },
              count,
              (progress, message) => {
                sendEvent({ type: 'progress', progress, data: message });
              }
            );

            const imageUrls = results
              .filter((r) => r.success)
              .map((r) => r.imageUrl);

            if (imageUrls.length > 0) {
              sendEvent({
                type: 'image',
                data: imageUrls,
              });
            } else {
              sendEvent({
                type: 'error',
                error: '所有方案生成失败',
              });
            }
          }

          sendEvent({ type: 'done' });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '未知错误';
          sendEvent({ type: 'error', error: errorMessage });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * GET /api/generate
 * 健康检查
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'curtain-ai-generator',
    version: '1.0.0',
  });
}

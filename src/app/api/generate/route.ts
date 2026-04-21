/**
 * 窗帘效果图生成 API
 * 支持流式输出（SSE）
 */
import { NextRequest, NextResponse } from 'next/server';
import { analyzeScene, generateCurtainImage, generateMultipleSchemes, generateCurtainShowcase } from '@/lib/coze-sdk';
import type {
  CurtainReference,
  CurtainStructure,
  GenerateRequestPayload,
  SceneAnalysisResult,
  ShowcaseAngle,
} from '@/lib/curtain-ai-types';
import { mergePromptWithSaas } from '@/lib/saas-utils';

export const runtime = 'nodejs';

/**
 * 生成响应（SSE 事件）
 */
export interface GenerateResponse {
  type: 'scene_analysis' | 'progress' | 'image' | 'error' | 'done';
  data?: SceneAnalysisResult | number | string | string[];
  progress?: number;
  error?: string;
}

function startWaitingTicker(sendEvent: (data: GenerateResponse) => void, initialProgress: number) {
  const waitingMessages = [
    '模型仍在生成，请保持页面开启...',
    '图像细节正在精修，马上就好...',
    '后台质检与重试进行中...',
  ];

  let tick = 0;
  let progress = initialProgress;

  return setInterval(() => {
    progress = Math.min(88, progress + 2);
    const message = waitingMessages[tick % waitingMessages.length];
    tick += 1;
    sendEvent({ type: 'progress', progress, data: message });
  }, 3000);
}

/**
 * POST /api/generate
 * 流式生成窗帘效果图
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateRequestPayload;

    // 参数校验
    const mode = body.mode || 'auto';

    // 前线入口日志：确认请求到达 + 模式 + 角度列表
    try {
      const { appendFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const logPath = process.env.CURTAIN_DEBUG_LOG || join(process.cwd(), 'tmp', 'curtain-debug.log');
      mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
      appendFileSync(
        logPath,
        `[${new Date().toISOString()}][route POST] mode=${mode} showcaseAngles=${JSON.stringify(body.showcaseAngles)} count=${body.count} hasSceneImage=${Boolean(body.sceneImage)} curtainImagesCount=${body.curtainImages?.length || 0}\n\n`
      );
    } catch (logError) {
      console.warn('[route POST] debug log failed:', logError);
    }

    // 电商展示模式不需要场景图片
    if (mode !== 'showcase' && !body.sceneImage) {
      return NextResponse.json(
        { error: '缺少场景图片' },
        { status: 400 }
      );
    }
    
    // 电商展示模式需要窗帘图片
    if (mode === 'showcase' && (!body.curtainImages || body.curtainImages.length === 0)) {
      return NextResponse.json(
        { error: '电商展示模式需要提供窗帘商品图' },
        { status: 400 }
      );
    }
    const count = body.count || 1;
    const curtainReferences = normalizeCurtainReferences(body.curtainReferences, body.curtainImages);
    const curtainStructure = normalizeCurtainStructure(body.curtainStructure, curtainReferences);

    // 合成最终提示词：内部预设风格 + SaaS context + SaaS prompt[]
    const mergedStyle = mergePromptWithSaas(body.style, body.saasContext, body.saasPrompt);

    // 创建 SSE 流
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: GenerateResponse) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        // 启动心跳，防止连接超时
        const heartbeat = setInterval(() => {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        }, 15000);

        try {
          // 电商展示模式处理
          if (mode === 'showcase') {
            sendEvent({ type: 'progress', progress: 10, data: '正在生成电商展示图...' });

            const curtainImage = body.curtainImages?.[0];
            if (!curtainImage) {
              sendEvent({ type: 'error', error: '未找到窗帘图片' });
              sendEvent({ type: 'done' });
              return;
            }

            const waitingTicker = startWaitingTicker(sendEvent, 18);

            const currentImageMap = new Map<ShowcaseAngle, string>();
            const results = await generateCurtainShowcase(
              {
                curtainImage,
                style: mergedStyle,
                angles: body.showcaseAngles && body.showcaseAngles.length > 0 ? body.showcaseAngles : undefined,
                angle: 'all',
              },
              (progress, message) => {
                sendEvent({ type: 'progress', progress, data: message });
              },
              (imageUrl, angle) => {
                // 按角度索引覆盖：初版与质检后最终版共享一个 key，前端只会看到每角度一张
                currentImageMap.set(angle, imageUrl);
                sendEvent({
                  type: 'image',
                  data: Array.from(currentImageMap.values()),
                });
              }
            ).finally(() => clearInterval(waitingTicker));

            const finalImageUrls = results
              .filter((r) => r.success)
              .map((r) => r.imageUrl);
            const failedMessages = results
              .filter((r) => !r.success && r.error)
              .map((r) => r.error as string);

            if (finalImageUrls.length > 0) {
              // 最后确保推送一次完整的列表
              sendEvent({
                type: 'image',
                data: finalImageUrls,
              });

              if (failedMessages.length > 0) {
                sendEvent({
                  type: 'error',
                  error: `部分电商图生成失败：${failedMessages.join('；')}`,
                });
              }
            } else {
              sendEvent({
                type: 'error',
                error: results[0]?.error || '电商展示生成失败',
              });
            }

            sendEvent({ type: 'done' });
            return;
          }

          // Step 1: 分析场景
          sendEvent({ type: 'progress', progress: 5, data: '正在准备场景分析...' });

          const sceneAnalysis = body.sceneAnalysisOverride || await analyzeScene(body.sceneImage);
          sendEvent({
            type: 'scene_analysis',
            data: sceneAnalysis,
          });

          // 确定最终模式
          const finalMode = mode === 'auto' ? sceneAnalysis.recommendedMode : mode;

          if (count === 1) {
            // 单图生成
            sendEvent({ type: 'progress', progress: 10, data: '正在生成效果图...' });

            const waitingTicker = startWaitingTicker(sendEvent, 28);

            const result = await generateCurtainImage({
              sceneImage: body.sceneImage,
              curtainReferences,
              mode: finalMode,
              style: mergedStyle,
              curtainStructure,
              sceneAnalysisOverride: sceneAnalysis,
            }, (progress, message) => {
              sendEvent({ type: 'progress', progress, data: message });
            }).finally(() => clearInterval(waitingTicker));

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

            const currentImageUrls: string[] = [];
            const results = await generateMultipleSchemes(
              {
                sceneImage: body.sceneImage,
                curtainReferences,
                mode: finalMode,
                style: mergedStyle,
                curtainStructure,
                sceneAnalysisOverride: sceneAnalysis,
              },
              count,
              (progress, message) => {
                sendEvent({ type: 'progress', progress, data: message });
              },
              (imageUrl) => {
                currentImageUrls.push(imageUrl);
                // 实时推送当前已生成的图片列表
                sendEvent({
                  type: 'image',
                  data: [...currentImageUrls],
                });
              }
            );

            const finalImageUrls = results
              .filter((r) => r.success)
              .map((r) => r.imageUrl);

            if (finalImageUrls.length > 0) {
              // 确保推送一次完整的列表
              sendEvent({
                type: 'image',
                data: finalImageUrls,
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
          clearInterval(heartbeat);
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

function normalizeCurtainReferences(
  curtainReferences: CurtainReference[] | undefined,
  curtainImages: string[] | undefined
): CurtainReference[] {
  if (Array.isArray(curtainReferences) && curtainReferences.length > 0) {
    return curtainReferences.filter((reference) => typeof reference?.url === 'string' && reference.url.length > 0);
  }

  if (!Array.isArray(curtainImages)) {
    return [];
  }

  return curtainImages
    .filter((url) => typeof url === 'string' && url.length > 0)
    .map((url) => ({
      url,
      role: 'generic',
    }));
}

function normalizeCurtainStructure(
  curtainStructure: CurtainStructure | undefined,
  curtainReferences: CurtainReference[]
): CurtainStructure {
  if (curtainStructure === 'single' || curtainStructure === 'double') {
    return curtainStructure;
  }

  const hasFabric = curtainReferences.some((reference) => reference.role === 'fabric');
  const hasSheer = curtainReferences.some((reference) => reference.role === 'sheer');

  if (hasFabric && hasSheer) {
    return 'double';
  }

  return 'auto';
}

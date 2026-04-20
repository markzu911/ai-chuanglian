import { NextRequest, NextResponse } from 'next/server';
import { analyzeScene } from '@/lib/coze-sdk';
import type { SceneAnalysisResult } from '@/lib/curtain-ai-types';

export const runtime = 'nodejs';

interface AnalyzeRequest {
  sceneImage: string;
}

interface AnalyzeResponse {
  success: boolean;
  data?: SceneAnalysisResult;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<AnalyzeResponse>> {
  try {
    const body = (await request.json()) as AnalyzeRequest;

    if (!body.sceneImage) {
      return NextResponse.json(
        {
          success: false,
          error: '缺少场景图片',
        },
        { status: 400 }
      );
    }

    const result = await analyzeScene(body.sceneImage);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    service: 'scene-analysis',
  });
}

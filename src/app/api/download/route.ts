/**
 * 图片下载代理 API
 * 用于解决跨域下载导致的 "Failed to fetch" 问题
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const filename = searchParams.get('filename') || 'curtain-effect.png';

  if (!url) {
    return NextResponse.json({ error: '缺少图片 URL' }, { status: 400 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`无法获取图片: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const contentType = response.headers.get('content-type') || 'image/png';

    // 返回图片二进制数据，并设置下载响应头
    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (error) {
    console.error('下载代理失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
}

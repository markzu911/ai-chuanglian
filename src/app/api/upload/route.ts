/**
 * 图片上传 API
 * 将 base64 图片转为可访问的 URL
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export interface UploadResponse {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * POST /api/upload
 * 上传图片并返回可访问的 URL
 */
export async function POST(request: NextRequest): Promise<NextResponse<UploadResponse>> {
  try {
    const body = await request.json();

    if (!body.image || typeof body.image !== 'string') {
      return NextResponse.json(
        { success: false, error: '缺少图片数据' },
        { status: 400 }
      );
    }

    const base64Data = body.image;

    // 检查是否是 base64 格式
    if (!base64Data.startsWith('data:image/')) {
      // 如果不是 base64，假设已经是 URL
      return NextResponse.json({
        success: true,
        url: base64Data,
      });
    }

    // 提取 mime 类型和数据
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return NextResponse.json(
        { success: false, error: '无效的图片格式' },
        { status: 400 }
      );
    }

    const mimeType = matches[1];
    const base64Content = matches[2];

    // 生成唯一文件名
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const extension = mimeType.split('/')[1] || 'png';
    const filename = `curtain-${timestamp}-${randomStr}.${extension}`;

    // 将 base64 转为 Buffer
    const imageBuffer = Buffer.from(base64Content, 'base64');

    // 保存到 public/uploads 目录
    const fs = await import('fs/promises');
    const path = await import('path');

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    const filePath = path.join(uploadDir, filename);

    // 确保目录存在
    await fs.mkdir(uploadDir, { recursive: true });

    // 写入文件
    await fs.writeFile(filePath, imageBuffer);

    // 构建可访问的 URL
    let baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT || request.nextUrl.origin;

    // 如果 origin 是 0.0.0.0，在本地环境下通常应该指向 localhost 才能在浏览器中正常显示
    if (baseUrl.includes('//0.0.0.0')) {
      baseUrl = baseUrl.replace('//0.0.0.0', '//localhost');
    }

    const imageUrl = `${baseUrl}/uploads/${filename}`;

    return NextResponse.json({
      success: true,
      url: imageUrl,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * GET /api/upload
 * 健康检查
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    service: 'image-upload',
  });
}

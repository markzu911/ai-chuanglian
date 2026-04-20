/**
 * SaaS 三步走代理转发（仅供 app/api/tool/** 的 route.ts 调用）
 * 转发到 http://aibigtree.com/api/tool/{path}
 */
import { NextRequest, NextResponse } from 'next/server';
import { SAAS_API_BASE_URL } from '@/lib/saas-utils';
import type { SaasApiResponse } from '@/lib/saas-types';

export async function handleToolOptions(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204 });
}

export async function proxyToolRequest<T = unknown>(
  request: NextRequest,
  path: '/api/tool/launch' | '/api/tool/verify' | '/api/tool/consume'
): Promise<NextResponse<SaasApiResponse<T>>> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const upstream = await fetch(`${SAAS_API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const text = await upstream.text();
    let parsed: SaasApiResponse<T>;
    try {
      parsed = JSON.parse(text) as SaasApiResponse<T>;
    } catch {
      parsed = {
        success: false,
        error: `\u4e0a\u6e38\u54cd\u5e94\u975e JSON (status=${upstream.status})`,
      };
    }

    return NextResponse.json(parsed, { status: upstream.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : '\u4ee3\u7406\u8f6c\u53d1\u5931\u8d25';
    return NextResponse.json<SaasApiResponse<T>>(
      { success: false, error: message },
      { status: 502 }
    );
  }
}

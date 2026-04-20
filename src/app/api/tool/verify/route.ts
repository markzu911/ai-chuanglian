import { NextRequest } from 'next/server';
import { proxyToolRequest, handleToolOptions } from '@/lib/saas-proxy';
import type { ToolVerifyResponseData } from '@/lib/saas-types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return proxyToolRequest<ToolVerifyResponseData>(request, '/api/tool/verify');
}

export async function OPTIONS() {
  return handleToolOptions();
}

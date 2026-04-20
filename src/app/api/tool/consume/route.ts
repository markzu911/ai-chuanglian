import { NextRequest } from 'next/server';
import { proxyToolRequest, handleToolOptions } from '@/lib/saas-proxy';
import type { ToolConsumeResponseData } from '@/lib/saas-types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return proxyToolRequest<ToolConsumeResponseData>(request, '/api/tool/consume');
}

export async function OPTIONS() {
  return handleToolOptions();
}

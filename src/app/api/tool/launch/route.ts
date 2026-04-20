import { NextRequest } from 'next/server';
import { proxyToolRequest, handleToolOptions } from '@/lib/saas-proxy';
import type { ToolLaunchResponseData } from '@/lib/saas-types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return proxyToolRequest<ToolLaunchResponseData>(request, '/api/tool/launch');
}

export async function OPTIONS() {
  return handleToolOptions();
}

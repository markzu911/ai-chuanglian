/**
 * Provider 共享工具
 */

/**
 * 把图片 URL 规范化为 Provider 可消费的格式：
 * - data URL 原样返回
 * - 本地静态资源（localhost/127.0.0.1）读文件转成 base64 data URL
 * - 公网 URL 原样返回（Ark 支持 URL，Gemini 需要再用 fetchAsInlineData 转 base64）
 */
export async function resolveImageInput(url: string): Promise<string> {
  if (!url || url.startsWith('data:image/')) {
    return url;
  }

  if (
    url.startsWith('http://localhost') ||
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('http://0.0.0.0')
  ) {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const urlObj = new URL(url);
      const filePath = path.join(process.cwd(), 'public', urlObj.pathname);
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1) || 'png';
      const mimeType = ext === 'jpg' ? 'jpeg' : ext;
      return `data:image/${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
      console.error('无法转换本地图片为 base64:', error);
      return url;
    }
  }

  return url;
}

/**
 * 从 LLM 返回的自由文本里抠出 JSON 字符串
 */
export function extractJsonFromResponse(content: string): string {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  const codeMatch = content.match(/```\s*([\s\S]*?)\s*```/);
  if (codeMatch) {
    return codeMatch[1].trim();
  }

  const objMatch = content.match(/\{[\s\S]*\}/);
  if (objMatch) {
    return objMatch[0];
  }

  return content;
}

/** Gemini inlineData 结构 */
export interface InlineData {
  mimeType: string;
  data: string;
}

/**
 * 把 data URL 拆成 Gemini 需要的 inlineData 结构
 */
function parseDataUrl(dataUrl: string): InlineData | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/**
 * 把任意图片输入（data URL / http URL / localhost URL）转成 Gemini 可吃的 inlineData。
 * Gemini REST API 的 inlineData 字段只接受 base64，不接受公网 URL。
 */
export async function toInlineData(url: string): Promise<InlineData> {
  const resolved = await resolveImageInput(url);

  const parsed = parseDataUrl(resolved);
  if (parsed) return parsed;

  // 公网 URL：下载后 base64 编码
  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`下载图片失败: ${response.status} ${resolved}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = response.headers.get('content-type') || 'image/png';
  return {
    mimeType,
    data: buffer.toString('base64'),
  };
}

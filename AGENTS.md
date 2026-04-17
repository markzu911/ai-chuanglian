# 窗帘 AI 工具项目上下文

### 项目简介
面向窗帘商家的 AI 商品实景挂装与方案出图工具，帮助商家将窗帘商品展示到客户真实空间中，提升销售转化率。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **AI SDK**: coze-coding-dev-sdk (LLM 多模态理解)
- **图像生成**: 火山方舟 Seedream (ark.cn-beijing.volces.com)

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   │   ├── page.tsx        # 首页（主入口）
│   │   ├── layout.tsx      # 根布局
│   │   └── api/            # API 路由
│   │       └── generate/   # AI 生图 API
│   │           └── route.ts # 流式生成接口
│   ├── components/          # 组件目录
│   │   ├── ui/             # Shadcn UI 组件库
│   │   ├── image-uploader.tsx    # 图片上传组件
│   │   ├── curtain-display.tsx   # 窗帘展示组件
│   │   └── generation-panel.tsx  # 生成控制面板
│   ├── hooks/              # 自定义 Hooks
│   │   └── use-image-generation.ts # AI 生图 Hook
│   ├── lib/                 # 工具库
│   │   ├── utils.ts        # 通用工具函数 (cn)
│   │   └── coze-sdk.ts     # Coze SDK 封装
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

## 核心功能模块

### 1. 图片上传模块
- **客户现场照片上传**：支持拖拽上传、点击上传、剪贴板粘贴
- **窗帘商品图上传**：支持多张商品图上传
- **图片预览**：支持原图预览、缩放、对比

### 2. 场景识别模块
- 使用 LLM 多模态能力识别图像中的窗户区域
- 判断是否已有窗帘（替换场景 vs 新增挂装场景）
- 提取窗户位置、尺寸、布帘/纱帘结构等信息

### 3. AI 生图模块
- 基于窗帘商品图生成实景效果图
- 支持三种生成模式：
  - 商品替换：替换已有窗帘
  - 新增挂装：在空窗区域生成窗帘
  - 自动风格：系统推荐风格方案
- 流式输出：实时展示生成进度
- 多方案对比：支持同时生成多个方案

### 4. 效果展示模块
- 原图与效果图对比展示
- 多方案并列对比
- 下载高清效果图
- 复制分享链接

## API 设计

### POST /api/generate
流式生成窗帘效果图

**请求体**：
```typescript
interface GenerateRequest {
  sceneImage: string;      // 客户现场照片（URL 或 Base64）
  curtainImages: string[]; // 窗帘商品图列表
  mode: 'replace' | 'add' | 'auto'; // 生成模式
  style?: string;          // 风格方向（auto 模式使用）
}
```

**响应**：SSE 流式输出
```typescript
interface GenerateResponse {
  type: 'progress' | 'image' | 'error' | 'done';
  progress?: number;       // 进度 0-100
  imageUrl?: string;       // 生成完成的图片 URL
  message?: string;         // 状态消息
  error?: string;          // 错误信息
}
```

## 性能优化规范

1. **首屏加载**：图片懒加载，非首屏图片使用 loading="lazy"
2. **流式渲染**：使用 SSE + ReadableStream 实现实时进度
3. **CLS 优化**：上传区域设置固定尺寸，避免布局抖动
4. **错误处理**：网络异常自动重试，失败后降级展示

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 火山方舟 API 配置

### 环境变量配置

```bash
# 火山方舟 API Key（必须）
export ARK_API_KEY="your_api_key_here"

# 火山方舟 API 地址
export ARK_API_BASE="https://ark.cn-beijing.volces.com/api/v3"

# LLM API Key（用于场景分析）
export COZE_WORKLOAD_IDENTITY_API_KEY="your_llm_api_key"
```

### API 调用示例

```typescript
// 火山方舟 Seedream 模型调用
const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.ARK_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'ep-20260417093524-5qxv2',
    prompt: '你的提示词',
    response_format: 'url',
    size: '2K',
  }),
});
```

### 模型说明

- **模型 ID**: `ep-20260417093524-5qxv2`
- **支持尺寸**: 2K (2048x2048), 4K (4096x4096)
- **支持功能**: 文生图、图生图
- **API 文档**: https://www.volcengine.com/docs/82379/1399008

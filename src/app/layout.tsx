import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '窗帘 AI 工具',
    template: '%s | 窗帘 AI 工具',
  },
  description:
    '面向窗帘商家的 AI 商品实景挂装与方案出图工具，帮助商家将窗帘商品展示到客户真实空间中，提升销售转化率。',
  keywords: [
    '窗帘AI',
    '窗帘效果图',
    '窗帘设计',
    '窗帘销售工具',
    'AI生图',
    '商品替换',
  ],
  authors: [{ name: 'Coze Code Team', url: 'https://code.coze.cn' }],
  generator: 'Coze Code',
  // icons: {
  //   icon: '',
  // },
  openGraph: {
    title: '扣子编程 | 你的 AI 工程师已就位',
    description:
      '我正在使用扣子编程 Vibe Coding，让创意瞬间上线。告别拖拽，拥抱心流。',
    url: 'https://code.coze.cn',
    siteName: '扣子编程',
    locale: 'zh_CN',
    type: 'website',
    // images: [
    //   {
    //     url: '',
    //     width: 1200,
    //     height: 630,
    //     alt: '扣子编程 - 你的 AI 工程师',
    //   },
    // ],
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'Coze Code | Your AI Engineer is Here',
  //   description:
  //     'Build and deploy full-stack applications through AI conversation. No env setup, just flow.',
  //   // images: [''],
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`antialiased`} suppressHydrationWarning>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}

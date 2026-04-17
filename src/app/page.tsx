/**
 * 窗帘 AI 工具 - 首页
 * 面向窗帘商家的 AI 商品实景挂装与方案出图工具
 */
'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Shirt, Palette, Sparkles } from 'lucide-react';
import { ImageUploader, UploadedImage } from '@/components/image-uploader';
import { GenerationPanel, GenerationOptions } from '@/components/generation-panel';
import { GeneratedResult } from '@/components/curtain-display';
import { useImageGeneration } from '@/hooks/use-image-generation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export default function Home() {
  // 上传的图片
  const [sceneImage, setSceneImage] = useState<UploadedImage | null>(null);
  const [curtainImages, setCurtainImages] = useState<UploadedImage[]>([]);

  // 生成选项
  const [options, setOptions] = useState<GenerationOptions>({
    mode: 'auto',
    style: '',
    count: 1,
  });

  // AI 生成状态
  const {
    isGenerating,
    progress,
    message,
    sceneAnalysis,
    generatedImages,
    error,
    startGeneration,
    cancelGeneration,
    reset,
  } = useImageGeneration();

  // 判断是否可以生成
  const canGenerate = sceneImage !== null && !isGenerating;

  // 开始生成
  const handleGenerate = useCallback(() => {
    if (!sceneImage) return;

    const sceneImageUrl = sceneImage.url;

    // 如果没有上传窗帘商品图，且模式为 replace，则自动切换为 add 模式
    const mode = curtainImages.length === 0 && options.mode === 'replace' ? 'add' : options.mode;

    startGeneration({
      sceneImage: sceneImageUrl,
      curtainImages: curtainImages.map((img) => img.url),
      mode,
      style: options.style,
      count: options.count,
    });
  }, [sceneImage, curtainImages, options, startGeneration]);

  // 重置
  const handleReset = useCallback(() => {
    reset();
    setSceneImage(null);
    setCurtainImages([]);
    setOptions({
      mode: 'auto',
      style: '',
      count: 1,
    });
  }, [reset]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* 头部 */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Shirt className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">窗帘 AI 工具</h1>
              <p className="text-sm text-muted-foreground">
                面向窗帘商家的 AI 商品实景挂装工具
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 左侧：上传区域 */}
          <div className="space-y-6">
            {/* 场景图片上传 */}
            <ImageUploader
              type="scene"
              value={sceneImage ? [sceneImage] : []}
              onChange={(images) => setSceneImage(images[0] || null)}
              maxCount={1}
              disabled={isGenerating}
            />

            {/* 场景分析结果 */}
            {sceneAnalysis && !isGenerating && (
              <Alert>
                <AlertDescription>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={sceneAnalysis.hasCurtain ? 'default' : 'secondary'}>
                      {sceneAnalysis.hasCurtain ? '已有窗帘' : '无窗帘'}
                    </Badge>
                    <Badge variant="outline">
                      检测到 {sceneAnalysis.windowRegions.length} 个窗户
                    </Badge>
                    <Badge variant="outline">
                      推荐模式：{sceneAnalysis.recommendedMode === 'replace' ? '商品替换' : '新增挂装'}
                    </Badge>
                  </div>
                  {sceneAnalysis.sceneDescription && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {sceneAnalysis.sceneDescription}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* 窗帘商品图上传 */}
            <ImageUploader
              type="curtain"
              value={curtainImages}
              onChange={setCurtainImages}
              maxCount={5}
              disabled={isGenerating}
            />

            {/* 错误提示 */}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          {/* 右侧：生成控制 */}
          <div className="space-y-6">
            {/* 生成面板 */}
            <GenerationPanel
              options={options}
              onOptionsChange={setOptions}
              isGenerating={isGenerating}
              progress={progress}
              message={message}
              onGenerate={handleGenerate}
              onCancel={cancelGeneration}
              onReset={handleReset}
              disabled={!sceneImage}
              canGenerate={canGenerate}
            />

            {/* 生成结果 */}
            {!isGenerating && generatedImages.length > 0 && (
              <GeneratedResult
                originalImage={sceneImage?.url}
                generatedImages={generatedImages}
                isGenerating={isGenerating}
                onReset={handleReset}
              />
            )}

            {/* 使用提示 */}
            {sceneImage && !isGenerating && generatedImages.length === 0 && (
              <Card className="p-6">
                <h3 className="font-medium mb-4">使用说明</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>上传客户现场照片（客厅、卧室、飘窗或落地窗）</li>
                  <li>上传窗帘商品图（如需商品替换）</li>
                  <li>选择生成模式和风格方向</li>
                  <li>点击&quot;开始生成&quot;按钮</li>
                  <li>等待 AI 生成效果图</li>
                  <li>下载或复制效果图发送给客户</li>
                </ol>
                <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm font-medium mb-2">提示：</p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>上传窗帘商品图可实现精准替换效果</li>
                    <li>不上传商品图将自动匹配合适的风格</li>
                    <li>支持同时生成多个方案进行对比</li>
                  </ul>
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>

      {/* 底部 */}
      <footer className="border-t bg-muted/30 mt-12">
        <div className="container mx-auto px-4 py-6">
          <p className="text-center text-sm text-muted-foreground">
            窗帘 AI 工具 - 助力窗帘商家提升销售转化率
          </p>
        </div>
      </footer>
    </div>
  );
}

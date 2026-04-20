/**
 * 窗帘 AI 工具 - 首页
 * 面向窗帘商家的 AI 商品实景挂装与方案出图工具
 */
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ScanSearch, Shirt } from 'lucide-react';
import { ImageUploader, UploadedImage } from '@/components/image-uploader';
import { GenerationPanel, GenerationOptions } from '@/components/generation-panel';
import { GeneratedResult } from '@/components/curtain-display';
import { SceneAnalysisEditor } from '@/components/scene-analysis-editor';
import { useImageGeneration } from '@/hooks/use-image-generation';
import type {
  CurtainReference,
  CurtainReferenceRole,
  SceneAnalysisResult,
} from '@/lib/curtain-ai-types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface AnalyzeResponse {
  success: boolean;
  data?: SceneAnalysisResult;
  error?: string;
}

export default function Home() {
  const [pageMode, setPageMode] = useState<'scene' | 'showcase'>('scene'); // 页面模式：场景替换 vs 艺术展示
  const [sceneImage, setSceneImage] = useState<UploadedImage | null>(null);
  const [singleCurtainImages, setSingleCurtainImages] = useState<UploadedImage[]>([]);
  const [fabricCurtainImages, setFabricCurtainImages] = useState<UploadedImage[]>([]);
  const [sheerCurtainImages, setSheerCurtainImages] = useState<UploadedImage[]>([]);
  const [detectedSceneAnalysis, setDetectedSceneAnalysis] = useState<SceneAnalysisResult | null>(null);
  const [editableSceneAnalysis, setEditableSceneAnalysis] = useState<SceneAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [options, setOptions] = useState<GenerationOptions>({
    mode: 'auto',
    structure: 'auto',
    style: '',
    count: 1,
    showcaseAngles: ['vertical', 'horizontal', 'detail', 'scene'],
  });

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

  const canGenerate =
    (pageMode === 'scene' ? sceneImage !== null : singleCurtainImages.length > 0) &&
    !isGenerating;

  const analyzeSceneImage = useCallback(async (imageUrl: string) => {
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sceneImage: imageUrl,
        }),
      });

      const result = (await response.json()) as AnalyzeResponse;
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || `识别失败 (${response.status})`);
      }

      setDetectedSceneAnalysis(result.data);
      setEditableSceneAnalysis(result.data);
    } catch (analyzeError) {
      setAnalysisError(analyzeError instanceof Error ? analyzeError.message : '识别失败');
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  useEffect(() => {
    if (!sceneImage) {
      setDetectedSceneAnalysis(null);
      setEditableSceneAnalysis(null);
      setAnalysisError(null);
      setIsAnalyzing(false);
      return;
    }

    void analyzeSceneImage(sceneImage.url);
  }, [sceneImage, analyzeSceneImage]);

  useEffect(() => {
    if (sceneAnalysis) {
      setDetectedSceneAnalysis(sceneAnalysis);
      setEditableSceneAnalysis(sceneAnalysis);
      setAnalysisError(null);
    }
  }, [sceneAnalysis]);

  const handleGenerate = useCallback(() => {
    if (pageMode === 'showcase') {
      // 艺术展示模式
      if (!singleCurtainImages.length) return;

      startGeneration({
        sceneImage: singleCurtainImages[0].url,
        curtainReferences: [],
        mode: 'showcase',
        style: options.style,
        count: 1,
        curtainImages: singleCurtainImages.map((img) => img.url),
        showcaseAngles: options.showcaseAngles,
      });
    } else {
      // 场景替换模式
      if (!sceneImage) return;

      const curtainReferences = buildCurtainReferences({
        structure: options.structure,
        singleCurtainImages,
        fabricCurtainImages,
        sheerCurtainImages,
      });

      const mode = curtainReferences.length === 0 && options.mode === 'replace' ? 'add' : options.mode;

      startGeneration({
        sceneImage: sceneImage.url,
        curtainReferences,
        mode,
        style: options.style,
        count: options.count,
        curtainStructure: options.structure,
        sceneAnalysisOverride: editableSceneAnalysis || undefined,
      });
    }
  }, [
    pageMode,
    sceneImage,
    options,
    singleCurtainImages,
    fabricCurtainImages,
    sheerCurtainImages,
    editableSceneAnalysis,
    startGeneration,
  ]);

  const handleReset = useCallback(() => {
    reset();
    setSceneImage(null);
    setSingleCurtainImages([]);
    setFabricCurtainImages([]);
    setSheerCurtainImages([]);
    setDetectedSceneAnalysis(null);
    setEditableSceneAnalysis(null);
    setAnalysisError(null);
    setOptions({
      mode: 'auto',
      structure: 'auto',
      style: '',
      count: 1,
      showcaseAngles: ['vertical', 'horizontal', 'detail', 'scene'],
    });
  }, [reset]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                <Shirt className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">窗帘 AI 工具</h1>
                <p className="text-sm text-muted-foreground">
                  面向窗帘商家的 AI 商品实景挂装工具
                </p>
              </div>
            </div>
          </div>
          
          {/* 模式选择 */}
          <div className="flex gap-2 border-t pt-4">
            <Button
              variant={pageMode === 'scene' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setPageMode('scene');
                handleReset();
              }}
              disabled={isGenerating}
            >
              场景替换
            </Button>
            <Button
              variant={pageMode === 'showcase' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setPageMode('showcase');
                handleReset();
              }}
              disabled={isGenerating}
            >
              艺术展示
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            {/* 场景替换模式 */}
            {pageMode === 'scene' && (
              <>
                <ImageUploader
                  type="scene"
                  value={sceneImage ? [sceneImage] : []}
                  onChange={(images) => setSceneImage(images[0] || null)}
                  maxCount={1}
                  disabled={isGenerating}
                  title="客户现场照片"
                  description="上传客户家的真实空间照片，系统会自动识别窗区并允许手动修正。"
                />

                {sceneImage && (
                  <Alert>
                    <AlertDescription>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={isAnalyzing ? 'secondary' : 'outline'}>
                          {isAnalyzing ? '窗区识别中' : '窗区识别已完成'}
                        </Badge>
                        {editableSceneAnalysis && (
                          <>
                            <Badge variant={editableSceneAnalysis.hasCurtain ? 'default' : 'secondary'}>
                              {editableSceneAnalysis.hasCurtain ? '已有窗帘' : '无窗帘'}
                            </Badge>
                            <Badge variant="outline">
                              检测到 {editableSceneAnalysis.windowRegions.length} 个窗区
                            </Badge>
                            <Badge variant="outline">
                              推荐模式：
                              {editableSceneAnalysis.recommendedMode === 'replace' ? '商品替换' : '新增挂装'}
                            </Badge>
                          </>
                        )}
                      </div>
                      {editableSceneAnalysis?.sceneDescription && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {editableSceneAnalysis.sceneDescription}
                        </p>
                      )}
                      {analysisError && (
                        <p className="mt-2 text-sm text-destructive">{analysisError}</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {sceneImage && editableSceneAnalysis && (
                  <SceneAnalysisEditor
                    sceneImageUrl={sceneImage.url}
                    value={editableSceneAnalysis}
                    disabled={isGenerating || isAnalyzing}
                    onChange={setEditableSceneAnalysis}
                    onReset={() => {
                      if (sceneImage) {
                        void analyzeSceneImage(sceneImage.url);
                      }
                    }}
                  />
                )}

                {options.structure === 'double' ? (
                  <div className="space-y-6">
                    <ImageUploader
                      type="curtain"
                      value={fabricCurtainImages}
                      onChange={setFabricCurtainImages}
                      maxCount={3}
                      disabled={isGenerating}
                      title="布帘商品图"
                      description="双层结构下用于主帘替换。建议上传正面、清晰的布帘商品图。"
                    />
                    <ImageUploader
                      type="curtain"
                      value={sheerCurtainImages}
                      onChange={setSheerCurtainImages}
                      maxCount={3}
                      disabled={isGenerating}
                      title="纱帘商品图"
                      description="双层结构下用于纱帘层生成。越清晰越能稳定保持透光和轻薄感。"
                    />
                  </div>
                ) : (
                  <ImageUploader
                    type="curtain"
                    value={singleCurtainImages}
                    onChange={setSingleCurtainImages}
                    maxCount={5}
                    disabled={isGenerating}
                    title={options.structure === 'single' ? '单层窗帘商品图' : '通用窗帘商品图'}
                    description={
                      options.structure === 'single'
                        ? '用于单层替换或新增挂装。'
                        : '如果暂时不区分布帘和纱帘，可以先上传通用商品图；若需精准双层替换，请切换到双层结构。'
                    }
                  />
                )}
              </>
            )}

            {/* 艺术展示模式 */}
            {pageMode === 'showcase' && (
              <>
                <ImageUploader
                  type="curtain"
                  value={singleCurtainImages}
                  onChange={setSingleCurtainImages}
                  maxCount={1}
                  disabled={isGenerating}
                  title="窗帘商品图"
                  description="上传1张清晰的窗帘商品图，可在右侧勾选要生成的角度（1-4 张，按需选择更省成本）。"
                />
              </>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-6">
            <GenerationPanel
              options={options}
              onOptionsChange={setOptions}
              isGenerating={isGenerating}
              progress={progress}
              message={message}
              onGenerate={handleGenerate}
              onCancel={cancelGeneration}
              onReset={handleReset}
              disabled={pageMode === 'scene' ? !sceneImage : singleCurtainImages.length === 0}
              canGenerate={canGenerate}
              pageMode={pageMode}
            />

            {detectedSceneAnalysis && !isGenerating && (
              <Card className="p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 font-medium">
                      <ScanSearch className="h-4 w-4" />
                      一期能力已接入
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      现在生成会优先使用服务端分析结果和你手动修正后的窗区，不再只靠前端上传几张图直接盲生。
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (sceneImage) {
                        void analyzeSceneImage(sceneImage.url);
                      }
                    }}
                    disabled={isAnalyzing}
                  >
                    再识别一次
                  </Button>
                </div>
              </Card>
            )}

            {!isGenerating && generatedImages.length > 0 && (
              <GeneratedResult
                originalImage={sceneImage?.url}
                generatedImages={generatedImages}
                isGenerating={isGenerating}
                onReset={handleReset}
              />
            )}

            {sceneImage && !isGenerating && generatedImages.length === 0 && (
              <Card className="p-6">
                <h3 className="mb-4 font-medium">当前一期建议操作</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>上传客户现场照片，等待系统自动识别窗区</li>
                  <li>若窗区识别不准，先手动修正坐标与单双层结构</li>
                  <li>按实际商品输入选择单层或双层结构</li>
                  <li>双层场景下分别上传布帘图和纱帘图</li>
                  <li>点击开始生成，直接走服务端接口调用，不在前端暴露 API Key</li>
                </ol>
              </Card>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t bg-muted/30">
        <div className="container mx-auto px-4 py-6">
          <p className="text-center text-sm text-muted-foreground">
            窗帘 AI 工具 - 助力窗帘商家提升销售转化率
          </p>
        </div>
      </footer>
    </div>
  );
}

function buildCurtainReferences({
  structure,
  singleCurtainImages,
  fabricCurtainImages,
  sheerCurtainImages,
}: {
  structure: GenerationOptions['structure'];
  singleCurtainImages: UploadedImage[];
  fabricCurtainImages: UploadedImage[];
  sheerCurtainImages: UploadedImage[];
}): CurtainReference[] {
  const toReferences = (
    images: UploadedImage[],
    role: CurtainReferenceRole
  ): CurtainReference[] =>
    images.map((image) => ({
      url: image.url,
      name: image.name,
      role,
    }));

  if (structure === 'double') {
    return [
      ...toReferences(fabricCurtainImages, 'fabric'),
      ...toReferences(sheerCurtainImages, 'sheer'),
    ];
  }

  return toReferences(singleCurtainImages, 'generic');
}

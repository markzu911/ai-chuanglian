'use client';

import React, { useState } from 'react';
import {
  Download,
  Copy,
  Check,
  RotateCcw,
  ImageIcon,
  Maximize2,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ShowcaseAngle } from '@/lib/curtain-ai-types';

interface GeneratedResultProps {
  originalImage?: string;
  generatedImages: string[];
  isGenerating: boolean;
  onReset: () => void;
  pageMode?: 'scene' | 'showcase';
  showcaseAngles?: ShowcaseAngle[];
}

export function GeneratedResult({
  originalImage,
  generatedImages,
  isGenerating,
  onReset,
  pageMode = 'scene',
  showcaseAngles = [],
}: GeneratedResultProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (generatedImages.length === 0 && !isGenerating) {
    return null;
  }

  const downloadImage = (url: string, index: number) => {
    // 使用后端代理进行下载，解决跨域问题
    const filename = `curtain-effect-${index + 1}.png`;
    const proxyUrl = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
    
    const link = document.createElement('a');
    link.href = proxyUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyImageUrl = async (url: string, index: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  const selectedImage = generatedImages[selectedIndex] || generatedImages[0];
  const showcaseItems = generatedImages.map((url, index) => ({
    url,
    angle: showcaseAngles[index] || 'hero',
  }));

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <ImageIcon className="w-5 h-5" />
          生成结果
          {generatedImages.length > 1 && (
            <span className="text-sm text-muted-foreground font-normal">
              ({selectedIndex + 1}/{generatedImages.length})
            </span>
          )}
        </h3>
        <div className="flex gap-2">
          {selectedImage && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadImage(selectedImage, selectedIndex)}
              >
                <Download className="w-4 h-4 mr-2" />
                下载
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyImageUrl(selectedImage, selectedIndex)}
              >
                {copiedIndex === selectedIndex ? (
                  <>
                    <Check className="w-4 h-4 mr-2 text-green-500" />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    复制链接
                  </>
                )}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            重新生成
          </Button>
        </div>
      </div>

      {pageMode === 'showcase' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {showcaseItems.map((item, index) => {
            const meta = getShowcasePreviewMeta(item.angle);
            return (
              <div key={`${item.angle}-${index}`} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{meta.label}</Badge>
                    <span className="text-xs text-muted-foreground">{meta.ratioLabel}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{meta.description}</span>
                </div>
                <ResultImage
                  src={item.url}
                  alt={meta.label}
                  aspectClassName={meta.aspectClassName}
                />
              </div>
            );
          })}
        </div>
      ) : generatedImages.length > 1 ? (
        <Tabs
          value={String(selectedIndex)}
          onValueChange={(v) => setSelectedIndex(Number(v))}
        >
          <TabsList className="w-full justify-start overflow-auto">
            {generatedImages.map((_, index) => (
              <TabsTrigger key={index} value={String(index)}>
                方案 {index + 1}
              </TabsTrigger>
            ))}
          </TabsList>
          {generatedImages.map((url, index) => (
            <TabsContent key={index} value={String(index)} className="mt-4">
              <ResultImage src={url} alt={`方案 ${index + 1}`} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        selectedImage && <ResultImage src={selectedImage} alt="效果图" />
      )}

      {originalImage && generatedImages.length > 0 && (
        <div className="border-t pt-6">
          <h4 className="font-medium mb-4">效果对比</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">原始图片</p>
              <ResultImage src={originalImage} alt="原始图片" sm />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">效果图</p>
              <ResultImage src={selectedImage} alt="效果图" sm />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ResultImage({
  src,
  alt,
  sm = false,
  aspectClassName,
}: {
  src: string;
  alt: string;
  sm?: boolean;
  aspectClassName?: string;
}) {
  const [isLoaded, setIsLoaded] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);

  const clampZoom = (value: number) => Math.min(4, Math.max(1, Number(value.toFixed(2))));
  const zoomIn = () => setZoom((prev) => clampZoom(prev + 0.25));
  const zoomOut = () => setZoom((prev) => clampZoom(prev - 0.25));
  const resetZoom = () => setZoom(1);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetZoom();
        }
      }}
    >
      <DialogTrigger asChild>
        <div 
          className={cn(
            "relative rounded-lg overflow-hidden bg-muted cursor-zoom-in group",
            aspectClassName || (sm ? "aspect-square sm:aspect-video" : "aspect-video")
          )}
        >
          {!isLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <img
            src={src}
            alt={alt}
            className={cn(
              'w-full h-full object-contain transition-all group-hover:scale-105',
              isLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={() => setIsLoaded(true)}
          />
          {isLoaded && (
            <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <div className="bg-background/80 p-2 rounded-full shadow-lg">
                <Maximize2 className="w-5 h-5" />
              </div>
            </div>
          )}
        </div>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 left-0 top-0 z-50 h-screen w-screen max-w-none translate-x-0 translate-y-0 gap-0 border-none bg-black/92 p-0 shadow-none"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{alt}</DialogTitle>
        </DialogHeader>

        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-black/55 px-3 py-2 text-white backdrop-blur">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white"
            onClick={zoomOut}
            disabled={zoom <= 1}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-14 text-center text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-white hover:bg-white/10 hover:text-white"
            onClick={zoomIn}
            disabled={zoom >= 4}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full px-3 text-white hover:bg-white/10 hover:text-white"
            onClick={resetZoom}
            disabled={zoom === 1}
          >
            重置
          </Button>
        </div>

        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 z-10 h-11 w-11 rounded-full bg-black/55 text-white hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </Button>
        </DialogClose>

        <div className="flex h-screen w-screen items-center justify-center overflow-auto p-6 md:p-10">
          <img
            src={src}
            alt={alt}
            className="max-w-none rounded-xl object-contain shadow-2xl transition-transform duration-200 ease-out"
            style={{
              maxWidth: 'min(calc(100vw - 3rem), 1600px)',
              maxHeight: 'calc(100vh - 3rem)',
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            onDoubleClick={() => setZoom((prev) => (prev === 1 ? 2 : 1))}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getShowcasePreviewMeta(angle: ShowcaseAngle): {
  label: string;
  description: string;
  ratioLabel: string;
  aspectClassName: string;
} {
  switch (angle) {
    case 'lifestyle':
      return {
        label: '中近景展示',
        description: '局部场景与风格氛围',
        ratioLabel: '3:4',
        aspectClassName: 'aspect-[3/4]',
      };
    case 'detail':
      return {
        label: '材质细节',
        description: '面料纹理与做工特写',
        ratioLabel: '3:4',
        aspectClassName: 'aspect-[3/4]',
      };
    case 'layered':
      return {
        label: '遮光效果',
        description: '透光或遮光能力展示',
        ratioLabel: '3:4',
        aspectClassName: 'aspect-[3/4]',
      };
    case 'hero':
    default:
      return {
        label: '远景展示',
        description: '完整挂装与空间比例',
        ratioLabel: '3:4',
        aspectClassName: 'aspect-[3/4]',
      };
  }
}

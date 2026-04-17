'use client';

import React, { useState } from 'react';
import { Download, Copy, Check, RotateCcw, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

interface GeneratedResultProps {
  originalImage?: string;
  generatedImages: string[];
  isGenerating: boolean;
  onReset: () => void;
}

export function GeneratedResult({
  originalImage,
  generatedImages,
  isGenerating,
  onReset,
}: GeneratedResultProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (generatedImages.length === 0 && !isGenerating) {
    return null;
  }

  const downloadImage = async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `curtain-effect-${index + 1}.png`;
      link.click();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('下载失败:', error);
    }
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

      {generatedImages.length > 1 ? (
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
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                <img
                  src={originalImage}
                  alt="原始图片"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">效果图</p>
              <div className="aspect-video rounded-lg overflow-hidden bg-muted">
                <img
                  src={selectedImage}
                  alt="效果图"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ResultImage({ src, alt }: { src: string; alt: string }) {
  const [isLoaded, setIsLoaded] = React.useState(false);

  return (
    <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={cn(
          'w-full h-full object-contain transition-opacity',
          isLoaded ? 'opacity-100' : 'opacity-0'
        )}
        onLoad={() => setIsLoaded(true)}
      />
    </div>
  );
}

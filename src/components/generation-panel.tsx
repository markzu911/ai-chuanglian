'use client';

import React from 'react';
import { Play, RotateCcw, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { ShowcaseAngle } from '@/lib/curtain-ai-types';

export interface GenerationOptions {
  mode: 'replace' | 'add' | 'auto';
  structure: 'auto' | 'single' | 'double';
  style: string;
  count: number;
  showcaseAngles: ShowcaseAngle[];
}

interface GenerationPanelProps {
  options: GenerationOptions;
  onOptionsChange: (options: GenerationOptions) => void;
  isGenerating: boolean;
  progress: number;
  message: string;
  onGenerate: () => void;
  onCancel: () => void;
  onReset: () => void;
  disabled?: boolean;
  canGenerate?: boolean;
  pageMode?: 'scene' | 'showcase';
}

const STYLE_OPTIONS = [
  { value: '', label: '不指定风格', description: '让 AI 自动选择最适合的风格' },
  { value: '奶油风', label: '奶油风', description: '暖色调、柔软质感、浅色系' },
  { value: '现代简约', label: '现代简约', description: '简洁线条、纯色面料、中性色调' },
  { value: '轻奢', label: '轻奢', description: '金属装饰、高贵面料、深色系' },
  { value: '北欧', label: '北欧', description: '自然材质、简约设计、浅木色' },
  { value: '中式', label: '中式', description: '传统图案、丝绸面料、红色或米色' },
];

const COUNT_OPTIONS = [
  { value: 1, label: '单张方案' },
  { value: 2, label: '2 张对比' },
  { value: 3, label: '3 张对比' },
];

const SHOWCASE_ANGLE_OPTIONS = [
  { value: 'hero' as const, label: '远景展示', description: '完整挂装效果，带空间比例' },
  { value: 'lifestyle' as const, label: '中近景展示', description: '局部场景，强调风格氛围' },
  { value: 'detail' as const, label: '材质细节', description: '纹理、织法、手感近景' },
  { value: 'layered' as const, label: '遮光效果', description: '透光或遮光能力展示' },
];

const STRUCTURE_OPTIONS = [
  { value: 'auto', label: '自动识别', description: '系统根据现场图和商品图判断单层或双层' },
  { value: 'single', label: '单层窗帘', description: '只生成单层主帘或纱帘结构' },
  { value: 'double', label: '双层窗帘', description: '保留布帘 + 纱帘的双层结构' },
] as const;

export function GenerationPanel({
  options,
  onOptionsChange,
  isGenerating,
  progress,
  message,
  onGenerate,
  onCancel,
  onReset,
  disabled = false,
  canGenerate = true,
  pageMode = 'scene',
}: GenerationPanelProps) {
  return (
    <Card className="p-6 space-y-6">
      {/* 模式选择 - 仅在场景模式下显示 */}
      {pageMode === 'scene' && (
        <div className="space-y-3">
          <Label className="text-base font-medium">生成模式</Label>
          <RadioGroup
            value={options.mode}
            onValueChange={(value) =>
              onOptionsChange({ ...options, mode: value as GenerationOptions['mode'] })
            }
            disabled={disabled || isGenerating}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
          <div>
            <RadioGroupItem value="auto" id="mode-auto" className="peer sr-only" />
            <Label
              htmlFor="mode-auto"
              className={cn(
                'flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer',
                'peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5',
                (disabled || isGenerating) && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span className="font-medium">智能识别</span>
              <span className="text-xs text-muted-foreground text-center mt-1">
                系统自动判断替换或新增
              </span>
            </Label>
          </div>
          <div>
            <RadioGroupItem value="replace" id="mode-replace" className="peer sr-only" />
            <Label
              htmlFor="mode-replace"
              className={cn(
                'flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer',
                'peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5',
                (disabled || isGenerating) && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span className="font-medium">商品替换</span>
              <span className="text-xs text-muted-foreground text-center mt-1">
                替换客户已有窗帘
              </span>
            </Label>
          </div>
          <div>
            <RadioGroupItem value="add" id="mode-add" className="peer sr-only" />
            <Label
              htmlFor="mode-add"
              className={cn(
                'flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer',
                'peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5',
                (disabled || isGenerating) && 'opacity-50 cursor-not-allowed'
              )}
            >
              <span className="font-medium">新增挂装</span>
              <span className="text-xs text-muted-foreground text-center mt-1">
                在空窗区域新增窗帘
              </span>
            </Label>
          </div>
        </RadioGroup>
        </div>
      )}

      {/* 结构选择 - 仅在场景模式下显示 */}
      {pageMode === 'scene' && (
        <div className="space-y-3">
          <Label className="text-base font-medium">窗帘结构</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {STRUCTURE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={options.structure === option.value ? 'default' : 'outline'}
              size="sm"
              disabled={disabled || isGenerating}
              onClick={() =>
                onOptionsChange({
                  ...options,
                  structure: option.value,
                })
              }
              className={cn(
                'h-auto min-h-16 flex-col items-start justify-center gap-1 whitespace-normal py-3 text-left',
                options.structure === option.value && 'bg-primary text-primary-foreground'
              )}
            >
              <span>{option.label}</span>
              <span className="text-xs opacity-80">{option.description}</span>
            </Button>
          ))}
        </div>
        </div>
      )}

      {/* 风格选择 */}
      <div className="space-y-3">
        <Label className="text-base font-medium">风格方向（可选）</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {STYLE_OPTIONS.map((style) => (
            <Button
              key={style.value}
              variant={options.style === style.value ? 'default' : 'outline'}
              size="sm"
              disabled={disabled || isGenerating}
              onClick={() => onOptionsChange({ ...options, style: style.value })}
              className={cn(
                'justify-start text-left h-auto py-2',
                options.style === style.value && 'bg-primary text-primary-foreground'
              )}
            >
              <span className="truncate">{style.label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* 生成数量 - 仅在场景模式下显示 */}
      {pageMode === 'scene' && (
        <div className="space-y-3">
          <Label className="text-base font-medium">生成数量</Label>
          <div className="flex gap-2">
            {COUNT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={options.count === opt.value ? 'default' : 'outline'}
                size="sm"
                disabled={disabled || isGenerating}
                onClick={() => onOptionsChange({ ...options, count: opt.value })}
              className={cn(
                options.count === opt.value && 'bg-primary text-primary-foreground'
              )}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        </div>
      )}

      {/* 电商展示用途 - 仅在 showcase 模式下显示 */}
      {pageMode === 'showcase' && (
        <div className="space-y-3">
          <Label className="text-base font-medium">
            展示用途（多选，{options.showcaseAngles.length} 张）
          </Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SHOWCASE_ANGLE_OPTIONS.map((opt) => {
              const selected = options.showcaseAngles.includes(opt.value);
              return (
                <Button
                  key={opt.value}
                  variant={selected ? 'default' : 'outline'}
                  size="sm"
                  disabled={disabled || isGenerating}
                  onClick={() => {
                    const next = selected
                      ? options.showcaseAngles.filter((a) => a !== opt.value)
                      : [...options.showcaseAngles, opt.value];
                    if (next.length === 0) return; // 至少保留一个
                    onOptionsChange({ ...options, showcaseAngles: next });
                  }}
                  className={cn(
                    'h-auto min-h-14 flex-col items-center justify-center gap-0.5 py-2',
                    selected && 'bg-primary text-primary-foreground'
                  )}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-xs opacity-80">{opt.description}</span>
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            按电商素材用途勾选即可，生成越少越省成本（并行出图，速度更快）
          </p>
        </div>
      )}

      {/* 进度条 */}
      {isGenerating && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{message || '生成中...'}</span>
            <span className="text-sm text-muted-foreground ml-auto">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3 pt-2">
        {!isGenerating ? (
          <Button
            onClick={onGenerate}
            disabled={disabled || !canGenerate}
            className="flex-1"
            size="lg"
          >
            <Play className="w-4 h-4 mr-2" />
            开始生成
          </Button>
        ) : (
          <>
            <Button
              variant="destructive"
              onClick={onCancel}
              className="flex-1"
              size="lg"
            >
              <Square className="w-4 h-4 mr-2" />
              取消
            </Button>
          </>
        )}
        {(options.count > 1 || progress > 0) && !isGenerating && (
          <Button variant="outline" onClick={onReset} size="lg">
            <RotateCcw className="w-4 h-4 mr-2" />
            重置
          </Button>
        )}
      </div>
    </Card>
  );
}

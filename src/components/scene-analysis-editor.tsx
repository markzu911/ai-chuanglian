'use client';

import React from 'react';
import { ScanSearch, RotateCcw } from 'lucide-react';
import type { SceneAnalysisResult, WindowRegion } from '@/lib/curtain-ai-types';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SceneRegionCanvas } from '@/components/scene-region-canvas';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SceneAnalysisEditorProps {
  sceneImageUrl: string;
  value: SceneAnalysisResult;
  disabled?: boolean;
  onChange: (value: SceneAnalysisResult) => void;
  onReset: () => void;
}

export function SceneAnalysisEditor({
  sceneImageUrl,
  value,
  disabled = false,
  onChange,
  onReset,
}: SceneAnalysisEditorProps) {
  const [selectedRegionIndex, setSelectedRegionIndex] = React.useState(0);

  React.useEffect(() => {
    if (value.windowRegions.length === 0) {
      setSelectedRegionIndex(0);
      return;
    }

    if (selectedRegionIndex > value.windowRegions.length - 1) {
      setSelectedRegionIndex(value.windowRegions.length - 1);
    }
  }, [selectedRegionIndex, value.windowRegions.length]);

  const updateRegion = (index: number, patch: Partial<WindowRegion>) => {
    const nextRegions = value.windowRegions.map((region, regionIndex) =>
      regionIndex === index ? { ...region, ...patch } : region
    );

    onChange({
      ...value,
      windowRegions: nextRegions,
    });
  };

  return (
    <Card className="p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ScanSearch className="w-4 h-4" />
            <h3 className="font-medium">窗区识别与手动校正</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            识别结果不准时，可以先修正窗区再生成，修正后的结果会直接传给后端接口。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset} disabled={disabled}>
          <RotateCcw className="w-4 h-4 mr-2" />
          重新识别
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>是否已有窗帘</Label>
          <div className="flex h-9 items-center rounded-md border px-3">
            <Switch
              checked={value.hasCurtain}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({
                  ...value,
                  hasCurtain: checked,
                })
              }
            />
            <span className="ml-3 text-sm text-muted-foreground">
              {value.hasCurtain ? '已有窗帘' : '当前为空窗'}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Label>推荐模式</Label>
          <Select
            value={value.recommendedMode}
            onValueChange={(nextMode: SceneAnalysisResult['recommendedMode']) =>
              onChange({
                ...value,
                recommendedMode: nextMode,
              })
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="replace">商品替换</SelectItem>
              <SelectItem value="add">新增挂装</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>场景描述</Label>
          <Input
            value={value.sceneDescription}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                sceneDescription: event.target.value,
              })
            }
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>窗区坐标（百分比）</Label>
          <span className="text-sm text-muted-foreground">
            共 {value.windowRegions.length} 个窗区
          </span>
        </div>

        <SceneRegionCanvas
          sceneImageUrl={sceneImageUrl}
          regions={value.windowRegions}
          selectedRegionIndex={selectedRegionIndex}
          disabled={disabled}
          onChange={(windowRegions) =>
            onChange({
              ...value,
              windowRegions,
            })
          }
          onSelectedRegionChange={setSelectedRegionIndex}
        />

        {value.windowRegions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            当前未识别到窗区。你可以先重新识别，或先直接生成再观察效果。
          </div>
        ) : (
          <div className="space-y-3">
            {value.windowRegions.map((region, index) => (
              <div
                key={`${index}-${region.x}-${region.y}`}
                className={`rounded-lg border p-4 space-y-4 ${index === selectedRegionIndex ? 'border-primary' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">窗区 {index + 1}</div>
                    <div className="text-sm text-muted-foreground">
                      调整 x / y / width / height，控制 AI 只在窗区内编辑
                    </div>
                  </div>
                  <Select
                    value={region.curtainType || 'single'}
                    onValueChange={(nextType: NonNullable<WindowRegion['curtainType']>) =>
                      updateRegion(index, { curtainType: nextType })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">单层</SelectItem>
                      <SelectItem value="double">双层</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  {(['x', 'y', 'width', 'height'] as const).map((field) => (
                    <div key={field} className="space-y-2">
                      <Label className="uppercase">{field}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        disabled={disabled}
                        value={region[field]}
                        onChange={(event) =>
                          updateRegion(index, {
                            [field]: normalizePercentage(event.target.value),
                          } as Partial<WindowRegion>)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function normalizePercentage(value: string): number {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(parsed)));
}

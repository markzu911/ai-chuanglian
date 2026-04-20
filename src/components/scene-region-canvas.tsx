'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { WindowRegion } from '@/lib/curtain-ai-types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

interface SceneRegionCanvasProps {
  sceneImageUrl: string;
  regions: WindowRegion[];
  selectedRegionIndex: number;
  disabled?: boolean;
  onChange: (regions: WindowRegion[]) => void;
  onSelectedRegionChange: (index: number) => void;
}

interface DragState {
  mode: 'move' | 'resize';
  regionIndex: number;
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  startRegion: WindowRegion;
}

export function SceneRegionCanvas({
  sceneImageUrl,
  regions,
  selectedRegionIndex,
  disabled = false,
  onChange,
  onSelectedRegionChange,
}: SceneRegionCanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      const frame = frameRef.current;

      if (!dragState || !frame) {
        return;
      }

      const rect = frame.getBoundingClientRect();
      const deltaX = ((event.clientX - dragState.startX) / rect.width) * 100;
      const deltaY = ((event.clientY - dragState.startY) / rect.height) * 100;

      const nextRegions = regions.map((region, index) => {
        if (index !== dragState.regionIndex) {
          return region;
        }

        if (dragState.mode === 'move') {
          return clampRegion({
            ...dragState.startRegion,
            x: dragState.startRegion.x + deltaX,
            y: dragState.startRegion.y + deltaY,
          });
        }

        return clampRegion(
          resizeRegion(dragState.startRegion, dragState.handle || 'se', deltaX, deltaY)
        );
      });

      onChange(nextRegions);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, onChange, regions]);

  const startDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    regionIndex: number,
    mode: DragState['mode'],
    handle?: ResizeHandle
  ) => {
    if (disabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragStateRef.current = {
      mode,
      regionIndex,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRegion: regions[regionIndex],
    };
    setIsDragging(true);
    onSelectedRegionChange(regionIndex);
  };

  const addRegion = () => {
    const newRegion: WindowRegion = {
      x: 25,
      y: 20,
      width: 50,
      height: 60,
      hasCurtain: false,
      curtainType: 'single',
    };

    onChange([...regions, newRegion]);
    onSelectedRegionChange(regions.length);
  };

  const removeSelectedRegion = () => {
    if (regions.length === 0) {
      return;
    }

    const nextRegions = regions.filter((_, index) => index !== selectedRegionIndex);
    onChange(nextRegions);
    onSelectedRegionChange(Math.max(0, Math.min(selectedRegionIndex - 1, nextRegions.length - 1)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          在图片上直接拖动窗区位置，或拖拽四个角调整大小。
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRegion} disabled={disabled}>
            <Plus className="mr-2 h-4 w-4" />
            新增窗区
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={removeSelectedRegion}
            disabled={disabled || regions.length === 0}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            删除当前窗区
          </Button>
        </div>
      </div>

      <div
        ref={frameRef}
        className="relative overflow-hidden rounded-xl border bg-muted shadow-sm"
      >
        <img
          src={sceneImageUrl}
          alt="窗区编辑底图"
          className="block h-auto w-full select-none"
          draggable={false}
        />
        <div className="absolute inset-0">
          {regions.map((region, index) => {
            const selected = index === selectedRegionIndex;

            return (
              <div
                key={`${index}-${region.x}-${region.y}-${region.width}-${region.height}`}
                className={cn(
                  'absolute border-2 transition-colors',
                  selected ? 'border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]' : 'border-white/90',
                  disabled ? 'cursor-default' : 'cursor-move'
                )}
                style={{
                  left: `${region.x}%`,
                  top: `${region.y}%`,
                  width: `${region.width}%`,
                  height: `${region.height}%`,
                }}
                onPointerDown={(event) => startDrag(event, index, 'move')}
                onClick={() => onSelectedRegionChange(index)}
              >
                <div className="absolute left-2 top-2 rounded bg-background/90 px-2 py-1 text-xs font-medium shadow">
                  窗区 {index + 1}
                </div>
                {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                  <div
                    key={handle}
                    className={cn(
                      'absolute h-3 w-3 rounded-full border border-white bg-primary shadow',
                      handle === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                      handle === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                      handle === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                      handle === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize'
                    )}
                    onPointerDown={(event) => startDrag(event, index, 'resize', handle)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function resizeRegion(
  region: WindowRegion,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number
): WindowRegion {
  switch (handle) {
    case 'nw':
      return {
        ...region,
        x: region.x + deltaX,
        y: region.y + deltaY,
        width: region.width - deltaX,
        height: region.height - deltaY,
      };
    case 'ne':
      return {
        ...region,
        y: region.y + deltaY,
        width: region.width + deltaX,
        height: region.height - deltaY,
      };
    case 'sw':
      return {
        ...region,
        x: region.x + deltaX,
        width: region.width - deltaX,
        height: region.height + deltaY,
      };
    case 'se':
    default:
      return {
        ...region,
        width: region.width + deltaX,
        height: region.height + deltaY,
      };
  }
}

function clampRegion(region: WindowRegion): WindowRegion {
  const minSize = 5;
  const width = clamp(region.width, minSize, 100);
  const height = clamp(region.height, minSize, 100);
  const x = clamp(region.x, 0, 100 - width);
  const y = clamp(region.y, 0, 100 - height);

  return {
    ...region,
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

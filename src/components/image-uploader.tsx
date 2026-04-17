'use client';

import React, { useCallback, useState } from 'react';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export interface UploadedImage {
  id: string;
  url: string;
  name: string;
  type: 'scene' | 'curtain';
}

interface ImageUploaderProps {
  type: 'scene' | 'curtain';
  value?: UploadedImage[];
  onChange?: (images: UploadedImage[]) => void;
  maxCount?: number;
  disabled?: boolean;
  className?: string;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function ImageUploader({
  type,
  value = [],
  onChange,
  maxCount = type === 'scene' ? 1 : 5,
  disabled = false,
  className,
}: ImageUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const uploadFile = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        console.error('不支持的文件类型:', file.type);
        return null;
      }

      if (file.size > MAX_FILE_SIZE) {
        console.error('文件太大:', file.size);
        return null;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploadingIds((prev) => new Set(prev).add(id));

      try {
        // 转换为 Base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        reader.readAsDataURL(file);
        const base64 = await base64Promise;

        const uploaded: UploadedImage = {
          id,
          url: base64,
          name: file.name,
          type,
        };

        onChange?.([...value, uploaded]);
        return uploaded;
      } catch (error) {
        console.error('上传失败:', error);
        return null;
      } finally {
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [type, value, onChange]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      const remainingSlots = maxCount - value.length;
      const filesToUpload = files.slice(0, remainingSlots);

      for (const file of filesToUpload) {
        await uploadFile(file);
      }
    },
    [disabled, maxCount, value.length, uploadFile]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const remainingSlots = maxCount - value.length;
      const filesToUpload = files.slice(0, remainingSlots);

      for (const file of filesToUpload) {
        await uploadFile(file);
      }

      e.target.value = '';
    },
    [maxCount, value.length, uploadFile]
  );

  const removeImage = useCallback(
    (id: string) => {
      onChange?.(value.filter((img) => img.id !== id));
    },
    [value, onChange]
  );

  const canAddMore = value.length < maxCount && !disabled;

  return (
    <div className={cn('space-y-4', className)}>
      {/* 标题 */}
      <div className="flex items-center gap-2">
        {type === 'scene' ? (
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
        )}
        <span className="font-medium">
          {type === 'scene' ? '客户现场照片' : '窗帘商品图'}
        </span>
        <span className="text-sm text-muted-foreground">
          ({value.length}/{maxCount})
        </span>
      </div>

      {/* 上传区域 */}
      {canAddMore && (
        <Card
          className={cn(
            'relative border-2 border-dashed transition-colors cursor-pointer',
            isDragging && 'border-primary bg-primary/5',
            !isDragging && 'hover:border-primary/50',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById(`upload-${type}`)?.click()}
        >
          <input
            id={`upload-${type}`}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            multiple={type === 'curtain'}
            onChange={handleFileSelect}
            disabled={disabled}
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <Upload className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground text-center">
              拖拽图片到此处，或点击上传
              <br />
              <span className="text-xs">支持 JPG、PNG、WebP，最大 10MB</span>
            </p>
          </div>
        </Card>
      )}

      {/* 已上传图片列表 */}
      {value.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {value.map((image) => (
            <Card
              key={image.id}
              className="relative overflow-hidden aspect-square group"
            >
              <img
                src={image.url}
                alt={image.name}
                className="w-full h-full object-cover"
              />
              {uploadingIds.has(image.id) ? (
                <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => removeImage(image.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  {type === 'curtain' && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                      <p className="text-xs text-white truncate">
                        {image.name}
                      </p>
                    </div>
                  )}
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { LocalMediaItem } from '../types/iptv';
import { formatFileSize, resolveLocalItemFile } from '../services/localMediaService';
import { ImageAdjustmentControls, useImageAdjustments } from './ImageAdjustments';

interface PhotoLightboxProps {
  photos: LocalMediaItem[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
}

export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  currentIndex,
  onSelectIndex,
  onClose,
}) => {
  const current = photos[currentIndex];
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [slideshow, setSlideshow] = useState<boolean>(false);
  const imageAdjustments = useImageAdjustments();

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setZoom(1);
    setRotation(0);

    if (current) {
      resolveLocalItemFile(current)
        .then((file) => {
          if (!active) return;
          url = URL.createObjectURL(file);
          setImageUrl(url);
        })
        .catch(() => active && setImageUrl(null));
    }

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [current]);

  useEffect(() => {
    if (!slideshow || photos.length <= 1) return;
    const id = window.setInterval(() => onSelectIndex((currentIndex + 1) % photos.length), 4000);
    return () => window.clearInterval(id);
  }, [slideshow, currentIndex, photos.length, onSelectIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && photos.length > 1) onSelectIndex((currentIndex + 1) % photos.length);
      if (e.key === 'ArrowLeft' && photos.length > 1) onSelectIndex((currentIndex - 1 + photos.length) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentIndex, photos.length, onSelectIndex, onClose]);

  if (!current) return null;

  return (
    <div className="lightbox-overlay" role="dialog" aria-modal="true">
      <header className="lightbox-topbar">
        <div className="lightbox-meta">
          <h3>{current.name}</h3>
          <span>{currentIndex + 1} de {photos.length} • {current.folderPath} • {formatFileSize(current.sizeBytes)}</span>
        </div>
        <div className="lightbox-actions">
          <ImageAdjustmentControls
            values={imageAdjustments.values}
            onChange={imageAdjustments.setValue}
            onReset={imageAdjustments.reset}
            filterId={imageAdjustments.filterId}
            curve={imageAdjustments.curve}
            kernel={imageAdjustments.kernel}
          />
          {photos.length > 1 && (
            <button type="button" className={'btn-studio ' + (slideshow ? 'active' : '')} onClick={() => setSlideshow((s) => !s)}>
              {slideshow ? <Pause size={15} /> : <Play size={15} />}
              <span>{slideshow ? 'Pausar' : 'Slideshow'}</span>
            </button>
          )}
          <button type="button" className="btn-circle" onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}><ZoomOut size={17} /></button>
          <button type="button" className="btn-circle" onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.25).toFixed(2))))}><ZoomIn size={17} /></button>
          <button type="button" className="btn-circle" onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw size={17} /></button>
          <button type="button" className="btn-circle" onClick={onClose}><X size={18} /></button>
        </div>
      </header>

      <div className="lightbox-stage">
        {photos.length > 1 && (
          <button type="button" className="lightbox-nav prev" onClick={() => onSelectIndex((currentIndex - 1 + photos.length) % photos.length)}>
            <ChevronLeft size={30} />
          </button>
        )}
        <div className="lightbox-canvas">
          {imageUrl && <img src={imageUrl} alt={current.title} className="lightbox-img" style={{ transform: `scale(${zoom}) rotate(${rotation}deg)`, filter: imageAdjustments.filter }} />}
        </div>
        {photos.length > 1 && (
          <button type="button" className="lightbox-nav next" onClick={() => onSelectIndex((currentIndex + 1) % photos.length)}>
            <ChevronRight size={30} />
          </button>
        )}
      </div>
    </div>
  );
};

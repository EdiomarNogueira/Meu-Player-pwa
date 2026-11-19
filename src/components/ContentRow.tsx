import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ArtworkMetadata, Channel } from '../types/iptv';
import { MediaCard } from './MediaCard';

interface ContentRowProps {
  title: string;
  channels: Channel[];
  artworkMap: Record<string, ArtworkMetadata>;
  favoriteIds: Set<string>;
  variant?: 'landscape' | 'poster';
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  onOpenDetails: (channel: Channel) => void;
}

export const ContentRow: React.FC<ContentRowProps> = ({
  title,
  channels,
  artworkMap,
  favoriteIds,
  variant = 'landscape',
  onPlay,
  onToggleFavorite,
  onOpenDetails,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  if (channels.length === 0) return null;

  const scrollByAmount = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: Math.max(el.clientWidth * 0.82, 320) * dir, behavior: 'smooth' });
  };

  return (
    <section className="cinema-row">
      <div className="row-header">
        <h2 className="row-title">{title}</h2>
        <span className="row-count">{channels.length} títulos</span>
      </div>

      <div className="row-track-wrapper">
        <button type="button" className="row-handle left" onClick={() => scrollByAmount(-1)}><ChevronLeft size={26} /></button>
        <div className="row-scroller" ref={scrollerRef}>
          {channels.slice(0, 45).map((ch) => (
            <MediaCard
              key={ch.id}
              channel={ch}
              artwork={artworkMap[ch.artworkKey]}
              isFavorite={favoriteIds.has(ch.id)}
              variant={variant}
              onPlay={onPlay}
              onToggleFavorite={onToggleFavorite}
              onOpenDetails={onOpenDetails}
            />
          ))}
        </div>
        <button type="button" className="row-handle right" onClick={() => scrollByAmount(1)}><ChevronRight size={26} /></button>
      </div>
    </section>
  );
};

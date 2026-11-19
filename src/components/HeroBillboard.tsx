import React, { useEffect, useState } from 'react';
import { Check, Info, Play, Plus, Star, Tv } from 'lucide-react';
import { ArtworkMetadata, Channel } from '../types/iptv';
import { getAtmosphericGradient } from '../services/titleCleaner';

interface HeroBillboardProps {
  featuredList: Channel[];
  artworkMap: Record<string, ArtworkMetadata>;
  favoriteIds: Set<string>;
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  onOpenDetails: (channel: Channel) => void;
}

export const HeroBillboard: React.FC<HeroBillboardProps> = ({
  featuredList,
  artworkMap,
  favoriteIds,
  onPlay,
  onToggleFavorite,
  onOpenDetails,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => setActiveIndex(0), [featuredList.length]);

  useEffect(() => {
    if (featuredList.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % featuredList.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [featuredList.length]);

  if (featuredList.length === 0) return null;

  const current = featuredList[activeIndex] ?? featuredList[0];
  const art = artworkMap[current.artworkKey];
  const heroBgImage = art?.backdropUrl || art?.posterUrl || current.logo;
  const isFav = favoriteIds.has(current.id);

  return (
    <section className="hero-billboard" style={{ backgroundImage: getAtmosphericGradient(current.cleanTitle) }}>
      {heroBgImage && <div className="hero-backdrop-img" style={{ backgroundImage: `url("${heroBgImage}")` }} />}
      <div className="hero-vignette-left" />
      <div className="hero-vignette-bottom" />

      <div className="hero-content">
        <div className="hero-badges">
          <span className="hero-type-pill">{current.kind === 'live' ? 'AO VIVO' : current.kind === 'series' ? 'SÉRIE' : 'FILME'}</span>
          <span className="hero-category-label">{current.group}</span>
          {art?.rating && <span className="hero-rating"><Star size={13} fill="currentColor" /> {art.rating}</span>}
          {(art?.year || current.yearHint) && <span className="hero-meta-year">{art?.year || current.yearHint}</span>}
          <span className="hero-format-tag">{current.format.toUpperCase()}</span>
        </div>

        <h1 className="hero-title">{art?.cleanTitle || current.cleanTitle}</h1>
        {art?.genres && art.genres.length > 0 && <div className="hero-genres">{art.genres.join(' • ')}</div>}
        <p className="hero-synopsis">
          {art?.overview || `Assista a "${current.name}" diretamente no reprodutor integrado na categoria ${current.group}.`}
        </p>

        <div className="hero-cta-row">
          <button type="button" className="btn-hero-play" onClick={() => onPlay(current)}>
            <Play size={20} fill="currentColor" />
            <span>Assistir</span>
          </button>
          <button type="button" className="btn-hero-secondary" onClick={() => onToggleFavorite(current)}>
            {isFav ? <Check size={19} /> : <Plus size={19} />}
            <span>{isFav ? 'Na Minha Lista' : 'Minha Lista'}</span>
          </button>
          <button type="button" className="btn-hero-secondary" onClick={() => onOpenDetails(current)}>
            <Info size={19} />
            <span>Mais Informações</span>
          </button>
        </div>
      </div>

      {!heroBgImage && (
        <div className="hero-floating-emblem fallback" aria-hidden="true">
          <Tv size={68} />
        </div>
      )}

      {featuredList.length > 1 && (
        <div className="hero-dots">
          {featuredList.map((item, idx) => (
            <button key={item.id} type="button" className={'hero-dot ' + (idx === activeIndex ? 'active' : '')} onClick={() => setActiveIndex(idx)} />
          ))}
        </div>
      )}
    </section>
  );
};

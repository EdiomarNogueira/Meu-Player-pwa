import React, { useState } from 'react';
import { Check, Info, Play, Plus, Star, Tv } from 'lucide-react';
import { ArtworkMetadata, Channel } from '../types/iptv';
import { getAtmosphericGradient } from '../services/titleCleaner';

interface MediaCardProps {
  channel: Channel;
  artwork?: ArtworkMetadata;
  isFavorite: boolean;
  variant?: 'landscape' | 'poster';
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  onOpenDetails: (channel: Channel) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({
  channel,
  artwork,
  isFavorite,
  variant = 'landscape',
  onPlay,
  onToggleFavorite,
  onOpenDetails,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const primaryArt =
    variant === 'poster'
      ? artwork?.posterUrl || artwork?.backdropUrl || channel.logo
      : artwork?.backdropUrl || artwork?.posterUrl || channel.logo;

  const isUsingLogoOnly = Boolean(channel.logo) && !artwork?.backdropUrl && !artwork?.posterUrl;

  return (
    <article className={'media-card ' + (variant === 'poster' ? 'poster-mode' : 'landscape-mode')}>
      <div className="media-card-visual" style={{ backgroundImage: getAtmosphericGradient(channel.cleanTitle) }} onClick={() => onPlay(channel)}>
        {primaryArt && !imgFailed ? (
          <img src={primaryArt} alt={channel.cleanTitle} loading="lazy" className={isUsingLogoOnly ? 'card-img-contain' : 'card-img-cover'} onError={() => setImgFailed(true)} />
        ) : (
          <div className="card-fallback-art">
            <Tv size={28} />
            <span>{channel.cleanTitle.slice(0, 22)}</span>
          </div>
        )}

        <div className="card-shade" />
        {channel.kind === 'live' && <span className="live-dot-badge">AO VIVO</span>}
        {artwork?.rating && <span className="card-score-badge"><Star size={11} fill="currentColor" /> {artwork.rating}</span>}

        <div className="card-hover-panel" onClick={(e) => e.stopPropagation()}>
          <div className="card-mini-actions">
            <button type="button" className="mini-btn play" onClick={() => onPlay(channel)}><Play size={15} fill="currentColor" /></button>
            <button type="button" className={'mini-btn ' + (isFavorite ? 'active' : '')} onClick={() => onToggleFavorite(channel)}>{isFavorite ? <Check size={15} /> : <Plus size={15} />}</button>
            <button type="button" className="mini-btn right" onClick={() => onOpenDetails(channel)}><Info size={15} /></button>
          </div>
          <div className="card-hover-text" onClick={() => onPlay(channel)}>
            <h4 className="card-title">{artwork?.cleanTitle || channel.cleanTitle}</h4>
            <div className="card-submeta">
              {(artwork?.year || channel.yearHint) && <span className="meta-highlight">{artwork?.year || channel.yearHint}</span>}
              <span>{channel.group}</span>
              <span className="meta-fmt">{channel.format}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card-caption" onClick={() => onPlay(channel)}>
        <span className="caption-title" title={channel.name}>{artwork?.cleanTitle || channel.cleanTitle}</span>
      </div>
    </article>
  );
};

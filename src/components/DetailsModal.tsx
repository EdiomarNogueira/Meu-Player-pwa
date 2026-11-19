import React from 'react';
import { Check, ExternalLink, Play, Plus, Sparkles, Star, X } from 'lucide-react';
import { ArtworkMetadata, Channel } from '../types/iptv';
import { getAtmosphericGradient } from '../services/titleCleaner';
import { preflightUrlCheck } from '../services/diagnostics';

interface DetailsModalProps {
  channel: Channel;
  artwork?: ArtworkMetadata;
  isFavorite: boolean;
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channel: Channel) => void;
  onEnrichNow: (channel: Channel) => void;
  onClose: () => void;
}

export const DetailsModal: React.FC<DetailsModalProps> = ({
  channel,
  artwork,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onEnrichNow,
  onClose,
}) => {
  const banner = artwork?.backdropUrl || artwork?.posterUrl || channel.logo;
  const preflightWarning = preflightUrlCheck(channel.streamUrl);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="details-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="details-banner" style={{ backgroundImage: getAtmosphericGradient(channel.cleanTitle) }}>
          {banner && (
            <img
              src={banner}
              alt={channel.cleanTitle}
              className="details-banner-img"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="details-banner-fade" />
          <button type="button" className="details-close-btn" onClick={onClose}><X size={20} /></button>

          <div className="details-banner-OverlayContent">
            <h2>{artwork?.cleanTitle || channel.cleanTitle}</h2>
            <div className="details-cta-bar">
              <button type="button" className="btn-hero-play" onClick={() => { onClose(); onPlay(channel); }}>
                <Play size={18} fill="currentColor" />
                <span>Assistir Agora</span>
              </button>
              <button type="button" className="btn-hero-secondary" onClick={() => onToggleFavorite(channel)}>
                {isFavorite ? <Check size={18} /> : <Plus size={18} />}
                <span>{isFavorite ? 'Na Minha Lista' : 'Minha Lista'}</span>
              </button>
              {!channel.isLocalFile && (!artwork || artwork.provider === 'none') && (
                <button type="button" className="btn-hero-secondary" onClick={() => onEnrichNow(channel)}>
                  <Sparkles size={16} />
                  <span>Buscar Capa Externa</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="details-body">
          <div className="details-main-col">
            <div className="details-tags">
              {artwork?.rating && <span className="tag-score"><Star size={13} fill="currentColor" /> {artwork.rating} Relevância</span>}
              {(artwork?.year || channel.yearHint) && <span className="tag-outline">{artwork?.year || channel.yearHint}</span>}
              <span className="tag-outline">{channel.format.toUpperCase()}</span>
            </div>
            <p className="details-overview">{artwork?.overview || 'Transmissão direta configurada na sua fonte IPTV.'}</p>
            {preflightWarning && (
              <div className="inline-alert warn">
                <div><strong>{preflightWarning.title}:</strong> {preflightWarning.explanation}</div>
              </div>
            )}
          </div>

          <div className="details-side-col">
            <div><span className="side-label">Nome na lista:</span><span className="side-val">{channel.name}</span></div>
            <div><span className="side-label">Categoria:</span><span className="side-val">{channel.group}</span></div>
            {!channel.isLocalFile && (
              <div>
                <a href={channel.streamUrl} target="_blank" rel="noopener noreferrer" className="direct-link">
                  <ExternalLink size={13} /> Testar stream direto em nova aba
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

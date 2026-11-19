import React, { useMemo } from 'react';
import { CheckCircle2, Film, Image, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { AppSettings } from '../types/iptv';
import { getCodecSupportSummary } from '../services/diagnostics';

interface SettingsModalProps {
  settings: AppSettings;
  artworkCount: number;
  localThumbCount: number;
  onUpdateSettings: (next: AppSettings) => void;
  onClearHistory: () => void;
  onResetArtworkCache: () => void;
  onPurgeAllLocal: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  artworkCount,
  localThumbCount,
  onUpdateSettings,
  onClearHistory,
  onResetArtworkCache,
  onPurgeAllLocal,
  onClose,
}) => {
  const codecs = useMemo(() => getCodecSupportSummary(), []);

  const badge = (ok: boolean) =>
    ok ? <span className="status-ok"><CheckCircle2 size={15} /> Ativo</span> : <span className="status-off"><XCircle size={15} /> Indisponível</span>;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="cinema-modal">
        <div className="modal-top">
          <h2>Configurações, Privacidade e Codecs</h2>
          <button type="button" className="btn-circle" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-form">
          <div className="cfg-section">
            <h3><Film size={16} /> Estúdio Local & Privacidade</h3>
            <p className="input-help">
              Os frames gerados para vídeos do seu PC ficam exclusivamente no IndexedDB local e são apagados ao revogar a pasta.
            </p>
            <div className="cache-actions">
              <span className="cache-stat">Frames locais no navegador: <strong>{localThumbCount}</strong></span>
              <button
                type="button"
                className="btn-glass"
                onClick={() => {
                  if (window.confirm('Revogar todas as pastas locais e excluir todas as miniaturas geradas?')) {
                    onPurgeAllLocal();
                  }
                }}
              >
                <Trash2 size={14} /> Revogar Pastas & Apagar Frames
              </button>
            </div>
          </div>

          <div className="cfg-section">
            <h3><Image size={16} /> Capas Online (Apenas IPTV)</h3>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={settings.enableExternalArtwork}
                onChange={(e) => onUpdateSettings({ ...settings, enableExternalArtwork: e.target.checked })}
              />
              <span>Buscar pôsteres e sinopses automaticamente apenas para listas IPTV</span>
            </label>
            <div className="input-block">
              <label htmlFor="tmdb-key">Chave da API TMDB v3 (Opcional)</label>
              <input
                id="tmdb-key"
                type="password"
                value={settings.tmdbApiKey}
                onChange={(e) => onUpdateSettings({ ...settings, tmdbApiKey: e.target.value })}
                placeholder="API Key gratuita do themoviedb.org (opcional)"
                className="dark-input"
              />
            </div>
            <div className="cache-actions">
              <span className="cache-stat">Capas IPTV em cache: <strong>{artworkCount}</strong></span>
              <button type="button" className="btn-glass" onClick={onResetArtworkCache}><RefreshCw size={14} /> Reprocessar Capas IPTV</button>
            </div>
          </div>

          <div className="cfg-section">
            <h3>Diagnóstico Real de Codecs</h3>
            <div className="codec-list">
              <div className="codec-row"><span>MediaSource Extensions (HLS.js)</span>{badge(codecs.mseSupported)}</div>
              <div className="codec-row"><span>Vídeo H.264 (AVC)</span>{badge(codecs.h264)}</div>
              <div className="codec-row"><span>Vídeo H.265 (HEVC)</span>{badge(codecs.hevc)}</div>
              <div className="codec-row"><span>Áudio AAC</span>{badge(codecs.aac)}</div>
              <div className="codec-row"><span>Áudio Dolby AC-3 / E-AC-3</span>{badge(codecs.ac3)}</div>
            </div>
          </div>

          <div className="cfg-section">
            <button type="button" className="btn-glass" onClick={onClearHistory}>
              <Trash2 size={15} /> Limpar Trilho "Continuar Assistindo" (IPTV)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

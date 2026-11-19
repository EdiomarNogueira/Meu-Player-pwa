import React, { useState } from 'react';
import { AlertCircle, FileUp, Globe, Server, Sparkles, Trash2, X } from 'lucide-react';
import { Channel, DiagnosticIssue, IptvSource, SourceMetadataCache, SourceType } from '../types/iptv';
import { parseM3uContent } from '../services/m3uParser';
import { diagnoseHttpStatus, diagnoseNetworkException, isMixedContentBlocked, preflightUrlCheck } from '../services/diagnostics';
import { loadXtreamCatalog, XtreamError } from '../services/xtreamClient';

interface SourceModalProps {
  sources: IptvSource[];
  activeSourceId: string | null;
  defaultXtreamFormat: 'm3u8' | 'ts';
  onSelectSource: (id: string) => void;
  onDeleteSource: (id: string) => void;
  onSaveSource: (source: IptvSource, channels: Channel[], metadata?: SourceMetadataCache) => Promise<void>;
  onClose: () => void;
}

const CINEMA_DEMO_M3U = `#EXTM3U
#EXTINF:-1 group-title="Filmes Sci-Fi & Fantasia",Tears of Steel (2012) [FHD]
https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8
#EXTINF:-1 group-title="Filmes Sci-Fi & Fantasia",Sintel (2010) [HD]
https://media.w3.org/2010/05/sintel/trailer.mp4
#EXTINF:-1 group-title="Animação & Família",Big Buck Bunny (2008) [FHD HLS]
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 group-title="Animação & Família",Elephants Dream (2006) [HD]
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4
#EXTINF:-1 group-title="TV ao Vivo • Demo Técnica",Apple Bipbop Multirate Live [HLS]
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8
`;

export const SourceModal: React.FC<SourceModalProps> = ({
  sources,
  activeSourceId,
  defaultXtreamFormat,
  onSelectSource,
  onDeleteSource,
  onSaveSource,
  onClose,
}) => {
  const [tab, setTab] = useState<SourceType>('file');
  const [name, setName] = useState<string>('');
  const [m3uUrl, setM3uUrl] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [xtreamServer, setXtreamServer] = useState<string>('');
  const [xtreamUser, setXtreamUser] = useState<string>('');
  const [xtreamPass, setXtreamPass] = useState<string>('');
  const [xtreamFormat, setXtreamFormat] = useState<'m3u8' | 'ts'>(defaultXtreamFormat);
  const [busy, setBusy] = useState<boolean>(false);
  const [issue, setIssue] = useState<DiagnosticIssue | null>(null);

  const createId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'src_' + Date.now();

  const handleLoadShowcaseDemo = async () => {
    setBusy(true);
    setIssue(null);
    try {
      const sourceId = createId();
      const parsed = parseM3uContent(CINEMA_DEMO_M3U, sourceId);
      const now = Date.now();
      await onSaveSource(
        {
          id: sourceId,
          name: 'Vitrine Cinema Open-Movie (CORS + Capas)',
          type: 'file',
          createdAt: now,
          updatedAt: now,
          channelCount: parsed.channels.length,
        },
        parsed.channels
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssue(null);
    setBusy(true);
    const sourceId = createId();
    const now = Date.now();

    try {
      if (tab === 'file') {
        if (!selectedFile) {
          setIssue({
            code: 'INVALID_FORMAT',
            title: 'Selecione um arquivo .m3u ou .m3u8',
            explanation: 'Nenhum arquivo de playlist foi escolhido.',
            suggestion: 'Clique no campo de arquivo acima.',
          });
          return;
        }
        const parsed = parseM3uContent(await selectedFile.text(), sourceId);
        if (parsed.channels.length === 0) {
          setIssue({
            code: 'INVALID_FORMAT',
            title: 'Lista sem canais válidos',
            explanation: 'Nenhuma entrada #EXTINF com URL encontrada.',
            suggestion: 'Confira se o arquivo segue o padrão #EXTM3U.',
          });
          return;
        }
        await onSaveSource(
          {
            id: sourceId,
            name: name.trim() || selectedFile.name.replace(/\.(m3u8?|txt)$/i, ''),
            type: 'file',
            createdAt: now,
            updatedAt: now,
            channelCount: parsed.channels.length,
          },
          parsed.channels
        );
        onClose();
        return;
      }

      if (tab === 'url') {
        const cleanUrl = m3uUrl.trim();
        const preflight = preflightUrlCheck(cleanUrl);
        if (preflight) {
          setIssue(preflight);
          return;
        }
        let response: Response;
        try {
          response = await fetch(cleanUrl, { method: 'GET', credentials: 'omit' });
        } catch (err) {
          setIssue(diagnoseNetworkException(err, cleanUrl));
          return;
        }
        if (!response.ok) {
          setIssue(diagnoseHttpStatus(response.status, response.statusText));
          return;
        }
        const parsed = parseM3uContent(await response.text(), sourceId);
        if (parsed.channels.length === 0) {
          setIssue({
            code: 'INVALID_FORMAT',
            title: 'A URL não retornou canais M3U válidos',
            explanation: 'Nenhum canal encontrado na resposta.',
            suggestion: 'Verifique se o link aponta diretamente para um arquivo .m3u.',
          });
          return;
        }
        await onSaveSource(
          {
            id: sourceId,
            name: name.trim() || new URL(cleanUrl).hostname,
            type: 'url',
            url: cleanUrl,
            createdAt: now,
            updatedAt: now,
            channelCount: parsed.channels.length,
          },
          parsed.channels
        );
        onClose();
        return;
      }

      if (tab === 'xtream') {
        const creds = {
          serverUrl: xtreamServer.trim(),
          username: xtreamUser.trim(),
          password: xtreamPass.trim(),
          outputFormat: xtreamFormat,
        };
        const { channels, metadata } = await loadXtreamCatalog(sourceId, creds);
        if (channels.length === 0) {
          setIssue({
            code: 'INVALID_FORMAT',
            title: 'Catálogo vazio',
            explanation: 'Nenhum canal retornado pela conta Xtream.',
            suggestion: 'Confira a assinatura junto ao provedor.',
          });
          return;
        }
        await onSaveSource(
          {
            id: sourceId,
            name: name.trim() || 'Xtream • ' + new URL(creds.serverUrl).hostname,
            type: 'xtream',
            xtream: creds,
            createdAt: now,
            updatedAt: now,
            channelCount: channels.length,
          },
          channels,
          metadata
        );
        onClose();
      }
    } catch (err) {
      setIssue(
        err instanceof XtreamError
          ? err.issue
          : {
              code: 'INVALID_FORMAT',
              title: 'Falha ao processar fonte',
              explanation: err instanceof Error ? err.message : 'Erro inesperado.',
              suggestion: 'Revise os campos e tente novamente.',
            }
      );
    } finally {
      setBusy(false);
    }
  };

  const mixedWarn =
    (tab === 'url' && m3uUrl && isMixedContentBlocked(m3uUrl)) ||
    (tab === 'xtream' && xtreamServer && isMixedContentBlocked(xtreamServer));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="cinema-modal">
        <div className="modal-top">
          <h2>Gerenciar Fontes IPTV</h2>
          <button type="button" className="btn-circle" onClick={onClose}><X size={18} /></button>
        </div>

        {sources.length > 0 && (
          <div className="saved-sources-bar">
            <span className="saved-label">Listas IPTV salvas no IndexedDB:</span>
            <div className="saved-chips">
              {sources.map((src) => (
                <div key={src.id} className={'saved-chip ' + (src.id === activeSourceId ? 'active' : '')}>
                  <button type="button" className="chip-main" onClick={() => { onSelectSource(src.id); onClose(); }}>
                    {src.name} ({src.channelCount})
                  </button>
                  <button type="button" className="chip-del" onClick={() => onDeleteSource(src.id)}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-tabs">
          <button type="button" className={'m-tab ' + (tab === 'file' ? 'active' : '')} onClick={() => { setTab('file'); setIssue(null); }}><FileUp size={15} /> Arquivo M3U Local</button>
          <button type="button" className={'m-tab ' + (tab === 'url' ? 'active' : '')} onClick={() => { setTab('url'); setIssue(null); }}><Globe size={15} /> URL M3U Direta</button>
          <button type="button" className={'m-tab ' + (tab === 'xtream' ? 'active' : '')} onClick={() => { setTab('xtream'); setIssue(null); }}><Server size={15} /> Xtream Codes</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="input-block">
            <label htmlFor="src-title">Nome da Fonte (opcional)</label>
            <input id="src-title" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Minha Lista IPTV" className="dark-input" />
          </div>

          {tab === 'file' && (
            <div className="input-block">
              <label htmlFor="src-file">Selecione seu arquivo .m3u ou .m3u8</label>
              <input id="src-file" type="file" accept=".m3u,.m3u8,text/plain" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} className="dark-input" />
            </div>
          )}

          {tab === 'url' && (
            <div className="input-block">
              <label htmlFor="src-url">URL da Playlist (.m3u / .m3u8)</label>
              <input id="src-url" type="url" required value={m3uUrl} onChange={(e) => setM3uUrl(e.target.value)} placeholder="https://servidor.exemplo.com/lista.m3u8" className="dark-input" />
            </div>
          )}

          {tab === 'xtream' && (
            <>
              <div className="input-block">
                <label htmlFor="xc-host">Servidor Xtream</label>
                <input id="xc-host" type="url" required value={xtreamServer} onChange={(e) => setXtreamServer(e.target.value)} placeholder="https://painel.exemplo.com:8443" className="dark-input" />
              </div>
              <div className="two-cols">
                <div className="input-block">
                  <label htmlFor="xc-u">Usuário</label>
                  <input id="xc-u" type="text" required value={xtreamUser} onChange={(e) => setXtreamUser(e.target.value)} className="dark-input" />
                </div>
                <div className="input-block">
                  <label htmlFor="xc-p">Senha</label>
                  <input id="xc-p" type="password" required value={xtreamPass} onChange={(e) => setXtreamPass(e.target.value)} className="dark-input" />
                </div>
              </div>
              <div className="input-block">
                <label htmlFor="xc-out">Formato de stream ao vivo</label>
                <select id="xc-out" value={xtreamFormat} onChange={(e) => setXtreamFormat(e.target.value as 'm3u8' | 'ts')} className="dark-input">
                  <option value="m3u8">HLS (.m3u8) — Compatível com navegador</option>
                  <option value="ts">MPEG-TS (.ts) — Incompatível com HTML5 nativo</option>
                </select>
              </div>
            </>
          )}

          {mixedWarn && (
            <div className="inline-alert warn">
              <AlertCircle size={18} />
              <div><strong>Mixed Content detectado:</strong> App em HTTPS não pode requisitar fontes HTTP inseguras.</div>
            </div>
          )}

          {issue && (
            <div className="inline-alert error" role="alert">
              <AlertCircle size={18} />
              <div>
                <strong>{issue.title}</strong>
                <p>{issue.explanation}</p>
                <p className="tip-text">{issue.suggestion}</p>
                {issue.technicalDetail && <code>{issue.technicalDetail}</code>}
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn-glass" disabled={busy} onClick={handleLoadShowcaseDemo}>
              <Sparkles size={15} />
              <span>Carregar Vitrine Demo IPTV</span>
            </button>
            <div className="right-btns">
              <button type="button" className="btn-glass" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn-crimson" disabled={busy}>{busy ? 'Importando...' : 'Salvar Lista'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

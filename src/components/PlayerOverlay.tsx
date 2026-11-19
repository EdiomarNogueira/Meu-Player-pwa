import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Download,
  ExternalLink,
  ListVideo,
  Maximize,
  PictureInPicture2,
  RefreshCw,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Square,
  Star,
} from 'lucide-react';
import { AppSettings, Channel, DiagnosticIssue, PlaybackRepeatMode } from '../types/iptv';
import { preflightUrlCheck } from '../services/diagnostics';
import { createSubtitleTrackUrl } from '../services/localMediaService';
import { ImageAdjustmentControls, useImageAdjustments } from './ImageAdjustments';
import { LocalVideoOutputCodec, transcodeLocalVideo } from '../services/localVideoTranscoder';

interface PlayerOverlayProps {
  channel: Channel;
  queue: Channel[];
  queueIndex: number;
  repeatMode: PlaybackRepeatMode;
  settings: AppSettings;
  isOnline: boolean;
  isFavorite: boolean;
  onSelectQueueIndex: (index: number) => void;
  onChangeRepeatMode: (mode: PlaybackRepeatMode) => void;
  onToggleFavorite: (channel: Channel) => void;
  onClose: () => void;
}

export const PlayerOverlay: React.FC<PlayerOverlayProps> = ({
  channel,
  queue,
  queueIndex,
  repeatMode,
  settings,
  isOnline,
  isFavorite,
  onSelectQueueIndex,
  onChangeRepeatMode,
  onToggleFavorite,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [issue, setIssue] = useState<DiagnosticIssue | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [qualities, setQualities] = useState<Array<{ index: number; label: string; codec?: string; bitrate: number }>>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1);
  const [selectedCodec, setSelectedCodec] = useState<string>('auto');
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [captureFeedback, setCaptureFeedback] = useState<string>('');
  const [isTranscoding, setIsTranscoding] = useState<boolean>(false);
  const [transcodedMedia, setTranscodedMedia] = useState<{
    channelId: string;
    blob: Blob;
    codec: LocalVideoOutputCodec;
    extension: 'mp4' | 'webm';
  } | null>(null);
  const [outputCodec, setOutputCodec] = useState<LocalVideoOutputCodec>('h264');
  const [transcodeProgress, setTranscodeProgress] = useState<number | null>(null);
  const [transcodeStatus, setTranscodeStatus] = useState<string>('');
  const transcodeAbortRef = useRef<AbortController | null>(null);
  const imageAdjustments = useImageAdjustments();

  const hasQueue = queue.length > 1;

  useEffect(() => {
    if (!captureFeedback) return;
    const timeoutId = window.setTimeout(() => setCaptureFeedback(''), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [captureFeedback]);

  useEffect(() => {
    setTranscodedMedia(null);
    setOutputCodec('h264');
    setTranscodeProgress(null);
    setTranscodeStatus('');
    return () => transcodeAbortRef.current?.abort();
  }, [channel.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let activeBlobUrl: string | null = null;
    let activeSubBlobUrl: string | null = null;

    setIssue(null);
    setQualities([]);
    setSelectedQuality(-1);
    setSelectedCodec('auto');
    setSubtitleUrl(null);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    video.pause();
    video.removeAttribute('src');
    video.load();

    if (channel.isLocalFile || channel.format === 'local') {
      setIsLoading(true);
      if (transcodedMedia?.channelId === channel.id) {
        activeBlobUrl = URL.createObjectURL(transcodedMedia.blob);
        video.src = activeBlobUrl;
        video.onloadedmetadata = () => {
          if (cancelled) return;
          setIsLoading(false);
          if (settings.autoplay) video.play().catch(() => {});
        };
        video.onerror = () => {
          if (cancelled) return;
          setIsLoading(false);
          setIssue({
            code: 'MEDIA_OR_CODEC',
            title: 'O vídeo convertido não pôde ser reproduzido',
            explanation: 'O navegador recusou o MP4 gerado pelo conversor.',
            suggestion: 'Tente converter o arquivo novamente ou use um player externo.',
          });
        };
        return () => {
          cancelled = true;
          video.onloadedmetadata = null;
          video.onerror = null;
          if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        };
      }

      (async () => {
        try {
          const file = channel.localFileHandle ? await channel.localFileHandle.getFile() : channel.localFile;
          if (!file) throw new Error('Permissão do arquivo local expirada.');
          if (cancelled) return;

          activeBlobUrl = URL.createObjectURL(file);
          if (channel.subtitleFile || channel.subtitleHandle) {
            activeSubBlobUrl = await createSubtitleTrackUrl(channel.subtitleFile, channel.subtitleHandle);
            if (!cancelled) setSubtitleUrl(activeSubBlobUrl);
          }

          video.src = activeBlobUrl;
          video.onloadedmetadata = () => {
            if (cancelled) return;
            setIsLoading(false);
            if (!video.videoWidth || !video.videoHeight) {
              setIssue({
                code: 'MEDIA_OR_CODEC',
                title: 'Este arquivo não tem uma imagem de vídeo decodificável',
                explanation: 'O navegador pode não suportar o codec da faixa de vídeo, mesmo que consiga abrir o arquivo ou reproduzir o áudio.',
                suggestion: 'Use o conversor local para gerar uma versão temporária em MP4 (H.264/AAC) compatível com o navegador.',
                technicalDetail: channel.name,
              });
              return;
            }
            if (settings.autoplay) video.play().catch(() => {});
          };
          video.onerror = () => {
            if (cancelled) return;
            setIsLoading(false);
            setIssue({
              code: 'MEDIA_OR_CODEC',
              title: 'Formato ou codec deste arquivo local não suportado pelo navegador',
              explanation: 'O decodificador HTML5 não suporta a faixa de vídeo ou áudio (ex.: AVI ou áudio DTS/AC-3 sem extensão no Windows).',
              suggestion: 'Use o conversor local para gerar uma versão temporária em MP4 (H.264/AAC) compatível com o navegador.',
              technicalDetail: channel.name,
            });
          };
        } catch (err) {
          if (cancelled) return;
          setIsLoading(false);
          setIssue({
            code: 'INVALID_FORMAT',
            title: 'Não foi possível ler o arquivo do disco',
            explanation: err instanceof Error ? err.message : 'O arquivo requer nova permissão de leitura.',
            suggestion: 'Volte ao Estúdio Local e reative a permissão da pasta.',
          });
        }
      })();

      return () => {
        cancelled = true;
        video.onloadedmetadata = null;
        video.onerror = null;
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        if (activeSubBlobUrl) URL.revokeObjectURL(activeSubBlobUrl);
      };
    }

    const preflight = preflightUrlCheck(channel.streamUrl);
    if (preflight) {
      setIsLoading(false);
      setIssue(preflight);
      return;
    }

    if (channel.format === 'ts') {
      setIsLoading(false);
      setIssue({
        code: 'UNSUPPORTED_TS',
        title: 'Fluxo MPEG-TS contínuo (.ts) incompatível com navegador',
        explanation: 'Navegadores reproduzem HLS (.m3u8) ou MP4/WebM, mas não decodificam fluxos contínuos .ts diretamente.',
        suggestion: 'Para Xtream Codes, escolha o formato "HLS (.m3u8)" ao cadastrar a fonte.',
        technicalDetail: channel.streamUrl,
      });
      return;
    }

    setIsLoading(true);
    let mediaRecovered = false;
    const useHlsJs = (channel.format === 'hls' || channel.format === 'unknown') && Hls.isSupported();

    if (useHlsJs) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: settings.lowLatencyHls });
      hlsRef.current = hls;
      hls.loadSource(channel.streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        setIsLoading(false);
        if (data.levels && data.levels.length > 1) {
          setQualities(
            data.levels.map((lvl, idx) => ({
              index: idx,
              label: lvl.height ? lvl.height + 'p' : Math.round(lvl.bitrate / 1000) + ' kbps',
              codec: lvl.videoCodec || undefined,
              bitrate: lvl.bitrate,
            }))
          );
        }
        if (settings.autoplay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setIsLoading(false);
          const status = data.response?.code;
          setIssue({
            code: !status || status === 0 ? 'CORS_OR_NETWORK' : 'HTTP_STATUS',
            title: !status || status === 0 ? 'Bloqueio de CORS ou falha de rede' : 'Erro HTTP ' + status + ' no servidor de mídia',
            explanation: !status || status === 0
              ? 'O servidor de vídeo não envia o cabeçalho "Access-Control-Allow-Origin" (CORS) ou está inacessível.'
              : 'O servidor recusou a conexão ou o canal está fora do ar.',
            suggestion: 'Teste outro título ou confira a compatibilidade HTTPS/CORS da fonte.',
            technicalDetail: data.details,
          });
          hls.destroy();
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true;
          hls.recoverMediaError();
          return;
        }

        setIsLoading(false);
        setIssue({
          code: 'MEDIA_OR_CODEC',
          title: 'Codec ou formato incompatível com o navegador',
          explanation: 'A transmissão utiliza um codec sem decodificador ativo no navegador.',
          suggestion: 'Prefira streams em H.264 (AVC) com áudio AAC.',
          technicalDetail: data.details,
        });
        hls.destroy();
      });
    } else {
      video.src = channel.streamUrl;
      video.onloadedmetadata = () => {
        setIsLoading(false);
        if (settings.autoplay) video.play().catch(() => {});
      };
      video.onerror = () => {
        setIsLoading(false);
        setIssue({
          code: 'MEDIA_OR_CODEC',
          title: 'Não foi possível reproduzir este fluxo diretamente',
          explanation: 'O elemento de vídeo encontrou bloqueio de CORS, container incompatível ou codec ausente.',
          suggestion: 'Verifique os codecs nas Configurações.',
        });
      };
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel, settings.autoplay, settings.lowLatencyHls, isOnline, reloadToken, transcodedMedia]);

  const handleVideoEnded = () => {
    const video = videoRef.current;
    if (repeatMode === 'loop-one') {
      if (video) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
      return;
    }
    if (repeatMode === 'stop' || queue.length <= 1) return;
    if (queueIndex < queue.length - 1) onSelectQueueIndex(queueIndex + 1);
    else if (repeatMode === 'loop-all') onSelectQueueIndex(0);
  };

  const cycleRepeatMode = () => {
    const order: PlaybackRepeatMode[] = ['next', 'loop-all', 'loop-one', 'stop'];
    onChangeRepeatMode(order[(order.indexOf(repeatMode) + 1) % order.length]);
  };

  const repeatLabel =
    repeatMode === 'next' ? 'Auto-Próximo' : repeatMode === 'loop-all' ? 'Loop Pasta' : repeatMode === 'loop-one' ? 'Loop 1' : 'Parar';
  const outputCodecLabel = outputCodec === 'h264' ? 'H.264 / AAC (MP4)' : outputCodec === 'hevc' ? 'H.265 / AAC (MP4)' : 'VP9 / Opus (WebM)';

  const videoCodecs = Array.from(new Set(qualities.map((quality) => quality.codec).filter((codec): codec is string => Boolean(codec))));
  const codecLabel = (codec: string) => {
    const normalized = codec.toLowerCase();
    if (normalized.startsWith('avc1') || normalized.startsWith('avc3')) return `H.264 (${codec})`;
    if (normalized.startsWith('hvc1') || normalized.startsWith('hev1')) return `H.265 / HEVC (${codec})`;
    if (normalized.startsWith('vp09') || normalized.startsWith('vp9')) return `VP9 (${codec})`;
    if (normalized.startsWith('av01')) return `AV1 (${codec})`;
    return codec;
  };

  const saveCurrentFrame = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setCaptureFeedback('Aguarde o vídeo carregar para salvar um quadro.');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas indisponível');

      context.filter = imageAdjustments.videoFilter;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha ao gerar imagem')), 'image/png');
      });
      const downloadUrl = URL.createObjectURL(imageBlob);
      const link = document.createElement('a');
      const safeTitle = channel.cleanTitle.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'video';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = downloadUrl;
      link.download = `${safeTitle}-${timestamp}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setCaptureFeedback('Quadro salvo como PNG.');
    } catch {
      setCaptureFeedback('Não foi possível capturar este quadro. O fluxo pode bloquear a captura.');
    }
  };

  const downloadConvertedVideo = () => {
    if (!transcodedMedia || transcodedMedia.channelId !== channel.id) return;
    const downloadUrl = URL.createObjectURL(transcodedMedia.blob);
    const link = document.createElement('a');
    const safeTitle = channel.cleanTitle.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'video';
    link.href = downloadUrl;
    link.download = `${safeTitle}-${transcodedMedia.codec}.${transcodedMedia.extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };

  const convertLocalVideo = async () => {
    if (!channel.isLocalFile) return;
    const controller = new AbortController();
    transcodeAbortRef.current = controller;
    setIsTranscoding(true);
    setIsLoading(true);
    setIssue(null);
    setTranscodeProgress(null);
    setTranscodeStatus('Iniciando conversão...');

    try {
      const file = channel.localFileHandle
        ? await channel.localFileHandle.getFile()
        : channel.localFile;
      if (!file) throw new Error('Não foi possível ler o arquivo local.');
      const extension = file.name.split('.').pop() || '';
      const blob = await transcodeLocalVideo(
        file,
        extension,
        outputCodec,
        controller.signal,
        setTranscodeProgress,
        setTranscodeStatus,
        videoRef.current?.duration
      );
      if (controller.signal.aborted) return;
      setTranscodedMedia({
        channelId: channel.id,
        blob,
        codec: outputCodec,
        extension: outputCodec === 'vp9' ? 'webm' : 'mp4',
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setIsLoading(false);
      setIssue({
        code: 'MEDIA_OR_CODEC',
        title: 'Não foi possível converter este vídeo',
        explanation: error instanceof Error ? error.message : 'O conversor não conseguiu ler ou transformar este arquivo.',
        suggestion: 'Tente um arquivo menor ou converta-o com um aplicativo de vídeo instalado no computador.',
        technicalDetail: channel.name,
      });
    } finally {
      if (transcodeAbortRef.current === controller) transcodeAbortRef.current = null;
      if (!controller.signal.aborted) setIsTranscoding(false);
    }
  };

  return (
    <div className="theater-overlay" ref={stageRef}>
      <div className="theater-topbar">
        <button type="button" className="theater-back-btn" onClick={onClose}>
          <ArrowLeft size={20} />
          <span>Voltar</span>
        </button>

        <div className="theater-title-group">
          <h2>{channel.cleanTitle}</h2>
          <span>{hasQueue ? `Item ${queueIndex + 1} de ${queue.length} • ` : ''}{channel.group}</span>
        </div>

        <div className="theater-controls">
          {transcodedMedia?.channelId === channel.id && (
            <button type="button" className="btn-glass" onClick={downloadConvertedVideo} title="Baixar uma cópia convertida">
              <Download size={15} />
              <span>Baixar {transcodedMedia.codec.toUpperCase()}</span>
            </button>
          )}
          <button type="button" className="btn-glass" onClick={saveCurrentFrame} title="Salvar o quadro atual como PNG">
            <Camera size={15} />
            <span>Salvar frame</span>
          </button>
          <ImageAdjustmentControls
            values={imageAdjustments.values}
            onChange={imageAdjustments.setValue}
            onReset={imageAdjustments.reset}
            filterId={imageAdjustments.filterId}
            curve={imageAdjustments.curve}
            kernel={imageAdjustments.kernel}
            isVideo
          />
          {hasQueue && (
            <>
              <button type="button" className="btn-circle" disabled={queueIndex <= 0 && repeatMode !== 'loop-all'} onClick={() => onSelectQueueIndex(queueIndex > 0 ? queueIndex - 1 : queue.length - 1)}><SkipBack size={16} /></button>
              <button type="button" className="btn-circle" disabled={queueIndex >= queue.length - 1 && repeatMode !== 'loop-all'} onClick={() => onSelectQueueIndex(queueIndex < queue.length - 1 ? queueIndex + 1 : 0)}><SkipForward size={16} /></button>
            </>
          )}

          {(hasQueue || channel.isLocalFile) && (
            <button type="button" className="btn-glass" onClick={cycleRepeatMode}>
              {repeatMode === 'loop-one' ? <Repeat1 size={15} /> : repeatMode === 'loop-all' ? <Repeat size={15} /> : repeatMode === 'stop' ? <Square size={14} /> : <ListVideo size={15} />}
              <span>{repeatLabel}</span>
            </button>
          )}

          {hasQueue && (
            <button type="button" className={'btn-glass ' + (isDrawerOpen ? 'active-drawer-btn' : '')} onClick={() => setIsDrawerOpen((o) => !o)}>
              <ListVideo size={15} />
              <span>Fila ({queue.length})</span>
            </button>
          )}

          {videoCodecs.length > 0 && (
            <select
              className="theater-select"
              aria-label="Codec de vídeo"
              value={selectedCodec}
              onChange={(e) => {
                const codec = e.target.value;
                setSelectedCodec(codec);
                if (!hlsRef.current) return;
                if (codec === 'auto') {
                  setSelectedQuality(-1);
                  hlsRef.current.currentLevel = -1;
                  return;
                }
                const bestVariant = qualities
                  .filter((quality) => quality.codec === codec)
                  .sort((a, b) => b.bitrate - a.bitrate)[0];
                if (bestVariant) {
                  setSelectedQuality(bestVariant.index);
                  hlsRef.current.currentLevel = bestVariant.index;
                }
              }}
            >
              <option value="auto">Codec: Auto</option>
              {videoCodecs.map((codec) => <option key={codec} value={codec}>{codecLabel(codec)}</option>)}
            </select>
          )}

          {qualities.length > 0 && (
            <select
              className="theater-select"
              value={selectedQuality}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setSelectedQuality(idx);
                setSelectedCodec(idx < 0 ? 'auto' : qualities.find((quality) => quality.index === idx)?.codec || 'auto');
                if (hlsRef.current) hlsRef.current.currentLevel = idx;
              }}
            >
              <option value={-1}>Qualidade: Auto</option>
              {qualities.map((q) => <option key={q.index} value={q.index}>{q.label}</option>)}
            </select>
          )}

          {!channel.isLocalFile && (
            <button type="button" className={'btn-circle ' + (isFavorite ? 'fav-lit' : '')} onClick={() => onToggleFavorite(channel)}>
              <Star size={17} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
          )}

          <button type="button" className="btn-circle" onClick={() => setReloadToken((n) => n + 1)}><RefreshCw size={17} /></button>
          <button
            type="button"
            className="btn-circle"
            onClick={async () => {
              const v = videoRef.current;
              if (!v) return;
              try {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
              } catch {}
            }}
          >
            <PictureInPicture2 size={17} />
          </button>
          <button
            type="button"
            className="btn-circle"
            onClick={async () => {
              if (!stageRef.current) return;
              if (document.fullscreenElement) await document.exitFullscreen();
              else await stageRef.current.requestFullscreen();
            }}
          >
            <Maximize size={17} />
          </button>
        </div>
      </div>

      <div className="theater-body-split">
        <div className="theater-video-wrap">
          <video ref={videoRef} controls playsInline crossOrigin={channel.isLocalFile ? undefined : 'anonymous'} onEnded={handleVideoEnded} className="theater-video" style={{ filter: imageAdjustments.videoFilter }}>
            {subtitleUrl && <track kind="subtitles" src={subtitleUrl} srcLang="pt" label="Legenda Local" default />}
          </video>

          {captureFeedback && <div className="capture-feedback" role="status" aria-live="polite">{captureFeedback}</div>}

          {isLoading && !issue && (
            <div className="theater-status-layer">
              <div className="cinema-spinner" />
              <p>{isTranscoding ? `${transcodeStatus || `Convertendo para ${outputCodecLabel}`}${transcodeProgress !== null ? ` — ${transcodeProgress}%` : ''}` : 'Carregando mídia...'}</p>
              {isTranscoding && (
                <div className="transcode-progress-track" role="progressbar" aria-label="Progresso da conversão" aria-valuemin={0} aria-valuemax={100} aria-valuenow={transcodeProgress ?? undefined}>
                  <div className={transcodeProgress === null ? 'transcode-progress-fill indeterminate' : 'transcode-progress-fill'} style={transcodeProgress === null ? undefined : { width: `${transcodeProgress}%` }} />
                </div>
              )}
            </div>
          )}

          {issue && (
            <div className="theater-status-layer" role="alert">
              <div className="diagnostic-modal-box">
                <div className="diag-head">
                  <AlertTriangle size={24} className="diag-icon" />
                  <h3>{issue.title}</h3>
                </div>
                <p className="diag-desc">{issue.explanation}</p>
                <p className="diag-tip"><strong>Recomendação:</strong> {issue.suggestion}</p>
                {issue.technicalDetail && <code className="diag-tech">{issue.technicalDetail}</code>}
                {channel.isLocalFile && (
                  <label className="codec-output-field">
                    <span>Converter para</span>
                    <select className="theater-select" value={outputCodec} onChange={(event) => setOutputCodec(event.target.value as LocalVideoOutputCodec)}>
                      <option value="h264">H.264 / AAC — MP4 (mais compatível)</option>
                      <option value="hevc">H.265 / AAC — MP4</option>
                      <option value="vp9">VP9 / Opus — WebM</option>
                    </select>
                  {outputCodec !== 'h264' && <small className="codec-output-hint">H.265 e VP9 dependem do suporte do navegador; se não abrir, tente H.264.</small>}
                  </label>
                )}
                <div className="diag-buttons">
                  {channel.isLocalFile && (
                    <button type="button" className="btn-crimson" onClick={convertLocalVideo} disabled={isTranscoding}>
                      <RefreshCw size={15} className={isTranscoding ? 'spin-inline' : ''} />
                      <span>{isTranscoding ? 'Convertendo...' : 'Converter e reproduzir'}</span>
                    </button>
                  )}
                  <button type="button" className="btn-crimson" onClick={() => setReloadToken((n) => n + 1)}>
                    <RefreshCw size={15} />
                    <span>Tentar Novamente</span>
                  </button>
                  {!channel.isLocalFile && (
                    <a href={channel.streamUrl} target="_blank" rel="noopener noreferrer" className="btn-glass">
                      <ExternalLink size={15} />
                      <span>Abrir URL Direta</span>
                    </a>
                  )}
                </div>
                {channel.isLocalFile && <p className="diag-local-note">A conversão roda neste aparelho, pode demorar e usar bastante memória. O vídeo original não é alterado nem enviado.</p>}
              </div>
            </div>
          )}
        </div>

        {hasQueue && isDrawerOpen && (
          <aside className="queue-drawer">
            <div className="queue-drawer-head">
              <h3>Fila de Reprodução</h3>
              <span>{queueIndex + 1} / {queue.length}</span>
            </div>
            <div className="queue-drawer-list">
              {queue.map((item, idx) => (
                <button key={item.id} type="button" className={'queue-row-btn ' + (idx === queueIndex ? 'current' : '')} onClick={() => onSelectQueueIndex(idx)}>
                  <span className="q-index">{idx + 1}</span>
                  <div className="q-texts">
                    <span className="q-name">{item.cleanTitle}</span>
                    <small>{item.group}</small>
                  </div>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

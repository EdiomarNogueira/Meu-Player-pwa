import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Layers,
  ListVideo,
  LockOpen,
  Play,
  RefreshCw,
  Repeat,
  Repeat1,
  ShieldCheck,
  Square,
  Subtitles,
  Trash2,
} from 'lucide-react';
import {
  Channel,
  LocalMediaItem,
  LocalSeriesGroup,
  LocalThumbCache,
  PlaybackRepeatMode,
  SavedLocalRoot,
} from '../types/iptv';
import {
  buildLocalSeriesGroups,
  formatDuration,
  formatFileSize,
  generateVideoFrameThumbnail,
  getThumbCacheKey,
  localVideoToChannel,
  naturalCompare,
  readVideoDuration,
  resolveLocalItemFile,
} from '../services/localMediaService';
import { getAtmosphericGradient } from '../services/titleCleaner';
import { PhotoLightbox } from './PhotoLightbox';

type MediaFilterTab = 'all' | 'videos' | 'series' | 'photos';
type LocalVideoSort = 'name' | 'date-newest' | 'date-oldest' | 'duration-longest' | 'duration-shortest';

const LocalPhotoThumb: React.FC<{ item: LocalMediaItem; onClick: () => void }> = ({ item, onClick }) => {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let blobUrl: string | null = null;
    resolveLocalItemFile(item)
      .then((file) => {
        if (!active) return;
        blobUrl = URL.createObjectURL(file);
        setUrl(blobUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [item]);

  return (
    <article className="studio-photo-card" onClick={onClick}>
      <div className="studio-photo-frame">
        {url ? <img src={url} alt={item.title} loading="lazy" /> : <div className="studio-photo-placeholder"><ImageIcon size={24} /></div>}
      </div>
      <div className="studio-photo-caption">
        <span title={item.name}>{item.title}</span>
        <small>{item.extension.toUpperCase()}</small>
      </div>
    </article>
  );
};

interface LocalStudioViewProps {
  savedRoots: SavedLocalRoot[];
  activeRootId: string | null;
  needsPermissionRoot: SavedLocalRoot | null;
  items: LocalMediaItem[];
  thumbsMap: Record<string, LocalThumbCache>;
  searchQuery: string;
  repeatMode: PlaybackRepeatMode;
  isScanning: boolean;
  onChangeRepeatMode: (mode: PlaybackRepeatMode) => void;
  onPickDirectory: () => void;
  onFallbackFilesSelected: (files: FileList) => void;
  onSelectSavedRoot: (root: SavedLocalRoot) => void;
  onGrantRootPermission: (root: SavedLocalRoot) => void;
  onRemoveSavedRoot: (id: string) => void;
  onPurgeAllLocal: () => void;
  onThumbGenerated: (thumb: LocalThumbCache) => void;
  onPlayVideoQueue: (queue: Channel[], startIndex: number) => void;
}

export const LocalStudioView: React.FC<LocalStudioViewProps> = ({
  savedRoots,
  activeRootId,
  needsPermissionRoot,
  items,
  thumbsMap,
  searchQuery,
  repeatMode,
  isScanning,
  onChangeRepeatMode,
  onPickDirectory,
  onFallbackFilesSelected,
  onSelectSavedRoot,
  onGrantRootPermission,
  onRemoveSavedRoot,
  onPurgeAllLocal,
  onThumbGenerated,
  onPlayVideoQueue,
}) => {
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const [mediaTab, setMediaTab] = useState<MediaFilterTab>('all');
  const [selectedFolder, setSelectedFolder] = useState<string>('ALL');
  const [expandedSeriesId, setExpandedSeriesId] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [thumbGenCount, setThumbGenCount] = useState<{ done: number; total: number } | null>(null);
  const [videoSort, setVideoSort] = useState<LocalVideoSort>('name');
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [durationScan, setDurationScan] = useState<{ done: number; total: number } | null>(null);
  const durationScanId = useRef(0);

  useEffect(() => {
    setSelectedFolder('ALL');
    setExpandedSeriesId(null);
    setVideoSort('name');
    setVideoDurations({});
    setDurationScan(null);
    durationScanId.current += 1;
  }, [activeRootId]);

  useEffect(() => () => {
    durationScanId.current += 1;
  }, []);

  useEffect(() => {
    const videosWithoutThumb = items
      .filter((i) => i.kind === 'video' && !thumbsMap[getThumbCacheKey(i)])
      .slice(0, 80);

    if (videosWithoutThumb.length === 0) {
      setThumbGenCount(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const total = videosWithoutThumb.length;
      let done = 0;
      setThumbGenCount({ done: 0, total });

      for (const vid of videosWithoutThumb) {
        if (cancelled) return;
        const generated = await generateVideoFrameThumbnail(vid);
        done += 1;
        if (!cancelled) {
          if (generated) onThumbGenerated(generated);
          setThumbGenCount(done >= total ? null : { done, total });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items]);

  const folders = useMemo(() => {
    const map = new Map<string, { videos: number; photos: number }>();
    for (const item of items) {
      const cur = map.get(item.folderPath) ?? { videos: 0, photos: 0 };
      if (item.kind === 'video') cur.videos += 1;
      else cur.photos += 1;
      map.set(item.folderPath, cur);
    }
    return Array.from(map.entries())
      .map(([path, counts]) => ({ path, ...counts }))
      .sort((a, b) => naturalCompare(a.path, b.path));
  }, [items]);

  const scopedItems = useMemo(() => {
    const base = selectedFolder === 'ALL' ? items : items.filter((i) => i.folderPath === selectedFolder);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (i) => i.title.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || i.folderPath.toLowerCase().includes(q)
    );
  }, [items, selectedFolder, searchQuery]);

  const videos = useMemo(() => {
    const list = scopedItems.filter((item) => item.kind === 'video');
    const getDuration = (item: LocalMediaItem) => videoDurations[item.id] ?? thumbsMap[getThumbCacheKey(item)]?.durationSec;

    return list.sort((a, b) => {
      if (videoSort === 'date-newest') return b.lastModified - a.lastModified || naturalCompare(a.relativePath, b.relativePath);
      if (videoSort === 'date-oldest') return a.lastModified - b.lastModified || naturalCompare(a.relativePath, b.relativePath);
      if (videoSort === 'duration-longest' || videoSort === 'duration-shortest') {
        const aDuration = getDuration(a);
        const bDuration = getDuration(b);
        if (aDuration === undefined && bDuration !== undefined) return 1;
        if (aDuration !== undefined && bDuration === undefined) return -1;
        if (aDuration !== undefined && bDuration !== undefined && aDuration !== bDuration) {
          return (videoSort === 'duration-longest' ? -1 : 1) * (aDuration - bDuration);
        }
      }
      return naturalCompare(a.relativePath, b.relativePath);
    });
  }, [scopedItems, videoSort, videoDurations, thumbsMap]);
  const photos = useMemo(() => scopedItems.filter((i) => i.kind === 'image'), [scopedItems]);
  const seriesGroups = useMemo(() => buildLocalSeriesGroups(scopedItems), [scopedItems]);

  const expandedSeries: LocalSeriesGroup | null = useMemo(
    () => (expandedSeriesId ? seriesGroups.find((s) => s.id === expandedSeriesId) ?? null : null),
    [seriesGroups, expandedSeriesId]
  );

  const handlePlayFolderAll = (videoList: LocalMediaItem[], startIdx = 0) => {
    if (videoList.length === 0) return;
    onPlayVideoQueue(videoList.map(localVideoToChannel), startIdx);
  };

  const handleVideoSortChange = (sort: LocalVideoSort) => {
    durationScanId.current += 1;
    const scanId = durationScanId.current;
    setVideoSort(sort);
    setDurationScan(null);
    if (sort !== 'duration-longest' && sort !== 'duration-shortest') return;

    const missing = scopedItems.filter((item) =>
      item.kind === 'video' && videoDurations[item.id] === undefined && thumbsMap[getThumbCacheKey(item)]?.durationSec === undefined
    );
    if (missing.length === 0) return;

    let nextIndex = 0;
    let done = 0;
    setDurationScan({ done, total: missing.length });
    const worker = async () => {
      while (scanId === durationScanId.current) {
        const index = nextIndex++;
        if (index >= missing.length) return;
        const item = missing[index];
        const duration = await readVideoDuration(item);
        if (scanId !== durationScanId.current) return;
        if (duration !== null) setVideoDurations((current) => ({ ...current, [item.id]: duration }));
        done += 1;
        setDurationScan(done >= missing.length ? null : { done, total: missing.length });
      }
    };

    void Promise.all(Array.from({ length: Math.min(3, missing.length) }, () => worker()));
  };

  const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  return (
    <div className="studio-shell">
      <input
        ref={fallbackInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory em desktop
        webkitdirectory=""
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFallbackFilesSelected(e.target.files);
        }}
      />

      <aside className="studio-sidebar">
        <div className="studio-sidebar-block">
          <button
            type="button"
            className="btn-studio-primary full-width"
            onClick={() => (supportsDirectoryPicker ? onPickDirectory() : fallbackInputRef.current?.click())}
          >
            <FolderPlus size={17} />
            <span>Vincular Pasta do PC</span>
          </button>
        </div>

        {savedRoots.length > 0 && (
          <div className="studio-sidebar-block">
            <span className="studio-section-label">
              <HardDrive size={13} /> Diretórios Salvos
            </span>
            <div className="studio-roots-list">
              {savedRoots.map((root) => (
                <div key={root.id} className={'studio-root-item ' + (root.id === activeRootId ? 'active' : '')}>
                  <button type="button" className="root-main-btn" onClick={() => onSelectSavedRoot(root)}>
                    <Folder size={15} />
                    <span>{root.name}</span>
                  </button>
                  <button
                    type="button"
                    className="root-del-btn"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Revogar acesso à pasta "${root.name}" e excluir todas as miniaturas geradas para ela deste navegador? (Seus arquivos originais no PC permanecem intactos)`
                        )
                      ) {
                        onRemoveSavedRoot(root.id);
                      }
                    }}
                    title="Revogar pasta e apagar miniaturas geradas"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn-studio full-width btn-danger-soft"
              onClick={() => {
                if (
                  window.confirm(
                    'Desvincular TODAS as pastas locais e excluir permanentemente 100% das miniaturas geradas no banco local do navegador?'
                  )
                ) {
                  onPurgeAllLocal();
                }
              }}
            >
              <Trash2 size={14} />
              <span>Revogar Tudo & Limpar Cache</span>
            </button>
          </div>
        )}

        {folders.length > 0 && (
          <div className="studio-sidebar-block studio-tree-scroll">
            <span className="studio-section-label">
              <FolderOpen size={13} /> Subpastas ({folders.length})
            </span>
            <div className="studio-folder-tree">
              <button type="button" className={'folder-node ' + (selectedFolder === 'ALL' ? 'active' : '')} onClick={() => setSelectedFolder('ALL')}>
                <span className="folder-node-name">Tudo na Pasta Raiz</span>
                <span className="folder-node-count">{items.length}</span>
              </button>
              {folders.map((f) => (
                <button key={f.path} type="button" className={'folder-node ' + (selectedFolder === f.path ? 'active' : '')} onClick={() => setSelectedFolder(f.path)} title={f.path}>
                  <span className="folder-node-name">{f.path}</span>
                  <span className="folder-node-count">
                    {f.videos > 0 ? `${f.videos}v` : ''}{f.videos > 0 && f.photos > 0 ? ' • ' : ''}{f.photos > 0 ? `${f.photos}f` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="studio-privacy-note">
          <ShieldCheck size={16} />
          <div>
            <strong>100% Local e Revogável</strong>
            <p>Nenhum arquivo sai do PC. Ao revogar uma pasta, o acesso e todas as miniaturas geradas são excluídos do navegador.</p>
          </div>
        </div>
      </aside>

      <main className="studio-workspace">
        <div className="studio-toolbar">
          <div className="studio-mode-tabs">
            <button type="button" className={'s-tab ' + (mediaTab === 'all' ? 'active' : '')} onClick={() => setMediaTab('all')}>Visão Geral ({scopedItems.length})</button>
            <button type="button" className={'s-tab ' + (mediaTab === 'series' ? 'active' : '')} onClick={() => setMediaTab('series')}><Layers size={14} /> Séries ({seriesGroups.length})</button>
            <button type="button" className={'s-tab ' + (mediaTab === 'videos' ? 'active' : '')} onClick={() => setMediaTab('videos')}><Film size={14} /> Vídeos ({videos.length})</button>
            <button type="button" className={'s-tab ' + (mediaTab === 'photos' ? 'active' : '')} onClick={() => setMediaTab('photos')}><ImageIcon size={14} /> Fotos ({photos.length})</button>
          </div>

          <div className="studio-queue-bar">
            {thumbGenCount && (
              <span className="thumb-progress-badge">
                <RefreshCw size={13} className="spin-inline" /> Frames {thumbGenCount.done}/{thumbGenCount.total}
              </span>
            )}

            {durationScan && (
              <span className="thumb-progress-badge">
                <RefreshCw size={13} className="spin-inline" /> Durações {durationScan.done}/{durationScan.total}
              </span>
            )}

            <div className="repeat-selector">
              <button type="button" className={'rep-btn ' + (repeatMode === 'next' ? 'active' : '')} onClick={() => onChangeRepeatMode('next')}><ListVideo size={15} /><span>Auto-Próximo</span></button>
              <button type="button" className={'rep-btn ' + (repeatMode === 'loop-all' ? 'active' : '')} onClick={() => onChangeRepeatMode('loop-all')}><Repeat size={15} /><span>Loop Pasta</span></button>
              <button type="button" className={'rep-btn ' + (repeatMode === 'loop-one' ? 'active' : '')} onClick={() => onChangeRepeatMode('loop-one')}><Repeat1 size={15} /><span>Loop 1</span></button>
              <button type="button" className={'rep-btn ' + (repeatMode === 'stop' ? 'active' : '')} onClick={() => onChangeRepeatMode('stop')}><Square size={14} /><span>Parar</span></button>
            </div>

            {videos.length > 0 && (
              <select className="studio-sort-select" aria-label="Ordenar vídeos" value={videoSort} onChange={(event) => handleVideoSortChange(event.target.value as LocalVideoSort)}>
                <option value="name">Ordem: nome</option>
                <option value="date-newest">Modificação: mais recente</option>
                <option value="date-oldest">Modificação: mais antiga</option>
                <option value="duration-longest">Duração: maior primeiro</option>
                <option value="duration-shortest">Duração: menor primeiro</option>
              </select>
            )}

            {videos.length > 0 && (
              <button type="button" className="btn-studio-primary" onClick={() => handlePlayFolderAll(videos, 0)}>
                <Play size={16} fill="currentColor" />
                <span>Reproduzir Pasta ({videos.length})</span>
              </button>
            )}
          </div>
        </div>

        {needsPermissionRoot ? (
          <div className="studio-empty-box">
            <LockOpen size={44} className="cyan-accent" />
            <h2>Reativar acesso à pasta "{needsPermissionRoot.name}"</h2>
            <p>Confirme a permissão de leitura para listar os vídeos e fotos desta pasta salva.</p>
            <div className="series-head-actions">
              <button type="button" className="btn-studio-primary" onClick={() => onGrantRootPermission(needsPermissionRoot)}>
                <LockOpen size={17} />
                <span>Permitir Leitura</span>
              </button>
              <button type="button" className="btn-studio btn-danger-soft" onClick={() => onRemoveSavedRoot(needsPermissionRoot.id)}>
                <Trash2 size={15} />
                <span>Revogar Pasta & Cache</span>
              </button>
            </div>
          </div>
        ) : isScanning ? (
          <div className="studio-empty-box">
            <div className="studio-spinner" />
            <p>Lendo arquivos de mídia e legendas da pasta...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="studio-empty-box">
            <HardDrive size={48} className="cyan-accent" />
            <h2>Estúdio de Vídeos e Fotos do Computador</h2>
            <p>Selecione qualquer pasta local. As miniaturas são extraídas do próprio vídeo no navegador e podem ser excluídas a qualquer momento.</p>
            <button type="button" className="btn-studio-primary" onClick={() => (supportsDirectoryPicker ? onPickDirectory() : fallbackInputRef.current?.click())}>
              <FolderPlus size={18} />
              <span>Selecionar Pasta do PC</span>
            </button>
          </div>
        ) : (
          <div className="studio-content-scroll">
            {expandedSeries && (
              <section className="series-showcase-box">
                <div className="series-showcase-head">
                  <div>
                    <span className="series-kicker">SÉRIE / COLEÇÃO DETECTADA</span>
                    <h2>{expandedSeries.title}</h2>
                    <p>{expandedSeries.episodes.length} episódios • {expandedSeries.folderPath}</p>
                  </div>
                  <div className="series-head-actions">
                    <button type="button" className="btn-studio-primary" onClick={() => handlePlayFolderAll(expandedSeries.episodes, 0)}>
                      <Play size={16} fill="currentColor" />
                      <span>Maratonar Tudo</span>
                    </button>
                    <button type="button" className="btn-studio" onClick={() => setExpandedSeriesId(null)}>Fechar</button>
                  </div>
                </div>

                {expandedSeries.seasons.size > 1 && (
                  <div className="season-pills">
                    {Array.from(expandedSeries.seasons.keys()).map((sNum) => (
                      <button key={sNum} type="button" className={'season-pill ' + (selectedSeason === sNum ? 'active' : '')} onClick={() => setSelectedSeason(sNum)}>
                        Temporada {sNum}
                      </button>
                    ))}
                  </div>
                )}

                <div className="episode-list">
                  {(expandedSeries.seasons.get(selectedSeason) ?? expandedSeries.episodes).map((ep) => {
                    const globalIdx = expandedSeries.episodes.findIndex((e) => e.id === ep.id);
                    const thumb = thumbsMap[getThumbCacheKey(ep)];
                    const hasSub = Boolean(ep.subtitleFile || ep.subtitleHandle);
                    return (
                      <div key={ep.id} className="episode-row" onClick={() => handlePlayFolderAll(expandedSeries.episodes, Math.max(0, globalIdx))}>
                        <div className="episode-thumb" style={{ backgroundImage: getAtmosphericGradient(ep.title) }}>
                          {thumb?.dataUrl && <img src={thumb.dataUrl} alt={ep.title} />}
                          <span className="ep-play-icon"><Play size={16} fill="currentColor" /></span>
                          {thumb?.durationSec && <span className="ep-duration">{formatDuration(thumb.durationSec)}</span>}
                        </div>
                        <div className="episode-info">
                          <div className="episode-title-line">
                            {ep.episodeNumber !== undefined && <span className="ep-num">Ep. {String(ep.episodeNumber).padStart(2, '0')}</span>}
                            <h4>{ep.title}</h4>
                            {hasSub && <span className="sub-badge"><Subtitles size={13} /> LEG</span>}
                          </div>
                          <span className="ep-filepath">{ep.name} • {formatFileSize(ep.sizeBytes)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {(mediaTab === 'all' || mediaTab === 'series') && seriesGroups.length > 0 && (
              <section className="studio-block">
                <div className="studio-block-header">
                  <h3><Layers size={18} /> Séries e Pastas Sequenciais ({seriesGroups.length})</h3>
                </div>
                <div className="series-cards-grid">
                  {seriesGroups.map((sg) => {
                    const coverThumb = thumbsMap[getThumbCacheKey(sg.coverItem)];
                    return (
                      <article
                        key={sg.id}
                        className="series-folder-card"
                        onClick={() => {
                          setSelectedSeason(Array.from(sg.seasons.keys())[0] ?? 1);
                          setExpandedSeriesId(sg.id);
                        }}
                      >
                        <div className="series-folder-art" style={{ backgroundImage: getAtmosphericGradient(sg.title) }}>
                          {coverThumb?.dataUrl && <img src={coverThumb.dataUrl} alt={sg.title} />}
                          <div className="series-stack-badge">{sg.episodes.length} episódios</div>
                        </div>
                        <div className="series-folder-meta">
                          <h4>{sg.title}</h4>
                          <span>{sg.seasons.size} {sg.seasons.size > 1 ? 'temporadas' : 'pasta'}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {(mediaTab === 'all' || mediaTab === 'videos') && videos.length > 0 && (
              <section className="studio-block">
                <div className="studio-block-header">
                  <h3><Film size={18} /> Vídeos Locais ({videos.length})</h3>
                </div>
                <div className="studio-video-grid">
                  {videos.map((vid, idx) => {
                    const thumb = thumbsMap[getThumbCacheKey(vid)];
                    const hasSub = Boolean(vid.subtitleFile || vid.subtitleHandle);
                    return (
                      <article key={vid.id} className="studio-video-card" onClick={() => handlePlayFolderAll(videos, idx)}>
                        <div className="studio-video-thumb" style={{ backgroundImage: getAtmosphericGradient(vid.title) }}>
                          {thumb?.dataUrl ? (
                            <img src={thumb.dataUrl} alt={vid.title} loading="lazy" />
                          ) : (
                            <div className="studio-thumb-fallback"><Film size={26} /><span>{vid.extension.toUpperCase()}</span></div>
                          )}
                          <div className="studio-thumb-overlay"><span className="studio-play-circle"><Play size={18} fill="currentColor" /></span></div>
                          {thumb?.durationSec && <span className="studio-duration-chip">{formatDuration(thumb.durationSec)}</span>}
                          {hasSub && <span className="studio-cc-chip">CC</span>}
                        </div>
                        <div className="studio-video-body">
                          <h4 title={vid.name}>{vid.title}</h4>
                          <div className="studio-video-sub">
                            <span>{vid.folderPath}</span>
                            <span>{formatFileSize(vid.sizeBytes)}</span>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {(mediaTab === 'all' || mediaTab === 'photos') && photos.length > 0 && (
              <section className="studio-block">
                <div className="studio-block-header">
                  <h3><ImageIcon size={18} /> Galeria de Fotos ({photos.length})</h3>
                </div>
                <div className="studio-photo-grid">
                  {photos.slice(0, 180).map((photo, idx) => (
                    <LocalPhotoThumb key={photo.id} item={photo} onClick={() => setLightboxIndex(idx)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {lightboxIndex !== null && photos.length > 0 && (
        <PhotoLightbox
          photos={photos}
          currentIndex={lightboxIndex}
          onSelectIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
};

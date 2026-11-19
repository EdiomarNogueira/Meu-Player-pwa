import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, HardDrive, Tv } from 'lucide-react';
import {
  addHistoryEntry,
  clearArtworkCache,
  clearHistoryEntries,
  DEFAULT_SETTINGS,
  getChannelsForSource,
  listFavorites,
  listHistory,
  listSavedLocalRoots,
  listSources,
  loadActiveSourceId,
  loadAllArtwork,
  loadAllLocalThumbs,
  loadSettings,
  persistActiveSourceId,
  persistSettings,
  purgeAllLocalStudioData,
  removeSource,
  revokeAndPurgeLocalRoot,
  saveLocalRoot,
  saveSourceBundle,
  toggleFavoriteChannel,
} from './storage/db';
import {
  AppSettings,
  ArtworkMetadata,
  BrowseSection,
  Channel,
  FavoriteEntry,
  HistoryEntry,
  IptvSource,
  LocalMediaItem,
  LocalThumbCache,
  PlaybackRepeatMode,
  SavedLocalRoot,
  SourceMetadataCache,
} from './types/iptv';
import { enrichChannelBatch, enrichSingleChannel } from './services/artworkEnricher';
import { scanDirectoryHandle, scanFallbackFileList, verifyDirectoryPermission } from './services/localMediaService';
import { usePwaEnvironment } from './hooks/usePwaEnvironment';
import { Navbar } from './components/Navbar';
import { HeroBillboard } from './components/HeroBillboard';
import { ContentRow } from './components/ContentRow';
import { MediaCard } from './components/MediaCard';
import { LocalStudioView } from './components/LocalStudioView';
import { DetailsModal } from './components/DetailsModal';
import { PlayerOverlay } from './components/PlayerOverlay';
import { SourceModal } from './components/SourceModal';
import { SettingsModal } from './components/SettingsModal';

export const App: React.FC = () => {
  const { isOnline, canInstall, isStandalone, promptInstall } = usePwaEnvironment();

  const [sources, setSources] = useState<IptvSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [artworkMap, setArtworkMap] = useState<Record<string, ArtworkMetadata>>({});
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [savedRoots, setSavedRoots] = useState<SavedLocalRoot[]>([]);
  const [activeRootId, setActiveRootId] = useState<string | null>(null);
  const [needsPermissionRoot, setNeedsPermissionRoot] = useState<SavedLocalRoot | null>(null);
  const [localItems, setLocalItems] = useState<LocalMediaItem[]>([]);
  const [localThumbsMap, setLocalThumbsMap] = useState<Record<string, LocalThumbCache>>({});
  const [isScanningLocal, setIsScanningLocal] = useState<boolean>(false);

  const [section, setSection] = useState<BrowseSection>('home');
  const [selectedGenreGroup, setSelectedGenreGroup] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [playQueue, setPlayQueue] = useState<Channel[]>([]);
  const [playQueueIndex, setPlayQueueIndex] = useState<number>(0);
  const [detailsChannel, setDetailsChannel] = useState<Channel | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichSeed, setEnrichSeed] = useState<number>(0);
  const [ready, setReady] = useState<boolean>(false);

  const playingChannel = playQueue[playQueueIndex] ?? null;

  // Hidratação protegida: libera a tela imediatamente e escaneia a pasta em background
  useEffect(() => {
    let active = true;
    (async () => {
      let initialRoot: SavedLocalRoot | null = null;
      try {
        const [
          loadedSources,
          loadedFavs,
          loadedHist,
          loadedCfg,
          savedSourceId,
          cachedArtwork,
          loadedLocalRoots,
          cachedLocalThumbs,
        ] = await Promise.all([
          listSources(),
          listFavorites(),
          listHistory(),
          loadSettings(),
          loadActiveSourceId(),
          loadAllArtwork(),
          listSavedLocalRoots(),
          loadAllLocalThumbs(),
        ]);

        if (!active) return;

        setSources(loadedSources);
        setFavorites(loadedFavs);
        setHistory(loadedHist);
        setSettings(loadedCfg);
        setArtworkMap(cachedArtwork);
        setSavedRoots(loadedLocalRoots);
        setLocalThumbsMap(cachedLocalThumbs);

        const validId =
          savedSourceId && loadedSources.some((s) => s.id === savedSourceId)
            ? savedSourceId
            : loadedSources[0]?.id ?? null;

        setActiveSourceId(validId);

        if (loadedLocalRoots.length > 0) {
          initialRoot = loadedLocalRoots[0];
          setActiveRootId(initialRoot.id);
        }
      } catch (err) {
        console.error('Erro ao hidratar IndexedDB:', err);
      } finally {
        if (active) setReady(true);
      }

      if (active && initialRoot?.handle?.queryPermission) {
        try {
          const perm = await initialRoot.handle.queryPermission({ mode: 'read' });
          if (!active) return;
          if (perm === 'granted') {
            setIsScanningLocal(true);
            const scanned = await scanDirectoryHandle(initialRoot.id, initialRoot.handle);
            if (active) setLocalItems(scanned);
          } else {
            setNeedsPermissionRoot(initialRoot);
          }
        } catch {
          if (active) setNeedsPermissionRoot(initialRoot);
        } finally {
          if (active) setIsScanningLocal(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!activeSourceId) {
      setChannels([]);
      return;
    }
    let active = true;
    getChannelsForSource(activeSourceId).then((list) => {
      if (!active) return;
      setChannels(list);
      setSelectedGenreGroup('ALL');
    });
    return () => {
      active = false;
    };
  }, [activeSourceId]);

  useEffect(() => {
    if (section === 'local' || !settings.enableExternalArtwork || !isOnline || channels.length === 0) {
      setEnrichProgress(null);
      return;
    }

    const priorityCandidates: Channel[] = [];
    const vodAndSeries = channels.filter((c) => c.kind !== 'live' && !c.isLocalFile);
    const liveItems = channels.filter((c) => c.kind === 'live' && !c.isLocalFile);

    for (const item of [...vodAndSeries, ...liveItems]) {
      if (!artworkMap[item.artworkKey]) priorityCandidates.push(item);
      if (priorityCandidates.length >= 60) break;
    }

    if (priorityCandidates.length === 0) {
      setEnrichProgress(null);
      return;
    }

    const signal = { cancelled: false };
    enrichChannelBatch(
      priorityCandidates,
      settings.tmdbApiKey,
      (meta) => setArtworkMap((prev) => ({ ...prev, [meta.cacheKey]: meta })),
      (done, total) => setEnrichProgress(done >= total ? null : { done, total }),
      signal
    );

    return () => {
      signal.cancelled = true;
    };
  }, [section, channels, settings.enableExternalArtwork, settings.tmdbApiKey, isOnline, enrichSeed]);

  const handleSelectSavedRoot = useCallback(async (root: SavedLocalRoot) => {
    setActiveRootId(root.id);
    if (!root.handle) return;

    const granted = await verifyDirectoryPermission(root.handle);
    if (!granted) {
      setLocalItems([]);
      setNeedsPermissionRoot(root);
      return;
    }

    setNeedsPermissionRoot(null);
    setIsScanningLocal(true);
    try {
      setLocalItems(await scanDirectoryHandle(root.id, root.handle));
    } finally {
      setIsScanningLocal(false);
    }
  }, []);

  const handlePickLocalDirectory = useCallback(async () => {
    if (!window.showDirectoryPicker) return;
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const rootId = 'localroot_' + dirHandle.name + '_' + Date.now();
      const rootEntry: SavedLocalRoot = { id: rootId, name: dirHandle.name, addedAt: Date.now(), handle: dirHandle };

      setIsScanningLocal(true);
      setNeedsPermissionRoot(null);
      await saveLocalRoot(rootEntry);
      setSavedRoots(await listSavedLocalRoots());
      setActiveRootId(rootId);
      setLocalItems(await scanDirectoryHandle(rootId, dirHandle));
    } catch {
      // Seleção cancelada
    } finally {
      setIsScanningLocal(false);
    }
  }, []);

  const handleFallbackFilesSelected = useCallback((fileList: FileList) => {
    setIsScanningLocal(true);
    setNeedsPermissionRoot(null);
    const rootId = 'session_folder_' + Date.now();
    const { rootName, items } = scanFallbackFileList(rootId, fileList);
    setSavedRoots((prev) => [{ id: rootId, name: rootName + ' (Sessão)', addedAt: Date.now() }, ...prev]);
    setActiveRootId(rootId);
    setLocalItems(items);
    setIsScanningLocal(false);
  }, []);

  const handleGrantRootPermission = useCallback(async (root: SavedLocalRoot) => {
    if (!root.handle) return;
    if (!(await verifyDirectoryPermission(root.handle))) return;
    setNeedsPermissionRoot(null);
    setIsScanningLocal(true);
    try {
      setLocalItems(await scanDirectoryHandle(root.id, root.handle));
    } finally {
      setIsScanningLocal(false);
    }
  }, []);

  const handleRemoveSavedRoot = useCallback(
    async (id: string) => {
      setPlayQueue((q) => (q.some((ch) => ch.sourceId === id) ? [] : q));
      await revokeAndPurgeLocalRoot(id);

      const prefix = `thumb::${id}::`;
      setLocalThumbsMap((prev) => {
        const next: Record<string, LocalThumbCache> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.rootId !== id && !k.startsWith(prefix)) next[k] = v;
        }
        return next;
      });

      const nextRoots = savedRoots.filter((r) => r.id !== id);
      setSavedRoots(nextRoots);

      if (activeRootId === id) {
        setLocalItems([]);
        setNeedsPermissionRoot(null);
        const fallback = nextRoots[0] ?? null;
        setActiveRootId(fallback?.id ?? null);
        if (fallback) handleSelectSavedRoot(fallback);
      }
    },
    [savedRoots, activeRootId, handleSelectSavedRoot]
  );

  const handlePurgeAllLocal = useCallback(async () => {
    setPlayQueue((q) => (q.some((ch) => ch.isLocalFile) ? [] : q));
    await purgeAllLocalStudioData();
    setSavedRoots([]);
    setActiveRootId(null);
    setLocalItems([]);
    setLocalThumbsMap({});
    setNeedsPermissionRoot(null);
  }, []);

  const handleSelectSource = useCallback(async (id: string) => {
    setActiveSourceId(id);
    await persistActiveSourceId(id);
  }, []);

  const handleSaveSource = useCallback(async (source: IptvSource, newChannels: Channel[], metadata?: SourceMetadataCache) => {
    await saveSourceBundle(source, newChannels, metadata);
    setSources(await listSources());
    setActiveSourceId(source.id);
    setSection('home');
    await persistActiveSourceId(source.id);
  }, []);

  const handleDeleteSource = useCallback(
    async (sourceId: string) => {
      await removeSource(sourceId);
      const updated = await listSources();
      setSources(updated);
      if (activeSourceId === sourceId) {
        const nextId = updated[0]?.id ?? null;
        setActiveSourceId(nextId);
        await persistActiveSourceId(nextId);
      }
    },
    [activeSourceId]
  );

  const handlePlaySingleIptv = useCallback(async (channel: Channel) => {
    setPlayQueue([channel]);
    setPlayQueueIndex(0);
    await addHistoryEntry(channel);
    setHistory(await listHistory());
  }, []);

  const handleToggleFavorite = useCallback(async (channel: Channel) => {
    await toggleFavoriteChannel(channel);
    setFavorites(await listFavorites());
  }, []);

  const handleUpdateSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    await persistSettings(next);
  }, []);

  const handleChangeRepeatMode = useCallback(
    async (mode: PlaybackRepeatMode) => {
      const next = { ...settings, localRepeatMode: mode };
      setSettings(next);
      await persistSettings(next);
    },
    [settings]
  );

  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.channelId)), [favorites]);

  const sectionChannels = useMemo(() => {
    if (section === 'mylist') return favorites.map((f) => f.channel);
    if (section === 'live') return channels.filter((c) => c.kind === 'live');
    if (section === 'movies') return channels.filter((c) => c.kind !== 'live');
    return channels;
  }, [section, channels, favorites]);

  const heroItems = useMemo(() => {
    const pool = sectionChannels.length > 0 ? sectionChannels : channels;
    if (pool.length === 0) return [];
    const withBanner = pool.filter((ch) => artworkMap[ch.artworkKey]?.backdropUrl || artworkMap[ch.artworkKey]?.posterUrl);
    return (withBanner.length > 0 ? withBanner : pool).slice(0, 6);
  }, [sectionChannels, channels, artworkMap]);

  const categoryRows = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const ch of sectionChannels) {
      const list = map.get(ch.group);
      if (list) list.push(ch);
      else map.set(ch.group, [ch]);
    }
    return Array.from(map.entries()).map(([groupName, items]) => ({
      groupName,
      items,
      isPosterRow: items.filter((i) => i.kind !== 'live').length > items.length / 2,
    }));
  }, [sectionChannels]);

  const iptvSearchResults = useMemo(() => {
    if (section === 'local') return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const pool = section === 'mylist' ? favorites.map((f) => f.channel) : channels;
    return pool.filter((c) => c.cleanTitle.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [searchQuery, section, favorites, channels]);

  if (!ready) {
    return (
      <div className="splash-screen">
        <div className="cinema-spinner" />
        <p>Iniciando MeuPlayer...</p>
      </div>
    );
  }

  return (
    <div className={'streaming-app ' + (section === 'local' ? 'studio-theme' : '')}>
      <Navbar
        section={section}
        onSelectSection={(sec) => { setSection(sec); setSelectedGenreGroup('ALL'); }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sources={sources}
        activeSourceId={activeSourceId}
        onSelectSource={handleSelectSource}
        isOnline={isOnline}
        canInstall={canInstall}
        isStandalone={isStandalone}
        enrichProgress={enrichProgress}
        onInstallClick={promptInstall}
        onOpenSourcesModal={() => setIsSourceModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsOpen(true)}
      />

      {section === 'local' ? (
        <LocalStudioView
          savedRoots={savedRoots}
          activeRootId={activeRootId}
          needsPermissionRoot={needsPermissionRoot}
          items={localItems}
          thumbsMap={localThumbsMap}
          searchQuery={searchQuery}
          repeatMode={settings.localRepeatMode}
          isScanning={isScanningLocal}
          onChangeRepeatMode={handleChangeRepeatMode}
          onPickDirectory={handlePickLocalDirectory}
          onFallbackFilesSelected={handleFallbackFilesSelected}
          onSelectSavedRoot={handleSelectSavedRoot}
          onGrantRootPermission={handleGrantRootPermission}
          onRemoveSavedRoot={handleRemoveSavedRoot}
          onPurgeAllLocal={handlePurgeAllLocal}
          onThumbGenerated={(thumb) => setLocalThumbsMap((prev) => ({ ...prev, [thumb.key]: thumb }))}
          onPlayVideoQueue={(queue, startIdx) => { setPlayQueue(queue); setPlayQueueIndex(startIdx); }}
        />
      ) : iptvSearchResults ? (
        <main className="grid-page">
          <div className="grid-page-header"><h2>Resultados para "{searchQuery}" ({iptvSearchResults.length})</h2></div>
          {iptvSearchResults.length === 0 ? (
            <div className="empty-showcase"><Tv size={42} /><p>Nenhum título encontrado.</p></div>
          ) : (
            <div className="browse-grid">
              {iptvSearchResults.slice(0, 120).map((ch) => (
                <MediaCard key={ch.id} channel={ch} artwork={artworkMap[ch.artworkKey]} isFavorite={favoriteIds.has(ch.id)} onPlay={handlePlaySingleIptv} onToggleFavorite={handleToggleFavorite} onOpenDetails={setDetailsChannel} />
              ))}
            </div>
          )}
        </main>
      ) : sources.length === 0 ? (
        <main className="welcome-hero">
          <div className="welcome-box">
            <span className="welcome-kicker">STREAMING IPTV & ESTÚDIO LOCAL EM PWA</span>
            <h1>Suas listas IPTV e pastas do PC em um só lugar.</h1>
            <p>Importe listas <strong>M3U / Xtream</strong> com capas automáticas ou abra a aba <strong>Estúdio Local (PC)</strong> para assistir vídeos em sequência e álbuns de fotos diretamente do computador.</p>
            <div className="welcome-actions">
              <button type="button" className="btn-hero-play" onClick={() => setIsSourceModalOpen(true)}>
                <FolderPlus size={20} />
                <span>Importar Lista IPTV ou Demo</span>
              </button>
              <button type="button" className="btn-hero-secondary" onClick={() => setSection('local')}>
                <HardDrive size={19} />
                <span>Abrir Estúdio Local (PC)</span>
              </button>
            </div>
          </div>
        </main>
      ) : section === 'mylist' && sectionChannels.length === 0 ? (
        <main className="grid-page">
          <div className="empty-showcase"><Tv size={44} /><h2>Sua Lista está vazia</h2><p>Adicione canais ou filmes IPTV à Minha Lista para acessá-los rapidamente.</p></div>
        </main>
      ) : (
        <main className="catalog-canvas">
          <HeroBillboard featuredList={heroItems} artworkMap={artworkMap} favoriteIds={favoriteIds} onPlay={handlePlaySingleIptv} onToggleFavorite={handleToggleFavorite} onOpenDetails={setDetailsChannel} />

          <div className="rails-stack">
            {categoryRows.length > 2 && (
              <div className="genre-filter-bar">
                <button type="button" className={'genre-pill ' + (selectedGenreGroup === 'ALL' ? 'active' : '')} onClick={() => setSelectedGenreGroup('ALL')}>Todas as Categorias</button>
                {categoryRows.slice(0, 18).map((row) => (
                  <button key={row.groupName} type="button" className={'genre-pill ' + (selectedGenreGroup === row.groupName ? 'active' : '')} onClick={() => setSelectedGenreGroup(row.groupName)}>{row.groupName}</button>
                ))}
              </div>
            )}

            {selectedGenreGroup === 'ALL' ? (
              <>
                {section === 'home' && history.length > 0 && (
                  <ContentRow title="Continuar Assistindo" channels={history.map((h) => h.channel)} artworkMap={artworkMap} favoriteIds={favoriteIds} onPlay={handlePlaySingleIptv} onToggleFavorite={handleToggleFavorite} onOpenDetails={setDetailsChannel} />
                )}
                {section === 'home' && favorites.length > 0 && (
                  <ContentRow title="Minha Lista" channels={favorites.map((f) => f.channel)} artworkMap={artworkMap} favoriteIds={favoriteIds} onPlay={handlePlaySingleIptv} onToggleFavorite={handleToggleFavorite} onOpenDetails={setDetailsChannel} />
                )}
                {categoryRows.slice(0, 24).map((row) => (
                  <ContentRow key={row.groupName} title={row.groupName} channels={row.items} artworkMap={artworkMap} favoriteIds={favoriteIds} variant={row.isPosterRow ? 'poster' : 'landscape'} onPlay={handlePlaySingleIptv} onToggleFavorite={handleToggleFavorite} onOpenDetails={setDetailsChannel} />
                ))}
              </>
            ) : (
              <div className="filtered-genre-section">
                <h2 className="row-title">{selectedGenreGroup}</h2>
                <div className="browse-grid">
                  {sectionChannels.filter((c) => c.group === selectedGenreGroup).slice(0, 120).map((ch) => (
                    <MediaCard key={ch.id} channel={ch} artwork={artworkMap[ch.artworkKey]} isFavorite={favoriteIds.has(ch.id)} onPlay={handlePlaySingleIptv} onToggleFavorite={handleToggleFavorite} onOpenDetails={setDetailsChannel} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {detailsChannel && (
        <DetailsModal
          channel={detailsChannel}
          artwork={artworkMap[detailsChannel.artworkKey]}
          isFavorite={favoriteIds.has(detailsChannel.id)}
          onPlay={handlePlaySingleIptv}
          onToggleFavorite={handleToggleFavorite}
          onEnrichNow={async (ch) => {
            const meta = await enrichSingleChannel(ch, settings.tmdbApiKey);
            setArtworkMap((prev) => ({ ...prev, [meta.cacheKey]: meta }));
          }}
          onClose={() => setDetailsChannel(null)}
        />
      )}

      {playingChannel && (
        <PlayerOverlay
          channel={playingChannel}
          queue={playQueue}
          queueIndex={playQueueIndex}
          repeatMode={settings.localRepeatMode}
          settings={settings}
          isOnline={isOnline}
          isFavorite={favoriteIds.has(playingChannel.id)}
          onSelectQueueIndex={setPlayQueueIndex}
          onChangeRepeatMode={handleChangeRepeatMode}
          onToggleFavorite={handleToggleFavorite}
          onClose={() => setPlayQueue([])}
        />
      )}

      {isSourceModalOpen && (
        <SourceModal
          sources={sources}
          activeSourceId={activeSourceId}
          defaultXtreamFormat={settings.defaultXtreamFormat}
          onSelectSource={handleSelectSource}
          onDeleteSource={handleDeleteSource}
          onSaveSource={handleSaveSource}
          onClose={() => setIsSourceModalOpen(false)}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          artworkCount={Object.keys(artworkMap).length}
          localThumbCount={Object.keys(localThumbsMap).length}
          onUpdateSettings={handleUpdateSettings}
          onClearHistory={async () => { await clearHistoryEntries(); setHistory([]); }}
          onResetArtworkCache={async () => { await clearArtworkCache(); setArtworkMap({}); setEnrichSeed((s) => s + 1); }}
          onPurgeAllLocal={handlePurgeAllLocal}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};

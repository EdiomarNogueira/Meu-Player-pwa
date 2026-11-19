import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  AppSettings,
  ArtworkMetadata,
  Channel,
  FavoriteEntry,
  HistoryEntry,
  IptvSource,
  LocalThumbCache,
  SavedLocalRoot,
  SourceMetadataCache,
} from '../types/iptv';

interface MeuPlayerDb extends DBSchema {
  sources: { key: string; value: IptvSource };
  channels: { key: string; value: Channel; indexes: { 'by-source': string } };
  favorites: { key: string; value: FavoriteEntry };
  history: { key: string; value: HistoryEntry; indexes: { 'by-watched': number } };
  metadata: { key: string; value: SourceMetadataCache };
  artwork: { key: string; value: ArtworkMetadata };
  localRoots: { key: string; value: SavedLocalRoot };
  localThumbs: { key: string; value: LocalThumbCache };
  kv: { key: string; value: unknown };
}

const DB_NAME = 'horizon-studio-pwa-db';
const DB_VERSION = 2;

export const DEFAULT_SETTINGS: AppSettings = {
  autoplay: true,
  lowLatencyHls: false,
  defaultXtreamFormat: 'm3u8',
  enableExternalArtwork: true,
  tmdbApiKey: '',
  localRepeatMode: 'next',
};

let dbPromise: Promise<IDBPDatabase<MeuPlayerDb>> | null = null;

function getDb(): Promise<IDBPDatabase<MeuPlayerDb>> {
  if (!dbPromise) {
    dbPromise = openDB<MeuPlayerDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('channels')) {
          const chStore = db.createObjectStore('channels', { keyPath: 'id' });
          chStore.createIndex('by-source', 'sourceId');
        }
        if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'channelId' });
        if (!db.objectStoreNames.contains('history')) {
          const histStore = db.createObjectStore('history', { keyPath: 'channelId' });
          histStore.createIndex('by-watched', 'watchedAt');
        }
        if (!db.objectStoreNames.contains('metadata')) db.createObjectStore('metadata', { keyPath: 'sourceId' });
        if (!db.objectStoreNames.contains('artwork')) db.createObjectStore('artwork', { keyPath: 'cacheKey' });
        if (!db.objectStoreNames.contains('localRoots')) db.createObjectStore('localRoots', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('localThumbs')) db.createObjectStore('localThumbs', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

export async function listSources(): Promise<IptvSource[]> {
  const db = await getDb();
  return (await db.getAll('sources')).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveSourceBundle(
  source: IptvSource,
  channels: Channel[],
  metadata?: SourceMetadataCache
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['sources', 'channels', 'metadata'], 'readwrite');
  const index = tx.objectStore('channels').index('by-source');
  let cursor = await index.openCursor(IDBKeyRange.only(source.id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.objectStore('sources').put(source);
  const channelStore = tx.objectStore('channels');
  for (const ch of channels) {
    await channelStore.put(ch);
  }
  if (metadata) await tx.objectStore('metadata').put(metadata);
  await tx.done;
}

export async function removeSource(sourceId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['sources', 'channels', 'metadata'], 'readwrite');
  await tx.objectStore('sources').delete(sourceId);
  await tx.objectStore('metadata').delete(sourceId);
  const index = tx.objectStore('channels').index('by-source');
  let cursor = await index.openCursor(IDBKeyRange.only(sourceId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getChannelsForSource(sourceId: string): Promise<Channel[]> {
  const db = await getDb();
  return db.getAllFromIndex('channels', 'by-source', sourceId);
}

export async function listFavorites(): Promise<FavoriteEntry[]> {
  const db = await getDb();
  return (await db.getAll('favorites')).sort((a, b) => b.addedAt - a.addedAt);
}

export async function toggleFavoriteChannel(channel: Channel): Promise<boolean> {
  if (channel.isLocalFile) return false;
  const db = await getDb();
  const existing = await db.get('favorites', channel.id);
  if (existing) {
    await db.delete('favorites', channel.id);
    return false;
  }
  await db.put('favorites', { channelId: channel.id, addedAt: Date.now(), channel });
  return true;
}

export async function listHistory(limit = 40): Promise<HistoryEntry[]> {
  const db = await getDb();
  return (await db.getAll('history')).sort((a, b) => b.watchedAt - a.watchedAt).slice(0, limit);
}

export async function addHistoryEntry(channel: Channel): Promise<void> {
  if (channel.isLocalFile) return;
  const db = await getDb();
  await db.put('history', { channelId: channel.id, watchedAt: Date.now(), channel });
}

export async function clearHistoryEntries(): Promise<void> {
  const db = await getDb();
  await db.clear('history');
}

export async function loadAllArtwork(): Promise<Record<string, ArtworkMetadata>> {
  const db = await getDb();
  const items = await db.getAll('artwork');
  const map: Record<string, ArtworkMetadata> = {};
  for (const item of items) map[item.cacheKey] = item;
  return map;
}

export async function getArtworkByKey(cacheKey: string): Promise<ArtworkMetadata | undefined> {
  const db = await getDb();
  return db.get('artwork', cacheKey);
}

export async function saveArtworkEntry(entry: ArtworkMetadata): Promise<void> {
  const db = await getDb();
  await db.put('artwork', entry);
}

export async function clearArtworkCache(): Promise<void> {
  const db = await getDb();
  await db.clear('artwork');
}

export async function listSavedLocalRoots(): Promise<SavedLocalRoot[]> {
  const db = await getDb();
  return (await db.getAll('localRoots')).sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveLocalRoot(root: SavedLocalRoot): Promise<void> {
  const db = await getDb();
  await db.put('localRoots', root);
}

/**
 * Revoga o vínculo da pasta e apaga permanentemente todas as miniaturas geradas para ela no IndexedDB.
 */
export async function revokeAndPurgeLocalRoot(rootId: string): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(['localRoots', 'localThumbs'], 'readwrite');

  await tx.objectStore('localRoots').delete(rootId);

  let deletedThumbs = 0;
  const prefix = `thumb::${rootId}::`;
  let cursor = await tx.objectStore('localThumbs').openCursor();

  while (cursor) {
    const val = cursor.value;
    if (val.rootId === rootId || val.key.startsWith(prefix)) {
      await cursor.delete();
      deletedThumbs += 1;
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  return deletedThumbs;
}

/**
 * Remove TODAS as pastas vinculadas e apaga 100% das miniaturas locais do navegador.
 */
export async function purgeAllLocalStudioData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['localRoots', 'localThumbs'], 'readwrite');
  await tx.objectStore('localRoots').clear();
  await tx.objectStore('localThumbs').clear();
  await tx.done;
}

export async function loadAllLocalThumbs(): Promise<Record<string, LocalThumbCache>> {
  const db = await getDb();
  const all = await db.getAll('localThumbs');
  const map: Record<string, LocalThumbCache> = {};
  for (const t of all) map[t.key] = t;
  return map;
}

export async function getLocalThumb(key: string): Promise<LocalThumbCache | undefined> {
  const db = await getDb();
  return db.get('localThumbs', key);
}

export async function saveLocalThumb(entry: LocalThumbCache): Promise<void> {
  const db = await getDb();
  await db.put('localThumbs', entry);
}

export async function clearLocalThumbs(): Promise<void> {
  const db = await getDb();
  await db.clear('localThumbs');
}

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDb();
  const saved = (await db.get('kv', 'settings')) as Partial<AppSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

export async function persistSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put('kv', settings, 'settings');
}

export async function loadActiveSourceId(): Promise<string | null> {
  const db = await getDb();
  const id = await db.get('kv', 'activeSourceId');
  return typeof id === 'string' ? id : null;
}

export async function persistActiveSourceId(sourceId: string | null): Promise<void> {
  const db = await getDb();
  await db.put('kv', sourceId, 'activeSourceId');
}

export type SourceType = 'file' | 'url' | 'xtream';
export type StreamFormat = 'hls' | 'mp4' | 'ts' | 'local' | 'unknown';
export type ContentKind = 'live' | 'vod' | 'series';
export type BrowseSection = 'home' | 'live' | 'movies' | 'mylist' | 'local';
export type PlaybackRepeatMode = 'next' | 'loop-one' | 'loop-all' | 'stop';

export interface XtreamCredentials {
  serverUrl: string;
  username: string;
  password: string;
  outputFormat: 'm3u8' | 'ts';
}

export interface IptvSource {
  id: string;
  name: string;
  type: SourceType;
  createdAt: number;
  updatedAt: number;
  channelCount: number;
  url?: string;
  xtream?: XtreamCredentials;
}

export interface Channel {
  id: string;
  sourceId: string;
  name: string;
  cleanTitle: string;
  artworkKey: string;
  yearHint?: string;
  kind: ContentKind;
  group: string;
  logo?: string;
  streamUrl: string;
  tvgId?: string;
  format: StreamFormat;
  isLocalFile?: boolean;
  localFile?: File;
  localFileHandle?: FileSystemFileHandle;
  subtitleFile?: File;
  subtitleHandle?: FileSystemFileHandle;
}

export interface ArtworkMetadata {
  cacheKey: string;
  cleanTitle: string;
  posterUrl?: string;
  backdropUrl?: string;
  overview?: string;
  rating?: number;
  year?: string;
  genres?: string[];
  provider: 'tmdb' | 'itunes' | 'tvmaze' | 'none';
  updatedAt: number;
}

export interface FavoriteEntry {
  channelId: string;
  addedAt: number;
  channel: Channel;
}

export interface HistoryEntry {
  channelId: string;
  watchedAt: number;
  channel: Channel;
}

export interface SourceMetadataCache {
  sourceId: string;
  updatedAt: number;
  epgUrl?: string;
  serverInfo?: { url?: string; port?: string; httpsPort?: string; timezone?: string };
  accountInfo?: { status?: string; expDate?: string | null; activeCons?: string; maxConnections?: string };
}

export interface AppSettings {
  autoplay: boolean;
  lowLatencyHls: boolean;
  defaultXtreamFormat: 'm3u8' | 'ts';
  enableExternalArtwork: boolean;
  tmdbApiKey: string;
  localRepeatMode: PlaybackRepeatMode;
}

export type LocalMediaKind = 'video' | 'image';

export interface SavedLocalRoot {
  id: string;
  name: string;
  addedAt: number;
  handle?: FileSystemDirectoryHandle;
}

export interface LocalMediaItem {
  id: string;
  rootId: string;
  name: string;
  title: string;
  relativePath: string;
  folderPath: string;
  kind: LocalMediaKind;
  extension: string;
  sizeBytes: number;
  lastModified: number;
  file?: File;
  fileHandle?: FileSystemFileHandle;
  subtitleFile?: File;
  subtitleHandle?: FileSystemFileHandle;
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface LocalThumbCache {
  key: string;
  rootId: string;
  dataUrl: string;
  durationSec?: number;
  width?: number;
  height?: number;
  updatedAt: number;
}

export interface LocalSeriesGroup {
  id: string;
  title: string;
  folderPath: string;
  seasons: Map<number, LocalMediaItem[]>;
  episodes: LocalMediaItem[];
  coverItem: LocalMediaItem;
}

export type DiagnosticCode =
  | 'OFFLINE'
  | 'MIXED_CONTENT'
  | 'CORS_OR_NETWORK'
  | 'HTTP_STATUS'
  | 'UNSUPPORTED_TS'
  | 'MEDIA_OR_CODEC'
  | 'INVALID_FORMAT';

export interface DiagnosticIssue {
  code: DiagnosticCode;
  title: string;
  explanation: string;
  suggestion: string;
  technicalDetail?: string;
}

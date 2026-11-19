import {
  Channel,
  LocalMediaItem,
  LocalSeriesGroup,
  LocalThumbCache,
} from '../types/iptv';
import { getLocalThumb, saveLocalThumb } from '../storage/db';

const VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'mkv', 'm4v', 'mov', 'ogv', 'ogg',
  'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm2ts', 'mts', '3gp', 'ts', 'vob', 'asf',
]);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg']);
const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt']);

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.slice(idx + 1).toLowerCase() : '';
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.slice(0, idx) : filename;
}

function prettifyLocalTitle(filename: string): string {
  return stripExtension(filename).replace(/[._]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function detectEpisodeNumbers(
  filename: string,
  folderPath: string
): { season?: number; episode?: number } {
  const base = stripExtension(filename);
  const sxe =
    base.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i) ||
    base.match(/\b(\d{1,2})x(\d{1,3})\b/i);

  if (sxe) return { season: Number(sxe[1]), episode: Number(sxe[2]) };

  let seasonFromFolder: number | undefined;
  const seasonFolderMatch = folderPath.match(/(?:temporada|season|temp|s)\s*0*(\d{1,2})\b/i);
  if (seasonFolderMatch) seasonFromFolder = Number(seasonFolderMatch[1]);

  const epExplicit = base.match(/\b(?:ep|episodio|episódio|cap|e)\s*0*(\d{1,3})\b/i);
  if (epExplicit) return { season: seasonFromFolder ?? 1, episode: Number(epExplicit[1]) };

  const leadingNum = base.match(/^0*(\d{1,3})(?:\s*[-._)]|\s+)/);
  if (leadingNum) return { season: seasonFromFolder ?? 1, episode: Number(leadingNum[1]) };

  return { season: seasonFromFolder };
}

function inferSeriesNameFromPath(folderPath: string, rootName: string): string {
  const parts = folderPath.split('/').filter(Boolean);
  if (parts.length === 0) return rootName;
  const last = parts[parts.length - 1];
  const isSeasonSubfolder = /^(?:temporada|season|temp|s)\s*\d+$/i.test(last.trim());
  if (isSeasonSubfolder && parts.length >= 2) return parts[parts.length - 2];
  return last;
}

export async function verifyDirectoryPermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const current = await handle.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  const requested = await handle.requestPermission({ mode: 'read' });
  return requested === 'granted';
}

export async function scanDirectoryHandle(
  rootId: string,
  rootHandle: FileSystemDirectoryHandle
): Promise<LocalMediaItem[]> {
  const rawVideosAndImages: Array<{
    name: string;
    relPath: string;
    folderPath: string;
    ext: string;
    kind: 'video' | 'image';
    handle: FileSystemFileHandle;
    file: File;
  }> = [];

  const subtitleByBasePath = new Map<string, FileSystemFileHandle>();

  async function walk(dirHandle: FileSystemDirectoryHandle, prefix: string) {
    // @ts-expect-error iterador assíncrono do FileSystemDirectoryHandle
    for await (const entry of dirHandle.values()) {
      const currentRel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.kind === 'directory') {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(entry as FileSystemDirectoryHandle, currentRel);
        }
      } else if (entry.kind === 'file') {
        const ext = getExtension(entry.name);
        const fileHandle = entry as FileSystemFileHandle;

        if (SUBTITLE_EXTENSIONS.has(ext)) {
          const baseKey = currentRel.slice(0, -(ext.length + 1)).toLowerCase();
          subtitleByBasePath.set(baseKey, fileHandle);
          continue;
        }

        if (VIDEO_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) {
          try {
            const file = await fileHandle.getFile();
            rawVideosAndImages.push({
              name: entry.name,
              relPath: currentRel,
              folderPath: prefix || rootHandle.name,
              ext,
              kind: VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image',
              handle: fileHandle,
              file,
            });
          } catch {
            // Ignora arquivos sem permissão de leitura
          }
        }
      }
    }
  }

  await walk(rootHandle, '');

  const items: LocalMediaItem[] = rawVideosAndImages.map((entry) => {
    const baseLookup = entry.relPath.slice(0, -(entry.ext.length + 1)).toLowerCase();
    const epInfo = entry.kind === 'video' ? detectEpisodeNumbers(entry.name, entry.folderPath) : {};

    return {
      id: rootId + '::' + entry.relPath,
      rootId,
      name: entry.name,
      title: prettifyLocalTitle(entry.name),
      relativePath: entry.relPath,
      folderPath: entry.folderPath,
      kind: entry.kind,
      extension: entry.ext,
      sizeBytes: entry.file.size,
      lastModified: entry.file.lastModified,
      file: entry.file,
      fileHandle: entry.handle,
      subtitleHandle: subtitleByBasePath.get(baseLookup),
      seriesName:
        entry.kind === 'video'
          ? inferSeriesNameFromPath(entry.folderPath, rootHandle.name)
          : undefined,
      seasonNumber: epInfo.season,
      episodeNumber: epInfo.episode,
    };
  });

  return items.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
}

export function scanFallbackFileList(
  rootId: string,
  fileList: FileList
): { rootName: string; items: LocalMediaItem[] } {
  const files = Array.from(fileList);
  const firstPath = files[0]?.webkitRelativePath || 'Pasta Local';
  const rootName = firstPath.split('/')[0] || 'Pasta Local';

  const subtitleMap = new Map<string, File>();
  for (const f of files) {
    const ext = getExtension(f.name);
    if (SUBTITLE_EXTENSIONS.has(ext)) {
      const rel = f.webkitRelativePath || f.name;
      subtitleMap.set(rel.slice(0, -(ext.length + 1)).toLowerCase(), f);
    }
  }

  const items: LocalMediaItem[] = [];
  for (const f of files) {
    const ext = getExtension(f.name);
    if (!VIDEO_EXTENSIONS.has(ext) && !IMAGE_EXTENSIONS.has(ext)) continue;

    const rel = f.webkitRelativePath || f.name;
    const slashIdx = rel.lastIndexOf('/');
    const folderPath = slashIdx > 0 ? rel.slice(0, slashIdx) : rootName;
    const baseKey = rel.slice(0, -(ext.length + 1)).toLowerCase();
    const kind = VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
    const epInfo = kind === 'video' ? detectEpisodeNumbers(f.name, folderPath) : {};

    items.push({
      id: rootId + '::' + rel,
      rootId,
      name: f.name,
      title: prettifyLocalTitle(f.name),
      relativePath: rel,
      folderPath,
      kind,
      extension: ext,
      sizeBytes: f.size,
      lastModified: f.lastModified,
      file: f,
      subtitleFile: subtitleMap.get(baseKey),
      seriesName: kind === 'video' ? inferSeriesNameFromPath(folderPath, rootName) : undefined,
      seasonNumber: epInfo.season,
      episodeNumber: epInfo.episode,
    });
  }

  items.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
  return { rootName, items };
}

export function buildLocalSeriesGroups(items: LocalMediaItem[]): LocalSeriesGroup[] {
  const videos = items.filter((i) => i.kind === 'video');
  const buckets = new Map<string, LocalMediaItem[]>();

  for (const v of videos) {
    const key = v.seriesName || v.folderPath;
    const list = buckets.get(key);
    if (list) list.push(v);
    else buckets.set(key, [v]);
  }

  const seriesGroups: LocalSeriesGroup[] = [];
  for (const [seriesTitle, list] of buckets.entries()) {
    if (list.length < 2) continue;

    const sorted = [...list].sort((a, b) => {
      const sa = a.seasonNumber ?? 1;
      const sb = b.seasonNumber ?? 1;
      if (sa !== sb) return sa - sb;
      if (a.episodeNumber !== undefined && b.episodeNumber !== undefined && a.episodeNumber !== b.episodeNumber) {
        return a.episodeNumber - b.episodeNumber;
      }
      return naturalCompare(a.relativePath, b.relativePath);
    });

    const seasons = new Map<number, LocalMediaItem[]>();
    for (const ep of sorted) {
      const s = ep.seasonNumber ?? 1;
      const sList = seasons.get(s);
      if (sList) sList.push(ep);
      else seasons.set(s, [ep]);
    }

    seriesGroups.push({
      id: 'series::' + seriesTitle,
      title: seriesTitle,
      folderPath: sorted[0].folderPath,
      seasons,
      episodes: sorted,
      coverItem: sorted[0],
    });
  }

  return seriesGroups.sort((a, b) => naturalCompare(a.title, b.title));
}

export async function resolveLocalItemFile(item: LocalMediaItem): Promise<File> {
  if (item.fileHandle) return item.fileHandle.getFile();
  if (item.file) return item.file;
  throw new Error('Arquivo local indisponível na sessão atual.');
}

export async function readVideoDuration(item: LocalMediaItem): Promise<number | null> {
  if (item.kind !== 'video') return null;

  let objectUrl: string | null = null;
  try {
    const file = await resolveLocalItemFile(item);
    objectUrl = URL.createObjectURL(file);

    return await new Promise<number | null>((resolve) => {
      const video = document.createElement('video');
      let settled = false;
      const timeoutId = window.setTimeout(() => finish(null), 5000);
      const finish = (duration: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
        resolve(duration);
      };

      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        finish(duration);
      };
      video.onerror = () => finish(null);
      video.src = objectUrl!;
    });
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function localVideoToChannel(item: LocalMediaItem): Channel {
  const epLabel =
    item.episodeNumber !== undefined
      ? `S${String(item.seasonNumber ?? 1).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')} • ${item.title}`
      : item.title;

  return {
    id: item.id,
    sourceId: item.rootId,
    name: item.name,
    cleanTitle: epLabel,
    artworkKey: 'local-only::' + item.id,
    kind: 'vod',
    group: item.folderPath,
    streamUrl: 'local://' + item.relativePath,
    format: 'local',
    isLocalFile: true,
    localFile: item.file,
    localFileHandle: item.fileHandle,
    subtitleFile: item.subtitleFile,
    subtitleHandle: item.subtitleHandle,
  };
}

export async function createSubtitleTrackUrl(
  file?: File,
  handle?: FileSystemFileHandle
): Promise<string | null> {
  try {
    const resolved = handle ? await handle.getFile() : file;
    if (!resolved) return null;

    const rawText = await resolved.text();
    if (resolved.name.toLowerCase().endsWith('.vtt')) {
      return URL.createObjectURL(new Blob([rawText], { type: 'text/vtt' }));
    }

    const vttBody =
      'WEBVTT\n\n' +
      rawText.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

    return URL.createObjectURL(new Blob([vttBody], { type: 'text/vtt' }));
  } catch {
    return null;
  }
}

export function getThumbCacheKey(item: LocalMediaItem): string {
  return `thumb::${item.rootId}::${item.relativePath}::${item.sizeBytes}::${item.lastModified}`;
}

export async function generateVideoFrameThumbnail(
  item: LocalMediaItem
): Promise<LocalThumbCache | null> {
  if (item.kind !== 'video') return null;

  const cacheKey = getThumbCacheKey(item);
  const existing = await getLocalThumb(cacheKey);
  if (existing) return existing;

  let objectUrl: string | null = null;
  try {
    const file = await resolveLocalItemFile(item);
    objectUrl = URL.createObjectURL(file);

    const result = await new Promise<LocalThumbCache | null>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      let settled = false;
      const finish = (val: LocalThumbCache | null) => {
        if (settled) return;
        settled = true;
        video.pause();
        video.removeAttribute('src');
        video.load();
        resolve(val);
      };

      const timeoutId = window.setTimeout(() => finish(null), 7500);

      video.onloadedmetadata = () => {
        const dur = Number.isFinite(video.duration) ? video.duration : 0;
        const targetTime = dur > 4 ? Math.min(Math.max(dur * 0.12, 2), 25) : Math.min(dur * 0.5, 1);
        try {
          video.currentTime = targetTime;
        } catch {
          window.clearTimeout(timeoutId);
          finish(null);
        }
      };

      video.onseeked = () => {
        window.clearTimeout(timeoutId);
        try {
          const vw = video.videoWidth || 640;
          const vh = video.videoHeight || 360;
          const targetW = 420;
          const targetH = Math.max(200, Math.round((vh / vw) * targetW));

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            finish(null);
            return;
          }

          ctx.drawImage(video, 0, 0, targetW, targetH);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.76);

          finish({
            key: cacheKey,
            rootId: item.rootId,
            dataUrl,
            durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
            width: vw,
            height: vh,
            updatedAt: Date.now(),
          });
        } catch {
          finish(null);
        }
      };

      video.onerror = () => {
        window.clearTimeout(timeoutId);
        finish(null);
      };

      video.src = objectUrl!;
    });

    if (result) await saveLocalThumb(result);
    return result;
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

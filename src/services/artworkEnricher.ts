import { ArtworkMetadata, Channel } from '../types/iptv';
import { getArtworkByKey, saveArtworkEntry } from '../storage/db';

const inFlightRequests = new Map<string, Promise<ArtworkMetadata>>();

function stripHtml(html?: string | null): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}

function normalizeCompare(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function isReasonableMatch(query: string, candidate: string): boolean {
  const a = normalizeCompare(query);
  const b = normalizeCompare(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && (b.includes(a) || a.includes(b))) return true;
  return false;
}

async function queryTmdb(channel: Channel, apiKey: string): Promise<ArtworkMetadata | null> {
  const endpoint =
    channel.kind === 'series'
      ? 'https://api.themoviedb.org/3/search/tv'
      : channel.kind === 'vod'
      ? 'https://api.themoviedb.org/3/search/movie'
      : 'https://api.themoviedb.org/3/search/multi';

  const params = new URLSearchParams({
    api_key: apiKey.trim(),
    query: channel.cleanTitle,
    language: 'pt-BR',
    include_adult: 'false',
  });
  if (channel.yearHint && channel.kind === 'vod') params.set('year', channel.yearHint);

  const res = await fetch(`${endpoint}?${params.toString()}`, { method: 'GET', credentials: 'omit' });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      name?: string;
      poster_path?: string | null;
      backdrop_path?: string | null;
      overview?: string;
      vote_average?: number;
      release_date?: string;
      first_air_date?: string;
    }>;
  };

  const hit = data.results?.find((r) => r.backdrop_path || r.poster_path);
  if (!hit) return null;
  const dateStr = hit.release_date || hit.first_air_date;

  return {
    cacheKey: channel.artworkKey,
    cleanTitle: hit.title || hit.name || channel.cleanTitle,
    posterUrl: hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : undefined,
    backdropUrl: hit.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${hit.backdrop_path}`
      : hit.poster_path
      ? `https://image.tmdb.org/t/p/w780${hit.poster_path}`
      : undefined,
    overview: hit.overview || undefined,
    rating: hit.vote_average ? Number(hit.vote_average.toFixed(1)) : undefined,
    year: dateStr ? dateStr.slice(0, 4) : channel.yearHint,
    provider: 'tmdb',
    updatedAt: Date.now(),
  };
}

async function queryItunesMovie(channel: Channel): Promise<ArtworkMetadata | null> {
  const params = new URLSearchParams({
    term: channel.cleanTitle,
    country: 'BR',
    media: 'movie',
    entity: 'movie',
    limit: '4',
  });
  const res = await fetch(`https://itunes.apple.com/search?${params.toString()}`, {
    method: 'GET',
    credentials: 'omit',
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    results?: Array<{
      trackName?: string;
      artworkUrl100?: string;
      longDescription?: string;
      shortDescription?: string;
      primaryGenreName?: string;
      releaseDate?: string;
    }>;
  };

  if (!data.results || data.results.length === 0) return null;
  const match =
    data.results.find((item) => item.trackName && isReasonableMatch(channel.cleanTitle, item.trackName)) ??
    data.results[0];

  if (!match?.trackName || !isReasonableMatch(channel.cleanTitle, match.trackName)) return null;

  return {
    cacheKey: channel.artworkKey,
    cleanTitle: match.trackName,
    posterUrl: match.artworkUrl100?.replace('100x100bb', '600x900bb'),
    backdropUrl: match.artworkUrl100?.replace('100x100bb', '1000x1000bb'),
    overview: match.longDescription || match.shortDescription || undefined,
    year: match.releaseDate ? match.releaseDate.slice(0, 4) : channel.yearHint,
    genres: match.primaryGenreName ? [match.primaryGenreName] : undefined,
    provider: 'itunes',
    updatedAt: Date.now(),
  };
}

async function queryTvMaze(channel: Channel): Promise<ArtworkMetadata | null> {
  const params = new URLSearchParams({ q: channel.cleanTitle });
  const res = await fetch(`https://api.tvmaze.com/search/shows?${params.toString()}`, {
    method: 'GET',
    credentials: 'omit',
  });
  if (!res.ok) return null;

  const results = (await res.json()) as Array<{
    show: {
      name: string;
      genres?: string[];
      premiered?: string | null;
      rating?: { average?: number | null };
      image?: { medium?: string; original?: string } | null;
      summary?: string | null;
    };
  }>;

  if (!Array.isArray(results) || results.length === 0) return null;
  const candidate = results.find((r) => isReasonableMatch(channel.cleanTitle, r.show.name));
  if (!candidate?.show.image) return null;

  const show = candidate.show;
  return {
    cacheKey: channel.artworkKey,
    cleanTitle: show.name,
    posterUrl: show.image?.original || show.image?.medium,
    backdropUrl: show.image?.original || show.image?.medium,
    overview: stripHtml(show.summary),
    rating: show.rating?.average ?? undefined,
    year: show.premiered ? show.premiered.slice(0, 4) : channel.yearHint,
    genres: show.genres?.slice(0, 3),
    provider: 'tvmaze',
    updatedAt: Date.now(),
  };
}

export async function enrichSingleChannel(
  channel: Channel,
  tmdbApiKey: string
): Promise<ArtworkMetadata> {
  if (channel.isLocalFile || channel.format === 'local' || channel.artworkKey.startsWith('local-only::')) {
    return {
      cacheKey: channel.artworkKey,
      cleanTitle: channel.cleanTitle,
      provider: 'none',
      updatedAt: Date.now(),
    };
  }

  const cached = await getArtworkByKey(channel.artworkKey);
  if (cached) return cached;

  const pending = inFlightRequests.get(channel.artworkKey);
  if (pending) return pending;

  const task = (async (): Promise<ArtworkMetadata> => {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return { cacheKey: channel.artworkKey, cleanTitle: channel.cleanTitle, provider: 'none', updatedAt: Date.now() };
      }

      if (tmdbApiKey.trim().length > 10) {
        const tmdbResult = await queryTmdb(channel, tmdbApiKey).catch(() => null);
        if (tmdbResult) {
          await saveArtworkEntry(tmdbResult);
          return tmdbResult;
        }
      }

      const extArt =
        channel.kind === 'vod'
          ? await queryItunesMovie(channel).catch(() => null)
          : await queryTvMaze(channel).catch(() => null);

      if (extArt) {
        await saveArtworkEntry(extArt);
        return extArt;
      }

      const emptyEntry: ArtworkMetadata = {
        cacheKey: channel.artworkKey,
        cleanTitle: channel.cleanTitle,
        provider: 'none',
        updatedAt: Date.now(),
      };
      await saveArtworkEntry(emptyEntry);
      return emptyEntry;
    } finally {
      inFlightRequests.delete(channel.artworkKey);
    }
  })();

  inFlightRequests.set(channel.artworkKey, task);
  return task;
}

export async function enrichChannelBatch(
  channels: Channel[],
  tmdbApiKey: string,
  onResult: (meta: ArtworkMetadata) => void,
  onProgress?: (done: number, total: number) => void,
  signal?: { cancelled: boolean }
): Promise<void> {
  const uniqueMap = new Map<string, Channel>();
  for (const ch of channels) {
    if (ch.isLocalFile || ch.format === 'local') continue;
    if (!uniqueMap.has(ch.artworkKey)) uniqueMap.set(ch.artworkKey, ch);
  }

  const queue = Array.from(uniqueMap.values());
  const total = queue.length;
  if (total === 0) return;

  let completed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      if (signal?.cancelled) return;
      const current = queue[cursor++];
      const meta = await enrichSingleChannel(current, tmdbApiKey);
      completed += 1;
      if (!signal?.cancelled) {
        onResult(meta);
        onProgress?.(completed, total);
      }
      await new Promise((r) => setTimeout(r, 90));
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
}

import { ContentKind } from '../types/iptv';

export interface CleanedTitleInfo {
  cleanTitle: string;
  artworkKey: string;
  yearHint?: string;
  inferredKind: ContentKind;
}

const NOISE_TOKENS =
  /\b(FHD|UHD|4K|8K|HD|SD|HEVC|H265|H\.265|H264|H\.264|1080P|720P|480P|DUBLADO|DUB|LEGENDADO|LEG|DUAL|NACIONAL|PT-BR|BR|VIP|BACKUP|ALT|24H|24HRS)\b/gi;

export function analyzeChannelMetadata(
  rawName: string,
  groupTitle: string,
  streamUrl: string
): CleanedTitleInfo {
  let working = rawName.trim();
  const yearMatch = working.match(/[\(\[]\s*(19\d{2}|20\d{2})\s*[\)\]]/);
  const yearHint = yearMatch ? yearMatch[1] : undefined;

  const hasEpisodeTag = /\bS\d{1,2}\s*E\d{1,3}\b|\b\d{1,2}x\d{1,2}\b/i.test(working);
  working = working.replace(/\bS\d{1,2}\s*E\d{1,3}.*$/i, '');
  working = working.replace(/\bTemporada\s*\d+.*$/i, '');
  working = working.replace(/^\[[^\]]{1,12}\]\s*/, '');
  working = working.replace(/^[A-Z]{2,4}\s*[|:\-]\s*/i, '');
  working = working.replace(/\[[^\]]*\]/g, ' ');
  working = working.replace(/\([^)]*\)/g, ' ');
  working = working.replace(NOISE_TOKENS, ' ');
  working = working.replace(/[|_•]+/g, ' ');
  working = working.replace(/\s{2,}/g, ' ').trim();
  working = working.replace(/^[-:\s]+|[-:\s]+$/g, '').trim();

  const cleanTitle = working.length >= 2 ? working : rawName.trim();
  const lowerGroup = groupTitle.toLowerCase();
  const lowerUrl = streamUrl.toLowerCase();

  let inferredKind: ContentKind = 'live';
  if (
    hasEpisodeTag ||
    lowerGroup.includes('série') ||
    lowerGroup.includes('serie') ||
    lowerGroup.includes('series') ||
    lowerGroup.includes('novela') ||
    lowerGroup.includes('anime') ||
    lowerUrl.includes('/series/')
  ) {
    inferredKind = 'series';
  } else if (
    Boolean(yearHint) ||
    lowerGroup.includes('filme') ||
    lowerGroup.includes('movie') ||
    lowerGroup.includes('vod') ||
    lowerGroup.includes('cinema') ||
    lowerGroup.includes('lançamento') ||
    lowerUrl.includes('/movie/') ||
    lowerUrl.endsWith('.mp4') ||
    lowerUrl.endsWith('.mkv')
  ) {
    inferredKind = 'vod';
  }

  const normalizedSlug = cleanTitle
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    cleanTitle,
    artworkKey: inferredKind + ':' + (normalizedSlug || 'item') + (yearHint ? ':' + yearHint : ''),
    yearHint,
    inferredKind,
  };
}

const CINEMA_PALETTES: [string, string, string][] = [
  ['#1a090d', '#5c111b', '#e50914'],
  ['#091526', '#14365d', '#38bdf8'],
  ['#140d26', '#3b1d6e', '#a855f7'],
  ['#081c18', '#114b3e', '#10b981'],
  ['#241407', '#6b3410', '#f59e0b'],
  ['#19111f', '#4a1942', '#ec4899'],
];

export function getAtmosphericGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const [c1, c2, c3] = CINEMA_PALETTES[hash % CINEMA_PALETTES.length];
  return `radial-gradient(circle at 78% 22%, ${c3}33 0%, transparent 55%), linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

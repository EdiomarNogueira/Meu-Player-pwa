import { Channel, StreamFormat } from '../types/iptv';
import { analyzeChannelMetadata } from './titleCleaner';

export function detectStreamFormat(url: string): StreamFormat {
  try {
    const parsed = new URL(url);
    const p = parsed.pathname.toLowerCase();
    const s = parsed.search.toLowerCase();
    if (p.endsWith('.m3u8') || s.includes('m3u8')) return 'hls';
    if (p.endsWith('.mp4') || p.endsWith('.webm') || p.endsWith('.ogg') || p.endsWith('.mkv')) return 'mp4';
    if (p.endsWith('.ts') || s.includes('output=ts')) return 'ts';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractAttribute(line: string, attrName: string): string | undefined {
  const match = line.match(new RegExp(attrName + '="([^"]*)"', 'i'));
  return match?.[1]?.trim() || undefined;
}

export function parseM3uContent(content: string, sourceId: string): { channels: Channel[]; epgUrl?: string } {
  const lines = content.split(/\r?\n/);
  const channels: Channel[] = [];
  let epgUrl: string | undefined;
  let pendingName = '';
  let pendingGroup = 'Geral';
  let pendingLogo: string | undefined;
  let pendingTvgId: string | undefined;
  let idx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (i === 0 && line.toUpperCase().startsWith('#EXTM3U')) {
      epgUrl = extractAttribute(line, 'x-tvg-url') ?? extractAttribute(line, 'url-tvg');
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      pendingTvgId = extractAttribute(line, 'tvg-id');
      pendingLogo = extractAttribute(line, 'tvg-logo');
      pendingGroup = extractAttribute(line, 'group-title') || 'Geral';
      const tvgName = extractAttribute(line, 'tvg-name');
      const commaIdx = line.lastIndexOf(',');
      const title = commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : '';
      pendingName = title || tvgName || 'Canal ' + (idx + 1);
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      const grp = line.slice(8).trim();
      if (grp) pendingGroup = grp;
      continue;
    }

    if (line.startsWith('#')) continue;

    if (line.includes('://')) {
      idx += 1;
      const rawName = pendingName || 'Canal ' + idx;
      const group = pendingGroup || 'Geral';
      const analyzed = analyzeChannelMetadata(rawName, group, line);

      channels.push({
        id: sourceId + '::' + idx,
        sourceId,
        name: rawName,
        cleanTitle: analyzed.cleanTitle,
        artworkKey: analyzed.artworkKey,
        yearHint: analyzed.yearHint,
        kind: analyzed.inferredKind,
        group,
        logo: pendingLogo,
        streamUrl: line,
        tvgId: pendingTvgId,
        format: detectStreamFormat(line),
      });

      pendingName = '';
      pendingGroup = 'Geral';
      pendingLogo = undefined;
      pendingTvgId = undefined;
    }
  }

  return { channels, epgUrl };
}

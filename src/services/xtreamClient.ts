import { Channel, DiagnosticIssue, SourceMetadataCache, XtreamCredentials } from '../types/iptv';
import { diagnoseHttpStatus, diagnoseNetworkException, preflightUrlCheck } from './diagnostics';
import { analyzeChannelMetadata } from './titleCleaner';

export class XtreamError extends Error {
  public readonly issue: DiagnosticIssue;
  constructor(issue: DiagnosticIssue) {
    super(issue.title);
    this.issue = issue;
  }
}

async function fetchXtreamJson<T>(url: string): Promise<T> {
  const preflight = preflightUrlCheck(url);
  if (preflight) throw new XtreamError(preflight);

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new XtreamError(diagnoseNetworkException(err, url));
  }

  if (!response.ok) throw new XtreamError(diagnoseHttpStatus(response.status, response.statusText));

  try {
    return (await response.json()) as T;
  } catch {
    throw new XtreamError({
      code: 'INVALID_FORMAT',
      title: 'Resposta inválida da API Xtream Codes',
      explanation: 'O servidor não retornou um JSON Xtream válido.',
      suggestion: 'Confira a URL e porta do servidor.',
    });
  }
}

export async function loadXtreamCatalog(
  sourceId: string,
  creds: XtreamCredentials
): Promise<{ channels: Channel[]; metadata: SourceMetadataCache }> {
  const baseUrl = creds.serverUrl.trim().replace(/\/+$/, '');
  const u = encodeURIComponent(creds.username.trim());
  const p = encodeURIComponent(creds.password.trim());
  const apiBase = `${baseUrl}/player_api.php?username=${u}&password=${p}`;

  const authData = await fetchXtreamJson<{
    user_info?: { auth?: number | string; status?: string; exp_date?: string | null; active_cons?: string; max_connections?: string };
    server_info?: { url?: string; port?: string; https_port?: string; timezone?: string };
  }>(apiBase);

  if (!authData.user_info || Number(authData.user_info.auth) === 0) {
    throw new XtreamError({
      code: 'HTTP_STATUS',
      title: 'Credenciais Xtream recusadas',
      explanation: 'Usuário ou senha inválidos.',
      suggestion: 'Verifique os dados de acesso junto ao provedor.',
    });
  }

  const [liveCats, liveStreams] = await Promise.all([
    fetchXtreamJson<Array<{ category_id: string; category_name: string }>>(apiBase + '&action=get_live_categories').catch(() => []),
    fetchXtreamJson<Array<{ stream_id: number; name: string; stream_icon?: string; epg_channel_id?: string; category_id?: string }>>(apiBase + '&action=get_live_streams'),
  ]);

  const catMap = new Map<string, string>();
  if (Array.isArray(liveCats)) {
    for (const c of liveCats) catMap.set(String(c.category_id), c.category_name);
  }

  const channels: Channel[] = [];
  if (Array.isArray(liveStreams)) {
    for (const item of liveStreams) {
      const group = (item.category_id ? catMap.get(String(item.category_id)) : undefined) || 'TV ao Vivo';
      const streamUrl = `${baseUrl}/live/${u}/${p}/${item.stream_id}.${creds.outputFormat}`;
      const rawName = item.name || 'Canal ' + item.stream_id;
      const analyzed = analyzeChannelMetadata(rawName, group, streamUrl);

      channels.push({
        id: sourceId + '::live::' + item.stream_id,
        sourceId,
        name: rawName,
        cleanTitle: analyzed.cleanTitle,
        artworkKey: 'live:' + analyzed.artworkKey,
        kind: 'live',
        group,
        logo: item.stream_icon || undefined,
        tvgId: item.epg_channel_id || undefined,
        streamUrl,
        format: creds.outputFormat === 'm3u8' ? 'hls' : 'ts',
      });
    }
  }

  return {
    channels,
    metadata: {
      sourceId,
      updatedAt: Date.now(),
      epgUrl: `${baseUrl}/xmltv.php?username=${u}&password=${p}`,
      serverInfo: authData.server_info,
      accountInfo: {
        status: authData.user_info.status,
        expDate: authData.user_info.exp_date,
        activeCons: authData.user_info.active_cons,
        maxConnections: authData.user_info.max_connections,
      },
    },
  };
}

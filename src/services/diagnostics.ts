import { DiagnosticIssue } from '../types/iptv';

export function isMixedContentBlocked(targetUrl: string): boolean {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return false;
  try {
    const parsed = new URL(targetUrl);
    const isLocalhost =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    return parsed.protocol === 'http:' && !isLocalhost;
  } catch {
    return false;
  }
}

export function preflightUrlCheck(rawUrl: string): DiagnosticIssue | null {
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('local://')) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      code: 'INVALID_FORMAT',
      title: 'URL inválida',
      explanation: 'O endereço informado não possui um formato HTTP ou HTTPS válido.',
      suggestion: 'Verifique se a URL começa com https:// ou http:// e não contém espaços.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      code: 'INVALID_FORMAT',
      title: 'Protocolo incompatível com o navegador',
      explanation: 'Protocolos como rtmp://, rtsp:// ou udp:// não são suportados nativamente por APIs web.',
      suggestion: 'Utilize fluxos HLS (.m3u8) ou MP4 sobre HTTPS/HTTP.',
      technicalDetail: 'Protocolo: ' + parsed.protocol,
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      code: 'OFFLINE',
      title: 'Você está no modo Offline',
      explanation: 'A interface e a aba Estúdio Local funcionam sem internet, mas canais IPTV remotos exigem conexão.',
      suggestion: 'Reconecte-se à rede ou utilize a aba Estúdio Local (PC).',
    };
  }

  if (isMixedContentBlocked(parsed.href)) {
    return {
      code: 'MIXED_CONTENT',
      title: 'Conteúdo Misto Bloqueado (HTTPS -> HTTP)',
      explanation: 'Aplicações em HTTPS seguro são bloqueadas pelo navegador ao tentar carregar fluxos HTTP sem criptografia.',
      suggestion: 'Utilize URLs HTTPS ou rode o aplicativo localmente em http://localhost durante testes com HTTP.',
      technicalDetail: 'App: ' + window.location.origin + ' | Stream: ' + parsed.origin,
    };
  }

  return null;
}

export function diagnoseNetworkException(error: unknown, targetUrl: string): DiagnosticIssue {
  const preflight = preflightUrlCheck(targetUrl);
  if (preflight) return preflight;

  return {
    code: 'CORS_OR_NETWORK',
    title: 'Bloqueio de CORS ou Servidor Inacessível',
    explanation: 'O navegador bloqueou a leitura porque o servidor remoto não envia o cabeçalho "Access-Control-Allow-Origin" (CORS) ou recusou conexão.',
    suggestion: 'Para listas M3U sem CORS, baixe o arquivo .m3u pelo navegador e importe-o na aba "Arquivo M3U Local".',
    technicalDetail: error instanceof Error ? error.message : String(error),
  };
}

export function diagnoseHttpStatus(status: number, statusText: string): DiagnosticIssue {
  return {
    code: 'HTTP_STATUS',
    title: 'Erro HTTP ' + status + ' retornado pelo servidor',
    explanation: status === 401 || status === 403
      ? 'Credenciais recusadas, token expirado ou bloqueio de IP.'
      : 'O recurso solicitado não foi encontrado ou está temporariamente indisponível.',
    suggestion: 'Verifique os dados da fonte junto ao provedor.',
    technicalDetail: 'HTTP ' + status + ' ' + statusText,
  };
}

export function getCodecSupportSummary() {
  const mseSupported = typeof window !== 'undefined' && 'MediaSource' in window;
  const check = (mime: string): boolean => {
    if (mseSupported && typeof MediaSource.isTypeSupported === 'function') {
      return MediaSource.isTypeSupported(mime);
    }
    return document.createElement('video').canPlayType(mime) !== '';
  };

  return {
    mseSupported,
    h264: check('video/mp4; codecs="avc1.42E01E"'),
    hevc: check('video/mp4; codecs="hvc1.1.6.L93.B0"') || check('video/mp4; codecs="hev1.1.6.L93.B0"'),
    aac: check('audio/mp4; codecs="mp4a.40.2"'),
    ac3: check('audio/mp4; codecs="ac-3"') || check('audio/mp4; codecs="ec-3"'),
  };
}

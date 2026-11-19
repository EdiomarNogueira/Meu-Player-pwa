import type { FFmpeg as FFmpegInstance } from '@ffmpeg/ffmpeg';

export type LocalVideoOutputCodec = 'h264' | 'hevc' | 'vp9';

export async function transcodeLocalVideo(
  file: File,
  extensionHint: string,
  codec: LocalVideoOutputCodec,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
  onStatus: (status: string) => void,
  knownDuration?: number
): Promise<Blob> {
  let ffmpeg: FFmpegInstance | null = null;
  let stop: (() => void) | null = null;

  const checkAbort = () => {
    if (signal.aborted) throw new DOMException('Conversão cancelada.', 'AbortError');
  };

  const extension = extensionHint.match(/^[a-z0-9]{1,10}$/i)?.[0] || 'bin';
  const inputName = `input.${extension}`;
  const settings = {
    h264: { outputName: 'output.mp4', mimeType: 'video/mp4', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] },
    hevc: { outputName: 'output-hevc.mp4', mimeType: 'video/mp4', args: ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '28', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] },
    vp9: { outputName: 'output-vp9.webm', mimeType: 'video/webm', args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '34', '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k'] },
  }[codec];
  const outputName = settings.outputName;
  let durationSec = Number.isFinite(knownDuration) && knownDuration! > 0 ? knownDuration! : 0;
  let lastPercent = 0;
  const reportProgress = (percent: number) => {
    lastPercent = Math.max(lastPercent, Math.max(0, Math.min(99, Math.round(percent))));
    onProgress(lastPercent);
  };
  const parseTimestamp = (value: string) => {
    const parts = value.split(':').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };

  try {
    checkAbort();
    onStatus('Carregando o conversor...');
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    checkAbort();
    ffmpeg = new FFmpeg();
    stop = () => ffmpeg?.terminate();
    signal.addEventListener('abort', stop, { once: true });
    const coreBase = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, document.baseURI);
    await ffmpeg.load({
      coreURL: new URL('ffmpeg-core.js', coreBase).href,
      wasmURL: new URL('ffmpeg-core.wasm', coreBase).href,
    });
    checkAbort();

    onStatus('Preparando o arquivo...');
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    checkAbort();

    onStatus('Codificando vídeo...');
    const progressListener = ({ progress }: { progress: number }) => {
      if (Number.isFinite(progress)) reportProgress(progress * 100);
    };
    const logListener = ({ message }: { message: string }) => {
      const durationMatch = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (durationMatch && durationSec <= 0) durationSec = parseTimestamp(`${durationMatch[1]}:${durationMatch[2]}:${durationMatch[3]}`) ?? 0;

      if (message.includes('progress=end')) {
        onProgress(99);
        return;
      }
      if (durationSec <= 0) return;

      const microsecondsMatch = message.match(/out_time_ms=(\d+)/);
      const timestampMatch = message.match(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/) || message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const elapsedSec = microsecondsMatch
        ? Number(microsecondsMatch[1]) / 1_000_000
        : timestampMatch
          ? parseTimestamp(`${timestampMatch[1]}:${timestampMatch[2]}:${timestampMatch[3]}`)
          : null;
      if (elapsedSec !== null && elapsedSec !== undefined) reportProgress((elapsedSec / durationSec) * 100);
    };
    ffmpeg.on('progress', progressListener);
    ffmpeg.on('log', logListener);
    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec([
      '-i', inputName,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      ...settings.args,
      '-progress', 'pipe:1',
      outputName,
      ]);
    } finally {
      ffmpeg.off('progress', progressListener);
      ffmpeg.off('log', logListener);
    }
    checkAbort();
    if (exitCode !== 0) throw new Error('O FFmpeg não conseguiu converter este arquivo.');

    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string') throw new Error('O FFmpeg retornou um arquivo inválido.');
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    onProgress(100);
    return new Blob([buffer], { type: settings.mimeType });
  } finally {
    if (stop) signal.removeEventListener('abort', stop);
    ffmpeg?.terminate();
  }
}

# Avisos de terceiros

O MeuPlayer usa o FFmpeg WebAssembly para converter vídeos locais incompatíveis com o navegador.

- `@ffmpeg/ffmpeg` e `@ffmpeg/util`: MIT.
- `@ffmpeg/core`: GPL-2.0-or-later. O núcleo WebAssembly é copiado para `public/ffmpeg` durante `npm run dev` e `npm run build` e só é carregado quando o usuário solicita a conversão.
- Projeto FFmpeg: https://ffmpeg.org/
- Projeto ffmpeg.wasm: https://github.com/ffmpegwasm/ffmpeg.wasm

A conversão ocorre no aparelho do usuário. O conteúdo do vídeo não é enviado para um servidor.

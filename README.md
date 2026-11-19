# MeuPlayer — PWA (v3.1 Consolidado)

Aplicativo **Progressive Web App (PWA)** 100% client-side em **React 18 + TypeScript + Vite + vite-plugin-pwa + IndexedDB + HLS.js**, instalável em janela independente no Windows pelo Chrome ou Edge.

## Novidades da v3.1

- **Inicialização Não-Bloqueante:** A interface abre instantaneamente e revalida pastas locais em segundo plano sem risco de travar na splash screen.
- **Revogação Completa e Limpeza de Imagens:** Revogar uma pasta apaga imediatamente o `DirectoryHandle` e 100% das miniaturas geradas para ela no `IndexedDB` e na memória RAM.
- **Zero Warnings no Dev:** `vite.config.ts` ajustado para silenciar avisos de pré-cache virtual no modo `npm run dev`, mantendo o cache Workbox completo no `npm run build`.
- **Conversão Local de Vídeo:** Arquivos locais cujo codec não é decodificado pelo navegador podem ser convertidos sob demanda para H.264/MP4, H.265/MP4 ou VP9/WebM, com progresso estimado. A conversão roda no aparelho; o núcleo WebAssembly de aproximadamente 32 MB só é carregado quando necessário.

## Comandos

```bash
npm install
npm run dev      # Ambiente localhost sem avisos
npm run build    # Pacote estático pronto para HTTPS em ./dist
npm run preview  # Pré-visualiza o build de produção
```

O gerador independente `setup_revisado.mjs` pode recriar o projeto em uma pasta de saída. A conversão usa `@ffmpeg/core`, licenciado sob GPL-2.0-or-later; consulte `THIRD_PARTY_NOTICES.md`.

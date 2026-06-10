import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  // Honour a PORT env var (used by the preview harness) so the dev server binds
  // to the assigned port instead of auto-incrementing past an in-use 5173.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
  plugins: [
    react(),
    // Mirror onnxruntime-web's WASM blobs next to the bundle so the runtime
    // can fetch them as same-origin static files at /ort/*.wasm.
    viteStaticCopy({
      targets: [
        {
          // Only the wasm-only (non-JSEP) single-threaded build is loaded at
          // runtime — see src/lib/sevenSegmentOcr/index.ts. Copying just these
          // keeps the unused 26 MB JSEP/JSPI/asyncify blobs out of the deploy.
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}',
          dest: 'ort',
        },
      ],
    }),
  ],
})

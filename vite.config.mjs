import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Mirror onnxruntime-web's WASM blobs next to the bundle so the runtime
    // can fetch them as same-origin static files at /ort/*.wasm.
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/*.{wasm,mjs}',
          dest: 'ort',
        },
      ],
    }),
  ],
})

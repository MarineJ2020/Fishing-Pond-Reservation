import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const requiredFirebaseEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

function validateProductionEnv(env) {
  const missing = requiredFirebaseEnv.filter((key) => !env[key]?.trim())
  const invalidApiKey =
    env.VITE_FIREBASE_API_KEY &&
    !/^AIza[0-9A-Za-z_-]{35}$/.test(env.VITE_FIREBASE_API_KEY.trim())

  if (missing.length || invalidApiKey) {
    const problems = [
      missing.length ? `missing ${missing.join(', ')}` : null,
      invalidApiKey ? 'VITE_FIREBASE_API_KEY has an invalid format' : null,
    ].filter(Boolean)

    throw new Error(
      `Refusing to build a blank production site: ${problems.join('; ')}. ` +
        'Restore the Firebase web configuration in .env.local before deploying.',
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === 'production') {
    validateProductionEnv(loadEnv(mode, process.cwd(), 'VITE_'))
  }

  return {
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
  }
})

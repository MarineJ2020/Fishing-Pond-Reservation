// Staging only (exported from index.js when STAGING_GATE=1). Hosting serves no static
// files on staging; every non-function path rewrites here, so the IP allowlist covers the
// whole site. The built site is bundled in functions/staging-dist (copied from dist by
// scripts/stage-dist-for-gate.mjs at deploy time).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regional } from './regions.js';
import { ipGate } from './ip-allowlist.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'staging-dist');

const app = express();
app.disable('x-powered-by');
app.use(ipGate);
app.use(express.static(root, { index: false }));
// Single-page app: unknown paths get the shell; the router decides what to render.
app.use((_req, res) => res.sendFile(path.join(root, 'app.html')));

// Only exists on staging; undefined exports are ignored by the Functions loader, so production never deploys it.
export const stagingGate = process.env.STAGING_GATE === '1'
  ? regional.runWith({ maxInstances: 5, invoker: 'public' }).https.onRequest(app)
  : undefined;

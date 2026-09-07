// Browser integration check: node scripts/check-live-settings.mjs, then open http://localhost:5178.
// Uses the real BookingProvider and React renderer, with no production Firebase writes.
import { createServer } from 'node:http';
import { build } from 'esbuild';

const mocks = {
  '../lib/firestore': `export const loadAppDB = () => new Promise(resolve => globalThis.bridge.pending.push(resolve));
    export const subscribeSettings = callback => { globalThis.bridge.listeners.add(callback); return () => globalThis.bridge.listeners.delete(callback); };`,
  '../lib/api': 'export const createBooking = () => {};',
  '../utils/imageStorage': 'export const uploadDataUrlToFirebaseStorage = () => {};',
  '../utils/pdfStorage': 'export const isPdfFile = () => false; export const uploadPdfToFirebaseStorage = () => {};',
  '../../lib/firebase': 'export const auth = {};',
};
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, { useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import { BookingProvider, useBooking } from './src/context/BookingContext';
    import { emptyDB } from './src/data';
    import { formatWeight } from './src/utils/weight';
    globalThis.bridge = { pending: [], listeners: new Set() };
    const consumers = {};
    function Probe({ name }) {
      const context = useBooking();
      useEffect(() => { consumers[name] = context; }, [context]);
      return <section><h2>{name}</h2><output id={name}>{formatWeight(1.9, context.db.settings.ocrDecimalPlaces)} kg</output></section>;
    }
    for (const name of ['CMS', 'Public']) createRoot(document.getElementById(name + '-root')).render(<BookingProvider><Probe name={name}/></BookingProvider>);
    const wait = () => new Promise(resolve => setTimeout(resolve, 50));
    const emit = value => { for (const callback of bridge.listeners) callback({ ...emptyDB.settings, ocrDecimalPlaces: value }); };
    const resolveLoads = value => { for (const resolve of bridge.pending.splice(0)) resolve({ ...emptyDB, settings: { ...emptyDB.settings, ocrDecimalPlaces: value } }); };
    const check = (expected, label) => {
      for (const name of ['CMS', 'Public']) if (document.getElementById(name).textContent !== expected + ' kg') throw new Error(name + ': ' + label);
      const item = document.createElement('li'); item.textContent = 'PASS: ' + label; document.getElementById('checks').append(item);
    };
    async function run() {
      for (let attempt = 0; bridge.listeners.size < 2 && attempt < 40; attempt++) await wait();
      if (bridge.listeners.size !== 2) throw new Error('Providers did not subscribe');
      emit(3); resolveLoads(2); await wait(); check('1.900', 'Live snapshot survives stale initial load');
      const reloads = Object.values(consumers).map(context => context.reloadDB());
      emit(2); resolveLoads(3); await Promise.all(reloads); await wait(); check('1.90', 'Live snapshot survives stale reload');
      for (const [value, expected] of [[3, '1.900'], [2, '1.90'], [undefined, '1.9']]) {
        emit(value); await wait(); check(expected, 'Both open pages react to setting ' + (value ?? 'Auto'));
      }
      document.getElementById('status').textContent = 'All browser checks passed';
    }
    run().catch(error => { document.getElementById('status').textContent = 'FAIL: ' + error.message; console.error(error); });
  ` },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'test-services', setup(builder) {
    builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: 'mock' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
  } }],
});
const bundle = result.outputFiles[0].contents;
createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/check.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/check.js' ? bundle : `<!doctype html><html><head><title>Live settings integration check</title></head>
    <body style="font:18px system-ui;max-width:850px;margin:50px auto"><h1 id="status">Running checks...</h1>
    <div id="CMS-root"></div><div id="Public-root"></div><ul id="checks"></ul><script src="/check.js"></script></body></html>`);
}).listen(5178, '127.0.0.1', () => console.log('Live settings integration check: http://localhost:5178'));

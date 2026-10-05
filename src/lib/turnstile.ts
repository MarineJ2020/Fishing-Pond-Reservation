// Cloudflare Turnstile (free bot check) for customer booking submits.
// Loaded only when a token is needed, so browsing pages pay nothing. Most
// visitors pass invisibly; a small box appears only if Cloudflare wants a click.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 60_000;

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

let scriptPromise: Promise<Turnstile> | null = null;

const loadScript = (): Promise<Turnstile> => {
  const existing = (window as any).turnstile as Turnstile | undefined;
  if (existing) return Promise.resolve(existing);
  if (!scriptPromise) {
    scriptPromise = new Promise<Turnstile>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        const api = (window as any).turnstile as Turnstile | undefined;
        if (api) resolve(api); else reject(new Error('turnstile missing'));
      };
      script.onerror = () => { scriptPromise = null; reject(new Error('turnstile load failed')); };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
};

export const turnstileEnabled = (): boolean => !!SITE_KEY;

/** Resolves a fresh single-use token, or '' when Turnstile isn't configured. */
export async function getTurnstileToken(): Promise<string> {
  if (!SITE_KEY) return '';
  let api: Turnstile;
  try {
    api = await loadScript();
  } catch {
    throw new Error('Pengesahan keselamatan tidak dapat dimuatkan. Sila semak sambungan internet dan cuba lagi. / Security check failed to load.');
  }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:100000;';
  document.body.appendChild(host);
  return new Promise<string>((resolve, reject) => {
    let widgetId = '';
    const done = (fn: () => void) => {
      clearTimeout(timer);
      try { if (widgetId) api.remove(widgetId); } catch { /* already gone */ }
      host.remove();
      fn();
    };
    const fail = () => done(() => reject(new Error('Pengesahan keselamatan gagal. Sila cuba lagi. / Security check failed, please try again.')));
    const timer = setTimeout(fail, TIMEOUT_MS);
    widgetId = api.render(host, {
      sitekey: SITE_KEY,
      action: 'booking',
      appearance: 'interaction-only',
      execution: 'execute',
      callback: (token: string) => done(() => resolve(token)),
      'error-callback': fail,
      'expired-callback': fail,
    });
    api.execute(widgetId);
  });
}

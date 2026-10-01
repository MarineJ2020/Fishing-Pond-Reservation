import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// A refresh can otherwise restore the previous scroll offset while the short
// loading shell is visible, which clamps the homepage to its footer. Take over
// restoration before React mounts and keep explicit hash links working.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

const resetHomepageScroll = () => {
  if (window.location.pathname === '/' && !window.location.hash) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }
}

resetHomepageScroll()
window.addEventListener('pageshow', resetHomepageScroll)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

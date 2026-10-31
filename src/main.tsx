import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { getAllBigFiles } from './lib/blobstore'
import { setPreloadedBigFiles } from './lib/studio'

// Multi-megabyte media (soundtracks, voice acting, textures) is stored in IndexedDB.
// Hydrate it before mounting so every build path sees the real asset bytes.
getAllBigFiles()
  .then((map) => setPreloadedBigFiles(map))
  .catch(() => setPreloadedBigFiles({}))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })

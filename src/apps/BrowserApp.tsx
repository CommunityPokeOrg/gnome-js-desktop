import { useState } from 'react'

export default function BrowserApp() {
  const [url, setUrl] = useState('https://www.gnome.org')
  const [visited, setVisited] = useState(url)
  return (
    <div className="app-browser">
      <div className="browser-bar">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setVisited(url)}
          spellCheck={false}
        />
      </div>
      <div className="browser-page">
        <h2>{visited}</h2>
        <p>
          This is a stub renderer — the prototype does not embed real web content.
          The address bar still exercises the window/focus pipeline.
        </p>
      </div>
    </div>
  )
}

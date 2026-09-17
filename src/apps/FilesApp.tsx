const ENTRIES = [
  { name: 'Desktop', kind: 'dir' },
  { name: 'Documents', kind: 'dir' },
  { name: 'Downloads', kind: 'dir' },
  { name: 'Pictures', kind: 'dir' },
  { name: 'architecture.md', kind: 'file' },
  { name: 'cross-kwin-sync.md', kind: 'file' },
  { name: 'notes.txt', kind: 'file' },
]

export default function FilesApp() {
  return (
    <div className="app-files">
      <div className="files-sidebar">
        <div className="files-side-item active">Home</div>
        <div className="files-side-item">Desktop</div>
        <div className="files-side-item">Documents</div>
        <div className="files-side-item">Downloads</div>
      </div>
      <div className="files-main">
        {ENTRIES.map((e) => (
          <div key={e.name} className="files-entry">
            <div className={`files-icon ${e.kind}`}>{e.kind === 'dir' ? '▤' : '▤'}</div>
            <div className="files-name">{e.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

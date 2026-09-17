export default function TextEditorApp() {
  return (
    <textarea
      className="app-editor"
      placeholder="Start typing…"
      spellCheck={false}
      defaultValue={
        '# scratch\n\nA GNOME-style desktop in the browser.\nWindows sync from a live KWin session.\n'
      }
    />
  )
}

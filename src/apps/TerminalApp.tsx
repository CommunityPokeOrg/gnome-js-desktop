import { useState } from 'react'

const COMMANDS: Record<string, string[]> = {
  help: ['available commands: help, ls, whoami, uname, clear'],
  ls: ['Desktop  Documents  Downloads  Music  Pictures  gnome-js-desktop'],
  whoami: ['devin'],
  uname: ['gnome-js-desktop 0.1.0 (simulated tty)'],
}

export default function TerminalApp() {
  const [lines, setLines] = useState<string[]>([
    'Welcome to gnome-js-terminal (demo)',
    'Type "help" for commands.',
  ])
  const [input, setInput] = useState('')

  const run = () => {
    const cmd = input.trim()
    setInput('')
    if (!cmd) return
    if (cmd === 'clear') {
      setLines([])
      return
    }
    const out = COMMANDS[cmd] ?? [`bash: ${cmd}: command not found`]
    setLines((l) => [...l, `devin@gnome-js:~$ ${cmd}`, ...out])
  }

  return (
    <div className="app-terminal" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      <div className="terminal-scroll">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div className="terminal-prompt">
        <span>devin@gnome-js:~$ </span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          autoFocus
          spellCheck={false}
        />
      </div>
    </div>
  )
}

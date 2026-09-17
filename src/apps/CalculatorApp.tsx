import { useState } from 'react'

type Op = '+' | '−' | '×' | '÷'

function apply(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b
    case '−': return a - b
    case '×': return a * b
    case '÷': return b === 0 ? NaN : a / b
  }
}

export default function CalculatorApp() {
  const [display, setDisplay] = useState('0')
  const [acc, setAcc] = useState<number | null>(null)
  const [op, setOp] = useState<Op | null>(null)
  const [fresh, setFresh] = useState(true)

  const digit = (d: string) => {
    setDisplay(fresh ? d : display === '0' ? d : display + d)
    setFresh(false)
  }
  const opPress = (o: Op) => {
    const cur = Number(display)
    setAcc(acc !== null && op ? apply(acc, cur, op) : cur)
    if (acc !== null && op) setDisplay(String(apply(acc, cur, op)))
    setOp(o)
    setFresh(true)
  }
  const equals = () => {
    if (acc === null || !op) return
    setDisplay(String(apply(acc, Number(display), op)))
    setAcc(null)
    setOp(null)
    setFresh(true)
  }
  const clear = () => {
    setDisplay('0')
    setAcc(null)
    setOp(null)
    setFresh(true)
  }

  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+']
  return (
    <div className="app-calc">
      <div className="calc-display">{display}</div>
      <div className="calc-grid">
        <button className="calc-key wide" onClick={clear}>C</button>
        {keys.map((k) => (
          <button
            key={k}
            className="calc-key"
            onClick={() =>
              k === '=' ? equals() : '÷×−+'.includes(k) ? opPress(k as Op) : digit(k)
            }
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

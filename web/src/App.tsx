import { CapacityGrid } from './CapacityGrid'
import { formatDay } from './lib/dates'

// The range the grid loads. Week navigation and a range picker come next.
const FROM = '2025-12-29'
const TO = '2026-01-16'

export function App() {
  return (
    <main className="mx-auto flex max-w-[110rem] flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Team capacity</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formatDay(FROM, true)} to {formatDay(TO, true)}
        </p>
      </header>
      <CapacityGrid from={FROM} to={TO} />
    </main>
  )
}

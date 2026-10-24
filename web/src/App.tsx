import { CapacityGrid } from './CapacityGrid'
import { RangeToolbar } from './capacity/RangeToolbar'
import { useRangeParam } from './capacity/useRangeParam'

export function App() {
  const { range, notice, setRange } = useRangeParam()
  return (
    <main className="mx-auto flex max-w-[110rem] flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold tracking-tight">Team capacity</h1>
      <RangeToolbar range={range} notice={notice} onChange={setRange} />
      <CapacityGrid from={range.from} to={range.to} />
    </main>
  )
}

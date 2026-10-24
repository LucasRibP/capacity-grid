import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

import type { CapacityGrid } from '@/api/generated/model'
import { formatDay, yearOf } from '@/lib/dates'
import { cn } from '@/lib/utils'

import { WeekCell } from './WeekCell'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'

const ROW_HEIGHT = 44

type Props = {
  grid: CapacityGrid
  busy: boolean
}

// Production has a few thousand people: only the rows in view are rendered. The header row and the name column
// stay put while scrolling either way.
export function GridTable({ grid, busy }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read during render by design
  const virtualizer = useVirtualizer({
    count: grid.people.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })
  const rows = virtualizer.getVirtualItems()
  const padTop = rows[0]?.start ?? 0
  const padBottom = virtualizer.getTotalSize() - (rows.at(-1)?.end ?? 0)

  return (
    <div
      ref={scrollRef}
      className={cn(
        'max-h-[calc(100vh-11rem)] w-fit max-w-full overflow-auto rounded-lg border transition-opacity',
        busy && 'opacity-60',
      )}
    >
      <table
        aria-busy={busy}
        aria-rowcount={grid.people.length + 1}
        className="w-max border-separate border-spacing-0 text-sm"
      >
        <thead>
          <tr aria-rowindex={1}>
            <th
              scope="col"
              className="sticky top-0 left-0 z-30 w-56 border-b bg-background px-3 py-2 text-left font-medium"
            >
              Person
            </th>
            {grid.weeks.map((week, i) => (
              <th
                key={week}
                scope="col"
                className="sticky top-0 z-20 w-28 border-b bg-background px-1 py-2 text-center font-medium whitespace-nowrap"
              >
                <span className="sr-only">Week of</span>{' '}
                {formatDay(week, i === 0 || yearOf(week) !== yearOf(grid.weeks[i - 1] ?? week))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
          {rows.map((row) => {
            const person = grid.people[row.index]
            if (!person) return null
            return (
              <tr key={person.id} aria-rowindex={row.index + 2} style={{ height: ROW_HEIGHT }}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b bg-background px-3 text-left font-normal"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{person.name}</span>
                    <WeeklyHoursEditor
                      personId={person.id}
                      name={person.name}
                      weeklyHours={person.weeklyHours}
                    />
                  </div>
                </th>
                {person.weeks.map((week) => (
                  <td key={week.weekStart} className="border-b px-1">
                    <WeekCell allocatedHours={week.allocatedHours} capacityHours={week.capacityHours} />
                  </td>
                ))}
              </tr>
            )
          })}
          {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
        </tbody>
      </table>
    </div>
  )
}

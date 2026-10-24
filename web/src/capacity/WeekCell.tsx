import { TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

import { formatHours, weekLoad } from './load'

type Props = {
  allocatedHours: number
  capacityHours: number
}

// One person-week: a bar filled to the share of capacity in use, with "allocated / capacity" on top.
// Over-allocation is red, hatched, carries a warning icon and says "over by" to screen readers: never color alone.
export function WeekCell({ allocatedHours, capacityHours }: Props) {
  const { fill, over, overBy } = weekLoad(allocatedHours, capacityHours)
  return (
    <div
      className={cn(
        'relative h-8 overflow-hidden rounded-md border bg-muted/50',
        over && 'border-red-700 dark:border-red-400',
      )}
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0',
          over ? 'stripes bg-red-600 dark:bg-red-700' : 'bg-emerald-300 dark:bg-emerald-800',
        )}
        style={{ width: `${String(fill * 100)}%` }}
      />
      <span
        className={cn(
          'relative flex h-full items-center justify-center gap-1 text-xs font-medium tabular-nums',
          over && 'text-white',
          allocatedHours === 0 && 'text-muted-foreground',
        )}
      >
        {over && <TriangleAlert aria-hidden className="size-3.5 shrink-0" />}
        {formatHours(allocatedHours)} / {formatHours(capacityHours)}
        {over && <span className="sr-only">, over by {formatHours(overBy)} h</span>}
      </span>
    </div>
  )
}

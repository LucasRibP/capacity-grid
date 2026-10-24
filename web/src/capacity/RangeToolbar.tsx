import { CalendarDays, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  addWeeks,
  formatDay,
  fromLocalDate,
  startOfIsoWeek,
  toLocalDate,
  weekStartsBetween,
} from '@/lib/dates'

import { lastAllowedDay, MAX_WEEKS, normalizeRange, type Range, shiftRange } from './range'

type Props = {
  range: Range
  notice?: string
  onChange: (range: Range) => void
}

export function RangeToolbar({ range, notice, onChange }: Props) {
  const weekCount = weekStartsBetween(range.from, range.to).length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous week"
          onClick={() => {
            onChange(shiftRange(range, -1))
          }}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <RangePicker range={range} onChange={onChange} />
        <Button
          variant="outline"
          size="icon"
          aria-label="Next week"
          onClick={() => {
            onChange(shiftRange(range, 1))
          }}
        >
          <ChevronRight aria-hidden />
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {weekCount} {weekCount === 1 ? 'week' : 'weeks'}
        </span>
      </div>
      {notice && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Info aria-hidden className="size-4" />
          {notice}
        </p>
      )}
    </div>
  )
}

// Days the picker offers once a start is chosen: no further than 13 ISO weeks away on either side, so an
// out-of-range selection can't be made in the first place.
function outOfReach(start: Date) {
  const from = fromLocalDate(start)
  return [
    { before: toLocalDate(startOfIsoWeek(addWeeks(from, -(MAX_WEEKS - 1)))) },
    { after: toLocalDate(lastAllowedDay(from)) },
  ]
}

function RangePicker({ range, onChange }: Omit<Props, 'notice'>) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()

  const apply = () => {
    if (!draft?.from || !draft.to) return
    onChange(normalizeRange(fromLocalDate(draft.from), fromLocalDate(draft.to)).range)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setDraft({ from: toLocalDate(range.from), to: toLocalDate(range.to) })
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="tabular-nums">
          <CalendarDays aria-hidden />
          <span className="sr-only">Date range:</span> {formatDay(range.from, true)} –{' '}
          {formatDay(range.to, true)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          resetOnSelect
          numberOfMonths={2}
          weekStartsOn={1}
          defaultMonth={toLocalDate(range.from)}
          selected={draft}
          onSelect={setDraft}
          disabled={draft?.from && !draft.to ? outOfReach(draft.from) : undefined}
        />
        <div className="flex items-center justify-between gap-3 border-t p-3">
          <p className="text-xs text-muted-foreground">Up to {MAX_WEEKS} weeks, Monday to Sunday.</p>
          <Button size="sm" onClick={apply} disabled={!draft?.from || !draft.to}>
            Show range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

import { CircleAlert, LoaderCircle, Pencil } from 'lucide-react'
import { useId, useState } from 'react'

import { useUpdateWeeklyHours } from '@/api/useUpdateWeeklyHours'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import { formatHours, MAX_WEEKLY_HOURS, MIN_WEEKLY_HOURS, parseWeeklyHours } from './load'

type Props = {
  personId: number
  name: string
  weeklyHours: number
}

// "40 h/wk" next to a person's name, which opens a small editor. Enter saves, Escape cancels. The grid changes only
// once the server confirms; a failed save keeps the editor open with the typed value, the server's message and a
// retry.
export function WeeklyHoursEditor({ personId, name, weeklyHours }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const { mutate, isPending, error, reset } = useUpdateWeeklyHours()
  const inputId = useId()
  const messageId = useId()

  function openEditor(next: boolean) {
    if (isPending) return // closing mid-save would hide its outcome
    setOpen(next)
    if (next) {
      setDraft(formatHours(weeklyHours))
      setInvalid(false)
      reset()
    }
  }

  function save() {
    const hours = parseWeeklyHours(draft)
    setInvalid(hours === undefined)
    if (hours === undefined) return
    if (hours === weeklyHours) {
      setOpen(false)
      return
    }
    mutate(
      { id: personId, data: { weeklyHours: hours } },
      {
        onSuccess: () => {
          setOpen(false)
        },
      },
    )
  }

  const message = invalid
    ? `Enter a number of hours from ${String(MIN_WEEKLY_HOURS)} to ${String(MAX_WEEKLY_HOURS)}.`
    : error?.message

  return (
    <Popover open={open} onOpenChange={openEditor}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Weekly hours for ${name}: ${formatHours(weeklyHours)}. Edit`}
          className="group flex shrink-0 items-center gap-1 rounded px-1 text-xs text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {formatHours(weeklyHours)} h/wk
          <Pencil
            aria-hidden
            className="size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <form
          className="flex flex-col gap-2"
          aria-busy={isPending}
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <label htmlFor={inputId} className="font-medium">
            Weekly hours for {name}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              inputMode="decimal"
              autoComplete="off"
              value={draft}
              readOnly={isPending}
              aria-invalid={message !== undefined}
              aria-describedby={message === undefined ? undefined : messageId}
              onChange={(event) => {
                setDraft(event.target.value)
                setInvalid(false)
              }}
            />
            <span className="shrink-0 text-muted-foreground">h/wk</span>
          </div>
          {message !== undefined && (
            <p id={messageId} role="alert" className="flex items-start gap-1.5 text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => {
                openEditor(false)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <LoaderCircle aria-hidden className="animate-spin" />}
              {isPending ? 'Saving…' : error ? 'Retry' : 'Save'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

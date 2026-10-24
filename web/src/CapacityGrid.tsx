import { CircleAlert, LoaderCircle, SearchX, Users } from 'lucide-react'

import type { ApiError } from '@/api/http'
import { useCapacity } from '@/api/useCapacity'
import { GridTable } from '@/capacity/GridTable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type Props = {
  from: string
  to: string
  /** Name search; '' or absent shows everyone. */
  q?: string
  onClearSearch?: () => void
}

// CapacityGrid renders one row per person and one column per week, showing how allocated each person is and
// making over-allocation obvious.
export function CapacityGrid({ from, to, q = '', onClearSearch }: Props) {
  const { data, error, isPending, isPlaceholderData, refetch } = useCapacity({ from, to, q })

  return (
    <section aria-label="Capacity by person and week" className="flex flex-col gap-3">
      <div className="flex min-h-6 items-center justify-between gap-4 text-xs text-muted-foreground">
        <Legend />
        <p aria-live="polite" className="flex items-center gap-1.5">
          {isPlaceholderData && (
            <>
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
              Updating…
            </>
          )}
        </p>
      </div>
      {error && (
        <LoadError
          error={error}
          onRetry={() => {
            void refetch()
          }}
        />
      )}
      {isPending && <GridSkeleton />}
      {data &&
        (data.people.length > 0 ? (
          <GridTable grid={data} busy={isPlaceholderData} />
        ) : q ? (
          <NoMatches q={q} onClear={onClearSearch} />
        ) : (
          <EmptyGrid />
        ))}
    </section>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>Each cell: allocated / capacity hours</span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-5 rounded-sm border bg-emerald-300 dark:bg-emerald-800" />
        Used capacity
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="stripes h-3 w-5 rounded-sm bg-red-600 dark:bg-red-700" />
        Over capacity
      </span>
    </div>
  )
}

function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>Couldn't load capacity</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{error.message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function GridSkeleton() {
  return (
    <div role="status" aria-label="Loading capacity" className="flex flex-col gap-2 rounded-lg border p-3">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex gap-2">
          <Skeleton className="h-8 w-52" />
          {Array.from({ length: 6 }, (_, j) => (
            <Skeleton key={j} className="h-8 w-26" />
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyGrid() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <Users aria-hidden className="size-6 text-muted-foreground" />
      <p className="font-medium">No people to plan yet</p>
      <p className="text-sm text-muted-foreground">People appear here once they're added to the team.</p>
    </div>
  )
}

function NoMatches({ q, onClear }: { q: string; onClear: (() => void) | undefined }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <SearchX aria-hidden className="size-6 text-muted-foreground" />
      <p className="font-medium">No one matches “{q}”</p>
      <p className="text-sm text-muted-foreground">
        Check the spelling, or search for part of a first or last name.
      </p>
      {onClear && (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear search
        </Button>
      )}
    </div>
  )
}

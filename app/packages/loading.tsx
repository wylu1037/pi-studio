import { Skeleton } from '@/components/ui/skeleton'

export default function PackagesLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Loading packages" aria-busy="true">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 py-5">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-8 w-36 rounded-none" />
          <Skeleton className="h-4 w-[min(38rem,70vw)] rounded-none" />
        </div>
        <Skeleton className="h-8 w-24 rounded-none" />
      </header>

      <div className="flex h-10 items-end gap-2 border-b border-border px-6">
        <Skeleton className="h-8 w-32 rounded-none" />
        <Skeleton className="h-8 w-28 rounded-none" />
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
        <Skeleton className="h-9 w-64 rounded-none" />
        <Skeleton className="h-4 w-24 rounded-none" />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-6 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex min-h-44 flex-col border border-border bg-card">
            <div className="flex items-start gap-3 border-b border-border p-4">
              <Skeleton className="size-9 shrink-0 rounded-none" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/5 rounded-none" />
                <Skeleton className="h-3 w-3/5 rounded-none" />
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <Skeleton className="h-3 w-full rounded-none" />
              <Skeleton className="h-3 w-4/5 rounded-none" />
              <div className="mt-auto flex gap-2">
                <Skeleton className="h-5 w-16 rounded-none" />
                <Skeleton className="h-5 w-20 rounded-none" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

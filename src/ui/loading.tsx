export function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "h-4 w-4 border-2" : size === "lg" ? "h-10 w-10 border-4" : "h-6 w-6 border-2";
  return (
    <span
      className={`inline-block animate-spin rounded-full border-neutral-200 border-t-neutral-600 ${dim}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

export function InlineError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </p>
  );
}

export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-200 py-16 text-center">
      <p className="text-sm text-neutral-500">{message}</p>
      {action}
    </div>
  );
}

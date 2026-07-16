import type { CaptureSnapshot } from '../../types/capture'

interface ProgressFeedProps {
  snapshot: CaptureSnapshot | null
  starting: boolean
}

export function ProgressFeed({ snapshot, starting }: ProgressFeedProps) {
  const captured = snapshot?.progress.captured ?? 0
  const total = snapshot?.progress.total ?? 0
  const modeLabel = snapshot?.mode === 'single-page' ? 'single page' : 'whole site'
  const percent = total > 0 ? Math.min(100, Math.round((captured / total) * 100)) : null

  return (
    <section className="progress" aria-live="polite">
      <div className="progress-head">
        <span className="spinner" aria-hidden="true" />
        <span>{starting ? 'Starting capture…' : `Capturing ${modeLabel}…`}</span>
      </div>

      <p className="progress-count">
        <strong>{captured}</strong>
        <span> / {total > 0 ? total : '—'} pages captured</span>
      </p>

      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={percent === null ? 'progress-fill progress-fill-indeterminate' : 'progress-fill'}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </section>
  )
}

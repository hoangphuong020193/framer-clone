import { captureDownloadUrl, capturePreviewUrl } from '../../api/captureClient'
import type { CapturePhase, CaptureSnapshot } from '../../types/capture'

interface ResultPanelProps {
  phase: CapturePhase
  snapshot: CaptureSnapshot | null
  error: string | null
  onReset: () => void
}

export function ResultPanel({ phase, snapshot, error, onReset }: ResultPanelProps) {
  if (phase === 'failed') {
    return (
      <section className="result result-failed" role="alert">
        <h2>Capture failed</h2>
        <p>{error ?? 'Something went wrong during the capture.'}</p>
        <button className="ghost" type="button" onClick={onReset}>
          Try another site
        </button>
      </section>
    )
  }

  if ((phase !== 'succeeded' && phase !== 'partial') || !snapshot) return null

  const { captureId, report } = snapshot
  const captured =
    report?.pages.filter((page) => page.status === 'captured' || page.status === 'degraded').length ?? snapshot.progress.captured
  const partial = phase === 'partial'

  return (
    <section className={partial ? 'result result-partial' : 'result result-success'}>
      <header className="result-head">
        <div>
          <span className="result-badge">{partial ? 'Partial' : 'Complete'}</span>
          <h2>{partial ? 'Captured with limits' : 'Capture complete'}</h2>
          <p className="result-sub">
            {captured} page{captured === 1 ? '' : 's'} captured
            {report ? ` of ${report.totalPagesDiscovered} discovered` : ''}.
          </p>
        </div>
        <button className="ghost" type="button" onClick={onReset}>
          New capture
        </button>
      </header>

      {partial && report && (
        <ul className="limit-notes">
          {report.trippedWallClock && (
            <li>Stopped at the time limit — {report.pagesDroppedByTimeout} queued page(s) were skipped.</li>
          )}
          {report.trippedWorkspaceCap && <li>Reached the size limit — some pages were skipped.</li>}
        </ul>
      )}

      <div className="result-actions">
        <a className="preview" href={capturePreviewUrl(captureId)} target="_blank" rel="noopener noreferrer">
          Preview
        </a>
        <a className="download" href={captureDownloadUrl(captureId)}>
          Download .zip
        </a>
        <button className="reconstruct" type="button" disabled title="Tier 2 — available in a later phase">
          Reconstruct as React
        </button>
      </div>
    </section>
  )
}

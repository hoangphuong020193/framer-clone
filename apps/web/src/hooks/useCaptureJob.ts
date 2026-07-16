import { useCallback, useEffect, useRef, useState } from 'react'
import { captureEventsUrl, startCapture } from '../api/captureClient'
import type { CaptureMode, CapturePhase, CaptureSnapshot } from '../types/capture'

interface CaptureJobState {
  phase: CapturePhase
  snapshot: CaptureSnapshot | null
  error: string | null
}

const IDLE_STATE: CaptureJobState = { phase: 'idle', snapshot: null, error: null }

function phaseForStatus(status: CaptureSnapshot['status']): CapturePhase {
  if (status === 'complete') return 'succeeded'
  if (status === 'partial') return 'partial'
  if (status === 'failed') return 'failed'
  return 'running'
}

export interface UseCaptureJob {
  phase: CapturePhase
  snapshot: CaptureSnapshot | null
  error: string | null
  isBusy: boolean
  start: (url: string, mode: CaptureMode) => Promise<void>
  reset: () => void
}

/**
 * Owns one capture job's lifecycle: starts it, then follows its progress over
 * SSE until it settles, exposing a phase the UI switches on. Closes the stream
 * on completion, failure, reset, and unmount so no EventSource leaks.
 */
export function useCaptureJob(): UseCaptureJob {
  const [state, setState] = useState<CaptureJobState>(IDLE_STATE)
  const sourceRef = useRef<EventSource | null>(null)

  const closeSource = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
  }, [])

  const reset = useCallback(() => {
    closeSource()
    setState(IDLE_STATE)
  }, [closeSource])

  const subscribe = useCallback(
    (captureId: string) => {
      closeSource()
      const source = new EventSource(captureEventsUrl(captureId))
      sourceRef.current = source

      const onSnapshot = (event: MessageEvent<string>): void => {
        let snapshot: CaptureSnapshot
        try {
          snapshot = JSON.parse(event.data) as CaptureSnapshot
        } catch {
          // A malformed frame means the stream is unusable — fail rather than hang.
          closeSource()
          setState((prev) => ({ phase: 'failed', snapshot: prev.snapshot, error: 'Received a malformed progress update.' }))
          return
        }
        setState({ phase: phaseForStatus(snapshot.status), snapshot, error: snapshot.error })
        if (snapshot.status !== 'running') closeSource()
      }

      source.addEventListener('progress', onSnapshot)
      source.addEventListener('done', onSnapshot)
      source.addEventListener('failed', onSnapshot)

      // Native transport error (distinct from the server's `failed` frame). Only
      // treat it as fatal once the browser has given up reconnecting.
      source.onerror = (): void => {
        if (source.readyState !== EventSource.CLOSED) return
        closeSource()
        setState((prev) =>
          prev.phase === 'running' || prev.phase === 'starting'
            ? { phase: 'failed', snapshot: prev.snapshot, error: 'Lost connection to the capture. Please try again.' }
            : prev,
        )
      }
    },
    [closeSource],
  )

  const start = useCallback(
    async (url: string, mode: CaptureMode): Promise<void> => {
      closeSource()
      setState({ phase: 'starting', snapshot: null, error: null })
      try {
        const snapshot = await startCapture({ url, mode })
        setState({ phase: 'running', snapshot, error: null })
        subscribe(snapshot.captureId)
      } catch (error: unknown) {
        setState({ phase: 'failed', snapshot: null, error: error instanceof Error ? error.message : 'Could not start the capture.' })
      }
    },
    [closeSource, subscribe],
  )

  useEffect(() => closeSource, [closeSource])

  const isBusy = state.phase === 'starting' || state.phase === 'running'
  return { phase: state.phase, snapshot: state.snapshot, error: state.error, isBusy, start, reset }
}

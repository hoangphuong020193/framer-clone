import type { CaptureMode, CaptureSnapshot } from '../types/capture'

interface StartCaptureRequest {
  url: string
  mode: CaptureMode
}

/**
 * Kicks off a capture job. Resolves with the initial snapshot (status
 * `running`) whose `captureId` keys the SSE, preview, and download endpoints.
 * Throws with the server's message (or a generic fallback) on rejection.
 */
export async function startCapture(request: StartCaptureRequest): Promise<CaptureSnapshot> {
  const response = await fetch('/api/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (response.status !== 202) {
    const body: unknown = await response.json().catch(() => null)
    const message =
      typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : 'Could not start the capture. Please try again.'
    throw new Error(message)
  }

  return (await response.json()) as CaptureSnapshot
}

export function captureEventsUrl(captureId: string): string {
  return `/api/capture/${captureId}/events`
}

export function captureDownloadUrl(captureId: string): string {
  return `/api/capture/${captureId}/download`
}

export function capturePreviewUrl(captureId: string): string {
  return `/api/capture/${captureId}/preview/`
}

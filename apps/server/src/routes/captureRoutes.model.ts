import type { CaptureJobManager } from '../jobs/models/captureJobManager.model.js'
import type { WorkspaceRegistry } from '../packaging/models/packaging.model.js'

/**
 * Dependencies for the capture router. Lives in the routes layer (not a feature
 * model) because it composes two features — the async job manager and the
 * workspace registry — plus the on-disk workspace root the download/preview
 * handlers read from.
 */
export interface CaptureRoutesDeps {
  manager: CaptureJobManager
  registry: WorkspaceRegistry
  workspaceRoot: string
}

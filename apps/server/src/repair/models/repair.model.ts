export type IsCapturedFn = (relativeLocalPath: string) => boolean

export interface RepairHtmlOptions {
  baseUrl: string
  siteOrigin: string
  isCaptured: IsCapturedFn
}

export interface RepairWorkspaceResult {
  htmlFilesRepaired: number
}

/**
 * Substrings matched against a `<script src>` to strip non-functional-when-
 * offline scripts (editor bridge, analytics). `events.framer.com` is the
 * analytics beacon confirmed present on a real Framer site in Phase 0
 * (`docs/plans/2026-07-03-phase0-findings.md` §4). Best-effort and
 * pattern-based — extend as more Framer markup variants are observed.
 */
export const NON_FUNCTIONAL_SCRIPT_HOST_PATTERNS: readonly string[] = [
  'events.framer.com',
  'framer.com/edit',
  'livereload',
]

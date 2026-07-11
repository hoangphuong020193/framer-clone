export type ResourceKind = 'image' | 'script' | 'stylesheet-link' | 'other'

export interface ScannedResource {
  absoluteUrl: string
  kind: ResourceKind
}

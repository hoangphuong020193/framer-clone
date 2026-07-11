export interface WriteResult {
  localPath: string
  wasNew: boolean
}

/**
 * Public surface of the resource store. Consumers (e.g. `CapturePageOptions`)
 * depend on this port instead of the service class, keeping the rule that a
 * model file never imports a service file.
 */
export interface ResourceStorePort {
  has(canonicalUrl: string): boolean
  writeIfNew(canonicalUrl: string, desiredLocalPath: string, body: Buffer): Promise<WriteResult>
}

import dns from 'node:dns/promises'
import net from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'
import { isBlockedIp } from '../functions/ipBlocklist.function.js'
import { SsrfBlockedError, type LookupAddress, type LookupFn, type SafeFetchTarget } from '../models/ssrf.model.js'

const defaultLookup: LookupFn = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true })
  return results.map((r) => ({ address: r.address, family: r.family }))
}

/**
 * Validates a user-supplied URL is safe to fetch server-side, then returns a
 * dispatcher pinned to the specific IP that was validated — so the actual
 * connection can't be re-routed to a different (unvalidated) address by a
 * low-TTL DNS-rebinding response between validation and connect time.
 */
export async function resolveSafeFetchTarget(
  rawUrl: string,
  deps: { lookup?: LookupFn } = {},
): Promise<SafeFetchTarget> {
  const lookup = deps.lookup ?? defaultLookup

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Blocked protocol "${url.protocol}" for ${rawUrl}`)
  }

  const hostname = url.hostname
  const ipFamily = net.isIP(hostname)
  const addresses: LookupAddress[] = ipFamily
    ? [{ address: hostname, family: ipFamily }]
    : await lookup(hostname)

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`DNS resolution returned no addresses for ${hostname}`)
  }

  for (const { address, family } of addresses) {
    if (isBlockedIp(address, family)) {
      throw new SsrfBlockedError(`Blocked IP ${address} (resolved from ${hostname})`)
    }
  }

  // Prefer a validated IPv4 address: dual-stack CDN hostnames (Framer sites
  // included) often list their AAAA record first. Every address was already
  // validated above, so choosing among them changes nothing security-wise.
  const pinned = addresses.find((a) => a.family === 4) ?? addresses[0]
  const dispatcher = new Agent({
    connect: {
      // Node's Happy-Eyeballs (autoSelectFamily, on by default) asks a custom
      // `lookup` for *all* candidate addresses (`{ all: true }`) so it can race
      // connections across them. Our lookup always replies with a single
      // address/family pair, which Node then mishandles internally, crashing
      // every TLS connect with `ERR_INVALID_IP_ADDRESS: Invalid IP address:
      // undefined`. Racing is moot anyway — we deliberately pin to one already-
      // validated IP — so disable it rather than reimplementing the array form.
      autoSelectFamily: false,
      lookup: (_hostname, _opts, callback) => {
        callback(null, pinned.address, pinned.family as 4 | 6)
      },
    },
  })

  return { url, dispatcher }
}

/** SSRF-guarded fetch: resolves+validates the target, then fetches through a pinned dispatcher. */
export async function safeFetch(
  rawUrl: string,
  init: Parameters<typeof undiciFetch>[1] = {},
  deps: { lookup?: LookupFn } = {},
): ReturnType<typeof undiciFetch> {
  const { url, dispatcher } = await resolveSafeFetchTarget(rawUrl, deps)
  return undiciFetch(url, { ...init, dispatcher })
}

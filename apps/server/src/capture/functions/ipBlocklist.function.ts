import net from 'node:net'

// CIDR ranges (as [network, prefixLength]) that must never be reached by a
// server-side fetch triggered by a user-supplied URL: loopback, private,
// link-local (this is what covers the 169.254.169.254 cloud metadata
// endpoint), CGNAT, documentation/test ranges, multicast, and reserved.
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number)
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip)
  return BLOCKED_IPV4_RANGES.some(([network, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
    return (value & mask) === (ipv4ToInt(network) & mask)
  })
}

// Expands a valid IPv6 literal to its 8 hex groups (handling "::"
// compression), or null if it can't be parsed as pure-hex groups (e.g. a
// mixed dotted-decimal tail, which callers check separately).
function expandIpv6Groups(ip: string): string[] | null {
  if (!net.isIPv6(ip) || ip.includes('.')) return null
  if (!ip.includes('::')) {
    const groups = ip.split(':')
    return groups.length === 8 ? groups : null
  }
  const [head, tail] = ip.split('::')
  const headGroups = head ? head.split(':').filter(Boolean) : []
  const tailGroups = tail ? tail.split(':').filter(Boolean) : []
  const missing = 8 - headGroups.length - tailGroups.length
  if (missing < 0) return null
  return [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
}

function hexGroupsToIpv4(high: string, low: string): string {
  const h = parseInt(high, 16)
  const l = parseInt(low, 16)
  return [(h >> 8) & 0xff, h & 0xff, (l >> 8) & 0xff, l & 0xff].join('.')
}

// Extracts an IPv4 address embedded in well-known IPv6 transition schemes —
// tunneling/translation mechanisms otherwise usable to smuggle a blocked
// IPv4 target past a check that only inspects the IPv6 literal itself.
function embeddedIpv4FromGroups(groups: string[]): string | null {
  const [g0, g1, g2, , , g5, g6, g7] = groups
  // IPv4-mapped, hex form (::ffff:7f00:1 === ::ffff:127.0.0.1)
  if (g0 === '0' && g1 === '0' && g2 === '0' && groups[3] === '0' && groups[4] === '0' && g5?.toLowerCase() === 'ffff') {
    return hexGroupsToIpv4(g6, g7)
  }
  // 6to4 (2002::/16) — embeds the IPv4 address in the next 32 bits.
  if (g0?.toLowerCase() === '2002') {
    return hexGroupsToIpv4(g1, g2)
  }
  // NAT64 well-known prefix (64:ff9b::/96) — embeds the IPv4 address in the last 32 bits.
  if (g0?.toLowerCase() === '64' && g1?.toLowerCase() === 'ff9b') {
    return hexGroupsToIpv4(g6, g7)
  }
  return null
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  // fc00::/7 (unique local) covers fc.. and fd..
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true
  // fe80::/10 (link-local)
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
  // IPv4-mapped IPv6, dotted form (::ffff:a.b.c.d) — unwrap and re-check as IPv4
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped && net.isIPv4(mapped[1])) return isBlockedIpv4(mapped[1])

  const groups = expandIpv6Groups(lower)
  const embedded = groups ? embeddedIpv4FromGroups(groups) : null
  if (embedded) return isBlockedIpv4(embedded)

  return false
}

/** True if `address` (already resolved, `family` 4 or 6) must never be fetched server-side. */
export function isBlockedIp(address: string, family: number): boolean {
  return family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address)
}

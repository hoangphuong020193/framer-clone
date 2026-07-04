import { describe, expect, it } from 'vitest'
import { resolveSafeFetchTarget, safeFetch, SsrfBlockedError, type LookupAddress } from './ssrf.js'

function lookupReturning(addresses: LookupAddress[]) {
  return async () => addresses
}

describe('resolveSafeFetchTarget', () => {
  it('rejects non-http(s) protocols', async () => {
    await expect(resolveSafeFetchTarget('ftp://example.com/file')).rejects.toThrow(SsrfBlockedError)
    await expect(resolveSafeFetchTarget('file:///etc/passwd')).rejects.toThrow(SsrfBlockedError)
    await expect(resolveSafeFetchTarget('data:text/plain,hi')).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects invalid URLs', async () => {
    await expect(resolveSafeFetchTarget('not a url')).rejects.toThrow(SsrfBlockedError)
  })

  it('blocks literal loopback IPv4 in the URL', async () => {
    await expect(resolveSafeFetchTarget('http://127.0.0.1/')).rejects.toThrow(SsrfBlockedError)
  })

  it('blocks literal private IPv4 ranges', async () => {
    await expect(resolveSafeFetchTarget('http://10.0.0.5/')).rejects.toThrow(SsrfBlockedError)
    await expect(resolveSafeFetchTarget('http://172.16.0.1/')).rejects.toThrow(SsrfBlockedError)
    await expect(resolveSafeFetchTarget('http://192.168.1.1/')).rejects.toThrow(SsrfBlockedError)
  })

  it('blocks the cloud metadata endpoint (link-local range)', async () => {
    await expect(resolveSafeFetchTarget('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('blocks literal loopback IPv6', async () => {
    await expect(resolveSafeFetchTarget('http://[::1]/')).rejects.toThrow(SsrfBlockedError)
  })

  // These inject the resolved address directly (rather than putting the
  // literal in the URL) because the OS resolver normalizes some of these
  // forms — e.g. "::ffff:7f00:1" comes back from getaddrinfo as
  // "::ffff:127.0.0.1" — before it would ever reach our blocking logic,
  // which would exercise the pre-existing dotted-mapped check instead of
  // the hex/tunneling-prefix handling being tested here.
  it('blocks an IPv4-mapped IPv6 address in hex form (::ffff:7f00:1 === 127.0.0.1)', async () => {
    const lookup = lookupReturning([{ address: '::ffff:7f00:1', family: 6 }])
    await expect(resolveSafeFetchTarget('http://internal.example.com/', { lookup })).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('blocks a 6to4-tunneled loopback address (2002:7f00:1:: embeds 127.0.0.1)', async () => {
    const lookup = lookupReturning([{ address: '2002:7f00:1::', family: 6 }])
    await expect(resolveSafeFetchTarget('http://internal.example.com/', { lookup })).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('blocks a NAT64-tunneled loopback address (64:ff9b::7f00:1 embeds 127.0.0.1)', async () => {
    const lookup = lookupReturning([{ address: '64:ff9b::7f00:1', family: 6 }])
    await expect(resolveSafeFetchTarget('http://internal.example.com/', { lookup })).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('allows a 6to4-tunneled public address', async () => {
    // 2002:5db8:d800:: embeds 93.184.216.0 (a public address) in its next 32 bits.
    const lookup = lookupReturning([{ address: '2002:5db8:d800::', family: 6 }])
    const target = await resolveSafeFetchTarget('http://public.example.com/', { lookup })
    expect(target.url.hostname).toBe('public.example.com')
  })

  it('blocks a hostname that resolves to a private IP', async () => {
    const lookup = lookupReturning([{ address: '10.1.2.3', family: 4 }])
    await expect(resolveSafeFetchTarget('http://internal.example.com/', { lookup })).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('blocks a hostname if ANY resolved address is private (multi-record rebinding attempt)', async () => {
    const lookup = lookupReturning([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(resolveSafeFetchTarget('http://mixed.example.com/', { lookup })).rejects.toThrow(SsrfBlockedError)
  })

  it('allows a hostname resolving only to public addresses', async () => {
    const lookup = lookupReturning([{ address: '93.184.216.34', family: 4 }])
    const target = await resolveSafeFetchTarget('http://public.example.com/page', { lookup })
    expect(target.url.hostname).toBe('public.example.com')
    expect(target.dispatcher).toBeDefined()
  })

  it('rejects when DNS resolution returns no addresses', async () => {
    const lookup = lookupReturning([])
    await expect(resolveSafeFetchTarget('http://nowhere.example.com/', { lookup })).rejects.toThrow(
      SsrfBlockedError,
    )
  })
})

describe('safeFetch', () => {
  it('refuses to fetch a blocked target before making any network call', async () => {
    await expect(safeFetch('http://127.0.0.1:1/')).rejects.toThrow(SsrfBlockedError)
  })
})

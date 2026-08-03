import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  fallbackPasskeyDeviceName,
  passkeyDeviceName,
} from '../app/utils/passkey-device-name.ts'

describe('passkeyDeviceName', () => {
  it('uses a mobile model exposed by User-Agent Client Hints', async () => {
    const name = await passkeyDeviceName({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; K)',
      userAgentData: {
        mobile: true,
        platform: 'Android',
        getHighEntropyValues: async () => ({ model: ' Pixel 9 Pro ' }),
      },
    })

    assert.equal(name, 'Pixel 9 Pro')
  })

  it('falls back when high-entropy hints are unavailable', async () => {
    const name = await passkeyDeviceName({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => {
          throw new Error('NotAllowedError')
        },
      },
    })

    assert.equal(name, 'Komputer z Windows')
  })

  it('ignores the generic reduced Android model', async () => {
    const name = await passkeyDeviceName({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 Mobile',
      userAgentData: {
        mobile: true,
        platform: 'Android',
        getHighEntropyValues: async () => ({ model: 'K' }),
      },
    })

    assert.equal(name, 'Telefon z Androidem')
  })
})

describe('fallbackPasskeyDeviceName', () => {
  it('recognizes an iPad that reports itself as a Mac', () => {
    assert.equal(fallbackPasskeyDeviceName({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }), 'iPad')
  })

  it('extracts an Android model from a legacy user agent', () => {
    assert.equal(fallbackPasskeyDeviceName({
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014) Mobile',
      platform: 'Linux armv8l',
    }), 'SM-S918B')
  })

  it('uses useful desktop platform labels', () => {
    assert.equal(fallbackPasskeyDeviceName({ platform: 'MacIntel' }), 'Mac')
    assert.equal(fallbackPasskeyDeviceName({ userAgent: 'Mozilla/5.0 (X11; CrOS x86_64)' }), 'Chromebook')
    assert.equal(fallbackPasskeyDeviceName({ platform: 'Linux x86_64' }), 'Komputer z Linuxem')
  })

  it('leaves the suggestion empty for an unknown desktop platform', () => {
    assert.equal(fallbackPasskeyDeviceName({ userAgent: 'Custom browser' }), '')
  })
})

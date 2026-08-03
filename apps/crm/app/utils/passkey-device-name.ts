const PASSKEY_NAME_MAX_LENGTH = 80

interface BrowserUserAgentData {
  mobile?: boolean
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<{
    model?: string
    platform?: string
  }>
}

export interface BrowserNavigatorLike {
  maxTouchPoints?: number
  platform?: string
  userAgent?: string
  userAgentData?: BrowserUserAgentData
}

function normalizedLabel(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PASSKEY_NAME_MAX_LENGTH)
}

function usefulDeviceModel(value: string | undefined): string {
  const model = normalizedLabel(value)
  if (!model || /^(k|unknown|generic)$/i.test(model)) return ''
  return model
}

function androidModelFromUserAgent(userAgent: string): string {
  if (!/Android/i.test(userAgent)) return ''
  const match = userAgent.match(/;\s*([^;()]+?)\s+Build(?:[/;)])/i)
  return usefulDeviceModel(match?.[1])
}

export function fallbackPasskeyDeviceName(source: BrowserNavigatorLike): string {
  const userAgent = source.userAgent ?? ''
  const platform = source.userAgentData?.platform || source.platform || ''
  const signature = `${userAgent} ${platform}`

  if (/iPhone/i.test(signature)) return 'iPhone'
  if (/iPod/i.test(signature)) return 'iPod'
  if (/iPad/i.test(signature) || (/Mac/i.test(signature) && (source.maxTouchPoints ?? 0) > 1)) {
    return 'iPad'
  }
  if (/Android/i.test(signature)) {
    const model = androidModelFromUserAgent(userAgent)
    if (model) return model
    if (source.userAgentData?.mobile === false || !/Mobile/i.test(userAgent)) {
      return 'Tablet z Androidem'
    }
    return 'Telefon z Androidem'
  }
  if (/CrOS|Chrome OS/i.test(signature)) return 'Chromebook'
  if (/Windows/i.test(signature)) return 'Komputer z Windows'
  if (/Macintosh|MacIntel|macOS/i.test(signature)) return 'Mac'
  if (/Linux/i.test(signature)) return 'Komputer z Linuxem'
  if (source.userAgentData?.mobile) return 'Urządzenie mobilne'
  return ''
}

export async function passkeyDeviceName(source: BrowserNavigatorLike): Promise<string> {
  const userAgentData = source.userAgentData
  if (userAgentData?.getHighEntropyValues) {
    try {
      const values = await userAgentData.getHighEntropyValues(['model'])
      const model = usefulDeviceModel(values.model)
      if (model) return model
    }
    catch {
      // Client Hints are optional and may be disabled by the browser or policy.
    }
  }

  return fallbackPasskeyDeviceName(source)
}

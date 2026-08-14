const GMAIL_BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
  'ade',
  'adp',
  'apk',
  'appx',
  'appxbundle',
  'bat',
  'cab',
  'chm',
  'cmd',
  'com',
  'cpl',
  'diagcab',
  'diagcfg',
  'diagpkg',
  'dll',
  'dmg',
  'ex',
  'ex_',
  'exe',
  'hta',
  'img',
  'ins',
  'iso',
  'isp',
  'jar',
  'jnlp',
  'js',
  'jse',
  'lib',
  'lnk',
  'mde',
  'mjs',
  'msc',
  'msi',
  'msix',
  'msixbundle',
  'msp',
  'mst',
  'nsh',
  'pif',
  'ps1',
  'scr',
  'sct',
  'shb',
  'sys',
  'vb',
  'vbe',
  'vbs',
  'vhd',
  'vxd',
  'wsc',
  'wsf',
  'wsh',
  'xll',
])

/**
 * Mirrors Gmail's public blocked-extension list so users get a useful error
 * before uploading a message that Gmail is expected to reject. Gmail remains
 * the final malware scanner and may block additional content at any time.
 */
export function gmailBlockedAttachmentExtension(filename: string): string | null {
  const normalized = filename
    .normalize('NFKC')
    .replace(/[\u202A-\u202E\u2066-\u2069]/gu, '')
    .trim()
    .toLowerCase()
  const extension = normalized.split('.').at(-1) || ''
  return GMAIL_BLOCKED_ATTACHMENT_EXTENSIONS.has(extension) ? extension : null
}

export function stripUnsafeMailDisplayControls(value: string): string {
  return value.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu,
    '',
  )
}

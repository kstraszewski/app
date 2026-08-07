const sixDigitHexPattern = /^#([0-9a-f]{6})$/iu

function relativeLuminance(hex: string) {
  const match = sixDigitHexPattern.exec(hex)
  if (!match) return null

  const value = match[1]!
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  })

  return (channels[0]! * 0.2126) + (channels[1]! * 0.7152) + (channels[2]! * 0.0722)
}

export function contrastingTextColor(background: string) {
  const luminance = relativeLuminance(background)
  if (luminance === null) return null

  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF'
}

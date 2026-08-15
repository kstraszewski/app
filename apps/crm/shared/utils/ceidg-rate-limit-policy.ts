const maximumBucketSize = 10_000

export interface CeidgRateLimitBucketMaxima {
  identifierMax: number
  ipMax: number
  pairMax: number
}

/** Keeps CEIDG buckets within the shared auth limiter's accepted range. */
export function ceidgRateLimitBucketMaxima(
  identifier: string,
  limit: number,
): CeidgRateLimitBucketMaxima {
  const boundedLimit = Math.min(Math.max(1, Math.trunc(limit)), maximumBucketSize)
  return {
    pairMax: boundedLimit,
    identifierMax: identifier === 'anonymous' ? maximumBucketSize : boundedLimit,
    ipMax: Math.min(
      identifier === 'anonymous' ? boundedLimit : boundedLimit * 4,
      maximumBucketSize,
    ),
  }
}

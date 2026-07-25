import { randomUUID } from 'node:crypto'
import { AccessToken, TrackSource } from 'livekit-server-sdk'

interface CreateMeetingTokenOptions {
  apiKey: string
  apiSecret: string
  roomName: string
  participantName: string
}

export async function createMeetingParticipantToken(
  options: CreateMeetingTokenOptions,
): Promise<string> {
  const token = new AccessToken(options.apiKey, options.apiSecret, {
    identity: `guest_${randomUUID()}`,
    name: options.participantName,
    ttl: '10m',
  })

  token.addGrant({
    roomJoin: true,
    room: options.roomName,
    canPublish: true,
    canPublishSources: [
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ],
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  })

  return token.toJwt()
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { TokenVerifier } from 'livekit-server-sdk'
import {
  normalizeParticipantName,
  normalizeRoomName,
  toRoomSlug,
} from '../shared/utils/meeting.ts'
import {
  accessCodeMatches,
  isAllowedLiveKitUrl,
  isSecureAccessCode,
  resolveAllowedRoom,
} from '../server/utils/meeting-auth.ts'
import { createMeetingParticipantToken } from '../server/utils/livekit-token.ts'

test('normalizuje bezpieczne nazwy pokoju', () => {
  assert.equal(normalizeRoomName('  Demo-Room  '), 'demo-room')
  assert.equal(toRoomSlug('Spotkanie Łódź 2026'), 'spotkanie-lodz-2026')
  assert.equal(normalizeRoomName('ab'), null)
  assert.equal(normalizeRoomName('../admin'), null)
  assert.equal(normalizeRoomName('pokój'), null)
})

test('normalizuje nazwę uczestnika i odrzuca znaki sterujące', () => {
  assert.equal(normalizeParticipantName('  Anna   Kowalska  '), 'Anna Kowalska')
  assert.equal(normalizeParticipantName(''), null)
  assert.equal(normalizeParticipantName(`Anna\u0000Kowalska`), null)
  assert.equal(normalizeParticipantName('A'.repeat(61)), null)
})

test('porównuje kod dostępu i ogranicza demo do jednego pokoju', () => {
  assert.equal(accessCodeMatches('correct horse battery staple', 'correct horse battery staple'), true)
  assert.equal(accessCodeMatches('wrong', 'correct horse battery staple'), false)
  assert.equal(isSecureAccessCode('correct horse battery staple'), true)
  assert.equal(isSecureAccessCode('too-short'), false)
  assert.equal(resolveAllowedRoom('demo-room', 'demo-room'), 'demo-room')
  assert.equal(resolveAllowedRoom('other-room', 'demo-room'), null)
  assert.equal(resolveAllowedRoom('demo-room', ''), null)
})

test('wymaga szyfrowanego LiveKit poza lokalnym trybem developerskim', () => {
  assert.equal(isAllowedLiveKitUrl('wss://example.livekit.cloud'), true)
  assert.equal(isAllowedLiveKitUrl('ws://127.0.0.1:7880'), false)
  assert.equal(isAllowedLiveKitUrl('ws://127.0.0.1:7880', true), true)
  assert.equal(isAllowedLiveKitUrl('ws://localhost:7880', true), true)
  assert.equal(isAllowedLiveKitUrl('ws://192.168.1.10:7880', true), false)
  assert.equal(isAllowedLiveKitUrl('https://example.livekit.cloud'), false)
})

test('generuje krótko żyjący token wyłącznie dla mediów w dozwolonym pokoju', async () => {
  const apiKey = 'APItestkey'
  const apiSecret = 's'.repeat(64)
  const token = await createMeetingParticipantToken({
    apiKey,
    apiSecret,
    roomName: 'demo-room',
    participantName: 'Anna Kowalska',
  })
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(token)

  assert.match(String(claims.sub), /^guest_/u)
  assert.equal(claims.name, 'Anna Kowalska')
  assert.equal(claims.video?.room, 'demo-room')
  assert.equal(claims.video?.roomJoin, true)
  assert.equal(claims.video?.canPublish, true)
  assert.equal(claims.video?.canSubscribe, true)
  assert.equal(claims.video?.canPublishData, false)
  assert.equal(claims.video?.canUpdateOwnMetadata, false)
  assert.deepEqual(claims.video?.canPublishSources, [
    'camera',
    'microphone',
    'screen_share',
    'screen_share_audio',
  ])
  assert.equal(claims.video?.roomAdmin, undefined)
  assert.equal(claims.video?.roomRecord, undefined)
  const secondsUntilExpiry = Number(claims.exp) - Math.floor(Date.now() / 1000)
  assert.ok(secondsUntilExpiry >= 590 && secondsUntilExpiry <= 600)
})

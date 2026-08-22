<script setup lang="ts">
const props = withDefaults(defineProps<{
  dark?: boolean | null
}>(), {
  dark: null,
})

const PHONE_WIDTH = 280
const PHONE_HEIGHT = PHONE_WIDTH / 0.49
const PHONE_RADIUS = 44
const PHONE_CORNER_SEGMENTS = 12

interface Point {
  x: number
  y: number
}

const phoneSidePanels: Record<string, string>[] = []

function addPhoneSidePanel(from: Point, to: Point) {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y

  phoneSidePanels.push({
    '--phone-side-x': `${from.x.toFixed(3)}px`,
    '--phone-side-y': `${from.y.toFixed(3)}px`,
    '--phone-side-width': `${(Math.hypot(deltaX, deltaY) + 0.6).toFixed(3)}px`,
    '--phone-side-angle': `${(Math.atan2(deltaY, deltaX) * 180 / Math.PI).toFixed(3)}deg`,
  })
}

function addPhoneCorner(center: Point, startAngle: number) {
  for (let index = 0; index < PHONE_CORNER_SEGMENTS; index += 1) {
    const angleFrom = startAngle + (index / PHONE_CORNER_SEGMENTS) * Math.PI / 2
    const angleTo = startAngle + ((index + 1) / PHONE_CORNER_SEGMENTS) * Math.PI / 2

    addPhoneSidePanel(
      {
        x: center.x + Math.cos(angleFrom) * PHONE_RADIUS,
        y: center.y + Math.sin(angleFrom) * PHONE_RADIUS,
      },
      {
        x: center.x + Math.cos(angleTo) * PHONE_RADIUS,
        y: center.y + Math.sin(angleTo) * PHONE_RADIUS,
      },
    )
  }
}

addPhoneSidePanel({ x: PHONE_RADIUS, y: 0 }, { x: PHONE_WIDTH - PHONE_RADIUS, y: 0 })
addPhoneCorner({ x: PHONE_WIDTH - PHONE_RADIUS, y: PHONE_RADIUS }, -Math.PI / 2)
addPhoneSidePanel({ x: PHONE_WIDTH, y: PHONE_RADIUS }, { x: PHONE_WIDTH, y: PHONE_HEIGHT - PHONE_RADIUS })
addPhoneCorner({ x: PHONE_WIDTH - PHONE_RADIUS, y: PHONE_HEIGHT - PHONE_RADIUS }, 0)
addPhoneSidePanel({ x: PHONE_WIDTH - PHONE_RADIUS, y: PHONE_HEIGHT }, { x: PHONE_RADIUS, y: PHONE_HEIGHT })
addPhoneCorner({ x: PHONE_RADIUS, y: PHONE_HEIGHT - PHONE_RADIUS }, Math.PI / 2)
addPhoneSidePanel({ x: 0, y: PHONE_HEIGHT - PHONE_RADIUS }, { x: 0, y: PHONE_RADIUS })
addPhoneCorner({ x: PHONE_RADIUS, y: PHONE_RADIUS }, Math.PI)
</script>

<template>
  <div
    class="orbit-phone-hero"
    :class="{
      'orbit-phone-hero--dark': props.dark === true,
      'orbit-phone-hero--light': props.dark === false,
    }"
    role="img"
    aria-label="Telefon OpenExpert obracający się w przestrzeni 3D, otoczony dwiema kulami poruszającymi się po wspólnej orbicie."
  >
    <div class="orbit-phone-hero__canvas" aria-hidden="true">
      <div class="phone-stage">
        <div class="phone">
          <div class="phone__sides">
            <i
              v-for="(panelStyle, index) in phoneSidePanels"
              :key="index"
              class="phone__side-panel"
              :style="panelStyle"
            />
          </div>

          <div class="phone__back">
            <div class="phone__camera">
              <i /><i /><span />
            </div>
          </div>

          <div class="phone__rail phone__rail--top" />
          <div class="phone__rail phone__rail--bottom" />

          <div class="phone__front">
            <div class="phone__screen">
              <div class="phone__status">
                <span>9:41</span>
                <span class="phone__status-icons"><i /><i /><i /></span>
              </div>

              <div class="phone__appbar">
                <span class="phone__mark">OE</span>
                <span class="phone__avatar">MK</span>
              </div>

              <div class="phone__content">
                <p class="phone__kicker">Dzień dobry, Michał</p>
                <h3>Co dziś<br>domykamy?</h3>

                <div class="phone__agent-card">
                  <span class="phone__agent-dot" />
                  <div>
                    <small>Agent Eve</small>
                    <strong>Analizuje 3 nowe sprawy</strong>
                  </div>
                  <span class="phone__arrow">↗</span>
                </div>

                <div class="phone__section-heading">
                  <strong>Następne kroki</strong>
                  <span>3 zadania</span>
                </div>

                <div class="phone__task is-primary">
                  <span>01</span>
                  <div><strong>Wniosek Kowalskich</strong><small>Gotowy do review</small></div>
                </div>
                <div class="phone__task">
                  <span>02</span>
                  <div><strong>Dokumenty do banku</strong><small>Dziś, 14:30</small></div>
                </div>
              </div>

              <div class="phone__home" />
            </div>
          </div>

          <div class="phone__orbit">
            <span class="phone__orbit-anchor phone__orbit-anchor--large">
              <i class="phone__orbit-sphere">
                <span class="phone__orbit-volume">
                  <span class="phone__orbit-idle-facing">
                    <b class="phone__orbit-sphere-layer" />
                  </span>
                </span>
              </i>
            </span>

            <span class="phone__orbit-anchor phone__orbit-anchor--small">
              <i class="phone__orbit-sphere">
                <span class="phone__orbit-volume">
                  <span class="phone__orbit-idle-facing">
                    <b class="phone__orbit-sphere-layer" />
                  </span>
                </span>
              </i>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.orbit-phone-hero {
  --phone-orbit-delay: -2800ms;
  --phone-orbit-duration: 5600ms;
  --phone-idle-duration: 20000ms;
  --phone-orbit-radius: 250px;
  --phone-orbit-sphere-size: 70px;
  --phone-depth: 36px;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 640px;
  overflow: hidden;
  isolation: isolate;
}

.orbit-phone-hero__canvas {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 760px;
  height: 720px;
  translate: -50% -50%;
  transform-origin: center;
}

.phone-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  perspective: 1100px;
  perspective-origin: 52% 44%;
  transform-style: preserve-3d;
}

.phone {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  width: 280px;
  aspect-ratio: 0.49;
  margin: -286px 0 0 -140px;
  transform-style: preserve-3d;
  will-change: transform;
  animation:
    phone-in 2400ms cubic-bezier(0.08, 0.82, 0.17, 0.9502) both,
    phone-idle var(--phone-idle-duration) linear 2400ms infinite;
}

.phone__sides,
.phone__side-panel,
.phone__back {
  position: absolute;
  pointer-events: none;
  transform-style: preserve-3d;
}

.phone__sides {
  inset: 0;
}

.phone__side-panel {
  top: 0;
  left: 0;
  width: var(--phone-side-width);
  height: var(--phone-depth);
  background: #17191b;
  box-shadow: 0 0 0 0.4px #17191b;
  transform: translate3d(var(--phone-side-x), var(--phone-side-y), 0) rotateZ(var(--phone-side-angle)) rotateX(-90deg);
  transform-origin: 0 0;
}

.phone__back {
  inset: 0;
  border: 1px solid #303437;
  border-radius: 44px;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  background: #17191b;
  transform: translateZ(-36.1px) rotateY(180deg);
}

.phone__orbit {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform-style: preserve-3d;
}

.phone__orbit-anchor {
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--phone-orbit-sphere-size);
  height: var(--phone-orbit-sphere-size);
  transform-style: preserve-3d;
  will-change: transform;
  animation: phone-orbit 5600ms linear infinite;
}

.phone__orbit-anchor--small {
  animation-delay: var(--phone-orbit-delay);
}

.phone__orbit-sphere {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  transform-style: preserve-3d;
  will-change: transform;
  animation: phone-orbit-sphere-facing 5600ms linear infinite;
}

.phone__orbit-anchor--small .phone__orbit-sphere {
  animation-delay: var(--phone-orbit-delay);
}

.phone__orbit-volume {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  transform-style: preserve-3d;
  will-change: transform;
  animation: phone-in-facing 2400ms cubic-bezier(0.08, 0.82, 0.17, 0.9502) both;
}

.phone__orbit-idle-facing {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  transform-style: preserve-3d;
  will-change: transform;
  animation: phone-idle-facing var(--phone-idle-duration) linear 2400ms infinite;
}

.phone__orbit-sphere-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  border: 0;
  border-radius: 50%;
  background: #080a0b;
  backface-visibility: hidden;
}

.orbit-phone-hero--dark .phone__orbit-sphere-layer {
  background: radial-gradient(circle at 32% 28%, #fff 0 24%, #f4f4f2 58%, #d7d8d5 100%);
  box-shadow:
    0 10px 30px rgb(255 255 255 / 10%),
    inset -9px -11px 18px rgb(0 0 0 / 10%);
}

@keyframes phone-in {
  from {
    transform: translate3d(0, 0, -110px) scale(0.82) rotate3d(0.707, -0.707, 0.2, -720deg) rotateX(26deg) rotateY(-40deg) rotateZ(41deg);
  }

  to {
    transform: translate3d(0, 0, 0) scale(1) rotate3d(0.707, -0.707, 0.2, 0deg) rotateX(18deg) rotateY(-32deg) rotateZ(45deg);
  }
}

@keyframes phone-in-facing {
  from {
    transform: rotateZ(-41deg) rotateY(40deg) rotateX(-26deg) rotate3d(0.707, -0.707, 0.2, 720deg);
  }

  to {
    transform: rotateZ(-45deg) rotateY(32deg) rotateX(-18deg) rotate3d(0.707, -0.707, 0.2, 0deg);
  }
}

@keyframes phone-idle {
  from {
    transform: translate3d(0, 0, 0) scale(1) rotate3d(0.707, -0.707, 0.2, 0deg) rotateX(18deg) rotateY(-32deg) rotateZ(45deg);
  }

  to {
    transform: translate3d(0, 0, 0) scale(1) rotate3d(0.707, -0.707, 0.2, 360deg) rotateX(18deg) rotateY(-32deg) rotateZ(45deg);
  }
}

@keyframes phone-idle-facing {
  from { transform: rotate3d(0.707, -0.707, 0.2, 0deg); }
  to { transform: rotate3d(0.707, -0.707, 0.2, -360deg); }
}

@keyframes phone-orbit {
  from { transform: translate(-50%, -50%) rotateY(0turn) translateZ(var(--phone-orbit-radius)); }
  to { transform: translate(-50%, -50%) rotateY(1turn) translateZ(var(--phone-orbit-radius)); }
}

@keyframes phone-orbit-sphere-facing {
  from { transform: rotateY(0turn); }
  to { transform: rotateY(-1turn); }
}

.phone__camera {
  position: absolute;
  top: 28px;
  left: 24px;
  width: 88px;
  height: 88px;
  border: 1px solid #5b6064;
  border-radius: 20px;
  background: #23272a;
  box-shadow: 0 3px 12px rgb(0 0 0 / 35%);
  transform: translateZ(2px);
}

.phone__camera i {
  position: absolute;
  left: 10px;
  width: 30px;
  height: 30px;
  border: 5px solid #111315;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #454c58 0 8%, #121722 30%, #020304 68%);
  box-shadow: 0 0 0 1px #62686d;
}

.phone__camera i:first-child { top: 9px; }
.phone__camera i:nth-child(2) { bottom: 9px; }

.phone__camera span {
  position: absolute;
  top: 50%;
  right: 10px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #d7d1bc;
  transform: translateY(-50%);
}

.phone__front {
  position: absolute;
  z-index: 2;
  inset: 0;
  overflow: hidden;
  padding: 8px;
  border: 1px solid #363a3d;
  border-radius: 44px;
  background: #151719;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  transform: translateZ(0.2px);
}

.phone__front::before {
  position: absolute;
  z-index: 3;
  top: 15px;
  left: 50%;
  width: 32%;
  height: 24px;
  border-radius: 999px;
  background: #050607;
  content: '';
  transform: translateX(-50%);
}

.phone__rail {
  position: absolute;
  z-index: 3;
  left: 0;
  width: 11px;
  height: 58px;
  border: 0;
  border-radius: 999px;
  background: #1d2022;
  box-shadow: inset 0 0 0 0.35px rgb(255 255 255 / 3%);
  pointer-events: none;
  transform: translateZ(-23.5px) rotateY(-90deg);
  transform-origin: 0 50%;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.phone__rail::before {
  position: absolute;
  inset: 0.65px;
  border-radius: inherit;
  background: linear-gradient(90deg, #202325 0%, #292c2e 50%, #202325 100%);
  box-shadow: inset 0 0 0 0.35px rgb(255 255 255 / 4%);
  content: '';
  transform: translateZ(0.16px);
}

.phone__rail--top { top: 107px; }
.phone__rail--bottom { top: 180px; height: 38px; }

.phone__screen {
  position: relative;
  height: 100%;
  overflow: hidden;
  border-radius: 36px;
  color: #10110e;
  background: #f6f6f0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.phone__status {
  height: 42px;
  padding: 12px 20px 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  font-size: 9px;
  font-weight: 700;
}

.phone__status-icons {
  display: flex;
  gap: 2px;
  align-items: end;
}

.phone__status-icons i {
  width: 3px;
  height: 7px;
  display: block;
  border-radius: 1px;
  background: currentColor;
}

.phone__status-icons i:nth-child(2) { height: 5px; opacity: 0.7; }
.phone__status-icons i:nth-child(3) { width: 8px; height: 4px; }

.phone__appbar {
  padding: 4px 18px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.phone__mark,
.phone__avatar {
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 8px;
  font-weight: 800;
}

.phone__mark {
  width: 26px;
  height: 26px;
  color: #f5f5ef;
  background: #11130f;
}

.phone__avatar {
  width: 24px;
  height: 24px;
  border: 1px solid #c9cac3;
}

.phone__content { padding: 12px 18px 24px; }

.phone__kicker {
  margin-bottom: 6px;
  color: #74766e;
  font-size: 9px;
}

.phone__content h3 {
  margin-bottom: 24px;
  font-family: var(--font-serif);
  font-size: 38px;
  font-weight: 420;
  line-height: 0.9;
  letter-spacing: -0.035em;
}

.phone__agent-card {
  min-height: 74px;
  margin-bottom: 24px;
  padding: 12px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 9px;
  border-radius: 15px;
  background: #151713;
  color: #f7f7f1;
  box-shadow: 0 14px 30px rgb(15 17 13 / 20%);
}

.phone__agent-dot {
  width: 23px;
  height: 23px;
  border: 6px solid #dfff5c;
  border-radius: 50%;
  background: #353a23;
}

.phone__agent-card div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.phone__agent-card small,
.phone__task small {
  color: #a7aaa0;
  font-size: 7px;
}

.phone__agent-card strong {
  overflow: hidden;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phone__arrow {
  color: #dfff5c;
  font-size: 13px;
}

.phone__section-heading {
  margin-bottom: 10px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 9px;
}

.phone__section-heading span {
  color: #81837b;
  font-size: 7px;
}

.phone__task {
  min-height: 52px;
  padding: 10px 0;
  display: grid;
  grid-template-columns: 26px 1fr;
  align-items: center;
  gap: 8px;
  border-top: 1px solid #dedfd8;
}

.phone__task > span {
  color: #8b8d84;
  font-family: var(--font-mono);
  font-size: 7px;
}

.phone__task div {
  display: grid;
  gap: 2px;
}

.phone__task strong { font-size: 8px; }
.phone__task.is-primary small { color: #4c5c0c; }

.phone__home {
  position: absolute;
  bottom: 8px;
  left: 50%;
  width: 34%;
  height: 3px;
  border-radius: 999px;
  background: #171813;
  transform: translateX(-50%);
}

@media (max-width: 1180px) {
  .orbit-phone-hero__canvas { scale: 0.86; }
}

@media (max-width: 900px) {
  .orbit-phone-hero { min-height: 520px; }
  .orbit-phone-hero__canvas {
    top: calc(50% + 28px);
    scale: 0.62;
  }
}

@media (max-width: 640px) {
  .orbit-phone-hero { min-height: 400px; }
  .orbit-phone-hero__canvas {
    top: calc(50% + 36px);
    scale: 0.47;
  }
}

@media (max-width: 380px) {
  .orbit-phone-hero { min-height: 340px; }
  .orbit-phone-hero__canvas {
    top: calc(50% + 34px);
    scale: 0.41;
  }
}

@media (prefers-color-scheme: dark) {
  .orbit-phone-hero:not(.orbit-phone-hero--light) .phone__orbit-sphere-layer {
    background: radial-gradient(circle at 32% 28%, #fff 0 24%, #f4f4f2 58%, #d7d8d5 100%);
    box-shadow:
      0 10px 30px rgb(255 255 255 / 10%),
      inset -9px -11px 18px rgb(0 0 0 / 10%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .phone,
  .phone__orbit-anchor,
  .phone__orbit-sphere,
  .phone__orbit-volume,
  .phone__orbit-idle-facing {
    animation: none;
    will-change: auto;
  }

  .phone {
    transform: translate3d(0, 0, 0) scale(1) rotate3d(0.707, -0.707, 0.2, 0deg) rotateX(18deg) rotateY(-32deg) rotateZ(45deg);
  }

  .phone__orbit-anchor--large {
    transform: translate(-50%, -50%) rotateY(45deg) translateZ(var(--phone-orbit-radius));
  }

  .phone__orbit-anchor--small {
    transform: translate(-50%, -50%) rotateY(225deg) translateZ(var(--phone-orbit-radius));
  }

  .phone__orbit-anchor--large .phone__orbit-sphere { transform: rotateY(-45deg); }
  .phone__orbit-anchor--small .phone__orbit-sphere { transform: rotateY(-225deg); }

  .phone__orbit-volume {
    transform: rotateZ(-45deg) rotateY(32deg) rotateX(-18deg) rotate3d(0.707, -0.707, 0.2, 0deg);
  }

  .phone__orbit-idle-facing { transform: none; }
}

@media (forced-colors: active) {
  .phone,
  .phone__front,
  .phone__back,
  .phone__side-panel,
  .phone__screen,
  .phone__orbit-sphere-layer {
    border: 1px solid CanvasText;
  }
}
</style>

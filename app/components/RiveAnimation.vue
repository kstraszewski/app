<script setup lang="ts">
import type { Rive, StateMachineInput } from '@rive-app/webgl2'

type RiveFit = 'cover' | 'contain' | 'fill' | 'fitWidth' | 'fitHeight' | 'none' | 'scaleDown' | 'layout'
type RiveAlignment = 'center' | 'topLeft' | 'topCenter' | 'topRight' | 'centerLeft' | 'centerRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight'

const props = withDefaults(defineProps<{
  src: string
  artboard?: string
  animations?: string | string[]
  stateMachines?: string | string[]
  autoplay?: boolean
  autoBind?: boolean
  fit?: RiveFit
  alignment?: RiveAlignment
  useOffscreenRenderer?: boolean
  label?: string
}>(), {
  autoplay: true,
  autoBind: true,
  fit: 'contain',
  alignment: 'center',
  useOffscreenRenderer: true,
})

const emit = defineEmits<{
  load: [rive: Rive]
  error: [event: Event]
  stateChange: [event: Event]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const failed = ref(false)
let instance: Rive | null = null
let resizeObserver: ResizeObserver | null = null
let loadId = 0

async function initialise() {
  const element = canvas.value
  if (!element || !import.meta.client) return

  const currentLoadId = ++loadId
  instance?.cleanup()
  instance = null
  loading.value = true
  failed.value = false

  const { Alignment, Fit, Layout, Rive } = await import('@rive-app/webgl2')
  if (currentLoadId !== loadId || !canvas.value) return

  instance = new Rive({
    src: props.src,
    canvas: element,
    artboard: props.artboard,
    animations: props.animations,
    stateMachines: props.stateMachines,
    autoplay: props.autoplay,
    autoBind: props.autoBind,
    useOffscreenRenderer: props.useOffscreenRenderer,
    layout: new Layout({
      fit: Fit[fitKey[props.fit]],
      alignment: Alignment[alignmentKey[props.alignment]],
    }),
    onLoad: () => {
      if (!instance || currentLoadId !== loadId) return
      loading.value = false
      instance.resizeDrawingSurfaceToCanvas()
      emit('load', instance)
    },
    onLoadError: (event) => {
      if (currentLoadId !== loadId) return
      loading.value = false
      failed.value = true
      emit('error', event)
    },
    onStateChange: event => emit('stateChange', event),
  })
}

const fitKey: Record<RiveFit, keyof typeof import('@rive-app/webgl2').Fit> = {
  cover: 'Cover', contain: 'Contain', fill: 'Fill', fitWidth: 'FitWidth',
  fitHeight: 'FitHeight', none: 'None', scaleDown: 'ScaleDown', layout: 'Layout',
}

const alignmentKey: Record<RiveAlignment, keyof typeof import('@rive-app/webgl2').Alignment> = {
  center: 'Center', topLeft: 'TopLeft', topCenter: 'TopCenter', topRight: 'TopRight',
  centerLeft: 'CenterLeft', centerRight: 'CenterRight', bottomLeft: 'BottomLeft',
  bottomCenter: 'BottomCenter', bottomRight: 'BottomRight',
}

function stateMachineInputs(name: string): StateMachineInput[] {
  return instance?.stateMachineInputs(name) ?? []
}

defineExpose({
  get rive() { return instance },
  play: (name?: string | string[]) => instance?.play(name),
  pause: (name?: string | string[]) => instance?.pause(name),
  stop: (name?: string | string[]) => instance?.stop(name),
  reset: () => instance?.reset(),
  stateMachineInputs,
})

onMounted(() => {
  resizeObserver = new ResizeObserver(() => instance?.resizeDrawingSurfaceToCanvas())
  if (canvas.value) resizeObserver.observe(canvas.value)
  void initialise()
})

watch(
  () => [props.src, props.artboard, props.animations, props.stateMachines, props.autoplay, props.autoBind, props.fit, props.alignment, props.useOffscreenRenderer],
  () => void initialise(),
  { deep: true },
)

onBeforeUnmount(() => {
  loadId++
  resizeObserver?.disconnect()
  instance?.cleanup()
})
</script>

<template>
  <div class="rive-animation" :aria-busy="loading || undefined">
    <canvas
      ref="canvas"
      class="rive-animation__canvas"
      :role="label ? 'img' : undefined"
      :aria-label="label"
      :aria-hidden="label ? undefined : 'true'"
    />
    <slot v-if="failed" name="error">
      <span class="rive-animation__error" role="alert">Nie udało się wczytać animacji.</span>
    </slot>
  </div>
</template>

<style scoped>
.rive-animation {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.rive-animation__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.rive-animation__error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
</style>

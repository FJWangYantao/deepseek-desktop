<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const props = withDefaults(defineProps<{
  size?: 'xs' | 'sm' | 'md'
  animate?: boolean
  state?: 'idle' | 'active'
}>(), {
  size: 'sm',
  animate: false,
  state: 'idle',
})

const canvasRef = ref<HTMLCanvasElement>()
const scanLineY = ref(-1)
const blinkFrame = ref(0)
const breathingPhase = ref(0)

// 新增动画状态
const wigglePhase = ref(0)
const wiggleActive = ref(false)
const eyeDartDir = ref(0)    // -1=左看 0=正视 +1=右看
const hopY = ref(0)
const blushGlow = ref(0)

let animFrameId = 0
let lastTime = 0

// 各动画定时器
let blinkTimer = 0
let blinkCooldown = 3000 + Math.random() * 4000
let wiggleTimer = 0
let wiggleCooldown = 8000 + Math.random() * 7000
let eyeDartTimer = 0
let eyeDartCooldown = 5000 + Math.random() * 5000
let eyeDartDuration = 0
let hopTimer = 0
let hopCooldown = 12000 + Math.random() * 8000
let hopVelocity = 0
let scanTimer = 0

// ===== 像素数据 =====
const pixels: number[][] = [
  [0, 0, 0, 1, 1, 1, 0, 0, 0],
  [0, 0, 1, 4, 4, 4, 1, 0, 0],
  [0, 1, 4, 2, 4, 2, 4, 1, 0],
  [0, 1, 4, 3, 4, 3, 4, 1, 0],
  [0, 0, 1, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 1, 1, 1, 1, 0, 0],
  [0, 0, 0, 1, 1, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]

const colors: Record<number, string> = {
  0: 'transparent',
  1: '#5C7CFA',
  2: '#FFFFFF',
  3: '#FF8787',
  4: '#1E2235',
}
const blinkMask = [false, false, true, false, false, false, false, false, false]

const containerSize = computed(() => props.size === 'md' ? 56 : props.size === 'xs' ? 36 : 48)
const pixelSize = computed(() => props.size === 'md' ? 5 : props.size === 'xs' ? 3 : 4)
const gridPx = computed(() => pixelSize.value * 9)

function draw(now: number) {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const cSize = containerSize.value
  const pSize = pixelSize.value
  const grid = gridPx.value
  const dpr = window.devicePixelRatio || 1

  canvas.width = cSize * dpr
  canvas.height = cSize * dpr
  canvas.style.width = cSize + 'px'
  canvas.style.height = cSize + 'px'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // 呼吸 + 跳动 + 摇摆
  let scale = 1
  let tx = 0, ty = 0
  if (props.animate) {
    scale = 1 + Math.sin(breathingPhase.value) * 0.04
    tx = Math.sin(wigglePhase.value * 18) * (wiggleActive.value ? 2 : 0.3)
    ty = hopY.value
  }
  const ox = (cSize - grid * scale) / 2
  const oy = (cSize - grid * scale) / 2

  ctx.clearRect(0, 0, cSize, cSize)
  ctx.save()
  ctx.translate(ox + tx, oy + ty)
  ctx.scale(scale, scale)

  const isBlinking = blinkFrame.value > 0
  const activeFlash = props.state === 'active' && props.animate
  const flashOn = activeFlash && Math.floor(now / 350) % 2 === 0

  // 用来绘制替换眼位：先画背景，再画瞳
  const dartCols = eyeDartDir.value !== 0
    ? [3 + eyeDartDir.value, 5 + eyeDartDir.value]
    : null

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const v = pixels[row][col]
      if (v === 0) continue

      let color = colors[v]

      // 眼球移位：原位置填充深屏底
      if (dartCols && row === 2 && (col === 3 || col === 5) && v === 2) {
        color = colors[4] // 覆盖原瞳位为深屏底
      }

      if (isBlinking && blinkMask[row] && v === 2) {
        color = '#4A6A9A'
      }

      if (v === 3) {
        const glow = 1 + blushGlow.value * 0.5
        const r = Math.min(255, Math.round(255 * glow))
        const g = Math.min(255, Math.round(135 * (2 - glow)))
        const b = Math.min(255, Math.round(135 * (2 - glow)))
        color = `rgb(${r},${g},${b})`
      }

      if (flashOn && v === 2) {
        color = '#FF8888'
      }

      ctx.fillStyle = color
      ctx.fillRect(col * pSize, row * pSize, pSize, pSize)
    }

    // 眼球移位：新位置画白瞳
    if (dartCols && row === 2) {
      for (const dc of dartCols) {
        if (dc >= 2 && dc <= 6 && pixels[row][dc] === 4) {
          ctx.fillStyle = isBlinking ? '#4A6A9A' : colors[2]
          ctx.fillRect(dc * pSize, row * pSize, pSize, pSize)
        }
      }
    }
  }

  // 扫描线
  if (scanLineY.value >= 0 && scanLineY.value < 9) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(0, scanLineY.value * pSize, grid, pSize)
  }

  ctx.restore()
}

function tick(now: number) {
  const dt = Math.min(lastTime ? now - lastTime : 16, 50)
  lastTime = now

  if (props.animate) {
    // 呼吸
    breathingPhase.value += dt * 0.0025
    if (breathingPhase.value > Math.PI * 2) breathingPhase.value -= Math.PI * 2

    // 眨眼
    if (blinkFrame.value > 0) {
      blinkFrame.value--
    } else {
      blinkTimer += dt
      if (blinkTimer >= blinkCooldown) {
        blinkFrame.value = 6
        blinkTimer = 0
        blinkCooldown = 3000 + Math.random() * 5000
      }
    }

    // 摇摆 (wiggle)
    if (wiggleActive.value) {
      wigglePhase.value += dt * 0.02
      wiggleTimer += dt
      if (wiggleTimer >= 400) {
        wiggleActive.value = false
        wigglePhase.value = 0
        wiggleTimer = 0
        wiggleCooldown = 8000 + Math.random() * 7000
      }
    } else {
      wiggleTimer += dt
      if (wiggleTimer >= wiggleCooldown) {
        wiggleActive.value = true
        wiggleTimer = 0
      }
    }

    // 眼球转动
    if (eyeDartDuration > 0) {
      eyeDartDuration -= dt
      if (eyeDartDuration <= 0) {
        eyeDartDir.value = 0
        eyeDartCooldown = 4000 + Math.random() * 6000
      }
    } else {
      eyeDartTimer += dt
      if (eyeDartTimer >= eyeDartCooldown) {
        eyeDartDir.value = Math.random() > 0.5 ? -1 : 1
        eyeDartDuration = 500 + Math.random() * 400
        eyeDartTimer = 0
      }
    }

    // 跳动
    if (hopY.value === 0) {
      hopTimer += dt
      if (hopTimer >= hopCooldown) {
        hopVelocity = -3
        hopY.value = 0
        hopTimer = 0
        hopCooldown = 10000 + Math.random() * 10000
      }
    }
    if (hopVelocity !== 0 || hopY.value !== 0) {
      hopY.value += hopVelocity
      hopVelocity += 0.3 // gravity
      if (hopY.value >= 0) {
        hopY.value = 0
        hopVelocity = 0
      }
    }

    // 腮红脉冲
    blushGlow.value += (Math.sin(now * 0.003) * 0.5 + 0.5 - blushGlow.value) * 0.05

    // 扫描线
    if (scanLineY.value >= 0 && scanLineY.value < 9) {
      scanLineY.value += dt * 0.01
      if (scanLineY.value >= 9) scanLineY.value = -1
    }

    if (props.state === 'active') {
      scanTimer += dt
      if (scanTimer >= 8000 + Math.random() * 6000) {
        scanLineY.value = 0
        scanTimer = 0
      }
    }
  }

  draw(now)
  animFrameId = requestAnimationFrame(tick)
}

function triggerScan() {
  scanLineY.value = 0
}

onMounted(() => {
  animFrameId = requestAnimationFrame(tick)
})

onUnmounted(() => {
  cancelAnimationFrame(animFrameId)
})

defineExpose({ triggerScan })
</script>

<template>
  <canvas
    ref="canvasRef"
    class="shrink-0 select-none"
    :class="{ 'cursor-pointer': animate }"
    :style="{ width: containerSize + 'px', height: containerSize + 'px' }"
    @dblclick="animate ? triggerScan() : undefined"
    :title="animate ? 'Replix' : 'Replix'"
  />
</template>

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const defaultElementRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  width: 220,
  height: 48,
  right: 220,
  bottom: 48,
  toJSON: () => ({}),
}

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    if (this instanceof HTMLCanvasElement) {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: 960,
        height: 640,
        right: 960,
        bottom: 640,
        toJSON: () => ({}),
      }
    }
    return defaultElementRect
  },
})

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value() {
    return {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      closePath: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clip: vi.fn(),
      setLineDash: vi.fn(),
      clearRect: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(32 * 32 * 4),
      })),
      putImageData: vi.fn(),
    }
  },
})

Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  configurable: true,
  value: vi.fn(() => 'data:image/png;base64,'),
})

Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', {
  configurable: true,
  value: vi.fn(),
})

Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', {
  configurable: true,
  value: vi.fn(),
})

Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', {
  configurable: true,
  value: vi.fn(() => true),
})

Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
  configurable: true,
  value: vi.fn(),
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

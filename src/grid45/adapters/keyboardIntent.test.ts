import { describe, expect, it, vi } from 'vitest'
import { attachKeyboardIntent, isInteractiveKeyboardTarget } from './keyboardIntent'

function dispatchKeyboardEvent(target: EventTarget, type: 'keydown' | 'keyup', key: string) {
  const event = new KeyboardEvent(type, {
    key,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
}

describe('keyboardIntent', () => {
  it('recognizes interactive keyboard targets', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const button = document.createElement('button')
    const editable = document.createElement('div')
    const plain = document.createElement('div')

    editable.setAttribute('contenteditable', 'true')

    expect(isInteractiveKeyboardTarget(input)).toBe(true)
    expect(isInteractiveKeyboardTarget(textarea)).toBe(true)
    expect(isInteractiveKeyboardTarget(select)).toBe(true)
    expect(isInteractiveKeyboardTarget(button)).toBe(false)
    expect(isInteractiveKeyboardTarget(editable)).toBe(true)
    expect(isInteractiveKeyboardTarget(plain)).toBe(false)
  })

  it('tracks direction priority and clears movement when focus moves into form fields', () => {
    const onIntentChange = vi.fn()
    const detach = attachKeyboardIntent(window, onIntentChange)
    const input = document.createElement('input')
    document.body.append(input)

    dispatchKeyboardEvent(window, 'keydown', 'w')
    dispatchKeyboardEvent(window, 'keydown', 'd')
    dispatchKeyboardEvent(window, 'keyup', 'd')

    input.focus()
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    dispatchKeyboardEvent(input, 'keydown', 's')

    expect(onIntentChange).toHaveBeenCalledWith('north')
    expect(onIntentChange).toHaveBeenCalledWith('east')
    expect(onIntentChange).toHaveBeenCalledWith('stay')
    expect(onIntentChange).not.toHaveBeenCalledWith('south')

    detach()
  })
})

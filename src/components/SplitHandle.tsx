import { useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

const KEY = 'damnedcloud.split'
const MIN = 0.25
const MAX = 0.85
const DEFAULT = 2 / 3
const STEP = 0.05

const clamp = (f: number) => Math.min(MAX, Math.max(MIN, f))

function loadFraction(): number {
  try {
    const f = Number(localStorage.getItem(KEY))
    return f ? clamp(f) : DEFAULT
  } catch {
    return DEFAULT
  }
}

function saveFraction(f: number): void {
  try {
    localStorage.setItem(KEY, String(f))
  } catch {
    /* storage unavailable: the position lasts until the app closes */
  }
}

/** Share of the split area given to the top pane (2/3 at first), remembered across launches. */
export function useSplitFraction() {
  return useState(loadFraction)
}

interface Props {
  /** the box holding top pane, handle and bottom pane: the fraction is measured on its height */
  area: RefObject<HTMLElement>
  fraction: number
  onChange: (fraction: number) => void
}

/** Drag bar between the docked inspector and the list; arrows move it from the keyboard. */
export function SplitHandle({ area, fraction, onChange }: Props) {
  const [dragging, setDragging] = useState(false)

  const fractionAt = (clientY: number) => {
    const box = area.current?.getBoundingClientRect()
    return box && box.height > 0 ? clamp((clientY - box.top) / box.height) : fraction
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onChange(fractionAt(e.clientY))
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    const f = fractionAt(e.clientY)
    onChange(f)
    saveFraction(f)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowUp' ? -STEP : e.key === 'ArrowDown' ? STEP : 0
    if (!delta) return
    e.preventDefault()
    const f = clamp(fraction + delta)
    onChange(f)
    saveFraction(f)
  }

  return (
    <div
      className={`split-handle${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="dividi diff e lista"
      aria-valuemin={MIN * 100}
      aria-valuemax={MAX * 100}
      aria-valuenow={Math.round(fraction * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span />
    </div>
  )
}

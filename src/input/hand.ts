import {vec2, vec2ToString} from "../core/math"
import {MutableMap, RMap} from "../core/rcollect"
import {Disposable} from "../core/util"
import {Mouse} from "./mouse"
import {Touchpad} from "./touchpad"

/** The ID we use for the mouse pointer, which should never be a touch identifier. */
const MOUSE_ID = -999

const position = vec2.create()
const movement = vec2.create()

/** Combines mouse and touchpad input. */
export class Hand implements Disposable {
  readonly mouse :Mouse
  readonly touchpad :Touchpad

  private _pointers :MutableMap<number, Pointer> = MutableMap.local()

  /** Returns a reactive view of the map from ids to active pointers. */
  get pointers () :RMap<number, Pointer> {
    return this._pointers
  }

  constructor (private _canvas :HTMLElement) {
    this.mouse = new Mouse(_canvas)
    this.touchpad = new Touchpad(_canvas)
    _canvas.addEventListener("pointerdown", this._onPointerDown)
    _canvas.addEventListener("pointerup", this._onPointerUp)
  }

  /** Updates the mouse and touchpad state.  Should be called once per frame. */
  update () {
    this.mouse.update()

    if (this.mouse.entered && this.mouse.lastOffset) {
      const pressed = this.mouse.getButtonState(0).current
      const pointer = this._pointers.get(MOUSE_ID)
      if (!(pointer &&
            vec2.exactEquals(pointer.position, this.mouse.lastOffset) &&
            vec2.exactEquals(pointer.movement, this.mouse.movement.current) &&
            pointer.pressed === pressed)) {
        this._pointers.set(MOUSE_ID, new Pointer(vec2.clone(this.mouse.lastOffset),
                                                 vec2.clone(this.mouse.movement.current),
                                                 pressed))
      }
    } else if (this._pointers.has(MOUSE_ID)) {
      this._pointers.delete(MOUSE_ID)
    }

    const rect = this._canvas.getBoundingClientRect()
    for (const touch of this.touchpad.touches.values()) {
      vec2.set(position, touch.clientX - rect.left, touch.clientY - rect.top)
      const pointer = this._pointers.get(touch.identifier)
      if (pointer) {
        vec2.subtract(movement, position, pointer.position)
      } else {
        // @ts-ignore zero missing from type definition
        vec2.zero(movement)
      }
      if (!(pointer &&
            vec2.exactEquals(pointer.position, position) &&
            vec2.exactEquals(pointer.movement, movement))) {
        this._pointers.set(touch.identifier, new Pointer(vec2.clone(position),
                                                         vec2.clone(movement),
                                                         true))
      }
    }
    for (const id of this._pointers.keys()) {
      if (id !== MOUSE_ID && !this.touchpad.touches.has(id)) {
        this._pointers.delete(id)
      }
    }
  }

  dispose () {
    this._canvas.removeEventListener("pointerdown", this._onPointerDown)
    this._canvas.removeEventListener("pointerup", this._onPointerUp)
    this.mouse.dispose()
    this.touchpad.dispose()
  }

  private _onPointerDown = (event :PointerEvent) => {
    this._canvas.setPointerCapture(event.pointerId)
  }

  private _onPointerUp = (event :PointerEvent) => {
    this._canvas.releasePointerCapture(event.pointerId)
  }
}

/** Describes a touch or mouse point. */
export class Pointer {
  constructor (readonly position :vec2 = vec2.create(),
               readonly movement :vec2 = vec2.create(),
               readonly pressed :boolean = false) {}

  toString () {
    const p = this.position, m = this.movement, pd = this.pressed
    return `P${vec2ToString(p, 2)} M${vec2ToString(m, 2)}${pd ? " pressed" : ""}`
  }
}

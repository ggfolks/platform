import {vec2} from "gl-matrix"
import {Disposable} from "../core/util"
import {Mutable, Value} from "../core/react"
import {MutableMap, RMap} from "../core/rcollect"
import {Touch} from "./input"

/** Provides reactive values for mouse state. */
export class Mouse implements Disposable {

  private _buttonStates :Map<number, Mutable<boolean>> = new Map()
  private _movement = Mutable.local(vec2.create())
  private _touches :MutableMap<number, Touch> = MutableMap.local()
  private _lastScreen? :vec2
  private _lastOffset? :vec2
  private _accumulatedMovement = vec2.create()
  private _entered = true

  /** Returns a reactive view of the movement on the current frame. */
  get movement () :Value<vec2> {
    return this._movement
  }

  /** Returns a reactive view of the map from identifiers to active touches. */
  get touches () :RMap<number, Touch> {
    return this._touches
  }

  constructor (private _canvas :HTMLElement) {
    _canvas.addEventListener("mousedown", this._onMouseDown)
    _canvas.addEventListener("mouseup", this._onMouseUp)
    _canvas.addEventListener("mousemove", this._onMouseMove)
    _canvas.addEventListener("mouseenter", this._onMouseEnter)
    _canvas.addEventListener("mouseleave", this._onMouseLeave)
  }

  /** Returns the state value corresponding to the given mouse button. */
  getButtonState (button :number) :Value<boolean> {
    return this._getButtonState(button)
  }

  /** Updates the mouse state.  Should be called once per frame. */
  update () {
    if (!vec2.exactEquals(this._accumulatedMovement, this._movement.current)) {
      this._movement.update(vec2.clone(this._accumulatedMovement))
    }
    // @ts-ignore zero missing in type definition?
    vec2.zero(this._accumulatedMovement)

    if (this._entered && this._lastOffset) {
      const pressed = this._getButtonState(0).current
      const touch = this._touches.get(0)
      if (
        !(touch && vec2.exactEquals(touch.position, this._lastOffset) && touch.pressed === pressed)
      ) {
        this._touches.set(0, new Touch(vec2.clone(this._lastOffset), pressed))
      }
    } else if (this._touches.size !== 0) {
      this._touches.delete(0)
    }
  }

  dispose () {
    this._canvas.removeEventListener("mousedown", this._onMouseDown)
    this._canvas.removeEventListener("mouseup", this._onMouseUp)
    this._canvas.removeEventListener("mousemove", this._onMouseMove)
    this._canvas.removeEventListener("mouseenter", this._onMouseEnter)
    this._canvas.removeEventListener("mouseleave", this._onMouseLeave)
  }

  private _onMouseDown = (event :MouseEvent) => {
    this._getButtonState(event.button).update(true)
  }

  private _onMouseUp = (event :MouseEvent) => {
    this._getButtonState(event.button).update(false)
  }

  private _onMouseMove = (event :MouseEvent) => {
    if (!(this._lastScreen && this._lastOffset)) {
      this._lastScreen = vec2.fromValues(event.screenX, event.screenY)
      this._lastOffset = vec2.fromValues(event.offsetX, event.offsetY)
      return
    }
    this._accumulatedMovement[0] += event.screenX - this._lastScreen[0]
    this._accumulatedMovement[1] += event.screenY - this._lastScreen[1]
    vec2.set(this._lastScreen, event.screenX, event.screenY)
    vec2.set(this._lastOffset, event.offsetX, event.offsetY)
  }

  private _onMouseEnter = (event :MouseEvent) => {
    this._entered = true
  }

  private _onMouseLeave = (event :MouseEvent) => {
    this._entered = false
  }

  private _getButtonState (button :number) {
    let state = this._buttonStates.get(button)
    if (!state) {
      this._buttonStates.set(button, state = Mutable.local<boolean>(false))
    }
    return state
  }
}

import {vec2} from "gl-matrix"
import {Disposable} from "../core/util"
import {Mutable, Value} from "../core/react"

/** Provides reactive values for mouse state. */
export class Mouse implements Disposable {

  private _buttonStates :Map<number, Mutable<boolean>> = new Map()
  private _movement = Mutable.localRef(vec2.create())
  private _lastScreen? :vec2
  private _accumulatedMovement = vec2.create()

  /** Returns the stream of movement values. */
  get movement () :Value<vec2> {
    return this._movement
  }

  constructor (private _canvas :HTMLElement) {
    _canvas.addEventListener("mousedown", this._onMouseDown)
    _canvas.addEventListener("mouseup", this._onMouseUp)
    _canvas.addEventListener("mousemove", this._onMouseMove)
  }

  /** Returns the state value corresponding to the given mouse button. */
  getButtonState (button :number) :Value<boolean> {
    return this._getButtonState(button)
  }

  /** Updates the movement state.  Should be called once per frame. */
  update () {
    if (!vec2.exactEquals(this._accumulatedMovement, this._movement.current)) {
      this._movement.update(vec2.clone(this._accumulatedMovement))
    }
    // @ts-ignore zero missing in type definition?
    vec2.zero(this._accumulatedMovement)
  }

  dispose () {
    this._canvas.removeEventListener("mousedown", this._onMouseDown)
    this._canvas.removeEventListener("mouseup", this._onMouseUp)
    this._canvas.removeEventListener("mousemove", this._onMouseMove)
  }

  private _onMouseDown = (event :MouseEvent) => {
    this._getButtonState(event.button).update(true)
  }

  private _onMouseUp = (event :MouseEvent) => {
    this._getButtonState(event.button).update(false)
  }

  private _onMouseMove = (event :MouseEvent) => {
    if (!this._lastScreen) {
      this._lastScreen = vec2.fromValues(event.screenX, event.screenY)
      return
    }
    this._accumulatedMovement[0] += event.screenX - this._lastScreen[0]
    this._accumulatedMovement[1] += event.screenY - this._lastScreen[1]
    vec2.set(this._lastScreen, event.screenX, event.screenY)
  }

  private _getButtonState (button :number) {
    let state = this._buttonStates.get(button)
    if (!state) {
      this._buttonStates.set(button, state = Mutable.local(false))
    }
    return state
  }
}

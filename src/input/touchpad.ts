import {Disposable} from "../core/util"

/** Provides reactive values for touchpad state. */
export class Touchpad implements Disposable {

  /** Map from identifier to active touch. */
  readonly touches :Map<number, Touch> = new Map()

  constructor (private _canvas :HTMLElement) {
    _canvas.addEventListener("touchstart", this._onTouchStartMove)
    _canvas.addEventListener("touchmove", this._onTouchStartMove)
    _canvas.addEventListener("touchcancel", this._onTouchCancelEnd)
    _canvas.addEventListener("touchend", this._onTouchCancelEnd)
  }

  dispose () {
    this._canvas.removeEventListener("touchstart", this._onTouchStartMove)
    this._canvas.removeEventListener("touchmove", this._onTouchStartMove)
    this._canvas.removeEventListener("touchcancel", this._onTouchCancelEnd)
    this._canvas.removeEventListener("touchend", this._onTouchCancelEnd)
  }

  private _onTouchStartMove = (event :TouchEvent) => {
    event.preventDefault()
    for (let ii = 0; ii < event.changedTouches.length; ii++) {
      const touch = event.changedTouches.item(ii)
      if (touch) this.touches.set(touch.identifier, touch)
    }
  }

  private _onTouchCancelEnd = (event :TouchEvent) => {
    for (let ii = 0; ii < event.changedTouches.length; ii++) {
      const touch = event.changedTouches.item(ii)
      if (touch) this.touches.delete(touch.identifier)
    }
  }
}

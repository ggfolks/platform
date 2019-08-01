import {Disposable} from "../core/util"

/** Provides reactive values for touchpad state. */
export class Touchpad implements Disposable {

  /** Map from identifier to active touch. */
  readonly touches :Map<number, Touch> = new Map()

  constructor (private _canvas :HTMLElement) {
    _canvas.addEventListener("touchstart", this._onTouchEvent)
    _canvas.addEventListener("touchmove", this._onTouchEvent)
    _canvas.addEventListener("touchcancel", this._onTouchEvent)
    _canvas.addEventListener("touchend", this._onTouchEvent)
  }

  dispose () {
    this._canvas.removeEventListener("touchstart", this._onTouchEvent)
    this._canvas.removeEventListener("touchmove", this._onTouchEvent)
    this._canvas.removeEventListener("touchcancel", this._onTouchEvent)
    this._canvas.removeEventListener("touchend", this._onTouchEvent)
  }

  private _onTouchEvent = (event :TouchEvent) => {
    event.preventDefault()
    this.touches.clear()
    for (let ii = 0; ii < event.touches.length; ii++) {
      const touch = event.touches.item(ii)
      if (touch) this.touches.set(touch.identifier, touch)
    }
  }
}

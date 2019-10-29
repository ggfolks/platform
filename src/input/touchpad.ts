import {Disposable, Disposer} from "../core/util"
import {touchEvents} from "./react"

/** Provides reactive values for touchpad state. */
export class Touchpad implements Disposable {
  private _disposer = new Disposer()

  /** Map from identifier to active touch. */
  readonly touches :Map<number, Touch> = new Map()

  constructor () {
    this._disposer.add(touchEvents("touchstart", "touchmove").onEmit(event => {
      event.preventDefault()
      if (event.cancelBubble) return
      for (let ii = 0; ii < event.changedTouches.length; ii++) {
        const touch = event.changedTouches.item(ii)
        if (touch) this.touches.set(touch.identifier, touch)
      }
    }))
    this._disposer.add(touchEvents("touchcancel", "touchend").onEmit(event => {
      for (let ii = 0; ii < event.changedTouches.length; ii++) {
        const touch = event.changedTouches.item(ii)
        if (touch) this.touches.delete(touch.identifier)
      }
    }))
  }

  dispose () {
    this._disposer.dispose()
  }
}

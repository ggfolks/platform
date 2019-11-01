import {vec2} from "gl-matrix"
import {Disposable, Disposer} from "../core/util"
import {Emitter, Mutable, Stream, Value} from "../core/react"
import {mouseEvents} from "./react"

/** Provides reactive values for mouse state. */
export class Mouse implements Disposable {

  private _disposer = new Disposer()
  private _buttonStates :Map<number, Mutable<boolean>> = new Map()
  private _movement = Mutable.local(vec2.create())
  private _doubleClicked :Emitter<void> = new Emitter()
  private _lastScreen? :vec2
  private _lastOffset? :vec2
  private _accumulatedMovement = vec2.create()
  private _entered = true

  /** Returns a reactive view of the movement on the current frame. */
  get movement () :Value<vec2> {
    return this._movement
  }

  /** Returns a reactive stream for double clicks. */
  get doubleClicked () :Stream<void> {
    return this._doubleClicked
  }

  /** Returns the last offset position recorded for the mouse, if any. */
  get lastOffset () {
    return this._lastOffset
  }

  /** Returns whether or not the mouse has entered the canvas. */
  get entered () {
    return this._entered
  }

  constructor () {
    this._disposer.add(mouseEvents("mousedown").onEmit(event => {
      if (!event.cancelBubble) this._getButtonState(event.button).update(true)
    }))
    this._disposer.add(mouseEvents("mouseup").onEmit(event => {
      this._getButtonState(event.button).update(false)
    }))
    this._disposer.add(mouseEvents("dblclick").onEmit(event => {
      if (!event.cancelBubble) this._doubleClicked.emit()
    }))
    this._disposer.add(mouseEvents("mousemove").onEmit(event => {
      if (!(this._lastScreen && this._lastOffset)) {
        this._lastScreen = vec2.fromValues(event.screenX, event.screenY)
        this._lastOffset = vec2.fromValues(event.offsetX, event.offsetY)
        return
      }
      this._accumulatedMovement[0] += event.screenX - this._lastScreen[0]
      this._accumulatedMovement[1] += event.screenY - this._lastScreen[1]
      vec2.set(this._lastScreen, event.screenX, event.screenY)
      vec2.set(this._lastOffset, event.offsetX, event.offsetY)
    }))
    this._disposer.add(mouseEvents("mouseenter").onEmit(event => {
      this._entered = true
    }))
    this._disposer.add(mouseEvents("mouseleave").onEmit(event => {
      this._entered = false
    }))
    this._disposer.add(mouseEvents("contextmenu").onEmit(event => {
      event.preventDefault()
    }))
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
  }

  dispose () {
    this._disposer.dispose()
  }

  private _getButtonState (button :number) {
    let state = this._buttonStates.get(button)
    if (!state) {
      this._buttonStates.set(button, state = Mutable.local<boolean>(false))
    }
    return state
  }
}

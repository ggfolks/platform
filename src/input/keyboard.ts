import {Disposable, Disposer} from "../core/util"
import {Mutable, Value} from "../core/react"
import {keyEvents} from "./react"

/** Provides reactive values for key states. */
export class Keyboard implements Disposable {
  private static _instance :Keyboard

  /** Returns the lazily-created keyboard instance. */
  static get instance () :Keyboard {
    if (!Keyboard._instance) {
      Keyboard._instance = new Keyboard()
    }
    return Keyboard._instance;
  }

  private _disposer = new Disposer()
  private _keyStates :Map<number, Mutable<boolean>> = new Map()

  constructor () {
    this._disposer.add(keyEvents("keydown").onEmit(event => {
      if (!event.cancelBubble) this._getKeyState(event.keyCode).update(true)
    }))
    this._disposer.add(keyEvents("keyup").onEmit(event => {
      this._getKeyState(event.keyCode).update(false)
    }))
  }

  /** Returns the state value corresponding to the given key code. */
  getKeyState (code :number) :Value<boolean> {
    return this._getKeyState(code)
  }

  dispose () {
    this._disposer.dispose()
  }

  private _getKeyState (code :number) :Mutable<boolean> {
    let keyState = this._keyStates.get(code)
    if (!keyState) {
      this._keyStates.set(code, keyState = Mutable.local<boolean>(false))
    }
    return keyState
  }
}

import {Disposable} from "../core/util"
import {Mutable, Value} from "../core/react"

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

  private _keyStates :Map<number, Mutable<boolean>> = new Map()

  constructor () {
    document.addEventListener("keydown", this._onKeyDown)
    document.addEventListener("keyup", this._onKeyUp)
  }

  /** Returns the state value corresponding to the given key code. */
  getKeyState (code :number) :Value<boolean> {
    return this._getKeyState(code)
  }

  dispose () {
    document.removeEventListener("keydown", this._onKeyDown)
    document.removeEventListener("keyup", this._onKeyUp)
  }

  private _onKeyDown = (event :KeyboardEvent) => {
    if (!event.cancelBubble) this._getKeyState(event.keyCode).update(true)
  }

  private _onKeyUp = (event :KeyboardEvent) => {
    this._getKeyState(event.keyCode).update(false)
  }

  private _getKeyState (code :number) :Mutable<boolean> {
    let keyState = this._keyStates.get(code)
    if (!keyState) {
      this._keyStates.set(code, keyState = Mutable.local<boolean>(false))
    }
    return keyState
  }
}

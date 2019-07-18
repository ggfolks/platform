import {rect, vec2} from "../core/math"
import {Emitter, Mutable, Value} from "../core/react"
import {Element, ElementFactory, ElementState, MouseInteraction, Sink} from "./element"
import {BoxLikeConfig, BoxLike, BoxStyle} from "./box"

export interface ButtonConfig extends BoxLikeConfig {
  type :"button"
  target :Sink<Button>
  event :any
  style: {normal :BoxStyle, pressed :BoxStyle, disabled :BoxStyle}
}

export class Button extends BoxLike {
  private _pressed = Mutable.local(false)
  private _target :Emitter<any>

  constructor (fact :ElementFactory, parent :Element, readonly config :ButtonConfig) {
    super(fact, parent, config)
    this._target = fact.resolveSink(config.target)
    this._pressed.onValue(_ => this._state.update(this.computeState))
  }

  get pressed () :Value<boolean> { return this._pressed }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    if (event.button !== 0) return undefined
    this._pressed.update(true)
    return {
      move: (event, pos) => this._pressed.update(rect.contains(this.bounds, pos)),
      release: () => {
        this._pressed.update(false)
        if (rect.contains(this.bounds, pos)) this._target.emit(this.config.event)
      },
      cancel: () => this._pressed.update(false)
    }
  }

  protected get computeState () :ElementState {
    const state = this.enabled.current ? (this._pressed.current ? "pressed" : "normal") : "disabled"
    // see Element.computeState for why we have to downcast
    return state as ElementState
  }
}

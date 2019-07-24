import {rect, vec2} from "../core/math"
import {Emitter, Mutable, Value} from "../core/react"
import {Control, ControlConfig, Element, ElementContext, MouseInteraction} from "./element"

export interface ButtonConfig extends ControlConfig {
  type :"button"
  target :string|Emitter<Button>
  event :any
}

const ButtonStyleScope = {id: "button", states: ["normal", "disabled", "pressed"]}

export class Button extends Control {
  protected readonly _pressed = Mutable.local(false)
  protected readonly target :Emitter<any>

  constructor (ctx :ElementContext, parent :Element, readonly config :ButtonConfig) {
    super(ctx, parent, config)
    this.target = ctx.resolveModel(config.target)
    this._pressed.onValue(_ => this._state.update(this.computeState))
  }

  get styleScope () { return ButtonStyleScope }
  get pressed () :Value<boolean> { return this._pressed }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    if (event.button !== 0) return undefined
    this._pressed.update(true)
    return {
      move: (event, pos) => this._pressed.update(rect.contains(this.bounds, pos)),
      release: () => {
        this._pressed.update(false)
        if (rect.contains(this.bounds, pos)) this.target.emit(this.config.event)
      },
      cancel: () => this._pressed.update(false)
    }
  }

  protected get computeState () {
    return this.enabled.current ? (this._pressed.current ? "pressed" : "normal") : "disabled"
  }
}

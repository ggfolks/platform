import {rect, vec2} from "../core/math"
import {Mutable, Value} from "../core/react"
import {Action, Spec} from "./model"
import {Control, ControlConfig, Element, ElementContext, MouseInteraction} from "./element"

export interface ButtonConfig extends ControlConfig {
  type :"button"
  onClick :Spec<Action>
}

const ButtonStyleScope = {id: "button", states: ["normal", "disabled", "focused", "pressed"]}

export class Button extends Control {
  protected readonly _pressed = Mutable.local(false)
  protected readonly onClick :Action

  constructor (ctx :ElementContext, parent :Element, readonly config :ButtonConfig) {
    super(ctx, parent, config)
    this.onClick = ctx.model.resolve(config.onClick)
    this._pressed.onValue(_ => this._state.update(this.computeState))
  }

  get styleScope () { return ButtonStyleScope }
  get pressed () :Value<boolean> { return this._pressed }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    if (event.button !== 0) return undefined
    this._pressed.update(true)
    this.focus()
    return {
      move: (event, pos) => this._pressed.update(rect.contains(this.bounds, pos)),
      release: () => {
        this._pressed.update(false)
        if (rect.contains(this.bounds, pos)) this.onClick()
      },
      cancel: () => this._pressed.update(false)
    }
  }

  protected get computeState () {
    return this._pressed.current ? "pressed" : super.computeState
  }
}

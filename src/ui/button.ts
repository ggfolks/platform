import {dim2, rect, vec2} from "../core/math"
import {Mutable, Value} from "../core/react"
import {Action, NoopAction, Spec} from "./model"
import {Control, Element, PointerInteraction} from "./element"

export interface ButtonConfig extends Control.Config {
  type :"button"
  onClick? :Spec<Action>
}

export const ButtonStates = [...Control.States, "pressed"]
const ButtonStyleScope = {id: "button", states: ButtonStates}

export abstract class AbstractButton extends Control {
  protected readonly _pressed = Mutable.local(false)

  constructor (ctx :Element.Context, parent :Element, config :Control.Config) {
    super(ctx, parent, config)
    this.recomputeStateOnChange(this._pressed)
  }

  get pressed () :Value<boolean> { return this._pressed }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    this._pressed.update(true)
    this.focus()
    into.push({
      move: (event, pos) => {
        this._pressed.update(rect.contains(this.hitBounds, pos))
        return false
      },
      release: () => {
        this._pressed.update(false)
        if (rect.contains(this.hitBounds, pos)) this.onClick()
      },
      cancel: () => this._pressed.update(false)
    })
  }

  protected get customStyleScope () { return ButtonStyleScope }

  protected get computeState () {
    // meh, this can be called before our constructor runs...
    const pressed = (this._pressed  && this._pressed.current)
    return this.enabled.current && pressed ? "pressed" : super.computeState
  }

  protected abstract onClick () :void
}

export class Button extends AbstractButton {
  protected readonly _onClick :Action

  constructor (ctx :Element.Context, parent :Element, config :ButtonConfig) {
    super(ctx, parent, config)
    this._onClick = ctx.model.resolveActionOr(config.onClick, NoopAction)
  }

  protected actionSpec (config :Control.Config) { return (config as ButtonConfig).onClick }

  protected onClick () { this._onClick() }
}

export interface ToggleConfig extends Control.Config {
  type :"toggle"
  checked :Spec<Value<boolean>>
  onClick? :Spec<Action>
  checkedContents? :Element.Config
}

function injectViz (cfg :Element.Config, visible :Spec<Value<boolean>>) :Element.Config {
  return {...cfg, visible}
}

export class Toggle extends Control {
  readonly onClick :Action
  readonly checkedContents? :Element

  constructor (ctx :Element.Context, parent :Element,
               readonly config :ToggleConfig,
               readonly checked :Value<boolean> = ctx.model.resolveOr(
                 config.checked,
                 Value.constant<boolean>(false),
               )) {
    super(ctx, parent,
          // if we have a special checked contents element, bind visibility of our "not" checked
          // (normal) contents to the opposite of our checked value
          config.checkedContents ?
          {...config, contents: injectViz(config.contents, checked.map(c => !c))} :
          config)
    this.invalidateOnChange(this.checked)
    this.onClick = ctx.model.resolveOr(config.onClick, NoopAction)
    if (config.checkedContents) this.checkedContents = ctx.elem.create(
      ctx, this, injectViz(config.checkedContents, checked))
  }

  applyToChildren (op :Element.Op) {
    super.applyToChildren(op)
    if (this.checkedContents) op(this.checkedContents)
  }
  queryChildren<R> (query :Element.Query<R>) {
    return super.queryChildren(query) || (this.checkedContents && query(this.checkedContents))
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :Element.Op) {
    const applied = super.applyToContaining(canvas, pos, op)
    if (applied && this.checkedContents) this.checkedContents.applyToContaining(canvas, pos, op)
    return applied
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    this.focus()
    into.push({
      move: (event, pos) => false,
      release: () => {
        if (rect.contains(this.hitBounds, pos)) this.onClick()
      },
      cancel: () => {}
    })
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    super.computePreferredSize(hintX, hintY, into)
    if (this.checkedContents) {
      const cpsize = this.checkedContents.preferredSize(hintX, hintY)
      into[0] = Math.max(into[0], cpsize[0])
      into[1] = Math.max(into[1], cpsize[1])
    }
  }

  protected relayout () {
    super.relayout()
    if (this.checkedContents) this.checkedContents.setBounds(this.bounds)
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    if (this.checked.current && this.checkedContents) this.checkedContents.render(canvas, region)
    else this.contents.render(canvas, region)
  }
}

export const ButtonCatalog :Element.Catalog = {
  "button": (ctx, parent, config) => new Button(ctx, parent, config as ButtonConfig),
  "toggle": (ctx, parent, config) => new Toggle(ctx, parent, config as ToggleConfig),
}

import {dim2, rect, vec2} from "../core/math"
import {Mutable, Value} from "../core/react"
import {Action, NoopAction, Spec} from "./model"
import {Control, ControlConfig, ControlStates, Element, ElementConfig, ElementContext,
        ElementOp, ElementQuery, PointerInteraction} from "./element"

export interface ButtonConfig extends ControlConfig {
  type :"button"
  onClick? :Spec<Action>
}

export const ButtonStates = [...ControlStates, "pressed"]
const ButtonStyleScope = {id: "button", states: ButtonStates}

export abstract class AbstractButton extends Control {
  protected readonly _pressed = Mutable.local(false)

  constructor (ctx :ElementContext, parent :Element, config :ControlConfig) {
    super(ctx, parent, config)
    this.recomputeStateOnChange(this._pressed)
  }

  get styleScope () { return ButtonStyleScope }
  get pressed () :Value<boolean> { return this._pressed }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    if (
      event instanceof MouseEvent && event.button !== 0 ||
      !this.visible.current ||
      !this.enabled.current
    ) {
      return undefined
    }
    this._pressed.update(true)
    this.focus()
    return {
      move: (event, pos) => this._pressed.update(rect.contains(this.hitBounds, pos)),
      release: () => {
        this._pressed.update(false)
        if (rect.contains(this.hitBounds, pos)) this.onClick()
      },
      cancel: () => this._pressed.update(false)
    }
  }

  protected get computeState () {
    // meh, this can be called before our constructor runs...
    const pressed = (this._pressed  && this._pressed.current)
    return this.enabled.current && pressed ? "pressed" : super.computeState
  }

  protected abstract onClick () :void
}

export class Button extends AbstractButton {
  protected readonly _onClick :Action

  constructor (ctx :ElementContext, parent :Element, config :ButtonConfig) {
    super(ctx, parent, config)
    this._onClick = ctx.model.resolveAction(config.onClick, NoopAction)
  }

  protected actionSpec (config :ControlConfig) { return (config as ButtonConfig).onClick }

  protected onClick () { this._onClick() }
}

export interface ToggleConfig extends ControlConfig {
  type :"toggle"
  checked :Spec<Value<boolean>>
  onClick? :Spec<Action>
  checkedContents? :ElementConfig
}

function injectViz (cfg :ElementConfig, visible :Spec<Value<boolean>>) :ElementConfig {
  return {...cfg, visible}
}

export class Toggle extends Control {
  readonly onClick :Action
  readonly checkedContents? :Element

  constructor (ctx :ElementContext, parent :Element,
               readonly config :ToggleConfig,
               readonly checked :Value<boolean> = ctx.model.resolve(
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
    this.onClick = ctx.model.resolve(config.onClick, NoopAction)
    if (config.checkedContents) this.checkedContents = ctx.elem.create(
      ctx, this, injectViz(config.checkedContents, checked))
  }

  applyToChildren (op :ElementOp) {
    super.applyToChildren(op)
    if (this.checkedContents) op(this.checkedContents)
  }
  queryChildren<R> (query :ElementQuery<R>) {
    return super.queryChildren(query) || (this.checkedContents && query(this.checkedContents))
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :ElementOp) {
    const applied = super.applyToContaining(canvas, pos, op)
    if (applied && this.checkedContents) this.checkedContents.applyToContaining(canvas, pos, op)
    return applied
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    if (event instanceof MouseEvent && event.button !== 0) return undefined
    this.focus()
    return {
      move: (event, pos) => {},
      release: () => {
        if (rect.contains(this.hitBounds, pos)) this.onClick()
      },
      cancel: () => {}
    }
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

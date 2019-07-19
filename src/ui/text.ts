import {dim2} from "../core/math"
import {Subject, Value} from "../core/react"
import {Element, ElementConfig, ElementContext, ElementStyle, Prop} from "./element"
import {FontConfig, Span, EmptySpan} from "./style"
import {PaintConfig, ShadowConfig, makePaint} from "./style"

/** Defines the styles that apply to [[Label]]. */
export interface LabelStyle extends ElementStyle {
  font :FontConfig
  fill? :PaintConfig
  stroke? :PaintConfig
  shadow? :ShadowConfig
}

/** Defines configuration for [[Label]]. */
export interface LabelConfig extends ElementConfig {
  type :"label"
  text :Prop<string>
  style : {normal :LabelStyle, disabled :LabelStyle}
}

/** Displays styled text. */
export class Label extends Element {
  readonly text :Value<string>
  private span = this.observe(EmptySpan)

  constructor (ctx :ElementContext, parent :Element, readonly config :LabelConfig) {
    super(ctx, parent, config)
    this.text = ctx.resolveProp(config.text)
    this.noteDependentValue(this.text)
    this._state.onValue(state => {
      const style = this.config.style[state]
      const fillS = style.fill ? makePaint(ctx, style.fill) : Value.constant(undefined)
      const strokeS = style.stroke ? makePaint(ctx, style.stroke) : Value.constant(undefined)
      this.span.observe(Subject.join3(this.text, fillS, strokeS).map(
        ([text, fill, stroke]) => new Span(text, style.font, fill, stroke, style.shadow)))
    })
  }

  render (canvas :CanvasRenderingContext2D) {
    this.span.current.render(canvas, this.x, this.y)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.span.current.size)
  }

  protected relayout () {} // nothing needed
}

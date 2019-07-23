import {dim2} from "../core/math"
import {Mutable, Subject, Value} from "../core/react"
import {Element, ElementConfig, ElementContext, ElementStyle} from "./element"
import {Spec, FontConfig, PaintConfig, ShadowConfig, Span, EmptySpan} from "./style"

/** Defines the styles that apply to [[Label]]. */
export interface LabelStyle extends ElementStyle {
  font :Spec<FontConfig>
  fill? :Spec<PaintConfig>
  stroke? :Spec<PaintConfig>
  shadow? :Spec<ShadowConfig>
}

/** Defines configuration for [[Label]]. */
export interface LabelConfig extends ElementConfig {
  type :"label"
  text :string|Value<string>
  style : {normal :LabelStyle, disabled :LabelStyle}
}

/** Displays styled text. */
export class Label extends Element {
  readonly text :Value<string>
  private span = this.observe(EmptySpan)

  constructor (ctx :ElementContext, parent :Element, readonly config :LabelConfig) {
    super(ctx, parent, config)
    this.text = ctx.resolveModel(config.text)
    this.noteDependentValue(this.text)
    this._state.onValue(state => {
      const style = this.config.style[state]
      const fillS = style.fill ? ctx.resolvePaint(style.fill) : Value.constant(undefined)
      const strokeS = style.stroke ? ctx.resolvePaint(style.stroke) : Value.constant(undefined)
      this.span.observe(Subject.join3(this.text, fillS, strokeS).map(([text, fill, stroke]) => {
        const font = ctx.resolveFont(style.font)
        const shadow = ctx.resolveShadowOpt(style.shadow)
        return new Span(text, font, fill, stroke, shadow)
      }))
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

/** Defines the styles that apply to [[Text]]. */
export interface TextStyle extends LabelStyle {
}

/** Defines configuration for [[Text]]. */
export interface TextConfig extends ElementConfig {
  type :"text"
  text :string|Mutable<string>
  style : {normal :TextStyle, focused :TextStyle, disabled :TextStyle}
}

/** Displays a span of editable text. */
export class Text extends Element {
  readonly text :Mutable<string>
  private span = this.observe(EmptySpan)

  constructor (ctx :ElementContext, parent :Element, readonly config :TextConfig) {
    super(ctx, parent, config)
    this.text = ctx.resolveModel(config.text)
  }

  render (canvas :CanvasRenderingContext2D) {
    this.span.current.render(canvas, this.x, this.y)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.span.current.size)
  }

  protected relayout () {} // nothing needed
}

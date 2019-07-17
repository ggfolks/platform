import {dim2} from "../core/math"
import {Value} from "../core/react"
import {Element, ElementConfig, ElementFactory, ElementStyle, Prop} from "./element"
import {FontConfig, Font, NoopDrawFn, makeFont} from "./style"
import {DefaultPaint, PaintConfig, makePaint} from "./style"

export interface LabelStyle extends ElementStyle {
  font :FontConfig
  // TODO: stroke, make both stroke & fill optional & freak out if neither are set?
  fill :PaintConfig
}

export interface LabelConfig extends ElementConfig {
  type :"label"
  text :Prop<string>
  style : {normal :LabelStyle, disabled :LabelStyle}
}

export class Label extends Element {
  readonly text :Value<string>
  private font! :Font
  private fill = this.observe(DefaultPaint)
  private fillFn = NoopDrawFn

  constructor (fact :ElementFactory, parent :Element, readonly config :LabelConfig) {
    super(fact, parent, config)
    this.text = fact.resolveProp(config.text)
    this.noteDependentValue(this.text)
    this._state.onValue(state => {
      const style = this.config.style[state]
      this.font = makeFont(style.font)
      this.fill.observe(makePaint(fact, style.fill))
    })
  }

  render (canvas :CanvasRenderingContext2D) {
    this.fill.current.prepFill(canvas)
    this.fillFn(canvas, this.x, this.y)
  }

  // protected get style () :LabelStyle { return this.config.style[this._state.current] }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const root = this.root
    if (!root) throw new Error(`Cannot compute preferred size on unparented Label`)
    this.fillFn = this.font.measureText(root.ctx, this.text.current, into)
  }

  protected relayout () {
    // TODO: anything?
  }
}

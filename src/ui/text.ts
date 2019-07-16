import {dim2} from "../core/math"
import {Value} from "../core/react"
import {Element, ElementConfig, ElementFactory, Prop} from "./element"
import {FontConfig, Font, NoopDrawFn, makeFont} from "./style"
import {DefaultPaint, PaintConfig, Paint, makePaint} from "./style"

export interface LabelConfig extends ElementConfig {
  type :"label"
  text :Prop<string>
  font :FontConfig
  fill :PaintConfig
}

export class Label extends Element {
  readonly text :Value<string>
  private readonly font :Font
  private fill :Paint = DefaultPaint
  private fillFn = NoopDrawFn

  constructor (fact :ElementFactory, parent :Element, readonly config :LabelConfig) {
    super(parent, config)
    this.font = makeFont(config.font)
    const foo = makePaint(fact, config.fill)
    this._onDispose.push(foo.onValue(fill => {
      this.fill = fill
      this.invalidate()
    }))
    this.text = fact.resolveProp(config.text)
    this.noteDependentValue(this.text)
  }

  render (canvas :CanvasRenderingContext2D) {
    this.fill && this.fill.prepFill(canvas)
    this.fillFn(canvas, this.x, this.y)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const root = this.root
    if (!root) throw new Error(`Cannot compute preferred size on unparented Label`)
    this.fillFn = this.font.measureText(root.ctx, this.text.current, into)
  }

  protected relayout () {
    // TODO: anything?
  }
}

import {dim2} from "../core/math"
import {Value} from "../core/react"
import {Element, ElementConfig, ElementFactory, Prop} from "./element"
import {ColorConfig, ColorSpec, FontConfig, FontSpec, NoopFillFn, makeColorSpec, makeFontSpec}
from "./style"

export interface LabelConfig extends ElementConfig {
  type :"label"
  text :Prop<string>
  font? :FontConfig
  fill? :ColorConfig
}

export class Label extends Element {
  readonly text :Value<string>
  private readonly fontSpec :FontSpec
  private readonly fillSpec :ColorSpec
  private fillFn = NoopFillFn

  constructor (fact :ElementFactory, parent :Element, readonly config :LabelConfig) {
    super(parent)
    this.fontSpec = makeFontSpec(config.font)
    this.fillSpec = makeColorSpec(config.fill)
    this.text = fact.resolveProp(config.text)
  }

  render (canvas :CanvasRenderingContext2D) {
    canvas.fillStyle = this.fillSpec
    this.fillFn(canvas, this.x, this.y)
  }

  protected wasAdded () {
    super.wasAdded()
    this.noteDependentValue(this.text)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const root = this.root
    if (!root) throw new Error(`Cannot compute preferred size on unparented Label`)
    this.fillFn = this.fontSpec.measureText(root.ctx, this.text.current, into)
  }

  protected relayout () {
    // TODO: anything?
  }
}

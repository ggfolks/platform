import {rect, dim2} from "../core/math"
import {Element, ElementConfig, ElementFactory} from "./element"
import {Background, BackgroundConfig} from "./background"

const tmpr = rect.create()

/** Padding and margin are either specified as a single value for all four sides, or as individual
  * values: `[top, right, bottom, left]`. */
export type Insets = number | [number,number,number,number]

function insetLeft (insets :Insets) :number {
  return typeof insets === 'number' ? insets : insets[3]
}
function insetTop (insets :Insets) :number {
  return typeof insets === 'number' ? insets : insets[0]
}
function insetWidth (insets :Insets) :number {
  return typeof insets === 'number' ? (2*insets) : (insets[1] + insets[3])
}
function insetHeight (insets :Insets) :number {
  return typeof insets === 'number' ? (2*insets) : (insets[0] + insets[2])
}
function insetRect (insets :Insets, source :rect, dest :rect) :rect {
  let top :number, right :number, bottom :number, left :number
  if (typeof insets === 'number') {
    left = insets ; right = insets ; top = insets ; bottom = insets
  } else {
    top = insets[0] ; right = insets[1] ; bottom = insets[2], left = insets[3]
  }
  dest[0] = source[0] + left
  dest[1] = source[1] + top
  dest[2] = source[2] - left - right
  dest[3] = source[3] - top - bottom
  return dest
}

/** Defines horizontal alignment values. */
export type HAlign = "left" | "center" | "right" | "stretch"
/** Defines vertical alignment values. */
export type VAlign = "top" | "center" | "bottom" | "stretch"

export function alignOffset (align :HAlign|VAlign, size :number, extent :number) :number {
  switch (align) {
  case    "left":
  case     "top": return 0
  case "stretch": return 0
  case  "center": return (extent - size)/2
  case   "right":
  case  "bottom": return (extent - size)
  }
}

/** Defines configuration for [[Box]] elements. */
export interface BoxConfig extends ElementConfig {
  type :"box"
  padding? :Insets
  margin? :Insets
  background? :BackgroundConfig
  halign? :HAlign
  valign? :VAlign
  child :ElementConfig
  // TODO: border?
}

/** Displays a single child with an optional background, padding, margin, and alignment. */
export class Box extends Element {
  readonly background? :Background
  readonly child :Element

  constructor (fact :ElementFactory, parent :Element, readonly config :BoxConfig) {
    super(parent)
    if (config.background) this.background = fact.createBackground(config.background)
    this.child = fact.createElement(this, config.child)
  }

  render (canvas :CanvasRenderingContext2D) {
    const {padding} = this.config
    if (this.background) {
      const inbounds = padding ? insetRect(padding, this._bounds, tmpr) : this._bounds
      this.background(canvas, inbounds)
    }
    this.child.render(canvas)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const {padding, margin} = this.config
    const edgeWidth = insetWidth(padding || 0) - insetWidth(margin || 0)
    const edgeHeight = insetHeight(padding || 0) - insetHeight(margin || 0)
    const psize = this.child.preferredSize(hintX-edgeWidth, hintY-edgeHeight)
    dim2.set(into, psize[0] + edgeWidth, psize[1] + edgeHeight)
  }

  protected relayout () {
    const {padding, margin} = this.config
    const halign = this.config.halign || "center"
    const valign = this.config.valign || "center"
    let inbounds = rect.copy(tmpr, this._bounds)
    if (padding) inbounds = insetRect(padding, inbounds, tmpr)
    if (margin) inbounds = insetRect(margin, inbounds, tmpr)
    const bwidth = inbounds[2], bheight = inbounds[3]
    const psize = this.child.preferredSize(bwidth, bheight)
    const cwidth = halign == "stretch" ? bwidth : Math.min(bwidth, psize[0])
    const cheight = valign == "stretch" ? bheight : Math.min(bheight, psize[1])
    const edgeLeft = insetLeft(padding || 0) + insetLeft(margin || 0)
    const edgeTop = insetTop(padding || 0) + insetTop(margin || 0)
    const cx = edgeLeft + alignOffset(halign, cwidth, bwidth)
    const cy = edgeTop + alignOffset(valign, cheight, bheight)
    this.child.setBounds(rect.set(tmpr, cx, cy, cwidth, cheight))
  }

  protected revalidate () {
    super.revalidate()
    this.child.validate()
  }
}

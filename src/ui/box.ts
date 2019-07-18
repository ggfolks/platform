import {rect, dim2, vec2} from "../core/math"
import {Subject, Value} from "../core/react"
import {Element, ElementConfig, ElementFactory, ElementStyle} from "./element"
import {ImageResolver, PaintConfig, ShadowConfig, makePaint, prepShadow, resetShadow} from "./style"

const tmpr = rect.create()
const tmpd = dim2.create()

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

//
// Backgrounds and borders

/** A decoration (border or background) is simply a rendering function. The canvas will be
  * translated such that `0, 0` is the upper left of the region into which the decoration should be
  * rendered, and `size` indicates its size. */
type Decoration = (canvas :CanvasRenderingContext2D, size :dim2) => void

const NoopDecor :Decoration = (canvas, size) => {}

export type FitConfig = "start"| "center"  | "end" | "stretch"

/** Defines a background rendered behind a [[Box]]. */
export interface BackgroundConfig {
  /** The paint used to fill this background (if it is a filled background). */
  fill? :PaintConfig
  /** The corner radius if a filled background is used. */
  cornerRadius? :number // TODO: support [ul, ur, lr, ll] radii as well
  /** A shadow rendered behind this background. */
  shadow? :ShadowConfig
  /** Defines an image which is rendered for the background. */
  image? :{
    /** The source URL for the image. Passed to the image resolver. */
    source :string
    /** The fit for the image on both x and y axes. Defaults to `center`. */
    fit? :FitConfig
    /** The fit for the image on the x axis. Supercedes `fit`, defaults to `center`. */
    fitX? :FitConfig
    /** The fit for the image on the y axis. Supercedes `fit`, defaults to `center`. */
    fitY? :FitConfig
  }
}

/** Creates a background based on the supplied `config`. */
export function makeBackground (res :ImageResolver, config :BackgroundConfig) :Subject<Decoration> {
  if (config.fill) return makePaint(res, config.fill).map(fill => {
    const {cornerRadius, shadow} = config
    return (canvas, size) => {
      fill.prepFill(canvas)
      const w = size[0], h = size[1]
      shadow && prepShadow(canvas, shadow)
      if (cornerRadius) {
        const midx = w/2, midy = h/2, maxx = w, maxy = h
        canvas.beginPath()
        canvas.moveTo(0, midy)
        canvas.arcTo(0, 0, midx, 0, cornerRadius)
        canvas.arcTo(maxx, 0, maxx, midy, cornerRadius)
        canvas.arcTo(maxx, maxy, midx, maxy, cornerRadius)
        canvas.arcTo(0, maxy, 0, midy, cornerRadius)
        canvas.closePath()
        canvas.fill()
      } else {
        canvas.fillRect(0, 0, w, h)
      }
      shadow && resetShadow(canvas)
    }
  })
  // TODO
  else if (config.image) return Value.constant(NoopDecor)
  // TODO: log a warning?
  else return Value.constant(NoopDecor)
}

/** Defines a border rendered around a [[Box]]. */
export interface BorderConfig {
  /** The paint used to stroke this border. */
  stroke :PaintConfig
  /** The corner radius of the border. */
  cornerRadius? :number // TODO: support [ul, ur, lr, ll] radii as well
  /** A shadow rendered behind this border. */
  shadow? :ShadowConfig
}

/** Creates a border based on the supplied `config`. */
export function makeBorder (res :ImageResolver, config :BorderConfig) :Subject<Decoration> {
  return makePaint(res, config.stroke).map(stroke => {
    const {cornerRadius, shadow} = config
    return (canvas, size) => {
      stroke.prepStroke(canvas)
      const w = size[0], h = size[1]
      shadow && prepShadow(canvas, shadow)
      if (cornerRadius) {
        const midx = w/2, midy = h/2, maxx = w, maxy = h
        canvas.beginPath()
        canvas.moveTo(0, midy)
        canvas.arcTo(0, 0, midx, 0, cornerRadius)
        canvas.arcTo(maxx, 0, maxx, midy, cornerRadius)
        canvas.arcTo(maxx, maxy, midx, maxy, cornerRadius)
        canvas.arcTo(0, maxy, 0, midy, cornerRadius)
        canvas.closePath()
        canvas.stroke()
      } else {
        canvas.strokeRect(0, 0, w, h)
      }
      shadow && resetShadow(canvas)
    }
  })
}

//
// Box config and element

/** Defines the styles that apply to [[Box]]. */
export interface BoxStyle extends ElementStyle {
  margin? :Insets
  background? :BackgroundConfig
  border? :BorderConfig
  padding? :Insets
  halign? :HAlign
  valign? :VAlign
  // TODO: border?
}

/** Defines configuration for [[Box]]-like elements. */
export interface BoxLikeConfig extends ElementConfig {
  contents :ElementConfig
  style: {normal :BoxStyle, disabled :BoxStyle}
}

/** Defines configuration for [[Box]] elements. */
export interface BoxConfig extends BoxLikeConfig {
  type :"box"
}

export class BoxLike extends Element {
  private background = this.observe(NoopDecor)
  private border = this.observe(NoopDecor)
  readonly contents :Element

  constructor (fact :ElementFactory, parent :Element, readonly config :BoxLikeConfig) {
    super(fact, parent, config)
    this.contents = fact.createElement(this, config.contents)
    this._state.onValue(state => {
      const style = this.config.style[state]
      if (style.background) this.background.observe(makeBackground(fact, style.background))
      else this.background.update(NoopDecor)
      if (style.border) this.border.observe(makeBorder(fact, style.border))
      else this.border.update(NoopDecor)
    })
  }

  render (canvas :CanvasRenderingContext2D) {
    const {margin} = this.style
    const inbounds = margin ? insetRect(margin, this._bounds, tmpr) : this._bounds
    // TODO: should we just do all element rendering translated to the element's origin
    canvas.translate(inbounds[0], inbounds[1])
    this.background.current(canvas, dim2.set(tmpd, inbounds[2], inbounds[3]))
    // TODO: should the border render over the contents?
    this.border.current(canvas, dim2.set(tmpd, inbounds[2], inbounds[3]))
    canvas.translate(-inbounds[0], -inbounds[1])
    this.contents.render(canvas)
  }

  dispose () {
    super.dispose()
    this.contents.dispose()
  }

  protected get style () :BoxStyle { return this.config.style[this._state.current] }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const {padding, margin} = this.style
    const edgeWidth = insetWidth(padding || 0) - insetWidth(margin || 0)
    const edgeHeight = insetHeight(padding || 0) - insetHeight(margin || 0)
    const psize = this.contents.preferredSize(hintX-edgeWidth, hintY-edgeHeight)
    dim2.set(into, psize[0] + edgeWidth, psize[1] + edgeHeight)
  }

  protected relayout () {
    const {padding, margin} = this.style
    const halign = this.style.halign || "center"
    const valign = this.style.valign || "center"
    let inbounds = rect.copy(tmpr, this._bounds)
    if (padding) inbounds = insetRect(padding, inbounds, tmpr)
    if (margin) inbounds = insetRect(margin, inbounds, tmpr)
    const bwidth = inbounds[2], bheight = inbounds[3]
    const psize = this.contents.preferredSize(bwidth, bheight)
    const cwidth = halign == "stretch" ? bwidth : Math.min(bwidth, psize[0])
    const cheight = valign == "stretch" ? bheight : Math.min(bheight, psize[1])
    const edgeLeft = insetLeft(padding || 0) + insetLeft(margin || 0)
    const edgeTop = insetTop(padding || 0) + insetTop(margin || 0)
    const cx = this.x + edgeLeft + alignOffset(halign, cwidth, bwidth)
    const cy = this.y + edgeTop + alignOffset(valign, cheight, bheight)
    this.contents.setBounds(rect.set(tmpr, cx, cy, cwidth, cheight))
  }

  protected revalidate () {
    super.revalidate()
    this.contents.validate()
  }
}

/** Displays a single child with an optional background, padding, margin, and alignment. */
export class Box extends BoxLike {
  constructor (fact :ElementFactory, parent :Element, config :BoxConfig) {
    super(fact, parent, config)
  }

  handleMouseDown (event :MouseEvent, pos :vec2) {
    return rect.contains(this.contents.bounds, pos) ?
      this.contents.handleMouseDown(event, pos) : undefined
  }
}

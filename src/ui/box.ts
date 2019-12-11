import {rect, dim2, vec2} from "../core/math"
import {Mutable} from "../core/react"
import {PMap} from "../core/util"
import {Container, Element} from "./element"
import {BackgroundConfig, BorderConfig, Decoration, Spec, Insets} from "./style"

const tmpr = rect.create()
const tmpd = dim2.create()

/** Defines horizontal alignment values. */
export type HAlign = "left" | "center" | "right" | "stretch"
/** Defines vertical alignment values. */
export type VAlign = "top" | "center" | "bottom" | "stretch"

export function alignOffset (align :HAlign|VAlign, size :number, extent :number) :number {
  switch (align) {
  case    "left":
  case     "top": return 0
  case "stretch": return 0
  case  "center": return Math.round((extent - size)/2)
  case   "right":
  case  "bottom": return (extent - size)
  }
}

//
// Box config and element

/** Defines the styles that apply to [[Box]]. */
export interface BoxStyle {
  margin? :Insets
  background? :Spec<BackgroundConfig>
  border? :Spec<BorderConfig>
  padding? :Insets
  alpha? :number
  halign? :HAlign
  valign? :VAlign
  minWidth? :number
  minHeight? :number
  preferredWidth? :number
  preferredHeight? :number
  cursor? :string
}

/** Defines configuration for [[Box]] elements. */
export interface BoxConfig extends Element.Config {
  type :"box"
  contents :Element.Config
  style :PMap<BoxStyle>
}

/** Displays a single child with an optional background, padding, margin, and alignment. */
export class Box extends Container {
  private readonly styles :Element.Styles<BoxStyle>
  private readonly background = this.observe(Decoration.Noop)
  private readonly border = this.observe(Decoration.Noop)
  private readonly _hovered = Mutable.local(false)
  readonly contents :Element

  constructor (ctx :Element.Context, parent :Element, readonly config :BoxConfig) {
    super(ctx, parent, config)
    const styles = this.styles = ctx.elem.resolveStyles(this, config.style)
    this.contents = ctx.elem.create(ctx, this, config.contents)
    this.background.observe(styles.resolve(
      s => s.background, bg => ctx.style.resolveBackground(bg), Decoration.Noop))
    this.border.observe(styles.resolve(
      s => s.border, border => ctx.style.resolveBorder(border), Decoration.Noop))
    this.disposer.add(this.state.onValue(state => {
      const style = styles.forState(state)
      if (this._hovered.current) {
        if (style.cursor) this.setCursor(this, style.cursor)
        else this.clearCursor(this)
      }
    }))
    this.disposer.add(this._hovered.onChange(hovered => {
      const style = this.styles.current
      if (hovered && style.cursor) this.setCursor(this, style.cursor)
      else this.clearCursor(this)
    }))
  }

  handleMouseEnter (pos :vec2) { this._hovered.update(true) }
  handleMouseLeave (pos :vec2) { this._hovered.update(false) }

  syncStyle (css :CSSStyleDeclaration) {
    const style = this.styles.current
    if (style.padding) css.padding = Insets.toCSS(style.padding)
    if (style.margin) css.margin = Insets.toCSS(style.margin)
    if (style.halign) css.textAlign = style.halign
  }

  private computeInnerBounds (into :rect) :rect {
    const {padding, margin} = this.styles.current
    rect.copy(into, this.bounds)
    if (padding) Insets.rect(padding, into, into)
    if (margin) Insets.rect(margin, into, into)
    return into
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const {padding, margin, minWidth, minHeight, preferredWidth, preferredHeight} =
      this.styles.current
    const edgeWidth = Insets.width(padding || 0) + Insets.width(margin || 0)
    const edgeHeight = Insets.height(padding || 0) + Insets.height(margin || 0)
    const psize = this.contents.preferredSize(hintX-edgeWidth, hintY-edgeHeight)
    dim2.set(into, psize[0] + edgeWidth, psize[1] + edgeHeight)
    if (preferredWidth !== undefined) into[0] = preferredWidth
    if (preferredHeight !== undefined) into[1] = preferredHeight
    if (minWidth !== undefined) into[0] = Math.max(into[0], minWidth)
    if (minHeight !== undefined) into[1] = Math.max(into[1], minHeight)
  }

  protected relayout () {
    const halign = this.styles.current.halign || "center"
    const valign = this.styles.current.valign || "center"
    const inbounds = this.computeInnerBounds(tmpr)
    const bx = inbounds[0], by = inbounds[1], bwidth = inbounds[2], bheight = inbounds[3]
    const psize = this.contents.preferredSize(bwidth, bheight)
    const cwidth = halign == "stretch" ? bwidth : Math.min(bwidth, psize[0])
    const cheight = valign == "stretch" ? bheight : Math.min(bheight, psize[1])
    const cx = bx + alignOffset(halign, cwidth, bwidth)
    const cy = by + alignOffset(valign, cheight, bheight)
    this.contents.setBounds(rect.set(tmpr, cx, cy, cwidth, cheight))
  }

  protected expandBounds (hbounds: rect, rbounds :rect) {
    Decoration.addBounds(rbounds, rbounds, this.background.current, this.border.current)
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const {margin, alpha} = this.styles.current
    const inbounds = margin ? Insets.rect(margin, this.bounds, tmpr) : this.bounds
    if (alpha !== undefined) canvas.globalAlpha = alpha
    // TODO: should we just do all element rendering translated to the element's origin
    canvas.translate(inbounds[0], inbounds[1])
    const bsize = dim2.set(tmpd, inbounds[2], inbounds[3])
    this.background.current.render(canvas, bsize)
    // TODO: should the border render over the contents?
    this.border.current.render(canvas, bsize)
    canvas.translate(-inbounds[0], -inbounds[1])
    super.rerender(canvas, region)
    if (alpha !== undefined) canvas.globalAlpha = 1
  }
}

export const BoxCatalog :Element.Catalog = {
  "box": (ctx, parent, config) => new Box(ctx, parent, config as BoxConfig)
}

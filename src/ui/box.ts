import {rect, dim2, vec2} from "../core/math"
import {Mutable} from "../core/react"
import {PMap} from "../core/util"
import {Element, ElementConfig, ElementContext, ElementOp, ElementQuery} from "./element"
import {NoopDecor, BackgroundConfig, BorderConfig, Spec, Insets,
        addDecorationBounds, insetWidth, insetHeight, insetRect} from "./style"

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
export interface BoxConfig extends ElementConfig {
  type :"box"
  contents :ElementConfig
  style :PMap<BoxStyle>
}

/** Displays a single child with an optional background, padding, margin, and alignment. */
export class Box extends Element {
  private background = this.observe(NoopDecor)
  private border = this.observe(NoopDecor)
  readonly contents :Element
  private readonly _hovered = Mutable.local(false)

  constructor (ctx :ElementContext, parent :Element, readonly config :BoxConfig) {
    super(ctx, parent, config)
    this.contents = ctx.elem.create(ctx, this, config.contents)
    this.background.observe(this.resolveStyle(
      config.style, s => s.background, bg => ctx.style.resolveBackground(bg), NoopDecor))
    this.border.observe(this.resolveStyle(
      config.style, s => s.border, border => ctx.style.resolveBorder(border), NoopDecor))
    this.disposer.add(this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      if (this._hovered.current) {
        if (style.cursor) this.setCursor(this, style.cursor)
        else this.clearCursor(this)
      }
    }))
    this.disposer.add(this._hovered.onChange(hovered => {
      const style = this.style
      if (hovered && style.cursor) this.setCursor(this, style.cursor)
      else this.clearCursor(this)
    }))
  }

  get style () :BoxStyle { return this.getStyle(this.config.style, this.state.current) }

  applyToChildren (op :ElementOp) { op(this.contents) }
  queryChildren<R> (query :ElementQuery<R>) { return query(this.contents) }
  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :ElementOp) {
    const applied = super.applyToContaining(canvas, pos, op)
    if (applied) this.contents.applyToContaining(canvas, pos, op)
    return applied
  }

  handleMouseEnter (pos :vec2) { this._hovered.update(true) }
  handleMouseLeave (pos :vec2) { this._hovered.update(false) }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    return this.contents.maybeHandlePointerDown(event, pos)
  }
  handleWheel (event :WheelEvent, pos :vec2) {
    return this.contents.maybeHandleWheel(event, pos)
  }
  handleDoubleClick (event :MouseEvent, pos :vec2) {
    return this.contents.maybeHandleDoubleClick(event, pos)
  }

  private computeInnerBounds (into :rect) :rect {
    const {padding, margin} = this.style
    rect.copy(into, this.bounds)
    if (padding) insetRect(padding, into, into)
    if (margin) insetRect(margin, into, into)
    return into
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const {padding, margin, minWidth, minHeight, preferredWidth, preferredHeight} = this.style
    const edgeWidth = insetWidth(padding || 0) + insetWidth(margin || 0)
    const edgeHeight = insetHeight(padding || 0) + insetHeight(margin || 0)
    const psize = this.contents.preferredSize(hintX-edgeWidth, hintY-edgeHeight)
    dim2.set(into, psize[0] + edgeWidth, psize[1] + edgeHeight)
    if (preferredWidth !== undefined) into[0] = preferredWidth
    if (preferredHeight !== undefined) into[1] = preferredHeight
    if (minWidth !== undefined) into[0] = Math.max(into[0], minWidth)
    if (minHeight !== undefined) into[1] = Math.max(into[1], minHeight)
  }

  protected relayout () {
    const halign = this.style.halign || "center"
    const valign = this.style.valign || "center"
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
    addDecorationBounds(rbounds, rbounds, this.background.current, this.border.current)
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const {margin, alpha} = this.style
    const inbounds = margin ? insetRect(margin, this.bounds, tmpr) : this.bounds
    if (alpha !== undefined) canvas.globalAlpha = alpha
    // TODO: should we just do all element rendering translated to the element's origin
    canvas.translate(inbounds[0], inbounds[1])
    const bsize = dim2.set(tmpd, inbounds[2], inbounds[3])
    this.background.current.render(canvas, bsize)
    // TODO: should the border render over the contents?
    this.border.current.render(canvas, bsize)
    canvas.translate(-inbounds[0], -inbounds[1])
    this.contents.render(canvas, region)
    if (alpha !== undefined) canvas.globalAlpha = 1
  }
}

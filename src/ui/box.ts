import {rect, dim2, vec2} from "../core/math"
import {Mutable} from "../core/react"
import {PMap} from "../core/util"
import {Element, ElementConfig, ElementContext} from "./element"
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
  halign? :HAlign
  valign? :VAlign
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
  private readonly _expandedBounds = rect.create()
  private readonly _hovered = Mutable.local(false)

  constructor (ctx :ElementContext, parent :Element, readonly config :BoxConfig) {
    super(ctx, parent, config)
    this.contents = ctx.elem.create(ctx, this, config.contents)
    this.disposer.add(this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      if (style.background) this.background.observe(ctx.style.resolveBackground(style.background))
      else this.background.update(NoopDecor)
      if (style.border) this.border.observe(ctx.style.resolveBorder(style.border))
      else this.border.update(NoopDecor)
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

  /** Finds the first child with the specified `type`. */
  findChild (type :string) :Element|undefined {
    return super.findChild(type) || this.contents.findChild(type)
  }

  /** Finds the first child with the specified `tag`. */
  findTaggedChild (tag :string) :Element|undefined {
    return super.findTaggedChild(tag) || this.contents.findTaggedChild(tag)
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    super.applyToContaining(canvas, pos, op)
    this.contents.applyToContaining(canvas, pos, op)
  }
  applyToIntersecting (region :rect, op :(element :Element) => void) {
    super.applyToIntersecting(region, op)
    this.contents.applyToIntersecting(region, op)
  }

  handleMouseEnter (event :MouseEvent, pos :vec2) { this._hovered.update(true) }
  handleMouseLeave (event :MouseEvent, pos :vec2) { this._hovered.update(false) }

  maybeHandlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    return rect.contains(this.expandBounds(this.bounds), pos)
      ? this.handlePointerDown(event, pos)
      : undefined
  }
  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    return this.contents.maybeHandlePointerDown(event, pos)
  }
  maybeHandleWheel (event :WheelEvent, pos :vec2) {
    return rect.contains(this.expandBounds(this.bounds), pos) && this.handleWheel(event, pos)
  }
  handleWheel (event :WheelEvent, pos :vec2) {
    return this.contents.maybeHandleWheel(event, pos)
  }
  maybeHandleDoubleClick (event :MouseEvent, pos :vec2) {
    return rect.contains(this.expandBounds(this.bounds), pos) && this.handleDoubleClick(event, pos)
  }
  handleDoubleClick (event :MouseEvent, pos :vec2) {
    return this.contents.maybeHandleDoubleClick(event, pos)
  }

  dispose () {
    super.dispose()
    this.contents.dispose()
  }

  expandBounds (bounds :rect) :rect {
    addDecorationBounds(this._expandedBounds, bounds, this.background.current, this.border.current)
    return rect.union(
      this._expandedBounds,
      this._expandedBounds,
      this.contents.expandBounds(this.contents.bounds),
    )
  }

  computeInnerBounds (into :rect) :rect {
    const {padding, margin} = this.style
    rect.copy(into, this._bounds)
    if (padding) insetRect(padding, into, into)
    if (margin) insetRect(margin, into, into)
    return into
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const {padding, margin} = this.style
    const edgeWidth = insetWidth(padding || 0) + insetWidth(margin || 0)
    const edgeHeight = insetHeight(padding || 0) + insetHeight(margin || 0)
    const psize = this.contents.preferredSize(hintX-edgeWidth, hintY-edgeHeight)
    dim2.set(into, psize[0] + edgeWidth, psize[1] + edgeHeight)
  }

  protected relayout () {
    const halign = this.style.halign || "center"
    const valign = this.style.valign || "center"
    const inbounds = this.computeInnerBounds(tmpr)
    const bwidth = inbounds[2], bheight = inbounds[3]
    const psize = this.contents.preferredSize(bwidth, bheight)
    const cwidth = halign == "stretch" ? bwidth : Math.min(bwidth, psize[0])
    const cheight = valign == "stretch" ? bheight : Math.min(bheight, psize[1])
    const cx = inbounds[0] + alignOffset(halign, cwidth, bwidth)
    const cy = inbounds[1] + alignOffset(valign, cheight, bheight)
    this.contents.setBounds(rect.set(tmpr, cx, cy, cwidth, cheight))
  }

  protected revalidate () {
    super.revalidate()
    this.contents.validate()
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const {margin} = this.style
    const inbounds = margin ? insetRect(margin, this._bounds, tmpr) : this._bounds
    // TODO: should we just do all element rendering translated to the element's origin
    canvas.translate(inbounds[0], inbounds[1])
    this.background.current.render(canvas, dim2.set(tmpd, inbounds[2], inbounds[3]))
    // TODO: should the border render over the contents?
    this.border.current.render(canvas, dim2.set(tmpd, inbounds[2], inbounds[3]))
    canvas.translate(-inbounds[0], -inbounds[1])
    this.contents.render(canvas, region)
  }
}

import {clamp, dim2, rect, vec2, vec2zero} from "../core/math"
import {Mutable} from "../core/react"
import {Control, ControlConfig, Element, ElementContext, PointerInteraction} from "./element"

export interface PannerConfig extends ControlConfig {
  type :"panner"
}

const transformedPos = vec2.create()
const transformedRegion = rect.create()
const tmpsize = vec2.create(), tmpv = vec2.create(), tmpv2 = vec2.create()

/** Base class for containers that transform their child. */
abstract class TransformedContainer extends Control {
  protected readonly _offset = Mutable.local(vec2.create(), vec2.equals, vec2.copy)

  get offset () { return this._offset ? this._offset.current : vec2zero }
  get scale () :number { return 1 }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    if (rect.contains(this.bounds, pos) && this.visible.current) op(this)
    this.contents.applyToContaining(canvas, this._transformPos(pos), op)
  }
  applyToIntersecting (region :rect, op :(element :Element) => void) {
    if (rect.intersects(this.bounds, region) && this.visible.current) op(this)
    this.contents.applyToIntersecting(this._transformRegion(region), op)
  }

  dirty (region :rect = this.expandBounds(this._bounds), fromChild :boolean = false) {
    if (!fromChild) {
      super.dirty(region, false)
      return
    }
    const {x, y, offset, scale} = this
    transformedRegion[0] = Math.floor(x + scale * (region[0] - x) - offset[0])
    transformedRegion[1] = Math.floor(y + scale * (region[1] - y) - offset[1])
    transformedRegion[2] = Math.ceil(scale * region[2])
    transformedRegion[3] = Math.ceil(scale * region[3])
    super.dirty(transformedRegion, true)
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const transformedPos = this._transformPos(pos)
    const interaction = this.contents.maybeHandlePointerDown(event, transformedPos)
    if (interaction) return {
      move: (event, pos) => interaction.move(event, this._transformPos(pos)),
      release: interaction.release,
      cancel: interaction.cancel,
    }
    if (event instanceof MouseEvent && event.button !== 0) return undefined
    this.root.focus.update(undefined)
    return this.startScroll(event, pos)
  }

  handleDoubleClick (event :MouseEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    return this.contents.maybeHandleDoubleClick(event, transformedPos)
  }

  protected get computeState () :string {
    return this.enabled.current ? "normal" : "disabled"
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const {x, y, offset, scale} = this
    canvas.save()
    canvas.beginPath()
    canvas.rect(x, y, this.width, this.height)
    canvas.clip()
    canvas.translate(x - x*scale - offset[0], y - y*scale - offset[1])
    canvas.scale(scale, scale)
    this.contents.render(canvas, this._transformRegion(region))
    canvas.restore()
  }

  protected relayout () {
    const size = this.contents.preferredSize(this.width, this.height)
    this.contents.setBounds(rect.fromValues(this.x, this.y, size[0], size[1]))
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, hintX, hintY)
  }

  protected startScroll (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    return undefined
  }

  protected get maxX () { return this.contents.width * this.scale - this.width }
  protected get maxY () { return this.contents.height * this.scale - this.height }

  protected _updateOffset (offset :vec2) {
    offset[0] = clamp(offset[0], 0, Math.max(this.maxX, 0))
    offset[1] = clamp(offset[1], 0, Math.max(this.maxY, 0))
    this._offset.update(offset)
  }

  /** Transforms the supplied position into the space of the contents. */
  protected _transformPos (pos :vec2) {
    const {x, y, offset, scale} = this
    const tx = (pos[0] - x + offset[0]) / scale + x
    const ty = (pos[1] - y + offset[1]) / scale + y
    return vec2.set(transformedPos, tx, ty)
  }

  /** Transforms the supplied region into the space of the contents. */
  protected _transformRegion (region :rect) {
    const {x, y, offset, scale} = this
    const tx = (region[0] - x + offset[0]) / scale + x
    const ty = (region[1] - y + offset[1]) / scale + y
    return rect.set(transformedRegion, tx, ty, region[2] / scale, region[3] / scale)
  }
}

/** Provides a pannable, zoomable window onto its contents. */
export class Panner extends TransformedContainer {
  private readonly _scale = Mutable.local(1)
  private _laidOut = false

  constructor (ctx :ElementContext, parent :Element, readonly config :PannerConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this._offset)
    this.invalidateOnChange(this._scale)
  }

  get scale () { return this._scale ? this._scale.current : 1 }

  /** Zooms in or out by the specified delta. */
  zoom (delta :number) {
    this._updateScale(this._scale.current * (1.1 ** delta))
  }

  /** Resets the zoom to 1. */
  resetZoom () {
    this._updateScale(1)
  }

  /** Zooms out to fit the entire element. */
  zoomToFit () {
    const size = this.contents.preferredSize(this.width, this.height)
    this._updateScale(Math.min(1, this.width / size[0], this.height / size[1]))
  }

  handleWheel (event :WheelEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    if (!this.contents.maybeHandleWheel(event, transformedPos)) {
      // TODO: different delta scales for different devices
      this.zoom(event.deltaY > 0 ? -1 : 1)
    }
    return true
  }

  protected startScroll (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const basePos = vec2.clone(pos), baseOffset = vec2.clone(this._offset.current)
    const cancel = () => this.clearCursor(this)
    return {
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        this._updateOffset(vec2.add(tmpv, baseOffset, vec2.subtract(tmpv, basePos, pos)))
      },
      release: cancel,
      cancel,
    }
  }

  private _updateScale (scale :number) {
    const offset = this._offset, size = this.size(tmpsize) as vec2, oscale = this.scale
    const ocenter = vec2.scaleAndAdd(tmpv, offset.current, size, 0.5)
    this._scale.update(scale)
    const ncenter = vec2.scaleAndAdd(tmpv2, offset.current, size, 0.5)
    const nocenter = vec2.scale(tmpv, ocenter, scale/oscale)
    this._updateOffset(vec2.add(tmpv, offset.current, vec2.subtract(tmpv, nocenter, ncenter)))
  }

  protected relayout () {
    super.relayout()
    // scale to fit on first layout if larger than viewport
    if (this._laidOut) return
    this._laidOut = true
    this.zoomToFit()
  }
}

export interface ScrollerConfig extends ControlConfig {
  type :"scroller"
  orient :"horiz"|"vert"
  scrollDelta? :number
}

export class Scroller extends TransformedContainer {

  constructor (ctx :ElementContext, parent :Element, readonly config :ScrollerConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this._offset)
  }

  /** Scrolls to the specified offset from the top/left-most scroll position. */
  scrollTo (offset :number) {
    const horiz = this.config.horiz
    this._updateOffset(vec2.fromValues(horiz ? offset : 0, horiz ? 0 : offset))
  }

  /** Scrolls to the top/left-most scroll position. */
  scrollToStart () { this.scrollTo(0) }

  /** Scrolls to the bottom/right-most scroll position. */
  scrollToEnd () { this.scrollTo(this.config.horiz ? this.maxX : this.maxY) }

  handleWheel (event :WheelEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    if (!this.contents.maybeHandleWheel(event, transformedPos)) {
      const horiz = this.config.orient == "horiz"
      const delta = (this.config.scrollDelta || 10) * (event.deltaY > 0 ? 1 : -1)
      const deltav = vec2.set(tmpv, horiz ? delta : 0, horiz ? 0 : delta)
      this._updateOffset(vec2.add(tmpv, this._offset.current, deltav))
    }
    return true
  }

  protected startScroll (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const basePos = vec2.clone(pos), baseOffset = vec2.clone(this._offset.current)
    const cancel = () => this.clearCursor(this)
    const horiz = this.config.orient == "horiz"
    return {
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        const offset = vec2.add(tmpv, baseOffset, vec2.subtract(tmpv, basePos, pos))
        offset[horiz ? 1 : 0] = 0
        this._updateOffset(offset)
      },
      release: cancel,
      cancel,
    }
  }
}

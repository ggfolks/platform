import {clamp, dim2, rect, vec2, vec2zero} from "../core/math"
import {Mutable} from "../core/react"
import {Control, ControlConfig, Element, ElementContext, PointerInteraction} from "./element"

export interface PannerConfig extends ControlConfig {
  type :"panner"
}

const transformedPos = vec2.create()
const transformedRegion = rect.create()

/** Base class for containers that transform their child. */
abstract class TransformedContainer extends Control {

  get offset () :vec2 { return vec2zero }
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
  private readonly _offset = Mutable.local(vec2.create())
  private readonly _scale = Mutable.local(1)
  private _laidOut = false

  constructor (ctx :ElementContext, parent :Element, readonly config :PannerConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this._offset)
    this.invalidateOnChange(this._scale)
  }

  get offset () { return this._offset ? this._offset.current : vec2zero }
  get scale () { return this._scale ? this._scale.current : 1 }

  handleWheel (event :WheelEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    if (!this.contents.maybeHandleWheel(event, transformedPos)) {
      // TODO: different delta scales for different devices
      this.zoom(event.deltaY > 0 ? -1 : 1)
    }
    return true
  }

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

  protected startScroll (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const basePos = vec2.clone(pos)
    const baseOffset = this._offset.current
    const cancel = () => this.clearCursor(this)
    return {
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        this._updateOffset(
          baseOffset[0] + (basePos[0] - pos[0]),
          baseOffset[1] + (basePos[1] - pos[1]),
        )
      },
      release: cancel,
      cancel,
    }
  }

  private _updateScale (scale :number) {
    const beforeX = (this._offset.current[0] + this.width / 2) / this._scale.current
    const beforeY = (this._offset.current[1] + this.height / 2) / this._scale.current
    this._scale.update(scale)
    const afterX = this._offset.current[0] + this.width / 2
    const afterY = this._offset.current[1] + this.height / 2
    this._updateOffset(
      this._offset.current[0] + (beforeX * this._scale.current) - afterX,
      this._offset.current[1] + (beforeY * this._scale.current) - afterY,
    )
  }

  private _updateOffset (ox :number, oy :number) {
    this._offset.update(vec2.fromValues(
      clamp(ox, 0, Math.max(this.contents.width * this._scale.current - this.width, 0)),
      clamp(oy, 0, Math.max(this.contents.height * this._scale.current - this.height, 0)),
    ))
  }

  protected relayout () {
    super.relayout()
    // scale to fit on first layout if larger than viewport
    if (this._laidOut) return
    this._laidOut = true
    this.zoomToFit()
  }
}

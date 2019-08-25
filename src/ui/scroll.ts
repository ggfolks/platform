import {clamp, dim2, rect, vec2, vec2zero} from "../core/math"
import {Mutable} from "../core/react"
import {Control, ControlConfig, Element, ElementContext, MouseInteraction} from "./element"

/** Provides a scrolling window onto its contents. */
export interface ScrollViewConfig extends ControlConfig {
  type :"scrollview"
}

const transformedPos = vec2.create()
const transformedRegion = rect.create()

export class ScrollView extends Control {
  private _offset = Mutable.local(vec2.create())
  private _scale = Mutable.local(1)
  private _laidOut = false

  constructor (ctx :ElementContext, parent :Element, readonly config :ScrollViewConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this._offset)
    this.invalidateOnChange(this._scale)
  }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    const transformedPos = this._transformPos(pos)
    if (rect.contains(this.contents.bounds, transformedPos)) {
      const interaction = this.contents.handleMouseDown(event, transformedPos)
      if (interaction) return {
        move: (event, pos) => interaction.move(event, this._transformPos(pos)),
        release: interaction.release,
        cancel: interaction.cancel,
      }
    }
    if (event.button !== 0) return undefined
    const basePos = vec2.clone(pos)
    const baseOffset = this._offset.current
    return {
      move: (event, pos) => this._updateOffset(
        baseOffset[0] + (basePos[0] - pos[0]),
        baseOffset[1] + (basePos[1] - pos[1]),
      ),
      release: () => {},
      cancel: () => {},
    }
  }

  /** Transforms the supplied position into the space of the contents. */
  private _transformPos (pos :vec2) {
    return vec2.set(
      transformedPos,
      (pos[0] - this.x + this._offset.current[0]) / this._scale.current + this.x,
      (pos[1] - this.y + this._offset.current[1]) / this._scale.current + this.y,
    )
  }

  handleWheel (event :WheelEvent, pos :vec2) {
    // TODO: different delta scales for different devices
    const delta = event.deltaY > 0 ? -1 : 1
    const beforeX = (this._offset.current[0] + this.width / 2) / this._scale.current
    const beforeY = (this._offset.current[1] + this.height / 2) / this._scale.current
    this._scale.update(this._scale.current * (1.1 ** delta))
    const afterX = this._offset.current[0] + this.width / 2
    const afterY = this._offset.current[1] + this.height / 2
    this._updateOffset(
      this._offset.current[0] + (beforeX * this._scale.current) - afterX,
      this._offset.current[1] + (beforeY * this._scale.current) - afterY,
    )
    return true
  }

  private _updateOffset (ox :number, oy :number) {
    this._offset.update(vec2.fromValues(
      clamp(ox, 0, Math.max(this.contents.width * this._scale.current - this.width, 0)),
      clamp(oy, 0, Math.max(this.contents.height * this._scale.current - this.height, 0)),
    ))
  }

  dirty (region :rect = this.expandBounds(this._bounds), fromChild :boolean = false) {
    if (!fromChild) {
      super.dirty(region, false)
      return
    }
    // can be called before properties are initialized
    const offset = this._offset ? this._offset.current : vec2zero
    const scale = this._scale ? this._scale.current : 1
    transformedRegion[0] = Math.floor(this.x + scale * (region[0] - this.x) - offset[0])
    transformedRegion[1] = Math.floor(this.y + scale * (region[1] - this.y) - offset[1])
    transformedRegion[2] = Math.ceil(scale * region[2])
    transformedRegion[3] = Math.ceil(scale * region[3])
    super.dirty(transformedRegion, true)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, hintX, hintY)
  }

  protected relayout () {
    const size = this.contents.preferredSize(this.width, this.height)
    this.contents.setBounds(rect.fromValues(this.x, this.y, size[0], size[1]))

    // scale to fit on first layout if larger than viewport
    if (this._laidOut) return
    this._laidOut = true
    if (size[0] <= this.width && size[1] <= this.height) return
    this._scale.update(Math.min(this.width / size[0], this.height / size[1]))
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    canvas.save()
    canvas.beginPath()
    canvas.rect(this.x, this.y, this.width, this.height)
    canvas.clip()
    const offset = this._offset.current
    const scale = this._scale.current
    canvas.translate(
      this.x - this.x * scale - offset[0],
      this.y - this.y * scale - offset[1],
    )
    canvas.scale(this._scale.current, this._scale.current)
    transformedRegion[0] = (region[0] - this.x + offset[0]) / scale + this.x
    transformedRegion[1] = (region[1] - this.y + offset[1]) / scale + this.y
    transformedRegion[2] = region[2] / scale
    transformedRegion[3] = region[3] / scale
    this.contents.render(canvas, transformedRegion)
    canvas.restore()
  }
}

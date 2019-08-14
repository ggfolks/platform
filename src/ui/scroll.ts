import {clamp, rect, vec2} from "../core/math"
import {Mutable} from "../core/react"
import {Control, ControlConfig, Element, ElementContext, MouseInteraction} from "./element"

/** Provides a scrolling window onto its contents. */
export interface ScrollViewConfig extends ControlConfig {
  type :"scrollview"
}

export class ScrollView extends Control {
  private _offset = Mutable.local(vec2.create())
  private _scale = Mutable.local(1)

  constructor (ctx :ElementContext, parent :Element, readonly config :ScrollViewConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this._offset)
    this.invalidateOnChange(this._scale)
  }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
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

  protected relayout () {
    const size = this.contents.preferredSize(this.width, this.height)
    this.contents.setBounds(rect.fromValues(this.x, this.y, size[0], size[1]))
  }

  protected rerender (canvas :CanvasRenderingContext2D) {
    canvas.save()
    canvas.beginPath()
    canvas.rect(this.x, this.y, this.width, this.height)
    canvas.clip()
    canvas.translate(-this._offset.current[0], -this._offset.current[1])
    canvas.scale(this._scale.current, this._scale.current)
    this.contents.render(canvas)
    canvas.restore()
  }
}

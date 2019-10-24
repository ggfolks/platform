import {NoopRemover} from "../core/util"
import {Interp, Easing} from "../core/interp"
import {clamp, dim2, rect, vec2, vec2zero} from "../core/math"
import {Clock} from "../core/clock"
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
    const clearCursor = () => this.clearCursor(this)
    const basePos = vec2.clone(pos), baseOffset = vec2.clone(this._offset.current)
    return {
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        this._updateOffset(vec2.add(tmpv, baseOffset, vec2.subtract(tmpv, basePos, pos)))
      },
      release: clearCursor,
      cancel: clearCursor,
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

class Anim {
  done = false
  update (clock :Clock, offset :number) { return offset }
}

class TweenAnim extends Anim {
  private elapsed = 0
  private time :number
  private init :number
  private range :number

  constructor (scroller :Scroller, targetOffset :number, readonly interp :Interp) {
    super()
    const init = this.init = scroller.axisOffset
    const range = this.range = targetOffset - init
    this.time = Math.min(range / 1000, 1)
  }

  update (clock :Clock, offset :number) {
    const elapsed = this.elapsed += clock.dt
    const pct = this.interp(elapsed/this.time)
    this.done = pct >= 1
    return this.init + this.range*pct
  }
}

const InertialFriction = 1000
const MinInertialVel = 50

class InertialAnim extends Anim {
  private poshist = [0, 0, 0, 0]
  private timehist = [0, 0, 0, 0]
  private samples = 0
  private vel = 0
  private dir = 0

  private _notePos (pos :number, time :number) {
    const idx = this.samples % this.poshist.length
    this.poshist[idx] = pos
    this.timehist[idx] = time
    this.samples += 1
  }

  constructor (readonly scroller :Scroller) { super() }

  start (pos :number, time :number) { this._notePos(pos, time) }
  move (pos :number, time :number) { this._notePos(pos, time) }
  release (pos :number, time :number) {
    this._notePos(pos, time)
    const {samples, poshist, timehist} = this, window = poshist.length
    const first = samples >= window ? samples % window : 0
    const last = samples >= window ? (samples-1 + window) % window : samples-1
    const deltat = (timehist[last] - timehist[first])/1000 // stamps are in millis
    const deltap = poshist[last] - poshist[first]
    const vel = this.vel = Math.abs(deltap/deltat)
    this.dir = deltap < 0 ? 1 : -1
    this.done = (vel < MinInertialVel)
  }

  update (clock :Clock, offset :number) {
    const vel = this.vel, noff = offset + clock.dt * vel * this.dir
    if (noff <= 0 || noff >= this.scroller.maxAxis) this.done = true
    const nvel = this.vel = vel - InertialFriction * clock.dt
    if (nvel <= 0) this.done = true
    return noff
  }
}

export interface ScrollerConfig extends ControlConfig {
  type :"scroller"
  orient :"horiz"|"vert"
  wheelDelta? :number
  noInertial? :boolean
}

export class Scroller extends TransformedContainer {
  private unanim = NoopRemover

  constructor (ctx :ElementContext, parent :Element, readonly config :ScrollerConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this._offset)
  }

  get axisOffset () { return this.offset[this.horiz ? 0 : 1] }
  get maxAxis () { return this.horiz ? this.maxX : this.maxY }

  /** Scrolls to the specified offset from the top/left-most scroll position. */
  scrollTo (offset :number, animate = true) {
    if (!animate) this._updateAxisOffset(offset)
    else this.setAnim(new TweenAnim(this, offset, Easing.quadIn))
  }

  /** Scrolls to the top/left-most scroll position. */
  scrollToStart (animate = true) { this.scrollTo(0, animate) }

  /** Scrolls to the bottom/right-most scroll position. */
  scrollToEnd (animate = true) { this.scrollTo(this.maxAxis, animate) }

  handleWheel (event :WheelEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    if (!this.contents.maybeHandleWheel(event, transformedPos)) {
      const delta = (this.config.wheelDelta || 10) * (event.deltaY > 0 ? 1 : -1)
      const horiz = this.horiz, deltav = vec2.set(tmpv, horiz ? delta : 0, horiz ? 0 : delta)
      this._updateOffset(vec2.add(tmpv, this._offset.current, deltav))
    }
    return true
  }

  protected setAnim (anim :Anim|undefined) {
    const offset = this._offset, idx = this.horiz ? 0 : 1
    this.unanim()
    if (anim) {
      const unanim = this.unanim = this.root.clock.onEmit(clock => {
        this._updateAxisOffset(anim.update(clock, offset.current[idx]))
        if (anim.done) unanim()
      })
    }
  }

  protected get horiz () :boolean { return this.config.orient == "horiz" }

  protected startScroll (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const clearCursor = () => this.clearCursor(this)
    const oidx = this.horiz ? 0 : 1, basePos = pos[oidx], baseOffset = this._offset.current[oidx]
    this.unanim()
    const anim = this.config.noInertial ? undefined : new InertialAnim(this)
    anim && anim.start(basePos, event.timeStamp)
    return {
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        anim && anim.move(pos[oidx], event.timeStamp)
        const offset = baseOffset + basePos - pos[oidx]
        this._updateAxisOffset(offset)
      },
      release: (event, pos) => {
        anim && anim.release(pos[oidx], event.timeStamp)
        this.setAnim(anim)
        clearCursor()
      },
      cancel: clearCursor,
    }
  }

  protected _updateAxisOffset (offset :number) {
    const horiz = this.horiz
    this._updateOffset(vec2.set(tmpv, horiz ? offset : 0, horiz ? 0 : offset))
  }
}

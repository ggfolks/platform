import {NoopRemover} from "../core/util"
import {Interp, Easing} from "../core/interp"
import {clamp, rect, vec2} from "../core/math"
import {Clock} from "../core/clock"
import {Mutable, Buffer} from "../core/react"
import {Control, Element, PointerInteraction} from "./element"

const transformedPos = vec2.create()
const transformedRegion = rect.create()
const transformedDirty = rect.create()
const tmpsize = vec2.create(), tmpv = vec2.create(), tmpv2 = vec2.create()

/** Base class for containers that transform their child. */
abstract class TransformedContainer extends Control {
  protected readonly _offset = Buffer.wrap(vec2.create())

  get offset () { return this._offset.current }
  get scale () :number { return 1 }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    const contains = this.containsPos(pos)
    if (contains) this.contents.applyToContaining(canvas, this._transformPos(pos), op)
    return contains
  }
  applyToIntersecting (region :rect, op :(element :Element) => void) {
    const intersects = this.intersectsRect(region)
    if (intersects) {
      op(this)
      this.contents.applyToIntersecting(this._transformRegion(region), op)
    }
    return intersects
  }

  dirty (region :rect = this.renderBounds, fromChild? :Element) {
    // we might be called from our super constructor, at which time _offset is not yet initialized
    if (this._offset === undefined) return
    if (!fromChild) {
      super.dirty(region, fromChild)
      return
    }
    const {x, y, offset, scale} = this
    // we use a special temp rect for transforming dirty regions because misbehaving elements can
    // dirty themselves in the middle of rendering which would cause us to stomp on the transformed
    // render region that we pass down to elements during rendering
    transformedDirty[0] = Math.floor(x + scale * (region[0] - x) - offset[0])
    transformedDirty[1] = Math.floor(y + scale * (region[1] - y) - offset[1])
    transformedDirty[2] = Math.ceil(scale * region[2])
    transformedDirty[3] = Math.ceil(scale * region[3])
    if (this.intersectsRect(transformedDirty, true)) super.dirty(transformedDirty, fromChild)
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    const transformedPos = this._transformPos(pos)
    const childIacts :PointerInteraction[] = []
    this.contents.maybeHandlePointerDown(event, transformedPos, childIacts)
    into.push(...childIacts.map(iact => (<PointerInteraction>{
      move: (event, pos) => iact.move(event, this._transformPos(pos)),
      release: iact.release,
      cancel: iact.cancel,
    })))
    this.maybeStartScroll(event, pos, into)
  }
  handleWheel (event :WheelEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    return this.contents.maybeHandleWheel(event, transformedPos)
  }
  handleDoubleClick (event :MouseEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    return this.contents.maybeHandleDoubleClick(event, transformedPos)
  }

  protected get computeState () :string {
    return this.enabled.current ? "normal" : "disabled"
  }

  protected relayout () {
    const size = this.contents.preferredSize(this.width, this.height)
    this.contents.setBounds(rect.fromValues(this.x, this.y, size[0], size[1]))
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

  protected inheritExpandedBounds (hitBounds :rect, renderBounds :rect) {
    // we don't want to inherit the bounds of our children because we hide/transform them
  }

  protected abstract maybeStartScroll (
    event :MouseEvent|TouchEvent,
    pos :vec2,
    into :PointerInteraction[],
  ) :void

  protected get maxX () { return this.contents.width * this.scale - this.width }
  protected get maxY () { return this.contents.height * this.scale - this.height }

  protected toHostCoords<T extends Float32Array> (coords :T, rect :boolean) :T {
    const {x, y, offset, scale} = this
    coords[0] = (coords[0] - x) * scale + x - offset[0]
    coords[1] = (coords[1] - y) * scale + y - offset[1]
    if (rect) {
      coords[2] *= scale
      coords[3] *= scale
    }
    return super.toHostCoords(coords, rect)
  }

  protected _updateOffset (offset :vec2) {
    offset[0] = clamp(offset[0], 0, Math.max(this.maxX, 0))
    offset[1] = clamp(offset[1], 0, Math.max(this.maxY, 0))
    this._offset.updateIf(offset)
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

export interface PannerConfig extends Control.Config {
  type :"panner"
}

/** Provides a pannable, zoomable window onto its contents. */
export class Panner extends TransformedContainer {
  private readonly _scale = Mutable.local(1)
  private _laidOut = false

  constructor (ctx :Element.Context, parent :Element, readonly config :PannerConfig) {
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

  protected maybeStartScroll (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    const clearCursor = () => this.clearCursor(this)
    const basePos = vec2.clone(pos), baseOffset = vec2.clone(this.offset)
    const ClaimDist = 5
    let claimed = false
    into.push({
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        const delta = vec2.subtract(tmpv, basePos, pos)
        if (vec2.length(delta) > ClaimDist) claimed = true
        this._updateOffset(vec2.add(tmpv, baseOffset, delta))
        return claimed
      },
      release: clearCursor,
      cancel: clearCursor,
    })
  }

  private _updateScale (scale :number) {
    const offset = this.offset, size = this.size(tmpsize) as vec2, oscale = this.scale
    const ocenter = vec2.scaleAndAdd(tmpv, offset, size, 0.5)
    this._scale.update(scale)
    const ncenter = vec2.scaleAndAdd(tmpv2, offset, size, 0.5)
    const nocenter = vec2.scale(tmpv, ocenter, scale/oscale)
    this._updateOffset(vec2.add(tmpv, offset, vec2.subtract(tmpv, nocenter, ncenter)))
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
    this.done = (this.time <= 0)
  }

  update (clock :Clock, offset :number) {
    const elapsed = this.elapsed += clock.dt
    const pct = this.interp(elapsed/this.time)
    this.done = pct >= 1
    return this.init + this.range*pct
  }
}

const InertialFriction = 2000
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

export interface ScrollBarConfig extends Control.Config {
  type :"scrollBar"
  alwaysVisible? :boolean
  handle :Element.Config
}

const ScrollBarStyleScope = {id: "scrollBar", states: Control.States}

export class ScrollBar extends Control {
  active = false

  private readonly _handle :Element

  constructor (ctx :Element.Context, parent :Element, readonly config :ScrollBarConfig) {
    super(ctx, parent, config)
    this._handle = ctx.elem.create(ctx, this, config.handle)
  }

  protected get customStyleScope () { return ScrollBarStyleScope }

  applyToChildren (op :Element.Op) {
    super.applyToChildren(op)
    op(this._handle)
  }
  queryChildren<R> (query :Element.Query<R>) {
    return super.queryChildren(query) || query(this._handle)
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :Element.Op) {
    const applied = super.applyToContaining(canvas, pos, op)
    if (applied) this._handle.applyToContaining(canvas, pos, op)
    return applied
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    const scroller = this.requireParent as Scroller
    scroller.handleScrollBarPointerDown(
      event,
      pos,
      into,
      !rect.contains(this._handle.hitBounds, pos),
    )
  }

  protected relayout () {
    super.relayout()

    const scroller = this.requireParent as Scroller
    const hbounds = rect.clone(this.bounds)
    if (scroller.horiz) {
      hbounds[0] += scroller.handleOffset
      hbounds[2] = scroller.handleSize
    } else {
      hbounds[1] += scroller.handleOffset
      hbounds[3] = scroller.handleSize
    }
    this._handle.setBounds(hbounds)
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    this._handle.render(canvas, region)
  }
}

export interface ScrollerConfig extends Control.Config {
  type :"scroller"
  orient :"horiz"|"vert"
  stretchContents? :boolean
  bar? :ScrollBarConfig
  noInertial? :boolean
}

export class Scroller extends TransformedContainer {
  private unanim = NoopRemover

  private readonly _bar? :ScrollBar

  constructor (ctx :Element.Context, parent :Element, readonly config :ScrollerConfig) {
    super(ctx, parent, config)
    this.invalidateOnChange(this._offset)
    if (config.bar) {
      this.disposer.add(this._bar = ctx.elem.create(ctx, this, config.bar) as ScrollBar)
    }
  }

  get axisOffset () { return this.offset[this.horiz ? 0 : 1] }
  get maxAxis () { return this.horiz ? this.maxX : this.maxY }
  get horiz () :boolean { return this.config.orient === "horiz" }

  get handleSize () {
    const idx = this.horiz ? 2 : 3
    const selfSize = this.bounds[idx]
    return Math.round(selfSize * selfSize / Math.max(selfSize, this.contents.bounds[idx]))
  }

  get handleOffset () {
    const idx = this.horiz ? 2 : 3
    const selfSize = this.bounds[idx]
    return Math.round(selfSize * this.axisOffset / Math.max(selfSize, this.contents.bounds[idx]))
  }

  /** Scrolls to the specified offset from the top/left-most scroll position. */
  scrollTo (offset :number, animate = true) {
    if (!animate) this._updateAxisOffset(offset)
    else this.setAnim(new TweenAnim(this, offset, Easing.quadIn))
  }

  /** Scrolls to the top/left-most scroll position. */
  scrollToStart (animate = true) { this.scrollTo(0, animate) }

  /** Scrolls to the bottom/right-most scroll position. */
  scrollToEnd (animate = true) { this.scrollTo(this.maxAxis, animate) }

  applyToChildren (op :Element.Op) {
    super.applyToChildren(op)
    if (this._bar && this._bar.active) op(this._bar)
  }
  queryChildren<R> (query :Element.Query<R>) {
    let result = super.queryChildren(query)
    if (!result && this._bar && this._bar.active) result = query(this._bar)
    return result
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    const contains = super.applyToContaining(canvas, pos, op)
    if (contains && this._bar && this._bar.active) this._bar.applyToContaining(canvas, pos, op)
    return contains
  }
  applyToIntersecting (region :rect, op :(element :Element) => void) {
    const intersects = super.applyToIntersecting(region, op)
    if (intersects && this._bar && this._bar.active) this._bar.applyToIntersecting(region, op)
    return intersects
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    if (this._bar && this._bar.active) {
      const olength = into.length
      this._bar.maybeHandlePointerDown(event, pos, into)
      if (into.length > olength) return
    }
    super.handlePointerDown(event, pos, into)
  }

  handleScrollBarPointerDown (
    event :MouseEvent|TouchEvent,
    pos :vec2,
    into :PointerInteraction[],
    jump :boolean,
  ) {
    const [posIdx, sizeIdx] = this.horiz ? [0, 2] : [1, 3]
    if (jump) {
      const relativePos = pos[posIdx] - this.bounds[posIdx]
      const selfSize = this.bounds[sizeIdx]
      const contentsSize = this.contents.bounds[sizeIdx]
      this._updateAxisOffset(Math.round(relativePos * contentsSize / selfSize - selfSize / 2))
    }
    const clearCursor = () => this.clearCursor(this)
    let lastPos = pos[posIdx]
    into.push({
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        const sizeScale = this.contents.bounds[sizeIdx] / this.bounds[sizeIdx]
        const currentPos = pos[posIdx]
        this._updateAxisOffset(Math.round(this.axisOffset + (currentPos - lastPos) * sizeScale))
        lastPos = currentPos
        return true
      },
      release: clearCursor,
      cancel: clearCursor,
    })
  }

  handleWheel (event :WheelEvent, pos :vec2) {
    const transformedPos = this._transformPos(pos)
    if (!this.contents.maybeHandleWheel(event, transformedPos)) {
      const horiz = this.horiz, deltav = vec2.set(
        tmpv, horiz ? event.deltaY : 0, horiz ? 0 : event.deltaY)
      this._updateOffset(vec2.add(tmpv, this.offset, deltav))
    }
    return true
  }

  protected relayout () {
    const size = this.contents.preferredSize(this.width, this.height)
    const bounds = rect.fromValues(this.x, this.y, size[0], size[1])
    const [posIdx, sizeIdx, offPosIdx, offSizeIdx] = this.horiz ? [0, 2, 1, 3] : [1, 3, 0, 2]
    let maxOffSize = this.bounds[offSizeIdx]
    if (this._bar) {
      if (size[posIdx] > this.bounds[sizeIdx] || this._bar.config.alwaysVisible) {
        const bsize = this._bar.preferredSize(this.width, this.height)
        maxOffSize -= bsize[offPosIdx]
        const bbounds = rect.clone(this.bounds)
        bbounds[offPosIdx] += maxOffSize
        bbounds[offSizeIdx] = bsize[offPosIdx]
        this._bar.setBounds(bbounds)
        this._bar.active = true
        this._bar.invalidate()

      } else this._bar.active = false
    }
    if (this.config.stretchContents) {
      bounds[sizeIdx] = Math.max(this.bounds[sizeIdx], bounds[sizeIdx])
      bounds[offSizeIdx] = maxOffSize
    }
    this.contents.setBounds(bounds)
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    if (this._bar && this._bar.active) this._bar.render(canvas, region)
  }

  protected setAnim (anim :Anim|undefined) {
    const offset = this.offset, idx = this.horiz ? 0 : 1
    this.unanim()
    if (anim && !anim.done) {
      const unanim = this.unanim = this.root.clock.onEmit(clock => {
        this._updateAxisOffset(anim.update(clock, offset[idx]))
        if (anim.done) unanim()
      })
    }
  }

  protected maybeStartScroll (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    if (this._bar) return
    const clearCursor = () => this.clearCursor(this)
    const oidx = this.horiz ? 0 : 1, basePos = pos[oidx], baseOffset = this.offset[oidx]
    this.unanim()
    const anim = this.config.noInertial ? undefined : new InertialAnim(this)
    anim && anim.start(basePos, event.timeStamp)
    const ClaimDist = 5
    let claimed = false
    into.push({
      move: (event, pos) => {
        this.setCursor(this, "all-scroll")
        anim && anim.move(pos[oidx], event.timeStamp)
        this._updateAxisOffset(baseOffset + basePos - pos[oidx])
        if (Math.abs(baseOffset - this.offset[oidx]) > ClaimDist) claimed = true
        return claimed
      },
      release: (event, pos) => {
        anim && anim.release(pos[oidx], event.timeStamp)
        this.setAnim(anim)
        clearCursor()
      },
      cancel: clearCursor,
    })
  }

  protected _updateAxisOffset (offset :number) {
    const horiz = this.horiz
    this._updateOffset(vec2.set(tmpv, horiz ? offset : 0, horiz ? 0 : offset))
  }
}

export const ScrollCatalog :Element.Catalog = {
  "panner": (ctx, parent, cfg) => new Panner(ctx, parent, cfg as PannerConfig),
  "scroller": (ctx, parent, cfg) => new Scroller(ctx, parent, cfg as ScrollerConfig),
  "scrollBar": (ctx, parent, cfg) => new ScrollBar(ctx, parent, cfg as ScrollBarConfig),
}

import {Disposer, log, insertSorted} from "../core/util"
import {dim2, mat2d, rect, vec2, vec2zero} from "../core/math"
import {Color} from "../core/color"
import {Emitter, Stream} from "../core/react"
import {Clock} from "../core/clock"
import {Animator, Anim} from "../core/anim"
import {mouseEvents, touchEvents} from "../input/react"
import {Renderer, Tile} from "./gl"
import {QuadBatch} from "./batch"
import {Transform} from "./transform"

const tmppos = vec2.create(), tmpscale = vec2.create()
const tmpsize = dim2.create(), tmpbounds = rect.create()

const defaultTint = Color.fromRGB(1, 1, 1)

interface Parent {
  trans :Transform
  stage :Stage|undefined
  layerChanged (actor :Actor) :void
  removeActor (actor :Actor, dispose :boolean) :void
}

type ActorEvent = {type: "added", actor :Actor}
                | {type: "removed", actor :Actor}
                | {type: "disposed", actor :Actor}

export abstract class Actor {
  readonly trans = new Transform()
  readonly vel = vec2.create()
  readonly events = new Emitter<ActorEvent>()

  private _layer = 0
  parent :Parent|undefined
  enabled = true
  visible = true

  get requireParent () :Parent {
    const parent = this.parent
    if (parent === undefined) throw new Error(`Parent expected (${this})`)
    return parent
  }

  get stage () { return this.parent ? this.parent.stage : undefined }
  get requireStage () :Stage {
    const stage = this.stage
    if (stage === undefined) throw new Error(`Stage expected (${this})`)
    return stage
  }

  get layer () :number { return this._layer }
  set layer (d :number) {
    this._layer = d
    if (this.parent) this.parent.layerChanged(this)
  }

  mouseToPos (into :vec2, ev :MouseEvent) :vec2 {
    const rect = this.requireStage.renderer.canvas.getBoundingClientRect()
    return this.trans.inverseTransform(
      into, vec2.set(into, ev.clientX-rect.left, ev.clientY-rect.top))
  }

  touchToPos (into :vec2, touch :Touch) :vec2 {
    const rect = this.requireStage.renderer.canvas.getBoundingClientRect()
    return this.trans.inverseTransform(
      into, vec2.set(into, touch.clientX-rect.left, touch.clientY-rect.top))
  }

  delete (dispose = true) { this.requireParent.removeActor(this, dispose) }
  deleteAfter (anim :Animator, time :number, dispose = true) {
    anim.add(Anim.delayedAction(time, () => this.delete(dispose)))
  }

  update (dt :number) {
    if (!this.enabled) return
    const vel = this.vel
    if (vel[0] !== 0 || vel[1] !== 0) this.trans.applyDeltaTranslation(vel, dt)
  }

  abstract render (batch :QuadBatch, txUpdated :boolean) :void

  dispose () {
    this.events.emit({type: "disposed", actor: this})
  }
}

export class Sprite extends Actor {
  tint = Color.clone(defaultTint)

  constructor (readonly tile :Tile) {
    super()
    if (tile === undefined) throw new Error(`Sprite created with undefined tile`)
  }

  readSize (into :dim2 = tmpsize) :dim2 {
    dim2.copy(into, this.tile.size)
    const scale = this.trans.readScale(tmpscale)
    into[0] *= scale[0]
    into[1] *= scale[1]
    return into
  }
  setSize (size :dim2) {
    const tile = this.tile
    this.trans.updateScale(vec2.set(tmpscale, size[0] / tile.size[0], size[1] / tile.size[1]))
  }

  readBounds (into :rect = tmpbounds) :rect {
    const eorig = this.trans.readOrigin(tmppos), eox = eorig[0], eoy = eorig[1]
    const epos = this.trans.readTranslation(tmppos)
    into[0]= epos[0]-eox
    into[1] = epos[1]-eoy
    const tile = this.tile, scale = this.trans.readScale(tmpscale)
    into[2] = tile.size[0] * scale[0]
    into[3] = tile.size[1] * scale[1]
    return into
  }

  contains (pos :vec2) :boolean {
    const x = pos[0], y = pos[1]
    const eorig = this.trans.readOrigin(tmppos), eox = eorig[0], eoy = eorig[1]
    const epos = this.trans.readTranslation(tmppos), ex = epos[0]-eox, ey = epos[1]-eoy
    if (x < ex || y < ey) return false
    const esize = this.readSize()
    if (x > ex+esize[0] || y > ey+esize[1]) return false
    // TODO: other fine grained hit testing?
    return true
  }

  render (batch :QuadBatch, txUpdated :boolean) {
    batch.addTile(this.tile, this.tint, this.trans.data as mat2d, vec2zero, this.tile.size)
    return true
  }
}

export class Group extends Actor implements Parent {
  private actors :Actor[] = []

  addActor (actor :Actor) {
    actor.parent = this
    insertSorted(this.actors, actor, (a, b) => a.layer - b.layer)
    actor.events.emit({type: "added", actor})
  }

  removeActor (actor :Actor, dispose = true) {
    const idx = this.actors.indexOf(actor)
    if (idx < 0) log.warn("Deleted unknown actor?", "group", this, "actor", actor)
    else {
      this.actors.splice(idx, 1)
      actor.parent = undefined
      actor.events.emit({type: "removed", actor})
      if (dispose) actor.dispose()
    }
  }

  layerChanged (actor :Actor) {
    const idx = this.actors.indexOf(actor)
    if (idx < 0) log.warn("Unknown actor changed layer?", "group", this, "actor", actor)
    this.actors.splice(idx, 1)
    insertSorted(this.actors, actor, (a, b) => a.layer - b.layer)
  }

  update (dt :number) {
    for (const actor of this.actors) actor.update(dt)
  }

  render (batch :QuadBatch, txUpdated :boolean) {
    const trans = this.trans
    for (const actor of this.actors) {
      const actorTxUpdated = txUpdated || actor.trans.dirty
      if (actorTxUpdated) actor.trans.updateMatrix(trans)
      if (actor.enabled && actor.visible) actor.render(batch, actorTxUpdated)
    }
  }

  dispose () {
    for (const actor of this.actors) actor.dispose()
  }
}

class RootGroup extends Group {
  constructor (private readonly _stage :Stage) { super() }
  get stage () { return this._stage }
}

type PointerEventType = "start" | "move" | "end" | "cancel"
type PointerEvent = {type :PointerEventType, pos :vec2}

const MaxDt = 1/15

export class Stage {
  private disposer = new Disposer()

  readonly clock :Stream<number> = new Emitter()
  readonly anim = new Animator()
  readonly fxanim = new Animator()
  readonly events = new Emitter<ActorEvent>()
  readonly root = new RootGroup(this)

  constructor (readonly renderer :Renderer) {
    this.clock.onEmit(dt => this.anim.update(dt))
    this.clock.onEmit(dt => this.fxanim.update(dt))
  }

  pointer (root :Actor) :Stream<PointerEvent> {
    return Stream.deriveStream(emit => {
      let mousedown = false
      const mousepos = vec2.create()
      const unmouse = mouseEvents("mousedown", "mousemove", "mouseup").onEmit(ev => {
        switch (ev.type) {
        case "mousedown":
          mousedown = true
          emit({type: "start", pos: root.mouseToPos(mousepos, ev)})
          break
        case "mousemove":
          if (mousedown) emit({type: "move", pos: root.mouseToPos(mousepos, ev)})
          break
        case "mouseup":
          if (mousedown) emit({type: "end", pos: root.mouseToPos(mousepos, ev)})
          mousedown = false
          break
        }
        ev.preventDefault()
      })

      let curtouchid :number|undefined = undefined
      const touchpos = vec2.create()
      const untouch = touchEvents(
        "touchstart", "touchmove", "touchcancel", "touchend"
      ).onEmit(ev => {
        if (curtouchid !== undefined) {
          for (let ii = 0; ii < ev.changedTouches.length; ii++) {
            const touch = ev.changedTouches[ii]
            if (touch.identifier === curtouchid) {
              switch (ev.type) {
              case "touchmove":
                emit({type: "move", pos: root.touchToPos(touchpos, touch)})
                break
              case "touchcancel":
                emit({type: "cancel", pos: root.touchToPos(touchpos, touch)})
                curtouchid = undefined
                break
              case "touchend":
                emit({type: "end", pos: root.touchToPos(touchpos, touch)})
                curtouchid = undefined
                break
              }
              // if we already have a touch in progress, ignore new touches
            }
          }
        } else if (ev.type === "touchstart") {
          const st = ev.changedTouches[0]
          curtouchid = st.identifier
          emit({type: "start", pos: root.touchToPos(touchpos, st)})
        }
        ev.preventDefault()
      })

      return () => { unmouse() ; untouch() }
    })
  }

  update (clock :Clock) {
    const eclock = this.clock as Emitter<number>
    let dt = Math.min(clock.dt, 10*MaxDt)
    while (dt > MaxDt) {
      this.root.update(MaxDt)
      eclock.emit(MaxDt)
      dt -= MaxDt
    }
    if (dt > 0) {
      this.root.update(dt)
      eclock.emit(dt)
    }
  }

  render (batch :QuadBatch) {
    const root = this.root, txUpdated = root.trans.dirty
    if (txUpdated) root.trans.updateMatrix()
    if (root.enabled && root.visible) root.render(batch, txUpdated)
  }

  dispose () {
    this.root.dispose()
    this.disposer.dispose()
  }
}

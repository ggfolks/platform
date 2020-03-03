import {Disposer, Noop, Remover, addListener, log, insertSorted} from "../core/util"
import {dim2, mat2d, rect, vec2, vec2zero} from "../core/math"
import {Color} from "../core/color"
import {Emitter, Stream} from "../core/react"
import {Clock} from "../core/clock"
import {Animator, Anim} from "../core/anim"
import {GestureHandler, InteractionManager, PointerInteraction} from "../input/interact"
import {mouseEvents, touchEvents} from "../input/react"
import {Renderer, Tile} from "./gl"
import {QuadBatch} from "./batch"
import {Transform} from "./transform"

const tmppos = vec2.create(), tmpscale = vec2.create(), contpos = vec2.create()
const tmpsize = dim2.create(), tmpbounds = rect.create()

const defaultTint = Color.fromRGB(1, 1, 1)

interface Parent {
  trans :Transform
  stage :Stage|undefined
  layerChanged (actor :Actor) :void
  removeActor (actor :Actor, dispose :boolean) :void
}

type ActorEvent = "added" | "removed" | "staged" | "unstaged"
                | "willRender" | "didRender" | "disposed"

export abstract class Actor {
  readonly trans = new Transform()
  readonly vel = vec2.create()
  readonly events = new Emitter<ActorEvent>()

  private _ghandlers? :GestureHandler[]
  private _layer = 0
  parent :Parent|undefined
  enabled = true
  visible = true

  get interactive () { return this.visible && this.enabled }

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

  toLocal (x :number, y :number, into :vec2) :vec2 {
    const rect = this.requireStage.renderer.canvas.getBoundingClientRect()
    return this.trans.inverseTransform(into, vec2.set(into, x-rect.left, y-rect.top))
  }

  addGestureHandler (handler :GestureHandler) :Remover {
    let handlers = this._ghandlers
    if (!handlers) {
      handlers = this._ghandlers = []
      this.stage && this.listenGestures(this.stage)
    }
    return addListener(handlers, handler)
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    const handlers = this._ghandlers
    if (handlers) {
      this.trans.inverseTransform(tmppos, pos) // convert from stage to actor coords
      for (const gh of handlers) {
        const iact = gh(event, tmppos)
        if (iact) {
          iact.toLocal = (x, y, ipos) => this.toLocal(x, y, ipos)
          into.push(iact)
        }
      }
    }
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

  wasStaged (stage :Stage) {
    this.events.emit("staged")
    if (this._ghandlers) this.listenGestures(stage)
  }
  willUnstage (stage :Stage) {
    this.events.emit("unstaged")
  }

  render (batch :QuadBatch, txUpdated :boolean) {
    this.events.emit("willRender")
    this.renderImpl(batch, txUpdated)
    this.events.emit("didRender")
  }

  abstract renderImpl (batch :QuadBatch, txUpdated :boolean) :void

  dispose () {
    this.events.emit("disposed")
  }

  private listenGestures (stage :Stage) {
    const ungesture = stage.addGestureActor(this)
    this.events.whenOnce(ev => ev === "unstaged", ungesture)
  }
}

export class Sprite extends Actor {
  tint = Color.clone(defaultTint)

  constructor (public tile :Tile) {
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
    return this.containsLocal(this.trans.inverseTransform(contpos, pos))
  }

  containsParent (pos :vec2) :boolean {
    return this.contains(this.requireParent.trans.transform(contpos, pos))
  }

  containsLocal (pos :vec2) :boolean {
    const lx = pos[0], ly = pos[1]
    if (lx < 0 || ly < 0) return false
    const tsize = this.tile.size
    if (lx > tsize[0] || ly > tsize[1]) return false
    // TODO: other fine grained hit testing?
    return true
  }

  renderImpl (batch :QuadBatch, txUpdated :boolean) {
    batch.addTile(this.tile, this.tint, this.trans.data as mat2d, vec2zero, this.tile.size)
    return true
  }

  onClick (fn :(ev :MouseEvent|TouchEvent, pos :vec2) => void) :Remover {
    return this.addGestureHandler((ev, pos) => this.containsLocal(pos) ? {
      exclusive: "click",
      priority: this.layer,
      move: (ev, pos) => false,
      release: (ev, pos) => {
        if (this.containsLocal(pos)) fn(ev, pos)
      },
      cancel: () => {},
    } : undefined)
  }
}

export class Group extends Actor implements Parent {
  private actors :Actor[] = []

  addActor (actor :Actor) {
    actor.parent = this
    insertSorted(this.actors, actor, (a, b) => a.layer - b.layer)
    actor.events.emit("added")
    const stage = this.stage
    if (stage) actor.wasStaged(stage)
  }

  removeActor (actor :Actor, dispose = true) {
    const idx = this.actors.indexOf(actor)
    if (idx < 0) log.warn("Deleted unknown actor?", "group", this, "actor", actor)
    else {
      const stage = this.stage
      if (stage) actor.willUnstage(stage)
      this.actors.splice(idx, 1)
      actor.parent = undefined
      actor.events.emit("removed")
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

  renderImpl (batch :QuadBatch, txUpdated :boolean) {
    const trans = this.trans
    for (const actor of this.actors) {
      const actorTxUpdated = txUpdated || actor.trans.dirty
      if (actorTxUpdated) actor.trans.updateMatrix(trans)
      if (actor.visible) actor.render(batch, actorTxUpdated)
    }
  }

  wasStaged (stage :Stage) {
    super.wasStaged(stage)
    for (const actor of this.actors) actor.wasStaged(stage)
  }
  willUnstage (stage :Stage) {
    super.willUnstage(stage)
    for (const actor of this.actors) actor.willUnstage(stage)
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
  private readonly disposer = new Disposer()
  private readonly gactors :Actor[] = []
  private readonly ghandlers :GestureHandler[] = []

  readonly clock :Stream<number> = new Emitter()
  readonly anim = new Animator()
  readonly fxanim = new Animator()
  readonly events = new Emitter<ActorEvent>()
  readonly root = new RootGroup(this)

  constructor (readonly renderer :Renderer, interact :InteractionManager) {
    this.clock.onEmit(dt => this.anim.update(dt))
    this.clock.onEmit(dt => this.fxanim.update(dt))
    this.disposer.add(interact.addProvider({
      zIndex: 0, // TODO: allow customize?
      toLocal: (x, y, pos) => {
        const rect = this.renderer.canvas.getBoundingClientRect()
        vec2.set(pos, x-rect.left, y-rect.top)
        return x >= rect.left && y >= rect.top && x <= rect.right && y <= rect.bottom
      },
      handlePointerDown: (event, pos, into) => {
        for (const gh of this.ghandlers) {
          const iact = gh(event, pos)
          if (iact) into.push(iact)
        }
        for (const ga of this.gactors) {
          if (ga.interactive) ga.handlePointerDown(event, pos, into)
        }
      },
      updateMouseHover: Noop,
      endMouseHover: Noop,
      handleDoubleClick: (event, pos) => false, // noop
    }))
  }

  addGestureHandler (handler :GestureHandler) :Remover {
    return addListener(this.ghandlers, handler)
  }

  addGestureActor (actor :Actor) :Remover {
    return addListener(this.gactors, actor)
  }

  pointer (root :Actor) :Stream<PointerEvent> {
    return Stream.deriveStream(emit => {
      let mousedown = false
      const mousepos = vec2.create()
      const unmouse = mouseEvents("mousedown", "mousemove", "mouseup").onEmit(ev => {
        switch (ev.type) {
        case "mousedown":
          if (!ev.defaultPrevented) {
            mousedown = true
            emit({type: "start", pos: root.toLocal(ev.clientX, ev.clientY, mousepos)})
            ev.preventDefault()
          }
          break
        case "mousemove":
          if (mousedown) {
            emit({type: "move", pos: root.toLocal(ev.clientX, ev.clientY, mousepos)})
            ev.preventDefault()
          }
          break
        case "mouseup":
          if (mousedown) {
            emit({type: "end", pos: root.toLocal(ev.clientX, ev.clientY, mousepos)})
            ev.preventDefault()
            mousedown = false
          }
          break
        }
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
                emit({type: "move", pos: root.toLocal(touch.clientX, touch.clientY, touchpos)})
                ev.preventDefault()
                break
              case "touchcancel":
                emit({type: "cancel", pos: root.toLocal(touch.clientX, touch.clientY, touchpos)})
                ev.preventDefault()
                curtouchid = undefined
                break
              case "touchend":
                emit({type: "end", pos: root.toLocal(touch.clientX, touch.clientY, touchpos)})
                ev.preventDefault()
                curtouchid = undefined
                break
              }
              // if we already have a touch in progress, ignore new touches
            }
          }
        } else if (ev.type === "touchstart" && !ev.defaultPrevented) {
          const st = ev.changedTouches[0]
          curtouchid = st.identifier
          emit({type: "start", pos: root.toLocal(st.clientX, st.clientY, touchpos)})
          ev.preventDefault()
        }
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
    if (root.visible) root.render(batch, txUpdated)
  }

  dispose () {
    this.root.dispose()
    this.disposer.dispose()
  }
}

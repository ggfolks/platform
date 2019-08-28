import {AnimationAction, AnimationMixer, Intersection, Object3D, Raycaster, Vector3} from "three"

import {Subject, Value} from "../core/react"
import {Noop} from "../core/util"
import {Graph} from "../graph/graph"
import {inputEdge, outputEdge, property} from "../graph/meta"
import {NodeTypeRegistry} from "../graph/node"
import {Component} from "../entity/entity"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {PointerConfig} from "../input/node"
import {HoverMap, loadGLTFAnimationClip} from "./entity"

/** Emits information about a single hover point. */
abstract class HoverConfig implements EntityComponentConfig, PointerConfig {
  type = "hover"
  @property() component = ""
  @property() index = 0
  @property() count = 1
  @outputEdge("Vector3") worldPosition = undefined
  @outputEdge("Vector3") worldMovement = undefined
  @outputEdge("Vector3") viewPosition = undefined
  @outputEdge("Vector3") viewMovement = undefined
  @outputEdge("boolean") pressed = undefined
  @outputEdge("boolean", true) hovered = undefined
}

const zeroVector = new Vector3()

class Hover extends EntityComponentNode<Component<HoverMap>> {

  constructor (graph :Graph, id :string, readonly config :HoverConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    const index = this.config.index || 0
    const count = this.config.count === undefined ? 1 : this.config.count
    const hover = this._component.getValue(this._entityId).map(hovers => {
      if (hovers.size === count) {
        let remaining = index
        for (const value of hovers.values()) {
          if (remaining-- === 0) return value
        }
      }
      return
    })
    switch (name) {
      case "worldPosition":
      case "worldMovement":
      case "viewPosition":
      case "viewMovement": return hover.map(hover => hover ? hover[name] : zeroVector)
      case "pressed": return hover.map(hover => Boolean(hover && hover.pressed))
      default: return hover.map(Boolean)
    }
  }
}

/** Controls an animation action on the entity. */
abstract class AnimationActionConfig implements EntityComponentConfig {
  type = "AnimationAction"
  @property() component = ""
  @property() url = ""
  @property() repetitions = Number.POSITIVE_INFINITY
  @property() clampWhenFinished = false
  @inputEdge("boolean") play = undefined
  @outputEdge("boolean", true) finished = undefined
  // YAGNI? @outputEdge("boolean") loop = undefined
}

class AnimationActionNode extends EntityComponentNode<Component<AnimationMixer>> {
  private readonly _action :Subject<AnimationAction>

  constructor (graph :Graph, id :string, readonly config :AnimationActionConfig) {
    super(graph, id, config)
    this._action = Subject.join2(
      this._component.getValue(this._entityId),
      loadGLTFAnimationClip(this.config.url)
    ).map(([mixer, clip]) => mixer.clipAction(clip))
  }

  connect () {
    const actplay = Subject.join2(this._action, this.graph.getValue(this.config.play, false))
    this._disposer.add(actplay.onValue(([action, play]) => {
      if (play !== action.isScheduled()) {
        if (play) {
          if (this.config.repetitions) action.repetitions = this.config.repetitions
          if (this.config.clampWhenFinished !== undefined) {
            action.clampWhenFinished = this.config.clampWhenFinished
          }
          action.play()
        } else {
          action.stop()
        }
      }
    }))
  }

  protected _createOutput () {
    const actplay = Subject.join2(this._action, this.graph.getValue(this.config.play, false))
    return actplay.switchMap(([action, playing]) => Subject.deriveSubject<boolean>(disp => {
      const listener = (e :any) => {
        if (e.action === action) disp(true)
      }
      action.getMixer().addEventListener("finished", listener)
      return () => action.getMixer().removeEventListener("finished", listener)
    })).fold(false, (ov, nv) => nv)
  }
}

/** Casts a ray into the scene. */
abstract class RaycasterConfig implements EntityComponentConfig {
  type = "Raycaster"
  @property() component = ""
  @property("CoordinateFrame") frame = "local"
  @inputEdge("Vector3") origin = undefined
  @inputEdge("Vector3") direction = undefined
  @outputEdge("number") distance = undefined
}

const NoIntersection = {distance: Infinity} as Intersection

class RaycasterNode extends EntityComponentNode<Component<Object3D>> {

  private _intersection? :Value<Intersection>
  private _origin? :Value<Vector3>
  private _direction? :Value<Vector3>

  constructor (graph :Graph, id :string, readonly config :RaycasterConfig) {
    super(graph, id, config)
  }

  connect () {
    // subscribe to updates so that we can poll the current value
    this._disposer.add(this._getOrigin().onValue(Noop))
    this._disposer.add(this._getDirection().onValue(Noop))
  }

  protected _createOutput () {
    return this._getIntersection().map(intersection => intersection.distance)
  }

  protected _getIntersection () {
    if (!this._intersection) {
      const raycaster = new Raycaster()
      const target :Intersection[] = []
      this._intersection = this.graph.clock.fold(NoIntersection, () => {
        target.length = 0
        const object = this._component.read(this._entityId)
        const parent = object.parent as Object3D
        let ancestor = parent
        while (ancestor.parent) ancestor = ancestor.parent
        raycaster.set(this._getOrigin().current, this._getDirection().current)
        if (this.config.frame !== "world") raycaster.ray.applyMatrix4(object.matrixWorld)
        // remove the object itself while we raycast
        parent.remove(object)
        raycaster.intersectObject(ancestor, true, target)
        parent.add(object)
        return target.length > 0 ? target[0] : NoIntersection
      })
    }
    return this._intersection
  }

  protected _getOrigin () {
    if (!this._origin) {
      this._origin = this.graph.getValue(this.config.origin, new Vector3())
    }
    return this._origin
  }

  protected _getDirection () {
    if (!this._direction) {
      this._direction = this.graph.getValue(this.config.direction, new Vector3(0, 0, 1))
    }
    return this._direction
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerScene3Nodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("hover", Hover)
  registry.registerNodeType("AnimationAction", AnimationActionNode)
  registry.registerNodeType("Raycaster", RaycasterNode)
}

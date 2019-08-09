import {AnimationMixer, Intersection, Object3D, Raycaster, Vector3} from "three"

import {Subject, Value} from "../core/react"
import {Noop} from "../core/util"
import {Graph} from "../graph/graph"
import {InputEdge, NodeTypeRegistry, OutputEdge} from "../graph/node"
import {Component} from "../entity/entity"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {PointerConfig} from "../input/node"
import {CoordinateFrame} from "../space/node"
import {HoverMap, loadGLTFAnimationClip} from "./entity"

/** Emits information about a single hover point. */
export interface HoverConfig extends EntityComponentConfig, PointerConfig {
  type :"hover"
  worldPosition :OutputEdge<Vector3>
  worldMovement :OutputEdge<Vector3>
  viewPosition :OutputEdge<Vector3>
  viewMovement :OutputEdge<Vector3>
  pressed :OutputEdge<boolean>
  hovered :OutputEdge<boolean>
}

const zeroVector = new Vector3()

class Hover extends EntityComponentNode<Component<HoverMap>> {

  constructor (graph :Graph, id :string, readonly config :HoverConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name? :string) {
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
export interface AnimationActionConfig extends EntityComponentConfig {
  type :"AnimationAction"
  url :string
  play :InputEdge<boolean>
}

class AnimationActionNode extends EntityComponentNode<Component<AnimationMixer>> {

  constructor (graph :Graph, id :string, readonly config :AnimationActionConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(
      Subject
        .join3(
          this._component.getValue(this._entityId),
          loadGLTFAnimationClip(this.config.url),
          this.graph.getValue(this.config.play, false),
        )
        .onValue(([mixer, clip, play]) => {
          const action = mixer.clipAction(clip)
          if (play) {
            if (!action.isScheduled()) {
              action.play()
            }
          } else if (action.isScheduled()) {
            action.stop()
          }
        })
    )
  }
}

/** Casts a ray into the scene. */
export interface RaycasterConfig extends EntityComponentConfig {
  type :"Raycaster"
  frame? :CoordinateFrame
  origin :InputEdge<Vector3>
  direction :InputEdge<Vector3>
  distance :OutputEdge<number>
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

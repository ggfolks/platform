import {AnimationMixer, Vector3} from "three"

import {Subject} from "../core/react"
import {Graph} from "../graph/graph"
import {InputEdge, NodeTypeRegistry, OutputEdge} from "../graph/node"
import {Component} from "../entity/entity"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {PointerConfig} from "../input/node"
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

/** Registers the nodes in this module with the supplied registry. */
export function registerScene3Nodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("hover", Hover)
  registry.registerNodeType("AnimationAction", AnimationActionNode)
}

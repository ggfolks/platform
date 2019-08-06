import {Vector3} from "three"
import {Graph} from "../graph/graph"
import {NodeTypeRegistry, OutputEdge} from "../graph/node"
import {Component} from "../entity/entity"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {PointerConfig} from "../input/node"
import {HoverMap} from "./entity"

/** Rotates by an amount determined by the inputs. */
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

/** Registers the nodes in this module with the supplied registry. */
export function registerScene3Nodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("hover", Hover)
}

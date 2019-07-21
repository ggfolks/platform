import {Quaternion, Vector3} from "three"
import {Graph} from "../graph/graph"
import {InputEdge, NodeTypeRegistry} from "../graph/node"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {TransformComponent} from "./entity"

/** Rotates at a speed determined by the input. */
export interface RotateConfig extends EntityComponentConfig {
  type :"rotate"
  axis :Vector3,
  input :InputEdge
}

class Rotate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) { super(graph, id, config) }

  protected _connectComponent (component :TransformComponent) {
    const quaternion = new Quaternion()
    const rotation = new Quaternion()
    const speed = this.graph.getValue(this.config.input)
    this._removers.push(this.graph.clock.onValue(clock => {
      component.readQuaternion(this.config.entity, quaternion)
      quaternion.multiply(rotation.setFromAxisAngle(this.config.axis, speed.current * clock.dt))
      component.updateQuaternion(this.config.entity, quaternion)
    }))
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSpaceNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("rotate", Rotate)
}

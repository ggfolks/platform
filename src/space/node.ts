import {Euler, Quaternion, Vector3} from "three"
import {Graph} from "../graph/graph"
import {InputEdge, NodeTypeRegistry} from "../graph/node"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {TransformComponent} from "./entity"

/** Rotates at a velocity determined by the input. */
export interface RotateConfig extends EntityComponentConfig {
  type :"rotate"
  x :InputEdge
  y :InputEdge
  z :InputEdge
}

class Rotate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) { super(graph, id, config) }

  protected _connectComponent (component :TransformComponent) {
    const quaternion = new Quaternion()
    const rotation = new Quaternion()
    const euler = new Euler()
    const x = this.graph.getValue(this.config.x)
    const y = this.graph.getValue(this.config.y)
    const z = this.graph.getValue(this.config.z)
    this._removers.push(this.graph.clock.onValue(clock => {
      component.readQuaternion(this.config.entity, quaternion)
      quaternion.multiply(rotation.setFromEuler(euler.set(
        x.current * clock.dt,
        y.current * clock.dt,
        z.current * clock.dt,
      )))
      component.updateQuaternion(this.config.entity, quaternion)
    }))
  }
}

/** Translates at a velocity determined by the input. */
export interface TranslateConfig extends EntityComponentConfig {
  type :"translate"
  x :InputEdge
  y :InputEdge
  z :InputEdge
}

class Translate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :TranslateConfig) {
    super(graph, id, config)
  }

  protected _connectComponent (component :TransformComponent) {
    const position = new Vector3()
    const quaternion = new Quaternion()
    const vector = new Vector3()
    const x = this.graph.getValue(this.config.x)
    const y = this.graph.getValue(this.config.y)
    const z = this.graph.getValue(this.config.z)
    this._removers.push(this.graph.clock.onValue(clock => {
      component.readPosition(this.config.entity, position)
      component.readQuaternion(this.config.entity, quaternion)
      vector
        .set(x.current, y.current, z.current)
        .multiplyScalar(clock.dt)
        .applyQuaternion(quaternion)
      component.updatePosition(this.config.entity, position.add(vector))
    }))
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSpaceNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("rotate", Rotate)
  registry.registerNodeType("translate", Translate)
}

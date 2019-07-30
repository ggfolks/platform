import {Euler, Quaternion, Vector3} from "three"
import {Noop} from "../core/util"
import {Graph} from "../graph/graph"
import {InputEdge, NodeTypeRegistry} from "../graph/node"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {TransformComponent} from "./entity"

/** Rotates by an amount determined by the inputs. */
export interface RotateConfig extends EntityComponentConfig {
  type :"rotate"
  x :InputEdge<number>
  y :InputEdge<number>
  z :InputEdge<number>
}

class Rotate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :RotateConfig) { super(graph, id, config) }

  protected _connectComponent (component :TransformComponent) {
    const quaternion = new Quaternion()
    const rotation = new Quaternion()
    const euler = new Euler()
    const x = this.graph.getValue(this.config.x, 0)
    const y = this.graph.getValue(this.config.y, 0)
    const z = this.graph.getValue(this.config.z, 0)
    this._removers.push(
      // we listen to the inputs despite the fact that we poll their values every frame;
      // this is because, without listeners, the current value won't be updated
      x.onChange(Noop),
      y.onChange(Noop),
      z.onChange(Noop),
      this.graph.clock.onValue(clock => {
        component.readQuaternion(this._entityId, quaternion)
        quaternion.multiply(rotation.setFromEuler(euler.set(x.current, y.current, z.current)))
        component.updateQuaternion(this._entityId, quaternion)
      }),
    )
  }
}

/** Translates by an amount determined by the inputs. */
export interface TranslateConfig extends EntityComponentConfig {
  type :"translate"
  x :InputEdge<number>
  y :InputEdge<number>
  z :InputEdge<number>
}

class Translate extends EntityComponentNode<TransformComponent> {

  constructor (graph :Graph, id :string, readonly config :TranslateConfig) {
    super(graph, id, config)
  }

  protected _connectComponent (component :TransformComponent) {
    const position = new Vector3()
    const quaternion = new Quaternion()
    const vector = new Vector3()
    const x = this.graph.getValue(this.config.x, 0)
    const y = this.graph.getValue(this.config.y, 0)
    const z = this.graph.getValue(this.config.z, 0)
    this._removers.push(
      // we listen to the inputs despite the fact that we poll their values every frame;
      // this is because, without listeners, the current value won't be updated
      x.onChange(Noop),
      y.onChange(Noop),
      z.onChange(Noop),
      this.graph.clock.onValue(clock => {
        component.readPosition(this._entityId, position)
        component.readQuaternion(this._entityId, quaternion)
        vector
          .set(x.current, y.current, z.current)
          .applyQuaternion(quaternion)
        component.updatePosition(this._entityId, position.add(vector))
      }),
    )
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSpaceNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("rotate", Rotate)
  registry.registerNodeType("translate", Translate)
}

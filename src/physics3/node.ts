import {Body, ICollisionEvent} from "cannon"

import {refEquals} from "../core/data"
import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {outputEdge} from "../graph/meta"
import {NodeTypeRegistry} from "../graph/node"
import {Component, ID} from "../entity/entity"
import {EntityComponentConfig, EntityComponentNode} from "../entity/node"
import {UserDataBody} from "./entity"

/** Fires upon collision with another entity. */
abstract class CollidedConfig implements EntityComponentConfig {
  type = "collided"
  component = ""
  @outputEdge("ID | undefined") entity = undefined
}

class Collided extends EntityComponentNode<Component<Body>> {

  constructor (graph :Graph, id :string, readonly config :CollidedConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this._component.getValue(this._entityId).switchMap(body => {
      let value :ID | undefined
      return Value.deriveValue(
        refEquals,
        dispatch => {
          const listener = (event :ICollisionEvent) => {
            const id = (event.body as UserDataBody).userData.id
            dispatch(value = id, undefined)
            dispatch(value = undefined, id)
          }
          body.addEventListener("collide", listener)
          return () => body.removeEventListener("collide", listener)
        },
        () => value,
      )
    })
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerPhysics3Nodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("collided", Collided)
}

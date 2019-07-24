import {Graph} from "../graph/graph"
import {InputEdge, Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
import {Domain, EntityConfig, ID} from "./entity"

/** Context for nodes relating to entities. */
export interface EntityNodeContext extends NodeContext {
  domain :Domain
  entityId? :ID
}

interface EntityNodeConfig extends NodeConfig {
  entityId? :ID
}

class EntityNode extends Node {

  constructor (graph :Graph, id :string, readonly config :EntityNodeConfig) {
    super(graph, id, config)
  }

  protected get _entityId () {
    if (this.config.entityId !== undefined) {
      return this.config.entityId
    }
    const ctx = this.graph.ctx as EntityNodeContext
    if (ctx.entityId === undefined) {
      throw new Error("Missing entity id")
    }
    return ctx.entityId
  }
}

/** Base config for nodes that operate on a single component of a single entity. */
export interface EntityComponentConfig extends EntityNodeConfig {
  component :string
}

/** Base class for nodes that operate on a single component (of type T) of a single entity. */
export class EntityComponentNode<T> extends EntityNode {

  constructor (graph :Graph, id :string, readonly config :EntityComponentConfig) {
    super(graph, id, config)
  }

  connect () {
    const ctx = this.graph.ctx as EntityNodeContext
    const component = ctx.domain.component(this.config.component) as unknown
    this._connectComponent(component as T)
  }

  protected _connectComponent (component :T) {}
}

/** A node that adds an entity when its input transitions to true. */
export interface AddEntityConfig extends NodeConfig {
  type :"addEntity"
  config :EntityConfig
  input :InputEdge
}

class AddEntity extends Node {

  constructor (graph :Graph, id :string, readonly config :AddEntityConfig) {
    super(graph, id, config)
  }

  connect () {
    this._removers.push(this.graph.getValue(this.config.input).onValue(value => {
      if (value) {
        const ctx = this.graph.ctx as EntityNodeContext
        ctx.domain.add(this.config.config)
      }
    }))
  }
}

/** A node that deletes an entity when its input transitions to true. */
export interface DeleteEntityConfig extends EntityNodeConfig {
  type :"deleteEntity"
  input :InputEdge
}

class DeleteEntity extends EntityNode {

  constructor (graph :Graph, id :string, readonly config :DeleteEntityConfig) {
    super(graph, id, config)
  }

  connect () {
    this._removers.push(this.graph.getValue(this.config.input).onValue(value => {
      if (value) {
        const ctx = this.graph.ctx as EntityNodeContext
        ctx.domain.delete(this._entityId)
      }
    }))
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerEntityNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("addEntity", AddEntity)
  registry.registerNodeType("deleteEntity", DeleteEntity)
}

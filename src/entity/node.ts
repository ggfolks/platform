import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {InputEdge, Node, NodeConfig, NodeContext, NodeTypeRegistry, OutputEdge} from "../graph/node"
import {Component, Domain, EntityConfig, ID} from "./entity"

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
export class EntityComponentNode<T extends Component<any>> extends EntityNode {

  constructor (graph :Graph, id :string, readonly config :EntityComponentConfig) {
    super(graph, id, config)
  }

  protected get _component () {
    const ctx = this.graph.ctx as EntityNodeContext
    const component = ctx.domain.component(this.config.component) as unknown
    return component as T
  }
}

/** A node that adds an entity when its input transitions to true. */
export interface AddEntityConfig extends NodeConfig {
  type :"addEntity"
  config :EntityConfig
  input :InputEdge<boolean>
}

class AddEntity extends Node {

  constructor (graph :Graph, id :string, readonly config :AddEntityConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, false).onValue(value => {
      if (value) {
        const ctx = this.graph.ctx as EntityNodeContext
        ctx.domain.add(this.config.config)
      }
    }))
  }
}

/** A node that deletes its input entity. */
export interface DeleteEntityConfig extends NodeConfig {
  type :"deleteEntity"
  input :InputEdge<ID | undefined>
}

class DeleteEntity extends Node {

  constructor (graph :Graph, id :string, readonly config :DeleteEntityConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, undefined).onValue(async id => {
      if (id !== undefined) {
        await true // don't delete in the middle of a physics update
        const ctx = this.graph.ctx as EntityNodeContext
        if (ctx.domain.entityExists(id)) ctx.domain.delete(id)
      }
    }))
  }
}

/** Outputs the entity id. */
export interface EntityIdConfig extends EntityConfig {
  type :"entityId"
  output :OutputEdge<ID>
}

class EntityId extends EntityNode {

  constructor (graph :Graph, id :string, readonly config :EntityIdConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this._entityId)
  }
}

/** Provides the value of a component as an output. */
export interface ReadComponentConfig extends EntityComponentConfig {
  type :"readComponent"
  output :OutputEdge<any>
}

class ReadComponent extends EntityComponentNode<Component<any>> {

  constructor (graph :Graph, id :string, readonly config :ReadComponentConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this._component.getValue(this._entityId)
  }
}

/** Updates the value of a component according to the input. */
export interface UpdateComponentConfig extends EntityComponentConfig {
  type :"updateComponent"
  input :InputEdge<any>
}

class UpdateComponent extends EntityComponentNode<Component<any>> {

  constructor (graph :Graph, id :string, readonly config :UpdateComponentConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(
      this.graph.getValue(this.config.input, 0).onValue(value => {
        this._component.update(this._entityId, value)
      })
    )
  }
}

/** Checks whether the input entity has a given tag. */
export interface TaggedConfig extends NodeConfig {
  type :"tagged"
  tag :string
  input :InputEdge<ID | undefined>
  output :OutputEdge<boolean>
}

class Tagged extends Node {

  constructor (graph :Graph, id :string, readonly config :TaggedConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph.getValue(this.config.input, undefined).map(id => {
      if (id === undefined) {
        return false
      }
      const ctx = this.graph.ctx as EntityNodeContext
      if (!ctx.domain.entityExists(id)) {
        return false
      }
      const cfg = ctx.domain.entityConfig(id)
      return cfg.tags && cfg.tags.has(this.config.tag)
    })
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerEntityNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("addEntity", AddEntity)
  registry.registerNodeType("deleteEntity", DeleteEntity)
  registry.registerNodeType("entityId", EntityId)
  registry.registerNodeType("readComponent", ReadComponent)
  registry.registerNodeType("updateComponent", UpdateComponent)
  registry.registerNodeType("tagged", Tagged)
}

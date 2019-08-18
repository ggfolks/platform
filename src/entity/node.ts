import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {inputEdge, outputEdge, property} from "../graph/meta"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
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
abstract class AddEntityConfig implements NodeConfig {
  type = "addEntity"
  config :EntityConfig = {components: {}}
  @inputEdge("boolean") input = undefined
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

const undefinedId = undefined as (ID | undefined)

/** A node that deletes its input entity. */
abstract class DeleteEntityConfig implements NodeConfig {
  type = "deleteEntity"
  @inputEdge("ID | undefined") input = undefined
}

class DeleteEntity extends Node {

  constructor (graph :Graph, id :string, readonly config :DeleteEntityConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, undefinedId).onValue(async id => {
      if (id !== undefined) {
        await true // don't delete in the middle of a physics update
        const ctx = this.graph.ctx as EntityNodeContext
        if (ctx.domain.entityExists(id)) ctx.domain.delete(id)
      }
    }))
  }
}

/** Outputs the entity id. */
abstract class EntityIdConfig implements EntityNodeConfig {
  type = "entityId"
  @outputEdge("ID") output = undefined
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
abstract class ReadComponentConfig implements EntityComponentConfig {
  type = "readComponent"
  @property() component = ""
  @outputEdge("any") output = undefined
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
abstract class UpdateComponentConfig implements EntityComponentConfig {
  type = "updateComponent"
  @property() component = ""
  @inputEdge("any") input = undefined
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
abstract class TaggedConfig implements NodeConfig {
  type = "tagged"
  @property() tag = ""
  @inputEdge("ID | undefined") input = undefined
  @outputEdge("boolean") output = undefined
}

class Tagged extends Node {

  constructor (graph :Graph, id :string, readonly config :TaggedConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph.getValue(this.config.input, undefinedId).map(id => {
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

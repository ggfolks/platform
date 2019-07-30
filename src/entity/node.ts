import {Mutable} from "../core/react"
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
  input :InputEdge<boolean>
}

class AddEntity extends Node {

  constructor (graph :Graph, id :string, readonly config :AddEntityConfig) {
    super(graph, id, config)
  }

  connect () {
    this._removers.push(this.graph.getValue(this.config.input, false).onValue(value => {
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
  input :InputEdge<boolean>
}

class DeleteEntity extends EntityNode {

  constructor (graph :Graph, id :string, readonly config :DeleteEntityConfig) {
    super(graph, id, config)
  }

  connect () {
    this._removers.push(this.graph.getValue(this.config.input, false).onValue(value => {
      if (value) {
        const ctx = this.graph.ctx as EntityNodeContext
        ctx.domain.delete(this._entityId)
      }
    }))
  }
}

/** Provides the value of a component as an output. */
export interface ReadComponentConfig extends EntityComponentConfig {
  type :"readComponent"
  output :OutputEdge<any>
}

class ReadComponent extends EntityComponentNode<Component<any>> {
  private _output :Mutable<any> = Mutable.local(0)

  constructor (graph :Graph, id :string, readonly config :ReadComponentConfig) {
    super(graph, id, config)
  }

  getOutput () {
    return this._output
  }

  protected _connectComponent (component :Component<any>) {
    // TODO: use a reactive view of the component value
    this._removers.push(
      this.graph.clock.onValue(clock => {
        this._output.update(component.read(this._entityId))
      })
    )
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

  protected _connectComponent (component :Component<any>) {
    this._removers.push(
      this.graph.getValue(this.config.input, 0).onValue(value => {
        component.update(this._entityId, value)
      })
    )
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerEntityNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("addEntity", AddEntity)
  registry.registerNodeType("deleteEntity", DeleteEntity)
  registry.registerNodeType("readComponent", ReadComponent)
  registry.registerNodeType("updateComponent", UpdateComponent)
}

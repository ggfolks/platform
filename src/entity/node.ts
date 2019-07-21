import {Graph} from "../graph/graph"
import {Node, NodeConfig, NodeContext} from "../graph/node"
import {Domain, ID} from "./entity"

/** Context for nodes relating to entities. */
export interface EntityNodeContext extends NodeContext {
  domain :Domain
}

/** Base config for nodes that operate on a single component of a single entity. */
export interface EntityComponentConfig extends NodeConfig {
  entity :ID
  component :string
}

/** Base class for nodes that operate on a single component (of type T) of a single entity. */
export class EntityComponentNode<T> extends Node {

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

import {Value} from "../core/react"
import {
  InputEdge,
  Node,
  NodeConfig,
  NodeTypeRegistry,
  OperatorConfig,
  Operator,
  OutputEdge,
} from "./node"
import {Graph} from "./graph"

/** Computes the logical and of its inputs. */
export interface AndConfig extends OperatorConfig<boolean> {
  type :"and"
}

class And extends Operator<boolean> {

  constructor (graph :Graph, id :string, readonly config :AndConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () :boolean {
    return true
  }

  protected _apply (values :boolean[]) :boolean {
    let result = true
    for (const value of values) {
      result = result && value
    }
    return result
  }
}

/** Computes the logical or of its inputs. */
export interface OrConfig extends OperatorConfig<boolean> {
  type :"or"
}

class Or extends Operator<boolean> {

  constructor (graph :Graph, id :string, readonly config :OrConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () :boolean {
    return false
  }

  protected _apply (values :boolean[]) :boolean {
    let result = false
    for (const value of values) {
      result = result || value
    }
    return result
  }
}

/** Provides the negation of its input. */
export interface NotConfig extends NodeConfig {
  type :"not"
  input :InputEdge<boolean>
  output :OutputEdge<boolean>
}

class Not extends Node {

  constructor (graph :Graph, id :string, readonly config :NotConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph.getValue(this.config.input, false).map(value => !value)
  }
}

/** Outputs x < y. */
export interface LessThanConfig extends NodeConfig {
  type :"lessThan"
  x :InputEdge<number>
  y :InputEdge<number>
  output :OutputEdge<boolean>
}

class LessThan extends Node {

  constructor (graph :Graph, id :string, readonly config :LessThanConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join(
        this.graph.getValue(this.config.x, 0),
        this.graph.getValue(this.config.y, 0),
      )
      .map(([x, y]) => x < y)
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerLogicNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("and", And)
  registry.registerNodeType("or", Or)
  registry.registerNodeType("not", Not)
  registry.registerNodeType("lessThan", LessThan)
}

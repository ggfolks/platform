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

/** Registers the nodes in this module with the supplied registry. */
export function registerLogicNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("or", Or)
  registry.registerNodeType("not", Not)
}

import {Value} from "../core/react"
import {Graph} from "./graph"
import {inputEdge, inputEdges, outputEdge} from "./meta"
import {
  Node,
  NodeConfig,
  NodeTypeRegistry,
  OperatorConfig,
  Operator,
} from "./node"

/** Computes the logical and of its inputs. */
abstract class AndConfig implements OperatorConfig<boolean> {
  type = "and"
  @inputEdges("boolean") inputs = undefined
  @outputEdge("boolean") output = undefined
}

class And extends Operator<boolean> {

  constructor (graph :Graph, id :string, readonly config :AndConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () :boolean {
    return true
  }

  protected _apply (values :boolean[]) :boolean {
    for (const value of values) {
      if (!value) return false
    }
    return true
  }
}

/** Computes the logical or of its inputs. */
abstract class OrConfig implements OperatorConfig<boolean> {
  type = "or"
  @inputEdges("boolean") inputs = undefined
  @outputEdge("boolean") output = undefined
}

class Or extends Operator<boolean> {

  constructor (graph :Graph, id :string, readonly config :OrConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () :boolean {
    return false
  }

  protected _apply (values :boolean[]) :boolean {
    for (const value of values) {
      if (value) return true
    }
    return false
  }
}

/** Provides the negation of its input. */
abstract class NotConfig implements NodeConfig {
  type = "not"
  @inputEdge("boolean") input = undefined
  @outputEdge("boolean") output = undefined
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
abstract class LessThanConfig implements NodeConfig {
  type = "lessThan"
  @inputEdge("number") x = undefined
  @inputEdge("number") y = undefined
  @outputEdge("boolean") output = undefined
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

/** Outputs condition ? ifTrue : ifFalse. */
abstract class ConditionalConfig implements NodeConfig {
  type = "conditional"
  @inputEdge("boolean") condition = undefined
  @outputEdge("any") ifTrue = undefined
  @outputEdge("any") ifFalse = undefined
}

class Conditional extends Node {

  constructor (graph :Graph, id :string, readonly config :ConditionalConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string | undefined, defaultValue :any) {
    return Value
      .join3(
        this.graph.getValue(this.config.condition, false),
        this.graph.getValue(this.config.ifTrue, defaultValue),
        this.graph.getValue(this.config.ifFalse, defaultValue),
      )
      .map(([condition, ifTrue, ifFalse]) => condition ? ifTrue : ifFalse)
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerLogicNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("and", And)
  registry.registerNodeType("or", Or)
  registry.registerNodeType("not", Not)
  registry.registerNodeType("lessThan", LessThan)
  registry.registerNodeType("conditional", Conditional)
}

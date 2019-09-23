import {Value} from "../core/react"
import {Graph} from "./graph"
import {inputEdge, inputEdges, outputEdge, property} from "./meta"
import {
  Node,
  NodeConfig,
  NodeTypeRegistry,
  OperatorConfig,
  Operator,
} from "./node"

/** Outputs a constant boolean value. */
abstract class BooleanConfig implements NodeConfig {
  type = "boolean"
  @property() value = false
  @outputEdge("boolean") output = undefined
}

class BooleanNode extends Node {

  constructor (graph :Graph, id :string, readonly config :BooleanConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this.config.value || false)
  }
}

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

/** Outputs a === b. */
abstract class EqualsConfig implements NodeConfig {
  type = "equals"
  @inputEdge("any") a = undefined
  @inputEdge("any") b = undefined
  @outputEdge("boolean") output = undefined
}

class Equals extends Node {

  constructor (graph :Graph, id :string, readonly config :EqualsConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join(
        this.graph.getValue<any>(this.config.a, undefined),
        this.graph.getValue<any>(this.config.b, undefined),
      )
      .map(([a, b]) => a === b)
  }
}

/** Outputs a < b. */
abstract class LessThanConfig implements NodeConfig {
  type = "lessThan"
  @inputEdge("number") a = undefined
  @inputEdge("number") b = undefined
  @outputEdge("boolean") output = undefined
}

class LessThan extends Node {

  constructor (graph :Graph, id :string, readonly config :LessThanConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join(
        this.graph.getValue(this.config.a, 0),
        this.graph.getValue(this.config.b, 0),
      )
      .map(([a, b]) => a < b)
  }
}

/** Outputs a > b. */
abstract class GreaterThanConfig implements NodeConfig {
  type = "greaterThan"
  @inputEdge("number") a = undefined
  @inputEdge("number") b = undefined
  @outputEdge("boolean") output = undefined
}

class GreaterThan extends Node {

  constructor (graph :Graph, id :string, readonly config :GreaterThanConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value
      .join(
        this.graph.getValue(this.config.a, 0),
        this.graph.getValue(this.config.b, 0),
      )
      .map(([a, b]) => a > b)
  }
}

/** Outputs condition ? ifTrue : ifFalse. */
abstract class ConditionalConfig implements NodeConfig {
  type = "conditional"
  @inputEdge("boolean") condition = undefined
  @inputEdge("any") ifTrue = undefined
  @inputEdge("any") ifFalse = undefined
  @outputEdge("any") output = undefined
}

class Conditional extends Node {

  constructor (graph :Graph, id :string, readonly config :ConditionalConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
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
  registry.registerNodeTypes(["logic"], {
    boolean: BooleanNode,
    and: And,
    or: Or,
    not: Not,
    equals: Equals,
    greaterThan: GreaterThan,
    lessThan: LessThan,
    conditional: Conditional,
  })
}

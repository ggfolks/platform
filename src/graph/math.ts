import {Value} from "../core/react"
import {Graph} from "./graph"
import {InputEdges, Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Outputs a single constant. */
export interface ConstantConfig extends NodeConfig {
  type :"constant"
  value :number
}

class Constant extends Node {

  constructor (graph :Graph, id :string, readonly config :ConstantConfig) {
    super(graph, id, config)
  }

  getDefaultOutput () {
    return Value.constant(this.config.value)
  }
}

/** Base config for operators with N inputs and one output. */
interface OperatorConfig extends NodeConfig {
  inputs :InputEdges
}

class Operator extends Node {

  constructor (graph :Graph, id :string, readonly config :OperatorConfig) {
    super(graph, id, config)
  }

  getDefaultOutput () {
    return this.graph.getValues(this.config.inputs).map(values => this._apply(values))
  }

  protected _apply (values :number[]) :number {
    throw new Error("Not implemented")
  }
}

/** Subtract/negate operator. */
export interface SubtractConfig extends OperatorConfig {
  type :"subtract"
}

class Subtract extends Operator {

  constructor (graph :Graph, id :string, readonly config :SubtractConfig) {
    super(graph, id, config)
  }

  protected _apply (values :number[]) :number {
    if (values.length === 0) {
      return 0
    }
    if (values.length === 1) {
      return -values[0]
    }
    let difference = values[0]
    for (let ii = 1; ii < values.length; ii++) {
      difference -= values[ii]
    }
    return difference
  }
}

/** Multiplication operator. */
export interface MultiplyConfig extends OperatorConfig {
  type :"multiply"
}

class Multiply extends Operator {

  constructor (graph :Graph, id :string, readonly config :MultiplyConfig) {
    super(graph, id, config)
  }

  protected _apply (values :number[]) :number {
    let product = 1
    for (const value of values) {
      product *= value
    }
    return product
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerMathNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("constant", Constant)
  registry.registerNodeType("subtract", Subtract)
  registry.registerNodeType("multiply", Multiply)
}

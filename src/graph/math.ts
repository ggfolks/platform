import {Value} from "../core/react"
import {Graph} from "./graph"
import {
  InputEdge,
  Node,
  NodeConfig,
  NodeTypeRegistry,
  OperatorConfig,
  Operator,
  OutputEdge,
} from "./node"

/** Outputs a single constant. */
export interface ConstantConfig extends NodeConfig {
  type :"constant"
  value :number
  output :OutputEdge<number>
}

class Constant extends Node {

  constructor (graph :Graph, id :string, readonly config :ConstantConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return Value.constant(this.config.value)
  }
}

/** Subtract/negate operator. */
export interface SubtractConfig extends OperatorConfig<number> {
  type :"subtract"
}

class Subtract extends Operator<number> {

  constructor (graph :Graph, id :string, readonly config :SubtractConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () :number {
    return 0
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
export interface MultiplyConfig extends OperatorConfig<number> {
  type :"multiply"
}

class Multiply extends Operator<number> {

  constructor (graph :Graph, id :string, readonly config :MultiplyConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () :number {
    return 1
  }

  protected _apply (values :number[]) :number {
    let product = 1
    for (const value of values) {
      product *= value
    }
    return product
  }
}

/** Emits a random number. */
export interface RandomConfig extends NodeConfig {
  type :"random"
  min? :number
  max? :number
  output :OutputEdge<number>
}

class Random extends Node {

  constructor (graph :Graph, id :string, readonly config :RandomConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph.clock.fold(
      this._getRandomValue(),
      (value, clock) => this._getRandomValue(),
    )
  }

  protected _getRandomValue () {
    const min = this.config.min === undefined ? 0 : this.config.min
    const max = this.config.max === undefined ? 1 : this.config.max
    return Math.random() * (max - min) + min
  }
}

/** Tracks the sum of its input over time, subject to optional min and max constraints. */
export interface AccumulateConfig extends NodeConfig {
  type :"random"
  min? :number
  max? :number
  input: InputEdge<number>
  output :OutputEdge<number>
}

class Accumulate extends Node {

  constructor (graph :Graph, id :string, readonly config :AccumulateConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    let sum = 0
    return this.graph.getValue(this.config.input, 0).map(value => {
      sum += value
      if (this.config.min !== undefined) sum = Math.max(this.config.min, sum)
      if (this.config.max !== undefined) sum = Math.min(this.config.max, sum)
      return sum
    })
  }
}

/** Outputs the sign of the input (-1, 0, or +1). */
export interface SignConfig extends NodeConfig {
  type :"sign"
  epsilon? :number
  input: InputEdge<number>
  output :OutputEdge<number>
}

class Sign extends Node {

  constructor (graph :Graph, id :string, readonly config :SignConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const epsilon = this.config.epsilon === undefined ? 0.0001 : this.config.epsilon
    return this.graph.getValue(this.config.input, 0).map(
      value => value < -epsilon ? -1 : value > epsilon ? 1 : 0,
    )
  }
}

/** Outputs the absolute value of the input. */
export interface AbsConfig extends NodeConfig {
  type :"abs"
  input: InputEdge<number>
  output :OutputEdge<number>
}

class Abs extends Node {

  constructor (graph :Graph, id :string, readonly config :AbsConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this.graph.getValue(this.config.input, 0).map(Math.abs)
  }
}

/** Outputs the minimum of the inputs. */
export interface MinConfig extends OperatorConfig<number> {
  type :"min"
}

class Min extends Operator<number> {

  constructor (graph :Graph, id :string, readonly config :MinConfig) {
    super(graph, id, config)
  }

  protected get _defaultInputValue () :number {
    return 0
  }
  
  protected _apply (values :number[]) :number {
    return Math.min(...values)
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerMathNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("constant", Constant)
  registry.registerNodeType("subtract", Subtract)
  registry.registerNodeType("multiply", Multiply)
  registry.registerNodeType("random", Random)
  registry.registerNodeType("accumulate", Accumulate)
  registry.registerNodeType("sign", Sign)
  registry.registerNodeType("abs", Abs)
  registry.registerNodeType("min", Min)
}

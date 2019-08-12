import {Clock} from "../core/clock"
import {refEquals} from "../core/data"
import {Mutable, Value} from "../core/react"
import {Graph, GraphConfig} from "./graph"
import {InputEdge, Node, NodeConfig, NodeTypeRegistry, OutputEdge} from "./node"

/** Switches to true after a number of seconds have passed. */
export interface TimeoutConfig extends NodeConfig {
  type :"timeout"
  seconds :number
  output :OutputEdge<boolean>
}

class TimeoutNode extends Node {
  private _output = Mutable.local(false)
  private _timeout = setTimeout(() => this._output.update(true), this.config.seconds * 1000)

  constructor (graph :Graph, id :string, readonly config :TimeoutConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this._output
  }

  dispose () {
    super.dispose()
    clearTimeout(this._timeout)
  }
}

/** Pulses true at regular intervals. */
export interface IntervalConfig extends NodeConfig {
  type :"interval"
  seconds :number
  output :OutputEdge<boolean>
}

class IntervalNode extends Node {
  private _output = Mutable.local(false)
  private _interval = setInterval(
    () => { this._output.update(true) ; this._output.update(false) },
    this.config.seconds * 1000,
  )

  constructor (graph :Graph, id :string, readonly config :IntervalConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    return this._output
  }

  dispose () {
    super.dispose()
    clearInterval(this._interval)
  }
}

/** Stores a value, updating from the value input when the store input is set. */
export interface LatchConfig extends NodeConfig {
  type :"latch"
  store :InputEdge<boolean>
  value :InputEdge<any>
  output :OutputEdge<any>
}

class Latch extends Node {

  constructor (graph :Graph, id :string, readonly config :LatchConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string | undefined, defaultValue :any) {
    let stored :any = defaultValue
    return Value
      .join2(
        this.graph.getValue(this.config.store, false),
        this.graph.getValue(this.config.value, defaultValue),
      )
      .map(([store, value]) => {
        if (store) stored = value
        return stored
      })
  }
}

/** Provides the time, elapsed, and dt (default) fields from the clock. */
export interface ClockConfig extends NodeConfig {
  type :"clock"
  time :OutputEdge<number>
  elapsed :OutputEdge<number>
  dt :OutputEdge<number>
}

class ClockNode extends Node {

  constructor (graph :Graph, id :string, readonly config :ClockConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name? :string) {
    const field :(clock :Clock) => number =
      (name === "time" || name === "elapsed") ? clock => clock[name] : clock => clock.dt
    return this.graph.clock.map(field).toValue(0, refEquals)
  }
}

/** An encapsulated graph. */
export interface SubgraphConfig extends NodeConfig {
  type :"subgraph"
  graph :GraphConfig
}

export class Subgraph extends Node {
  _containedGraph :Graph
  _containedOutputs :Map<string, InputEdge<any>> = new Map()

  constructor (graph :Graph, id :string, readonly config :SubgraphConfig) {
    super(graph, id, config)

    const subctx = Object.create(graph.ctx)
    subctx.subgraph = this
    for (const key in config.graph) {
      const value = config.graph[key]
      if (value.type === 'output') {
        this._containedOutputs.set(value.name, value.input)
      }
    }
    this._disposer.add(this._containedGraph = new Graph(subctx, config.graph))
    this._disposer.add(graph.clock.onValue(clock => this._containedGraph.update(clock)))
  }

  connect () {
    this._containedGraph.connect()
  }

  protected _createOutput (name :string | undefined, defaultValue :any) {
    let edge :InputEdge<any>
    if (name === undefined) {
      if (this._containedOutputs.size !== 1) throw new Error("No default output")
      edge = this._containedOutputs.values().next().value
    } else {
      if (!this._containedOutputs.has(name)) throw new Error("Unknown output: " + name)
      edge = this._containedOutputs.get(name)
    }
    return this._containedGraph.getValue(edge, defaultValue)
  }
}

/** An input to a subgraph. */
export interface InputConfig extends NodeConfig {
  type :"input"
  name :string
  output :OutputEdge<any>
}

class Input extends Node {

  constructor (graph :Graph, id :string, readonly config :InputConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string | undefined, defaultValue :any) {
    const subgraph = this.graph.ctx.subgraph
    if (!subgraph) throw new Error("Input node used outside subgraph")
    return subgraph.graph.getValue(subgraph.config[this.config.name], defaultValue)
  }
}

/** An output from a subgraph. */
export interface OutputConfig extends NodeConfig {
  type :"output"
  name :string
  input :InputEdge<any>
}

class Output extends Node {

  constructor (graph :Graph, id :string, readonly config :OutputConfig) {
    super(graph, id, config)
  }
}

/** Logs its input to the console. */
export interface LogConfig extends NodeConfig {
  type :"log"
  input :InputEdge<any>
}

class Log extends Node {

  constructor (graph :Graph, id :string, readonly config :LogConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, undefined).onValue(
      value => console.log(value),
    ))
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUtilNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("timeout", TimeoutNode)
  registry.registerNodeType("interval", IntervalNode)
  registry.registerNodeType("latch", Latch)
  registry.registerNodeType("clock", ClockNode)
  registry.registerNodeType("subgraph", Subgraph)
  registry.registerNodeType("input", Input)
  registry.registerNodeType("output", Output)
  registry.registerNodeType("log", Log)
}

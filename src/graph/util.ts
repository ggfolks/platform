import {Clock} from "../core/clock"
import {refEquals} from "../core/data"
import {Mutable, Value} from "../core/react"
import {PMap} from "../core/util"
import {Graph, GraphConfig} from "./graph"
import {EdgeMeta, InputEdgeMeta, inputEdge, outputEdge, property} from "./meta"
import {InputEdge, Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Switches to true after a number of seconds have passed. */
abstract class TimeoutConfig implements NodeConfig {
  type = "timeout"
  @property() seconds = 0
  @outputEdge("boolean") output = undefined
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
abstract class IntervalConfig implements NodeConfig {
  type = "interval"
  @property() seconds = 0
  @outputEdge("boolean") output = undefined
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
abstract class LatchConfig implements NodeConfig {
  type = "latch"
  @inputEdge("boolean") store = undefined
  @inputEdge("any") value = undefined
  @outputEdge("any") output = undefined
}

class Latch extends Node {

  constructor (graph :Graph, id :string, readonly config :LatchConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
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
abstract class ClockConfig implements NodeConfig {
  type = "clock"
  @outputEdge("number") time = undefined
  @outputEdge("number") elapsed = undefined
  @outputEdge("number", true) dt = undefined
}

class ClockNode extends Node {

  constructor (graph :Graph, id :string, readonly config :ClockConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    const field :(clock :Clock) => number =
      (name === "time" || name === "elapsed") ? clock => clock[name] : clock => clock.dt
    return this.graph.clock.map(field).toValue(0, refEquals)
  }
}

/** An encapsulated graph. */
abstract class SubgraphConfig implements NodeConfig {
  type = "subgraph"
  graph :GraphConfig = {}
}

export class Subgraph extends Node {
  readonly containedGraph :Graph

  private _containedOutputs :Map<string, InputEdge<any>> = new Map()
  private _inputsMeta :PMap<InputEdgeMeta> = {}
  private _outputsMeta :PMap<EdgeMeta> = {}

  get inputsMeta () {
    return this._inputsMeta
  }

  get outputsMeta () {
    return this._outputsMeta
  }

  constructor (graph :Graph, id :string, readonly config :SubgraphConfig) {
    super(graph, id, config)

    const subctx = Object.create(graph.ctx)
    subctx.subgraph = this
    for (const key in config.graph) {
      const value = config.graph[key]
      if (value.type === 'input') {
        this._inputsMeta[value.name] = {type: "any"} // TODO: infer

      } else if (value.type === 'output') {
        this._containedOutputs.set(value.name, value.input)
        this._outputsMeta[value.name] = {type: "any"} // TODO: infer
      }
    }
    this._disposer.add(this.containedGraph = new Graph(subctx, config.graph))
    this._disposer.add(graph.clock.onValue(clock => this.containedGraph.update(clock)))
  }

  connect () {
    this.containedGraph.connect()
  }

  protected _createOutput (name :string, defaultValue :any) {
    let edge :InputEdge<any>
    if (name === undefined) {
      if (this._containedOutputs.size !== 1) throw new Error("No default output")
      edge = this._containedOutputs.values().next().value
    } else {
      if (!this._containedOutputs.has(name)) throw new Error("Unknown output: " + name)
      edge = this._containedOutputs.get(name)
    }
    return this.containedGraph.getValue(edge, defaultValue)
  }
}

/** An input to a subgraph. */
abstract class InputConfig implements NodeConfig {
  type = "input"
  @property() name = ""
  @outputEdge("any") output = undefined
}

class Input extends Node {

  constructor (graph :Graph, id :string, readonly config :InputConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
    const subgraph = this.graph.ctx.subgraph
    if (!subgraph) throw new Error("Input node used outside subgraph")
    return subgraph.graph.getValue(subgraph.config[this.config.name], defaultValue)
  }
}

/** An output from a subgraph. */
abstract class OutputConfig implements NodeConfig {
  type = "output"
  @property() name = ""
  @inputEdge("any") input = undefined
}

class Output extends Node {

  constructor (graph :Graph, id :string, readonly config :OutputConfig) {
    super(graph, id, config)
  }
}

/** Logs its input to the console. */
abstract class LogConfig implements NodeConfig {
  type = "log"
  @inputEdge("any") input = undefined
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

/** Extracts a property of the (object) input. */
abstract class PropertyConfig implements NodeConfig {
  type = "property"
  @property() name = ""
  @inputEdge("object") input = undefined
  @outputEdge("any") output = undefined
}

class Property extends Node {

  constructor (graph :Graph, id :string, readonly config :PropertyConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string, defaultValue :any) {
    return this.graph.getValue(this.config.input, {}).map(value => value[this.config.name])
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
  registry.registerNodeType("property", Property)
}

import {Clock} from "../core/clock"
import {refEquals} from "../core/data"
import {ChangeFn, Mutable, Value} from "../core/react"
import {log, PMap} from "../core/util"
import {Graph, GraphConfig} from "./graph"
import {EdgeMeta, InputEdgeMeta, inputEdge, outputEdge, property} from "./meta"
import {InputEdge, Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Switches to true after a number of seconds have passed. */
abstract class TimeoutConfig implements NodeConfig {
  type = "timeout"
  @property() seconds = 0
  @inputEdge("boolean") start = undefined
  @outputEdge("boolean") output = undefined
}

class TimeoutNode extends Node {
  private _output = Mutable.local(false)
  private _timeout? :number

  constructor (graph :Graph, id :string, readonly config :TimeoutConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.start, true).onValue(start => {
      if (!start) return
      this._output.update(false)
      window.clearTimeout(this._timeout)
      this._timeout = window.setTimeout(() => this._output.update(true), this.config.seconds * 1000)
    }))
  }

  dispose () {
    super.dispose()
    window.clearTimeout(this._timeout)
  }

  protected _createOutput () {
    return this._output
  }
}

/** Pulses true at regular intervals. */
abstract class IntervalConfig implements NodeConfig {
  type = "interval"
  @property() seconds = 0
  @inputEdge("boolean") start = undefined
  @outputEdge("boolean") output = undefined
}

class IntervalNode extends Node {
  private _output = Mutable.local(false)
  private _interval? :number

  constructor (graph :Graph, id :string, readonly config :IntervalConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.start, true).onValue(start => {
      if (!start) return
      window.clearInterval(this._interval)
      this._interval = window.setInterval(
        () => {
          this._output.update(true)
          this._output.update(false)
        },
        this.config.seconds * 1000,
      )
    }))
  }

  dispose () {
    super.dispose()
    window.clearInterval(this._interval)
  }

  protected _createOutput () {
    return this._output
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

  toJSON () :NodeConfig {
    const json = super.toJSON()
    json.graph = this.containedGraph.toJSON()
    return json
  }

  fromJSON (json :NodeConfig) {
    super.fromJSON(json)
    this.containedGraph.fromJSON(json.graph)
    return json
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
  @property() message = ""
  @inputEdge("any") input = undefined
}

class Log extends Node {

  constructor (graph :Graph, id :string, readonly config :LogConfig) {
    super(graph, id, config)
  }

  connect () {
    this._disposer.add(this.graph.getValue(this.config.input, undefined).onValue(
      value => log.info(this.config.message || "", "value", value),
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

/** Calls a callback whenever the input changes. */
abstract class OnChangeConfig implements NodeConfig {
  type = "onChange"
  @property("ChangeFn") callback = undefined
  @inputEdge("any") input = undefined
}

class OnChange extends Node {

  constructor (graph :Graph, id :string, readonly config :OnChangeConfig) {
    super(graph, id, config)
  }

  connect () {
    const callback = this.config.callback as any
    if (callback instanceof Function) {
      const changeFn = callback as ChangeFn<any>
      this._disposer.add(this.graph.getValue(this.config.input, undefined).onChange(changeFn))
    } else {
      log.warn("Callback does not appear to be a Function")
    }
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUtilNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["util"], {
    timeout: TimeoutNode,
    interval: IntervalNode,
    latch: Latch,
    clock: ClockNode,
    subgraph: Subgraph,
    input: Input,
    output: Output,
    log: Log,
    property: Property,
  })
  registry.registerNodeTypes(undefined, {
    onChange: OnChange,
  })
}

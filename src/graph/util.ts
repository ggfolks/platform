import {Clock} from "../core/clock"
import {refEquals} from "../core/data"
import {Mutable} from "../core/react"
import {Graph} from "./graph"
import {InputEdge, Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Switches to true after a number of seconds have passed. */
export interface TimeoutConfig extends NodeConfig {
  type :"timeout"
  seconds :number
}

class TimeoutNode extends Node {
  private _output = Mutable.local(0)
  private _timeout = setTimeout(() => this._output.update(1), this.config.seconds * 1000)

  constructor (graph :Graph, id :string, readonly config :TimeoutConfig) {
    super(graph, id, config)
  }

  getOutput ()  {
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
}

class IntervalNode extends Node {
  private _output = Mutable.local(0)
  private _interval = setInterval(
    () => { this._output.update(1) ; this._output.update(0) },
    this.config.seconds * 1000,
  )

  constructor (graph :Graph, id :string, readonly config :IntervalConfig) {
    super(graph, id, config)
  }

  getOutput ()  {
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
  store :InputEdge
  value :InputEdge
}

class Latch extends Node {
  private _output = Mutable.local(0)

  constructor (graph :Graph, id :string, readonly config :LatchConfig) {
    super(graph, id, config)
  }

  getOutput ()  {
    return this._output
  }

  connect () {
    const value = this.graph.getValue(this.config.value)
    this._removers.push(this.graph.getValue(this.config.store).onValue(store => {
      if (store) {
        this._output.update(value.current)
      }
    }))
  }
}

/** Provides the time, elapsed, and dt (default) fields from the clock. */
export interface ClockConfig extends NodeConfig {
  type :"clock"
}

class ClockNode extends Node {

  constructor (graph :Graph, id :string, readonly config :ClockConfig) {
    super(graph, id, config)
  }

  getOutput (name? :string) {
    const field :(clock :Clock) => number =
      (name === "time" || name === "elapsed") ? clock => clock[name] : clock => clock.dt
    return this.graph.clock.map(field).toValue(0, refEquals)
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUtilNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("timeout", TimeoutNode)
  registry.registerNodeType("interval", IntervalNode)
  registry.registerNodeType("latch", Latch)
  registry.registerNodeType("clock", ClockNode)
}

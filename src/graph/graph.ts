import {Clock} from "../core/clock"
import {Emitter, Stream, Value} from "../core/react"
import {MutableMap, RMap} from "../core/rcollect"
import {Disposable} from "../core/util"
import {InputEdge, InputEdges, Node, NodeConfig, NodeContext} from "./node"

/** Configuration for a graph. */
export interface GraphConfig {
  [id :string] :NodeConfig
}

/** Returns the node id used for a fixed constant value. */
export function getConstantNodeId (value :any) {
  return `__${value}`
}

/** An execution graph. */
export class Graph implements Disposable {
  private _clock = new Emitter<Clock>()
  private _nodes = MutableMap.local<string, Node>()

  /** Returns a reactive view of the clock event stream. */
  get clock () :Stream<Clock> {
    return this._clock
  }

  /** Returns a reactive view of the map from node id to Node. */
  get nodes () :RMap<string, Node> {
    return this._nodes
  }

  constructor (readonly ctx :NodeContext, config :GraphConfig) {
    for (let id in config) {
      this._nodes.set(id, ctx.types.createNode(this, id, config[id]))
    }
  }

  /** Connects the nodes in the graph. */
  connect () {
    for (const node of this._nodes.values()) {
      node.connect()
    }
  }

  /** Retrieves a reactive value representing the identified input edges. */
  getValues<T> (inputs :InputEdges<T>, defaultValue :T) :Value<T[]> {
    if (!inputs) {
      return Value.constant([] as T[])
    }
    return Value.join(...inputs.map(input => this.getValue(input, defaultValue)))
  }

  /** Retrieves a reactive value representing the identified input edge. */
  getValue<T> (input :InputEdge<T>, defaultValue :T) :Value<T> {
    if (input === undefined) {
      return Value.constant(defaultValue)
    }
    if (Array.isArray(input)) {
      const [nodeId, outputName] = input
      return this._nodes.require(nodeId).getOutput(outputName, defaultValue)
    }
    if (typeof input === "string") {
      return this._nodes.require(input).getOutput(undefined, defaultValue)
    }
    const id = getConstantNodeId(input)
    let node = this._nodes.get(id)
    if (!node) {
      this._nodes.set(id, node = this.ctx.types.createNode(this, id, {
        type: "constant",
        value: input,
      }))
    }
    return node.getOutput(undefined, defaultValue)
  }

  /** Updates the state of the graph.  Should be called once per frame. */
  update (clock :Clock) {
    this._clock.emit(clock)
  }

  dispose () {
    for (const node of this._nodes.values()) {
      node.dispose()
    }
  }
}

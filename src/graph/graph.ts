import {Clock} from "../core/clock"
import {Emitter, Stream, Value} from "../core/react"
import {MutableMap, RMap} from "../core/rcollect"
import {Disposable} from "../core/util"
import {InputEdge, InputEdges, Node, NodeConfig, NodeContext} from "./node"

/** Configuration for a graph. */
export interface GraphConfig {
  [id :string] :NodeConfig
}

/** Returns the node id used for a fixed constant or reactive value. */
export function getConstantOrValueNodeId (value :any) {
  return (value instanceof Value) ? getValueNodeId(value) : getConstantNodeId(value)
}

/** Returns the node id used for a reactive value. */
function getValueNodeId (value :Value<any>) {
  return `$${value.id}`
}

/** Returns the node id used for a fixed constant value. */
function getConstantNodeId (value :any) {
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

  constructor (readonly ctx :NodeContext, readonly config :GraphConfig) {
    for (let id in config) {
      this._nodes.set(id, ctx.types.createNode(this, id, config[id]))
    }
  }

  /** Creates and connects a new node of the specified type, adding it to the config. */
  createNode (type :string) {
    // find a unique name based on the type
    let id = type
    for (let ii = 2; this._nodes.has(id); ii++) id = type + ii
    const node = this.ctx.types.createNode(this, id, this.config[id] = {type})
    this._nodes.set(id, node)
    node.connect()
  }

  /** Removes all the nodes in the graph. */
  removeAllNodes () {
    for (const node of this._nodes.values()) {
      node.dispose()
      delete this.config[node.id]
    }
    this._nodes.clear()
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
    if (input === undefined || input === null) {
      return Value.constant(defaultValue)
    }
    if (Array.isArray(input)) {
      const [nodeId, outputName] = input
      return this._nodes.require(nodeId).getOutput(outputName, defaultValue)
    }
    if (typeof input === "string") {
      return this._nodes.require(input).getOutput(undefined, defaultValue)
    }
    if (input instanceof Value) {
      const id = getValueNodeId(input)
      let node = this._nodes.get(id)
      if (!node) {
        this._nodes.set(id, node = this.ctx.types.createNode(this, id, {
          type: "value",
          value: input,
        }))
      }
      return node.getOutput(undefined, defaultValue)
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

  /** Returns a JSON representation of the graph. */
  toJSON () :GraphConfig {
    const json = {}
    for (const [key, node] of this._nodes) {
      json[key] = node.toJSON()
    }
    return json
  }

  /** Loads a JSON representation of the graph. */
  fromJSON (json :GraphConfig) {
    // remove any nodes not present in the configuration
    for (const [key, node] of this._nodes) {
      if (!json[key]) {
        delete this.config[key]
        this._nodes.delete(key)
        node.dispose()
      }
    }
    // add any new nodes, update existing
    for (const key in json) {
      const config = json[key]
      let node = this._nodes.get(key)
      if (node) {
        if (node.config.type === config.type) {
          node.fromJSON(config)
          continue
        }
        // if the type changed, we must dispose and recreate
        node.dispose()
      }
      node = this.ctx.types.createNode(this, key, this.config[key] = {type: config.type})
      this._nodes.set(key, node)
      node.fromJSON(config)
    }
    this.dispose()
    for (const node of this._nodes.values()) node.reconnect()
  }

  dispose () {
    for (const node of this._nodes.values()) {
      node.dispose()
    }
  }
}

import {Clock} from "../core/clock"
import {Emitter, Value} from "../core/react"
import {Disposable} from "../core/util"
import {InputEdge, InputEdges, Node, NodeConfig, NodeContext} from "./node"

/** Configuration for a graph. */
export interface GraphConfig {
  [id :string] :NodeConfig
}

/** An execution graph. */
export class Graph implements Disposable {
  readonly clock = new Emitter<Clock>()

  private _nodes :Map<string, Node> = new Map()

  constructor (readonly ctx :NodeContext, config :GraphConfig) {
    for (let id in config) {
      this._nodes.set(id, ctx.types.createNode(this, id, config[id]))
    }
    for (const node of this._nodes.values()) {
      node.connect()
    }
  }

  /** Retrieves a reactive value representing the identified input edges. */
  getValues (inputs :InputEdges) {
    if (!inputs) {
      return Value.constant([] as number[])
    }
    return Value.join(...inputs.map(input => this.getValue(input)))
  }

  /** Retrieves a reactive value representing the identified input edge. */
  getValue (input :InputEdge) {
    if (!input) {
      return Value.constant(0)
    }
    if (Array.isArray(input)) {
      const [nodeId, outputId] = input
      return this._requireNode(nodeId).getOutput(outputId)
    }
    return this._requireNode(input).getDefaultOutput()
  }

  /** Updates the state of the graph.  Should be called once per frame. */
  update (clock :Clock) {
    this.clock.emit(clock)
  }

  dispose () {
    for (const node of this._nodes.values()) {
      node.dispose()
    }
  }

  private _requireNode (id :string) {
    const node = this._nodes.get(id)
    if (!node) {
      throw new Error("Unknown node " + id)
    }
    return node
  }
}

import {Value} from "../core/react"
import {Remover} from "../core/util"
import {Disposable} from "../core/util"
import {Graph} from "./graph"

/** Configuration shared by all [[Node]]s. */
export interface NodeConfig {
  type :string
  // this allows NodeConfig to contain "extra" stuff that TypeScript will ignore
  [extra :string] :any
}

/** Optionally pairs a node id with the name of one of its outputs. */
export type NodeOutput = string | [string, string]

/** Indicates the node and output to which a single input is connected. */
export type InputEdge = undefined | NodeOutput

/** Indicates the node and output to which an array of inputs are connected. */
export type InputEdges = undefined | NodeOutput[]

/** Base interface for node contexts. */
export interface NodeContext {
  // this allows NodeContext to contain "extra" stuff that TypeScript will ignore
  [extra :string] :any
}

/** Parent class for all nodes. */
export abstract class Node implements Disposable {
  protected _removers :Remover[] = []

  constructor (readonly graph :Graph, readonly id :string, readonly config :NodeConfig) {}

  /** Returns the value corresponding to the identified output. */
  getOutput (output :string) :Value<number> {
    throw new Error("Unknown output " + output)
  }

  /** Returns the value corresponding to the default output. */
  getDefaultOutput () :Value<number> {
    throw new Error("No default output")
  }

  /** Connects and initializes the node. */
  connect () {}

  dispose () {
    for (const remover of this._removers) {
      remover()
    }
  }
}

interface NodeConstructor<T extends NodeConfig> {
  new (graph :Graph, id :string, config :T): Node
}

/** Maintains a mapping from string node types to constructors. */
export class NodeTypeRegistry {
  private _constructors :Map<string, NodeConstructor<NodeConfig>> = new Map()

  /** Registers a node type constructor. */
  registerNodeType<T extends NodeConfig> (type :string, constructor :NodeConstructor<T>) {
    this._constructors.set(type, constructor as NodeConstructor<NodeConfig>)
  }

  /** Creates a node with the supplied id and configuration. */
  createNode (graph :Graph, id :string, config :NodeConfig) {
    const Constructor = this._constructors.get(config.type)
    if (!Constructor) {
      throw new Error("Unknown node type: " + config.type)
    }
    return new Constructor(graph, id, config)
  }
}

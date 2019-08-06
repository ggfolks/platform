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

/** Describes the input of a node: a node ID, a node/output pair, or a static value. */
export type NodeInput<T> = string | [string, string] | T

/** Describes the connection state of a single node input. */
export type InputEdge<T> = undefined | NodeInput<T>

/** Describes the connection states of an array of node inputs. */
export type InputEdges<T> = undefined | InputEdge<T>[]

/** Used to describe output edges, whose connection states are omitted from configs. */
export type OutputEdge<T> = never

/** Base interface for node contexts. */
export interface NodeContext {
  types :NodeTypeRegistry
  // this allows NodeContext to contain "extra" stuff that TypeScript will ignore
  [extra :string] :any
}

/** Parent class for all nodes. */
export abstract class Node implements Disposable {
  protected _removers :Remover[] = []
  private _outputs :Map<string | undefined, Value<any>> = new Map()

  constructor (readonly graph :Graph, readonly id :string, readonly config :NodeConfig) {}

  /** Returns the value corresponding to the identified output, or the default if none. */
  getOutput (name? :string) :Value<any> {
    // create outputs lazily
    let output = this._outputs.get(name)
    if (!output) {
      this._outputs.set(name, output = this._createOutput(name))
    }
    return output
  }

  /** Connects and initializes the node. */
  connect () {}

  dispose () {
    for (const remover of this._removers) {
      remover()
    }
  }

  protected _createOutput (name? :string) :Value<any> {
    throw new Error("Unknown output " + name)
  }
}

interface NodeConstructor<T extends NodeConfig> {
  new (graph :Graph, id :string, config :T): Node
}

/** Maintains a mapping from string node types to constructors. */
export class NodeTypeRegistry {
  private _constructors :Map<string, NodeConstructor<NodeConfig>> = new Map()

  constructor (...regs :((registry :NodeTypeRegistry) => void)[]) {
    for (const reg of regs) {
      reg(this)
    }
  }

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

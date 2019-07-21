import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {Node, NodeConfig, NodeTypeRegistry} from "../graph/node"
import {Keyboard} from "./keyboard"

/** Provides an output of false or true depending on whether a key is pressed. */
export interface KeyConfig extends NodeConfig {
  type :"key"
  code :number
}

class Key extends Node {

  constructor (graph :Graph, id :string, readonly config :KeyConfig) { super(graph, id, config) }

  getDefaultOutput () :Value<number> {
    return Keyboard.instance.getKeyState(this.config.code).map(Number)
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerInputNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("key", Key)
}

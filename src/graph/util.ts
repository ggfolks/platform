import {Mutable} from "../core/react"
import {Graph} from "./graph"
import {Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Switches to true after an interval passes. */
export interface TimeoutConfig extends NodeConfig {
  type :"timeout"
  seconds :number
}

class Timeout extends Node {
  private _defaultOutput = Mutable.local(0)
  private _timeout = setTimeout(() => this._defaultOutput.update(1), this.config.seconds * 1000)

  constructor (graph :Graph, id :string, readonly config :TimeoutConfig) {
    super(graph, id, config)
  }

  getDefaultOutput ()  {
    return this._defaultOutput
  }

  dispose () {
    super.dispose()
    clearTimeout(this._timeout)
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerUtilNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("timeout", Timeout)
}

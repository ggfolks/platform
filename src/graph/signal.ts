import {Graph} from "./graph"
import {inputEdge, outputEdge} from "./meta"
import {Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Generates a sine wave, preserves phase over varying frequency. */
abstract class SineConfig implements NodeConfig {
  type = "sine"
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Sine extends Node {
  private _phase = 0

  constructor (graph :Graph, id :string, readonly config :SineConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const frequency = this.graph.getValue(this.config.frequency, 1)
    const amplitude = this.graph.getValue(this.config.amplitude, 1)
    return this.graph.clock.fold(
      0,
      (value, clock) => {
        this._phase += clock.dt * frequency.current * Math.PI * 2
        return amplitude.current * Math.sin(this._phase)
      },
    )
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSignalNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["signal"], {
    sine: Sine,
  })
}

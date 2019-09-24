import {Graph} from "./graph"
import {inputEdge, outputEdge, property} from "./meta"
import {InputEdge, Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Interface for wave generator configs. */
interface WaveConfig extends NodeConfig {
  frequency :InputEdge<number>
  amplitude :InputEdge<number>
}

/** Base class for wave generators. */
abstract class Wave extends Node {
  private _phase = 0

  constructor (graph :Graph, id :string, readonly config :WaveConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const frequency = this.graph.getValue(this.config.frequency, 1)
    const amplitude = this.graph.getValue(this.config.amplitude, 1)
    return this.graph.clock.fold(
      0,
      (value, clock) => {
        this._phase += clock.dt * frequency.current * Math.PI * 2
        return amplitude.current * this._getValue(this._phase)
      },
    )
  }

  protected abstract _getValue (phase :number) :number
}

/** Generates a sine wave, preserves phase over varying frequency. */
abstract class SineConfig implements WaveConfig {
  type = "sine"
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Sine extends Wave {

  constructor (graph :Graph, id :string, readonly config :SineConfig) {
    super(graph, id, config)
  }

  protected _getValue (phase :number) {
    return Math.sin(phase)
  }
}

/** Generates a square wave, preserves phase over varying frequency. */
abstract class SquareConfig implements WaveConfig {
  type = "square"
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Square extends Wave {

  constructor (graph :Graph, id :string, readonly config :SquareConfig) {
    super(graph, id, config)
  }

  protected _getValue (phase :number) {
    return (phase % (Math.PI * 2)) < Math.PI ? 1 : -1
  }
}

/** Generates a square wave, preserves phase over varying frequency. */
abstract class TriangleConfig implements WaveConfig {
  type = "triangle"
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Triangle extends Wave {

  constructor (graph :Graph, id :string, readonly config :TriangleConfig) {
    super(graph, id, config)
  }

  protected _getValue (phase :number) {
    const remainder = phase % (Math.PI * 2) / (Math.PI * 0.5)
    if (remainder <= 1) return remainder
    if (remainder <= 3) return 2 - remainder
    return remainder - 4
  }
}

/** Generates a sawtooth wave, preserves phase over varying frequency. */
abstract class SawtoothConfig implements WaveConfig {
  type = "sawtooth"
  @property() reversed = false
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Sawtooth extends Wave {

  constructor (graph :Graph, id :string, readonly config :SawtoothConfig) {
    super(graph, id, config)
  }

  protected _getValue (phase :number) {
    let remainder = phase % (Math.PI * 2) / Math.PI
    if (this.config.reversed) remainder = 2 - remainder
    return (remainder < 1) ? remainder : remainder - 2
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSignalNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["signal"], {
    sine: Sine,
    square: Square,
    triangle: Triangle,
    sawtooth: Sawtooth,
  })
}

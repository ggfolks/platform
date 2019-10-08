import {Value} from "../core/react"
import {getValue} from "../core/util"
import {Graph} from "./graph"
import {inputEdge, outputEdge, property} from "./meta"
import {InputEdge, Node, NodeConfig, NodeTypeRegistry} from "./node"

/** Interface for wave generator configs. */
interface WaveConfig extends NodeConfig {
  dutyCycle :InputEdge<number>
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
    const dutyCycle = this.graph.getValue(this.config.dutyCycle, 0.5)
    const frequency = this.graph.getValue(this.config.frequency, 1)
    const amplitude = this.graph.getValue(this.config.amplitude, 1)
    const twoPi = Math.PI * 2
    return this.graph.clock.fold(
      0,
      (value, clock) => {
        const onSpeed = frequency.current * Math.PI / dutyCycle.current
        const offSpeed = frequency.current * Math.PI / (1 - dutyCycle.current)
        for (let timeRemaining = clock.dt; timeRemaining > 0; ) {
          let timeToSwitch :number
          if (this._phase < Math.PI) { // on
            timeToSwitch = (Math.PI - this._phase) / onSpeed
            if (timeRemaining < timeToSwitch) {
              this._phase += timeRemaining * onSpeed
              break
            }
            this._phase = Math.PI
          } else { // off
            timeToSwitch = (twoPi - this._phase) / offSpeed
            if (timeRemaining < timeToSwitch) {
              this._phase += timeRemaining * offSpeed
              break
            }
            this._phase = 0
          }
          timeRemaining -= timeToSwitch
        }
        return amplitude.current * this._getValue(this._phase)
      },
    )
  }

  protected abstract _getValue (phase :number) :number
}

/** Generates a sine wave, preserves phase over varying frequency. */
abstract class SineConfig implements WaveConfig {
  type = "sine"
  @inputEdge("number") dutyCycle = undefined
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
  @inputEdge("number") dutyCycle = undefined
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Square extends Wave {

  constructor (graph :Graph, id :string, readonly config :SquareConfig) {
    super(graph, id, config)
  }

  protected _getValue (phase :number) {
    return phase < Math.PI ? 1 : -1
  }
}

/** Generates a square wave, preserves phase over varying frequency. */
abstract class TriangleConfig implements WaveConfig {
  type = "triangle"
  @inputEdge("number") dutyCycle = undefined
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Triangle extends Wave {

  constructor (graph :Graph, id :string, readonly config :TriangleConfig) {
    super(graph, id, config)
  }

  protected _getValue (phase :number) {
    const remainder = phase / (Math.PI * 0.5)
    if (remainder <= 1) return remainder
    if (remainder <= 3) return 2 - remainder
    return remainder - 4
  }
}

/** Generates a sawtooth wave, preserves phase over varying frequency. */
abstract class SawtoothConfig implements WaveConfig {
  type = "sawtooth"
  @property() reversed = false
  @inputEdge("number") dutyCycle = undefined
  @inputEdge("number") frequency = undefined
  @inputEdge("number") amplitude = undefined
  @outputEdge("number") output = undefined
}

class Sawtooth extends Wave {

  constructor (graph :Graph, id :string, readonly config :SawtoothConfig) {
    super(graph, id, config)
  }

  protected _getValue (phase :number) {
    let remainder = phase / Math.PI
    if (this.config.reversed) remainder = 2 - remainder
    return (remainder < 1) ? remainder : remainder - 2
  }
}

/** An ADSR envelope generator. */
abstract class EnvelopeConfig implements NodeConfig {
  type = "envelope"
  @property("number", {min: 0, wheelStep: 0.01}) attack = 0.1
  @property("number", {min: 0, wheelStep: 0.01}) decay = 0.1
  @property("number", {min: 0, max: 1, wheelStep: 0.01}) sustain = 0.5
  @property("number", {min: 0, wheelStep: 0.01}) release = 0.1
  @inputEdge("boolean") trigger = undefined
  @outputEdge("number") output = undefined
}

class Envelope extends Node {
  private _phase = 0
  private _level = 0
  private _armed = true

  constructor (graph :Graph, id :string, readonly config :EnvelopeConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const attack = getValue(this.config.attack, 0.1)
    const decay = getValue(this.config.decay, 0.1)
    const sustain = getValue(this.config.sustain, 0.5)
    const release = getValue(this.config.release, 0.1)
    return Value
      .join2(
        this.graph.clock.fold({dt: 0}, (value, clock) => ({dt: clock.dt})),
        this.graph.getValue(this.config.trigger, false),
      )
      .map(([clock, trigger]) => {
        if (trigger) {
          if (this._armed) {
            this._armed = false
            this._phase = 1
            this._level = 0
          }
        } else this._armed = true
        switch (this._phase) {
          case 1: // attacking
            this._level += clock.dt / attack
            if (this._level < 1) return this._level
            this._level = 1
            this._phase = 2
            // fall through to decay processing
          case 2: // decaying
            this._level -= clock.dt * (1 - sustain) / decay
            if (this._level > sustain) return this._level
            this._level = sustain
            this._phase = 3
            // fall through to sustain processing
          case 3: // sustaining
            if (trigger) return this._level
            this._phase = 4
            // fall through to release processing
          case 4: // releasing
            this._level -= clock.dt * sustain / release
            if (this._level > 0) return this._level
            this._phase = 0
            // fall through to pre-attack processing
          default:
            return 0
        }
      })
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerSignalNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["signal"], {
    sine: Sine,
    square: Square,
    triangle: Triangle,
    sawtooth: Sawtooth,
    envelope: Envelope,
  })
}

import {refEquals} from "../core/data"
import {Mutable, Value} from "../core/react"
import {Graph} from "../graph/graph"
import {outputEdge, property} from "../graph/meta"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
import {Hand} from "./hand"
import {Keyboard} from "./keyboard"
import {wheelEvents} from "./react"

/** Context for nodes relating to input. */
export interface InputNodeContext extends NodeContext {
  hand? :Hand
}

/** Provides an output of false or true depending on whether a key is pressed. */
abstract class KeyConfig implements NodeConfig {
  type = "key"
  @property("number", {min: 0, maxDecimals: 0}) code = 0
  @outputEdge("boolean") output = undefined
}

class Key extends Node {

  constructor (graph :Graph, id :string, readonly config :KeyConfig) { super(graph, id, config) }

  protected _createOutput () {
    return Keyboard.instance.getKeyState(this.config.code)
  }
}

/** Provides an output of false or true depending on whether a mouse button is pressed. */
abstract class MouseButtonConfig implements NodeConfig {
  type = "mouseButton"
  @property("number", {min: 0, maxDecimals: 0}) button = 0
  @outputEdge("boolean") output = undefined
}

class MouseButton extends Node {

  constructor (graph :Graph, id :string, readonly config :MouseButtonConfig) {
    super(graph, id, config)
  }

  protected _createOutput () {
    const hand = (this.graph.ctx as InputNodeContext).hand
    return hand ? hand.mouse.getButtonState(this.config.button || 0) : Value.constant(false)
  }
}

/** Fires on a double mouse click. */
abstract class DoubleClickConfig implements NodeConfig {
  type = "doubleClick"
  @outputEdge("boolean") output = undefined
}

class DoubleClick extends Node {
  private _output :Mutable<boolean> = Mutable.local(false as boolean)

  constructor (graph :Graph, id :string, readonly config :DoubleClickConfig) {
    super(graph, id, config)
  }

  connect () {
    const hand = (this.graph.ctx as InputNodeContext).hand
    if (hand) {
      this._disposer.add(hand.mouse.doubleClicked.onEmit(() => {
        this._output.update(true)
        this._output.update(false)
      }))
    }
  }

  protected _createOutput () {
    return this._output
  }
}

/** Provides outputs of x and y describing mouse movement in pixels. */
abstract class MouseMovementConfig implements NodeConfig {
  type = "mouseMovement"
  @outputEdge("number") x = undefined
  @outputEdge("number") y = undefined
}

class MouseMovement extends Node {

  constructor (graph :Graph, id :string, readonly config :MouseMovementConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    const hand = (this.graph.ctx as InputNodeContext).hand
    if (!hand) {
      return Value.constant(0)
    }
    const idx = Number(name === "y")
    return hand.mouse.movement.map(movement => movement[idx])
  }
}

/** Interface for nodes that filter by pointer configuration. */
export interface PointerConfig extends NodeConfig {
  index? :number
  count? :number
}

/** Provides outputs of x and y describing pointer movement in pixels. */
abstract class PointerMovementConfig implements PointerConfig {
  type = "pointerMovement"
  @property("number", {min: 0, maxDecimals: 0}) index = 0
  @property("number", {min: 1, maxDecimals: 0}) count = 1
  @outputEdge("number") x = undefined
  @outputEdge("number") y = undefined
}

class PointerMovement extends Node {

  constructor (graph :Graph, id :string, readonly config :PointerMovementConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    const hand = (this.graph.ctx as InputNodeContext).hand
    if (!hand) {
      return Value.constant(0)
    }
    const index = this.config.index || 0
    const count = this.config.count === undefined ? 1 : this.config.count
    const coord = Number(name === "y")
    return hand.pointers.fold(0, (output, map) => {
      if (map.size === count) {
        let remaining = index
        for (const value of map.values()) {
          if (remaining-- === 0) return value.movement[coord]
        }
      }
      return 0
    })
  }
}

/** Outputs wheel values. */
abstract class WheelConfig implements NodeConfig {
  type = "wheel"
  @outputEdge("number") deltaX = undefined
  @outputEdge("number", true) deltaY = undefined
  @outputEdge("number") deltaZ = undefined
}

class Wheel extends Node {

  constructor (graph :Graph, id :string, readonly config :WheelConfig) {
    super(graph, id, config)
  }

  protected _createOutput (name :string) {
    return Value.deriveValue(
      refEquals,
      dispatch => wheelEvents.onEmit(event => {
        const value = event[name]
        dispatch(value, 0)
        dispatch(0, value)
      }),
      () => 0,
    )
  }
}

/** Registers the nodes in this module with the supplied registry. */
export function registerInputNodes (registry :NodeTypeRegistry) {
  registry.registerNodeTypes(["input"], {
    key: Key,
    mouseButton: MouseButton,
    doubleClick: DoubleClick,
    mouseMovement: MouseMovement,
    pointerMovement: PointerMovement,
    wheel: Wheel,
  })
}

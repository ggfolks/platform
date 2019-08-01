import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry, OutputEdge} from "../graph/node"
import {Hand} from "./hand"
import {Keyboard} from "./keyboard"

/** Context for nodes relating to input. */
export interface InputNodeContext extends NodeContext {
  hand? :Hand
}

/** Provides an output of false or true depending on whether a key is pressed. */
export interface KeyConfig extends NodeConfig {
  type :"key"
  code :number
  output :OutputEdge<boolean>
}

class Key extends Node {

  constructor (graph :Graph, id :string, readonly config :KeyConfig) { super(graph, id, config) }

  getOutput () {
    return Keyboard.instance.getKeyState(this.config.code)
  }
}

/** Provides an output of false or true depending on whether a mouse button is pressed. */
export interface MouseButtonConfig extends NodeConfig {
  type :"mouseButton"
  button? :number
  output :OutputEdge<boolean>
}

class MouseButton extends Node {

  constructor (graph :Graph, id :string, readonly config :MouseButtonConfig) {
    super(graph, id, config)
  }

  getOutput () {
    const hand = (this.graph.ctx as InputNodeContext).hand
    return hand ? hand.mouse.getButtonState(this.config.button || 0) : Value.constant(false)
  }
}

/** Provides outputs of x and y describing mouse movement in pixels. */
export interface MouseMovementConfig extends NodeConfig {
  type :"mouseMovement"
  x :OutputEdge<number>
  y :OutputEdge<number>
}

class MouseMovement extends Node {

  constructor (graph :Graph, id :string, readonly config :MouseMovementConfig) {
    super(graph, id, config)
  }

  getOutput (name? :string) {
    const hand = (this.graph.ctx as InputNodeContext).hand
    if (!hand) {
      return Value.constant(0)
    }
    const idx = Number(name === "y")
    return hand.mouse.movement.map(movement => movement[idx])
  }
}

export interface PointerConfig extends NodeConfig {
  index? :number
  count? :number
}

/** Provides outputs of x and y describing pointer movement in pixels. */
export interface PointerMovementConfig extends PointerConfig {
  type :"pointerMovement"
  x :OutputEdge<number>
  y :OutputEdge<number>
}

class PointerMovement extends Node {

  constructor (graph :Graph, id :string, readonly config :PointerMovementConfig) {
    super(graph, id, config)
  }

  getOutput (name? :string) {
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

/** Registers the nodes in this module with the supplied registry. */
export function registerInputNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("key", Key)
  registry.registerNodeType("mouseButton", MouseButton)
  registry.registerNodeType("mouseMovement", MouseMovement)
  registry.registerNodeType("pointerMovement", PointerMovement)
}

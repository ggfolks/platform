import {Value} from "../core/react"
import {RMap} from "../core/rcollect"
import {Graph} from "../graph/graph"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry, OutputEdge} from "../graph/node"
import {Touch} from "./input"
import {Keyboard} from "./keyboard"
import {Mouse} from "./mouse"

/** Context for nodes relating to input. */
export interface InputNodeContext extends NodeContext {
  mouse? :Mouse
  touches? :RMap<number, Touch>
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
    const mouse = (this.graph.ctx as InputNodeContext).mouse
    return mouse ? mouse.getButtonState(this.config.button || 0) : Value.constant(false)
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
    const mouse = (this.graph.ctx as InputNodeContext).mouse
    if (!mouse) {
      return Value.constant(0)
    }
    const idx = Number(name === "y")
    return mouse.movement.map(movement => movement[idx])
  }
}

export interface TouchConfig extends NodeConfig {
  index? :number
  count? :number
}

/** Provides outputs of x and y describing touch movement in pixels. */
export interface TouchMovementConfig extends TouchConfig {
  type :"touchMovement"
  x :OutputEdge<number>
  y :OutputEdge<number>
}

class TouchMovement extends Node {

  constructor (graph :Graph, id :string, readonly config :TouchMovementConfig) {
    super(graph, id, config)
  }

  getOutput (name? :string) {
    const touches = (this.graph.ctx as InputNodeContext).touches
    if (!touches) {
      return Value.constant(0)
    }
    const index = this.config.index || 0
    const count = this.config.count === undefined ? 1 : this.config.count
    const coord = Number(name === "y")
    return touches.fold(0, (output, map) => {
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
  registry.registerNodeType("touchMovement", TouchMovement)
}

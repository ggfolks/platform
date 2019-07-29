import {Value} from "../core/react"
import {Graph} from "../graph/graph"
import {Node, NodeConfig, NodeContext, NodeTypeRegistry} from "../graph/node"
import {Keyboard} from "./keyboard"
import {Mouse} from "./mouse"

/** Context for nodes relating to input. */
export interface InputNodeContext extends NodeContext {
  mouse? :Mouse
}

/** Provides an output of false or true depending on whether a key is pressed. */
export interface KeyConfig extends NodeConfig {
  type :"key"
  code :number
}

class Key extends Node {

  constructor (graph :Graph, id :string, readonly config :KeyConfig) { super(graph, id, config) }

  getOutput () {
    return Keyboard.instance.getKeyState(this.config.code).map(Number)
  }
}

/** Provides an output of false or true depending on whether a mouse button is pressed. */
export interface MouseButtonConfig extends NodeConfig {
  type :"mouseButton"
  button? :number
}

class MouseButton extends Node {

  constructor (graph :Graph, id :string, readonly config :MouseButtonConfig) {
    super(graph, id, config)
  }

  getOutput () {
    const mouse = (this.graph.ctx as InputNodeContext).mouse
    return mouse ? mouse.getButtonState(this.config.button || 0).map(Number) : Value.constant(0)
  }
}

/** Provides outputs of x and y describing mouse movement in pixels. */
export interface MouseMovementConfig extends NodeConfig {
  type :"mouseMovement"
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

/** Registers the nodes in this module with the supplied registry. */
export function registerInputNodes (registry :NodeTypeRegistry) {
  registry.registerNodeType("key", Key)
  registry.registerNodeType("mouseButton", MouseButton)
  registry.registerNodeType("mouseMovement", MouseMovement)
}

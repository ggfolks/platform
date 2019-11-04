import {Remover, PMap, log} from "../core/util"
import {Command, Model} from "./model"

export const ShiftMask = 1 << 0
export const AltMask   = 1 << 1
export const CtrlMask  = 1 << 2
export const MetaMask  = 1 << 3

export function modMask (event :KeyboardEvent) :number {
  let mask = 0
  if (event.shiftKey) mask |= ShiftMask
  if (event.altKey) mask |= AltMask
  if (event.ctrlKey) mask |= CtrlMask
  if (event.metaKey) mask |= MetaMask
  return mask
}

const codeReplacements = {Delete: "Del", Escape: "Esc", Equal: "=", Minus: "-"}

type Binding = [number, string]

export function formatBinding (binding :Binding) {
  const [mods, code] = binding
  let str = ""
  if (mods & CtrlMask) str += "Ctrl+"
  if (mods & AltMask) str += "Alt+"
  if (mods & ShiftMask) str += "Shift+"
  if (mods & MetaMask) str += "Meta+"
  // only show the first mapping
  return str + (
    code.startsWith("Key")
    ? code.substring(3)
    : code.startsWith("Digit")
    ? code.substring(5)
    : codeReplacements[code] || code
  )
}

type ModMap = {[key :number] :string}

export class Bindings {
  private bindingsFor :Map<string, Binding[]>|undefined

  constructor (readonly bindings :PMap<ModMap>, readonly model :Model) {}

  getCommandBindings (name :string) :Binding[]|undefined {
    let bindings = this.bindingsFor
    if (!bindings) {
      bindings = this.bindingsFor = new Map()
      for (const code in this.bindings) {
        const modMap = this.bindings[code]
        for (const mods in modMap) {
          const command = modMap[mods]
          let list = bindings.get(command)
          if (!list) bindings.set(command, list = [])
          list.push([Number(mods), code])
        }
      }
    }
    return bindings.get(name)
  }

  /** Looks up and returns the action bound to the keyboard command represented by `event`.
    * @return `undefined` if no binding exists for the supplied keyboard command. */
  getBinding (event :KeyboardEvent) :string|undefined {
    const modMap = this.bindings[event.code]
    return modMap && modMap[modMask(event)]
  }
}

/** Maintains bindings between (optionally chorded) keys and actions to invoke when those keys are
  * pressed. */
export class Keymap {
  private layers :Bindings[] = []

  /** Adds a set of bindings to this keymap. They will take precedence over all existing bindings.
    * @return a remover which can be used to remove these bindings. */
  pushBindings (bindings :PMap<ModMap>, model :Model) :Remover {
    const layer = new Bindings(bindings, model)
    this.layers.unshift(layer)
    return () => {
      const idx = this.layers.indexOf(layer)
      if (idx >= 0) this.layers.splice(idx, 1)
    }
  }

  /** Returns the list of bindings (mod/code pairs), if any, for the named command.
    * These are returned from the highest priority keymap that has bindings for the command. */
  getCommandBindings (name :string) :Binding[] {
    for (const layer of this.layers) {
      const keys = layer.getCommandBindings(name)
      if (keys) return keys
    }
    return []
  }

  /** Looks up the binding for `event` and, if it exists and is bound to an enabled command or bare
    * action, invokes the action with the supplied arguments.
    * @return the id of the invoked action or `undefined` if no binding was found. */
  invokeAction (event :KeyboardEvent, ...args :any[]) :string|undefined {
    for (const layer of this.layers) {
      const binding = layer.getBinding(event)
      if (binding) {
        const action = layer.model.resolveOpt(binding)
        if (action instanceof Command) {
          action.enabled.once(enabled => {
            if (enabled) action.action(...args)
            // else log.info("Not invoking disabled command", "binding", binding)
          })
        }
        else if (typeof action === "function") action(...args)
        else log.warn("Key bound to non-action/command?", "binding", binding, "action", action)
        return binding
      }
    }
    return undefined
  }
}

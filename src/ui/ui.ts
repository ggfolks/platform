import {Record} from "../core/data"
import {makeConfig} from "../core/config"
import {Source, Subject} from "../core/react"
import {StyleContext, StyleDefs} from "./style"
import {Element, ElementConfig, ElementContext, Root, RootConfig} from "./element"
import * as X from "./box"
import * as G from "./group"
import * as T from "./text"
import * as B from "./button"

type ElemReg = {
  states :string[]
  create :(ctx :ElementContext, parent :Element, config :Record) => Element
}

/** Default element configuration. */
type ElemDefs = {[key :string] :Record}

type ModelElem = Source<any> | Model

/** Defines the reactive data model for the UI. This is a POJO with potentially nested objects whose
  * eventual leaf property values are reactive values which are displayed and/or updated by the UI
  * components and the game/application logic. */
export interface Model { [key :string] :ModelElem }

function findModelElem (model :Model, path :string[], pos :number) :ModelElem {
  const next = model[path[pos]]
  if (!next) throw new Error(`Missing model element at pos ${pos} in ${path}`)
  // TODO: would be nice if we could check the types here and freak out if we hit something
  // weird along the way
  else if (pos < path.length-1) return findModelElem(next as Model, path, pos+1)
  else return next
}

interface ImageResolver {
  resolveImage (path :string) :Subject<HTMLImageElement|Error>
}

export class UI extends StyleContext implements ElementContext {
  private protoStyles = new Map<string,Record>()
  private regs :{[key :string] :ElemReg} = {
    "box"   : {states: ["disabled"],
               create: (f, p, c) => new X.Box(f, p, c as any as X.BoxConfig)},
    "column": {states: ["disabled"],
               create: (f, p, c) => new G.Column(f, p, c as any as G.ColumnConfig)},
    "label" : {states: ["disabled"],
               create: (f, p, c) => new T.Label(f, p, c as any as T.LabelConfig)},
    "button" : {states: ["pressed", "disabled"],
               create: (f, p, c) => new B.Button(f, p, c as any as B.ButtonConfig)},
  }

  constructor (styles :StyleDefs,
               private readonly elems :ElemDefs,
               readonly model :Model,
               readonly resolver :ImageResolver) {
    super(styles)
  }

  createRoot (config :RootConfig) :Root {
    return new Root(this, config)
  }

  createElement (parent :Element, config :ElementConfig) :Element {
    const reg = this.regs[config.type]
    if (!reg) throw new Error(`Unknown element type '${config.type}'.`)
    const cfg = this.resolveConfig(config, reg.states)
    return reg.create(this, parent, cfg)
  }

  resolveModel<T, V extends Source<T>> (prop :string|V) :V {
    return (typeof prop !== "string") ? prop :
      findModelElem(this.model, prop.split("."), 0) as V
  }

  resolveConfig<C extends ElementConfig> (config :C, xstates :string[]) :Record {
    const states = ["normal", ...xstates]
    const protoStyles = this.resolveStyles(config.type, states)
    let pconfig = {...config} as any as Record
    pconfig.style = pconfig.style ?
      makeConfig([processStyles(this.styles, pconfig.style as Record, states), protoStyles]) :
      protoStyles
    return pconfig
  }

  resolveImage (path :string) :Subject<HTMLImageElement|Error> {
    return this.resolver.resolveImage(path)
  }

  private resolveStyles (type :string, states :string[]) :Record {
    function resolve (elems :ElemDefs, styles :StyleDefs, type :string, protos :Record[]) {
      const proto = elems[type]
      if (proto) {
        // pre-process the styles in our proto
        let pproto = {...proto}
        delete pproto["parent"]
        pproto = processStyles(styles, pproto as Record, states)
        protos.push(pproto)
        const parent = proto["parent"]
        if (typeof parent === "string") resolve(elems, styles, parent, protos)
      } // else: should we complain about missing proto?
      return protos
    }
    const proto = this.protoStyles.get(type)
    if (proto) return proto
    const nproto = makeConfig(resolve(this.elems, this.styles, type, []))
    this.protoStyles.set(type, nproto)
    return nproto
  }
}

function processStyles (defs :StyleDefs, styles :Record, states: string[]) :Record {
  const shared = {...styles}
  for (const state of states) delete shared[state]
  const pstyles :Record = {}
  for (const state of states) {
    pstyles[state] = makeConfig([styles[state] as Record, shared], false)
  }
  return pstyles
}

import {Record} from "../core/data"
import {makeConfig} from "../core/config"
import {Source, Subject} from "../core/react"
import {StyleContext, StyleDefs} from "./style"
import {Element, ElementConfig, ElementContext, StyleScope, Root, RootConfig} from "./element"
import * as E from "./element"
import * as X from "./box"
import * as G from "./group"
import * as T from "./text"
import * as B from "./button"

/** Defines a set of styles for elements. This is something like:
  * ```
  * {
  *   label: {...default label styles...},
  *   box: {...default box styles...},
  *   button: {...default button styles...},
  * }
  * ```
  * Where the styles for each element are defined by [[T.LabelStyles]], etc. */
interface ElemStyles {
  [key :string] :Record
}

/** Defines the default styles for elements for all the contexts in which elements appear. The
  * `default` context is used for elements that appear outside composite elements. Composite
  * elements define styles for elements nested within them. For example:
  * ```
  * {
  *   default: {label: { ... }, box: { ... } },
  *   button: {label: { ...labels inside buttons... }, box: { ...boxes inside buttons... }}
  * }
  * ``` */
export interface Theme {
  [key :string] :ElemStyles
}

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

function processStyles (styles :Record, states: string[]) :Record {
  const shared = {...styles}
  for (const state of states) delete shared[state]
  const pstyles :Record = {}
  for (const state of states) {
    pstyles[state] = makeConfig([styles[state] as Record, shared], false)
  }
  return pstyles
}

class StyleResolver {
  private protoStyles = new Map<string,Record>()

  constructor (readonly scope :StyleScope, readonly styles :ElemStyles[]) {}

  resolveStyles (type :string) :Record {
    const cached = this.protoStyles.get(type)
    if (cached) return cached
    const protos = this.styles.map(styles => {
      const proto = styles[type]
      return proto ? processStyles(proto, this.scope.states) : {}
    })
    const proto = makeConfig(protos)
    this.protoStyles.set(type, proto)
    return proto
  }
}

type ElemReg = {
  create :(ctx :ElementContext, parent :Element, config :Record) => Element
}

export class UI extends StyleContext implements ElementContext {
  private resolvers = new Map<string,StyleResolver>()

  private regs :{[key :string] :ElemReg} = {
    "box"    : {create: (f, p, c) => new X.Box(f, p, c as any as X.BoxConfig)},
    "control": {create: (f, p, c) => new E.Control(f, p, c as any as E.ControlConfig)},
    "column" : {create: (f, p, c) => new G.Column(f, p, c as any as G.ColumnConfig)},
    "label"  : {create: (f, p, c) => new T.Label(f, p, c as any as T.LabelConfig)},
    "button" : {create: (f, p, c) => new B.Button(f, p, c as any as B.ButtonConfig)},
  }

  constructor (styles :StyleDefs,
               readonly theme :Theme,
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
    const rstyles = this.resolveStyles(parent.styleScope, config.type, config.style as Record)
    const rconfig = {...config, style: rstyles} as any as Record
    return reg.create(this, parent, rconfig)
  }

  resolveModel<T, V extends Source<T>> (prop :string|V) :V {
    return (typeof prop !== "string") ? prop :
      findModelElem(this.model, prop.split("."), 0) as V
  }

  resolveStyles (scope :StyleScope, type :string, elemStyles :Record|undefined) :Record {
    const protoStyles = this.getStyleResolver(scope).resolveStyles(type)
    return elemStyles ? makeConfig([processStyles(elemStyles, scope.states), protoStyles]) :
      protoStyles
  }

  resolveImage (path :string) :Subject<HTMLImageElement|Error> {
    return this.resolver.resolveImage(path)
  }

  private getStyleResolver (scope :StyleScope) :StyleResolver {
    const cached = this.resolvers.get(scope.id)
    if (cached) return cached
    const styles = [this.theme[scope.id]]
    if (scope.id !== "default") styles.push(this.theme["default"])
    const resolver = new StyleResolver(scope, styles)
    this.resolvers.set(scope.id, resolver)
    return resolver
  }
}

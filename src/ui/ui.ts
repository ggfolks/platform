import {PMap, log} from "../core/util"
import {Record} from "../core/data"
import {makeConfig} from "../core/config"
import {ImageResolver, StyleContext, StyleDefs} from "./style"
import {Model, MissingModelElem} from "./model"
import {
  Element,
  ElementConfig,
  ElementContext,
  ElementFactory,
  StyleScope,
  Root,
  RootConfig,
} from "./element"
import * as B from "./button"
import * as D from "./dropdown"
import * as E from "./element"
import * as G from "./group"
import * as GR from "./graph"
import * as I from "./image"
import * as L from "./list"
import * as M from "./menu"
import * as P from "./property"
import * as S from "./scroll"
import * as TA from "./tabs"
import * as T from "./text"
import * as TR from "./tree"
import * as X from "./box"

/** Defines a set of styles for elements. This is something like:
  * ```
  * {
  *   label: {...default label styles...},
  *   box: {...default box styles...},
  *   button: {...default button styles...},
  * }
  * ```
  * Where the styles for each element are defined by [[T.LabelStyles]], etc. */
type ElemStyles = PMap<Record>

/** Defines the default styles for elements for all the contexts in which elements appear. The
  * `default` context is used for elements that appear outside composite elements. Composite
  * elements define styles for elements nested within them. For example:
  * ```
  * {
  *   default: {label: { ... }, box: { ... } },
  *   button: {label: { ...labels inside buttons... }, box: { ...boxes inside buttons... }}
  * }
  * ``` */
export type Theme = PMap<ElemStyles>

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

  constructor (readonly scope :StyleScope, readonly styles :ElemStyles[]) {
    for (let ii = 0; ii < styles.length; ii += 1) {
      if (!styles[ii]) throw new Error(`Missing styles for scope ${scope.id} @ ${scope.states[ii]}`)
    }
  }

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

export class UI {
  private resolvers = new Map<string,StyleResolver>()
  private readonly style :StyleContext
  private readonly elem :ElementFactory = {
    create: (ctx, parent, config) => this.createElement(ctx, parent, config)
  }

  constructor (private theme :Theme, defs :StyleDefs, image :ImageResolver) {
    this.style = new StyleContext(defs, image)
  }

  createRoot (config :RootConfig, model :Model) :Root {
    return new Root(new ElementContext(model, this.style, this.elem), config)
  }

  createElement (ctx :ElementContext, parent :Element, config :ElementConfig) :Element {
    try {
      const rstyles = this.resolveStyles(
        this.getElementScope(parent, config),
        config.type,
        config.style as Record,
      )
      const rconfig = {...config, style: rstyles} as any
      switch (config.type) {
      case           "box": return new X.Box(ctx, parent, rconfig as X.BoxConfig)
      case       "control": return new E.Control(ctx, parent, rconfig as E.ControlConfig)
      case           "row": return new G.Row(ctx, parent, rconfig as G.RowConfig)
      case        "column": return new G.Column(ctx, parent, rconfig as G.ColumnConfig)
      case     "absLayout": return new G.AbsLayout(ctx, parent, rconfig as G.AbsLayoutConfig)
      case        "spacer": return new G.Spacer(ctx, parent, rconfig as G.SpacerConfig)
      case         "image": return new I.Image(ctx, parent, rconfig as I.ImageConfig)
      case         "label": return new T.Label(ctx, parent, rconfig as T.LabelConfig)
      case        "cursor": return new T.Cursor(ctx, parent, rconfig as T.CursorConfig)
      case          "text": return new T.Text(ctx, parent, rconfig as T.TextConfig)
      case    "numberText": return new T.NumberText(ctx, parent, rconfig as T.NumberTextConfig)
      case     "colorText": return new T.ColorText(ctx, parent, rconfig as T.ColorTextConfig)
      case "editableLabel": return new T.EditableLabel(ctx, parent, rconfig as T.EditableLabelConfig)
      case        "button": return new B.Button(ctx, parent, rconfig as B.ButtonConfig)
      case        "toggle": return new B.Toggle(ctx, parent, rconfig as B.ToggleConfig)
      case         "hlist": return new L.HList(ctx, parent, rconfig as L.HListConfig)
      case         "vlist": return new L.VList(ctx, parent, rconfig as L.VListConfig)
      case     "dragVList": return new L.DragVList(ctx, parent, rconfig as L.DragVListConfig)
      case  "dragVElement": return new L.DragVElement(ctx, parent, rconfig as L.DragVElementConfig)
      case           "tab": return new TA.Tab(ctx, parent, rconfig as TA.TabConfig)
      case    "tabbedPane": return new TA.TabbedPane(ctx, parent, rconfig as TA.TabbedPaneConfig)
      case      "treeView": return new TR.TreeView(ctx, parent, rconfig as TR.TreeViewConfig)
      case  "treeViewNode": return new TR.TreeViewNode(ctx, parent, rconfig as TR.TreeViewNodeConfig)
      case      "dropdown": return new D.Dropdown(ctx, parent, rconfig as D.DropdownConfig)
      case  "dropdownList": return new D.DropdownList(ctx, parent, rconfig as D.DropdownListConfig)
      case  "dropdownItem": return new D.DropdownItem(ctx, parent, rconfig as D.DropdownItemConfig)
      case       "menuBar": return new M.MenuBar(ctx, parent, rconfig as M.MenuBarConfig)
      case          "menu": return new M.Menu(ctx, parent, rconfig as M.MenuConfig)
      case      "menuItem": return new M.MenuItem(ctx, parent, rconfig as M.MenuItemConfig)
      case      "shortcut": return new M.Shortcut(ctx, parent, rconfig as M.ShortcutConfig)
      case        "panner": return new S.Panner(ctx, parent, rconfig as S.PannerConfig)
      case      "scroller": return new S.Scroller(ctx, parent, rconfig as S.ScrollerConfig)
      case   "graphViewer": return new GR.GraphViewer(ctx, parent, rconfig as GR.GraphViewerConfig)
      case     "graphView": return new GR.GraphView(ctx, parent, rconfig as GR.GraphViewConfig)
      case      "nodeView": return new GR.NodeView(ctx, parent, rconfig as GR.NodeViewConfig)
      case  "propertyView": return new P.PropertyView(ctx, parent, rconfig as P.PropertyViewConfig)
      case      "edgeView": return new GR.EdgeView(ctx, parent, rconfig as GR.EdgeViewConfig)
      case      "terminal": return new GR.Terminal(ctx, parent, rconfig as GR.TerminalConfig)
      default: throw new Error(`Unknown element type '${config.type}'.`)
      }
    } catch (error) {
      log.warn("Failed to create element", "type", config.type, error)
      log.warn(`- path to element: ${parent.configPath.concat(config.type)}`)
      log.warn(`- element config: ${JSON.stringify(config)}`)
      if (error instanceof MissingModelElem) {
        log.warn(`- path to model value: ${error.path} (missing @ ${error.pos})`)
      }
      return new E.ErrorViz(ctx, parent, {type: "error"})
    }
  }

  getElementScope (parent :Element, config :ElementConfig) :StyleScope {
    switch (config.type) {
      case "terminal": return GR.TerminalStyleScope
      default:
        return config.scopeId
          ? {id: config.scopeId, states: parent.styleScope.states}
          : parent.styleScope
    }
  }

  resolveStyles (scope :StyleScope, type :string, elemStyles :Record|undefined) :Record {
    const protoStyles = this.getStyleResolver(scope).resolveStyles(type)
    return elemStyles ? makeConfig([processStyles(elemStyles, scope.states), protoStyles]) :
      protoStyles
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

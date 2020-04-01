import {dim2, rect} from "../core/math"
import {log, developMode} from "../core/util"
import {ElementsModel, ModelKey, Spec} from "./model"
import {Element} from "./element"
import {Model} from "./model"
import {Group} from "./group"

const tmpr = rect.create()
const gaps = (gap :number|undefined, count :number) => (gap||0) * Math.max(0, count-1)
const sum = (ns :number[]) => ns.reduce((a, b) => a+b, 0)

export type ElementConfigsMaker = (model :Model, key :ModelKey) => Element.Config[]

const elementConfigs = (elements :Element.Config[]|ElementConfigsMaker,
                        model :Model, key :ModelKey) =>
  typeof elements === "function" ? elements(model, key) : elements

export namespace Table {

  type AxisMetrics = {max :number, total :number}

  type Metrics = {
    rows :AxisMetrics[]
    cols :AxisMetrics[]
  }

  function note (size :number, ms :AxisMetrics[], idx :number) {
    const m = ms[idx] || (ms[idx] = {max: 0, total: 0})
    m.max = Math.max(m.max, size)
    m.total += size
  }

  function computeMetrics (
    elems :Element[], cols :number, hgap :number|undefined, hintX :number, hintY :number
  ) :Metrics {
    const hintCol = (hintX - gaps(hgap, cols)) / cols
    const m :Metrics = {rows: [], cols: []}
    let col = 0, row = 0
    for (const elem of elems) {
      if (!elem.visible.current) continue
      const psize = elem.preferredSize(hintCol, hintY)
      note(psize[0], m.cols, col)
      note(psize[1], m.rows, row)
      if (++col === cols) { col = 0 ; row += 1 }
    }
    return m
  }

  export interface Config extends Element.Config {
    hgap? :number
    vgap? :number
    // the elements that make up a row
    elements :Element.Config[]|ElementConfigsMaker
    model :Spec<ElementsModel<ModelKey>>
  }

  export class Table extends Group {
    readonly elements = new Map<ModelKey, Element[]>()
    readonly contents :Element[] = []
    private cols = 0

    constructor (ctx :Element.Context, parent :Element, readonly config :Config) {
      super(ctx, parent, config)
      const model = ctx.model.resolveAs(config.model, "model")
      this.disposer.add(model.keys.onValue(keys => {
        const {elements, contents} = this
        // convert keys (which maybe be a single use iterable) into a set
        const kset = new Set(keys)
        // first dispose no longer used elements
        for (const [ekey, elems] of elements) {
          if (!kset.has(ekey)) {
            elements.delete(ekey)
            for (const elem of elems) elem.dispose()
          }
        }
        // now create/reuse elements for the new keys
        contents.length = 0
        for (const key of kset) {
          let elems = elements.get(key)
          if (!elems) {
            const emodel = model.resolve(key)
            elems = elementConfigs(config.elements, emodel, key).map(
              elem => ctx.elem.create(ctx.remodel(emodel), this, elem))
            this.cols = elems.length
            elements.set(key, elems)
          }
          contents.push(...elems)
        }
        // TODO: if the contents did not change at all, avoid invalidation?
        this.invalidate()
      }))
    }

    protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
      const {hgap, vgap} = this.config, cols = this.cols
      const m = computeMetrics(this.contents, cols, hgap, hintX, hintY)
      const width = sum(m.cols.map(c => c.max)) + gaps(hgap, cols)
      const height = sum(m.rows.map(c => c.max)) + gaps(vgap, m.rows.length)
      dim2.set(into, width, height)
    }

    protected relayout () {
      const {hgap, vgap} = this.config, bounds = this.bounds, cols = this.cols
      const left = bounds[0], top = bounds[1], width = bounds[2], height = bounds[3]
      const m = computeMetrics(this.contents, cols, hgap||0, width, height)

      let x = left, y = top, col = 0, row = 0
      for (const elem of this.contents) {
        if (!elem.visible.current) continue
        const cwidth = m.cols[col].max, cheight = m.rows[row].max
        elem.setBounds(rect.set(tmpr, x, y, cwidth, cheight))
        x += cwidth+ (hgap||0)
        if (++col === cols) {
          col = 0
          row += 1
          x = left
          y += cheight + (vgap||0)
        }
      }
      const layHeight = y - top - (vgap||0)
      this.overflowed = layHeight > this.bounds[3]
      if (developMode && this.overflowed) log.warn(
        "Table overflowed bounds", "group", this, "height", layHeight)
    }
  }

  export const Catalog :Element.Catalog = {
    "table": (ctx, parent, cfg) => new Table(ctx, parent, cfg as Config),
  }
}

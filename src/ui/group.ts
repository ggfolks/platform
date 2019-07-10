import {dim2, rect} from "../core/math"
import {Element, ElementConfig, ElementFactory} from "./element"

const tmpr = rect.create()

interface GroupConfig extends ElementConfig {
  children: ElementConfig[]
}

abstract class Group extends Element {

  constructor (readonly config :GroupConfig, readonly children :Element[]) { super() }

  render (canvas :CanvasRenderingContext2D) {
    for (const child of this.children) child.render(canvas)
  }

  protected revalidate () {
    super.revalidate()
    for (const elem of this.children) elem.validate()
  }
}

class Metrics {
  count = 0
  prefWidth = 0
  prefHeight = 0
  maxWidth = 0
  maxHeight = 0
  fixWidth = 0
  fixHeight = 0
  unitWidth = 0
  unitHeight = 0
  stretchers = 0
  totalWeight = 0

  gaps (gap :number) :number { return gap * (this.count-1) }
}

export type AxisConstraints = {
  stretch? :boolean,
  weight? :number
}

function axisConstraints (elem :Element) :AxisConstraints {
  return elem.config.constraints || {}
}

function axisWeight (c :AxisConstraints) :number { return c.weight || 1 }

function computeSize (c :AxisConstraints, size :number, totalWeight :number,
                      availSize :number) :number {
  return c.stretch ? (availSize * axisWeight(c) / totalWeight) : size
}

function computeMetrics (group :Group, hintX :number, hintY :number,
                         gap :number, vert :boolean) {
  const m = new Metrics()
  for (const elem of group.children) {
    if (!elem.visible.current) continue
    m.count += 1

    // only compute the preferred size for the fixed elements in this pass
    const c = axisConstraints(elem)
    if (!c.stretch) {
      const psize = elem.preferredSize(hintX, hintY)
      const pwidth = psize[0], pheight = psize[1]
      m.prefWidth += pwidth
      m.prefHeight += pheight
      m.maxWidth = Math.max(m.maxWidth, pwidth)
      m.maxHeight = Math.max(m.maxHeight, pheight)
      m.fixWidth += pwidth
      m.fixHeight += pheight
    } else {
      m.stretchers += 1
      m.totalWeight += axisWeight(c)
    }
  }

  // now compute the preferred size for the stretched elements, providing them with more accurate
  // width/height hints
  for (const elem of group.children) {
    if (!elem.visible.current) continue
    const c = axisConstraints(elem)
    if (!c.stretch) continue

    // the first argument to computeSize is not used for stretched elements
    const availX = hintX - m.gaps(gap), availY = hintY - m.gaps(gap)
    const ehintX = vert ? availX : computeSize(c, 0, m.totalWeight, availX - m.fixWidth)
    const ehintY = vert ? computeSize(c, 0, m.totalWeight, availY - m.fixHeight) : availY
    const psize = elem.preferredSize(ehintX, ehintY)
    const pwidth = psize[0], pheight = psize[1]
    m.unitWidth = Math.max(m.unitWidth, pwidth / axisWeight(c))
    m.unitHeight = Math.max(m.unitHeight, pheight / axisWeight(c))
    m.maxWidth = Math.max(m.maxWidth, pwidth)
    m.maxHeight = Math.max(m.maxHeight, pheight)
  }
  m.prefWidth += m.stretchers * m.unitWidth
  m.prefHeight += m.stretchers * m.unitHeight

  return m
}

export type OffAxisPolicy = "stretch" | "equalize" | "constrain"

function computeOffSize (policy :OffAxisPolicy, size :number, maxSize :number, extent :number) {
  switch (policy) {
  case "stretch": return extent
  case "equalize": return Math.min(maxSize, extent)
  case "constrain": return Math.min(size, extent)
  }
}

interface AxisConfig extends GroupConfig {
  gap? :number
  offPolicy? :OffAxisPolicy
}

export interface ColumnConfig extends AxisConfig {
  type :"column"
}

export class Column extends Group {

  constructor (fact :ElementFactory, readonly config :ColumnConfig) {
    super(config, config.children.map(cc => fact.createElement(cc)))
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const gap = this.config.gap || 0
    const m = computeMetrics(this, hintX, hintY, gap, true)
    dim2.set(into, m.maxWidth, m.prefHeight + m.gaps(gap))
  }

  protected relayout () {
    const offPolicy = this.config.offPolicy || "constrain"
    const gap = this.config.gap || 0
    const bounds = this._bounds
    const left = bounds[0], top = bounds[1], width = bounds[2], height = bounds[3]
    const m = computeMetrics(this, width, height, gap, true)
    const stretchHeight = Math.max(0, height - m.gaps(gap) - m.fixHeight)
    let y = top
    for (const elem of this.children) {
      if (!elem.visible.current) continue
      const psize = elem.preferredSize(width, height) // will be cached
      const c = axisConstraints(elem)
      const ewidth = computeOffSize(offPolicy, psize[0], m.maxWidth, width)
      const eheight = computeSize(c, psize[1], m.totalWeight, stretchHeight)
      elem.setBounds(rect.set(tmpr, left, y, ewidth, eheight))
      y += (eheight + gap)
    }
  }
}

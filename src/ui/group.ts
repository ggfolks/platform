import {dim2, rect, vec2, vec2zero} from "../core/math"
import {getValue, log, developMode} from "../core/util"
import {Element, ElementConfig, ElementContext, ElementOp} from "./element"

const tmpr = rect.create()

/** Groups contain multiple child elements.
  * Different subclasses of group implement different layout policies. */
abstract class Group extends Element {
  protected overflowed = false
  abstract get contents () :Element[]

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    for (const cc of this.contents) {
      const interaction = cc.maybeHandlePointerDown(event, pos)
      if (interaction) return interaction
    }
    return undefined
  }
  handleWheel (event :WheelEvent, pos :vec2) :boolean {
    for (const cc of this.contents) {
      if (cc.maybeHandleWheel(event, pos)) return true
    }
    return false
  }
  handleDoubleClick (event :MouseEvent, pos :vec2) :boolean {
    for (const cc of this.contents) {
      if (cc.maybeHandleDoubleClick(event, pos)) return true
    }
    return false
  }

  findChild (type :string) :Element|undefined {
    const self = super.findChild(type)
    if (self) return self
    for (const cc of this.contents) {
      const child = cc.findChild(type)
      if (child) return child
    }
    return undefined
  }
  findTaggedChild (tag :string) :Element|undefined {
    const self = super.findTaggedChild(tag)
    if (self) return self
    for (const cc of this.contents) {
      const child = cc.findTaggedChild(tag)
      if (child) return child
    }
    return undefined
  }

  applyToChildren (op :ElementOp) { for (const elem of this.contents) op(elem) }
  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :ElementOp) {
    if (!super.applyToContaining(canvas, pos, op)) return false
    for (const cc of this.contents) {
      if (cc.applyToContaining(canvas, pos, op)) return true
    }
    return true
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    // render in reverse order since we process events in forward
    for (let ii = this.contents.length - 1; ii >= 0; ii--) this.contents[ii].render(canvas, region)
    if (developMode && this.overflowed) {
      canvas.strokeStyle = "red"
      canvas.lineWidth = 2
      const b = this.bounds
      canvas.strokeRect(b[0]+1, b[1]+1, b[2]-2, b[3]-2)
      canvas.lineWidth = 1
    }
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "constrain" }
}

/** Layout constraints for absolutely-positioned elements. */
export type AbsConstraints = {
  position? :number[],
  size? :number[],
  stretchX? :boolean,
  stretchY? :boolean,
}

function absConstraints (elem :Element) :AbsConstraints {
  return elem.config.constraints || {}
}

function absPosition (c :AbsConstraints) { return c.position || vec2zero }

/** A group whose contents are positioned absolutely. */
export abstract class AbsGroup extends Group {

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    if (!super.applyToContaining(canvas, pos, op)) return false
    // elements may overlap, so don't stop when one of them returns true
    for (const cc of this.contents) cc.applyToContaining(canvas, pos, op)
    return true
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    // handle mouse events in reverse order of drawing
    for (let ii = this.contents.length - 1; ii >= 0; ii--) {
      const interaction = this.contents[ii].maybeHandlePointerDown(event, pos)
      if (interaction) return interaction
    }
    return undefined
  }

  handleWheel (event :WheelEvent, pos :vec2) {
    for (let ii = this.contents.length - 1; ii >= 0; ii--) {
      if (this.contents[ii].maybeHandleWheel(event, pos)) return true
    }
    return false
  }

  handleDoubleClick (event :MouseEvent, pos :vec2) {
    for (let ii = this.contents.length - 1; ii >= 0; ii--) {
      if (this.contents[ii].maybeHandleDoubleClick(event, pos)) return true
    }
    return false
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, 0, 0)
    for (const element of this.contents) {
      const constraints = absConstraints(element)
      const position = absPosition(constraints)
      const size = constraints.size || element.preferredSize(hintX, hintY)
      into[0] = Math.max(into[0], position[0] + size[0])
      into[1] = Math.max(into[1], position[1] + size[1])
    }
  }

  protected relayout () {
    for (const element of this.contents) {
      const constraints = absConstraints(element)
      const position = absPosition(constraints)
      const size = constraints.size || element.preferredSize(this.width, this.height)
      element.setBounds(rect.set(
        tmpr,
        this.x + position[0],
        this.y + position[1],
        constraints.stretchX ? this.width : size[0],
        constraints.stretchY ? this.height : size[1],
      ))
    }
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    // render in forward order since we process events in reverse
    for (const child of this.contents) child.render(canvas, region)
  }
}

export interface AbsLayoutConfig extends ElementConfig {
  type :"absLayout"
  contents: ElementConfig[]
}

export class AbsLayout extends AbsGroup {
  readonly contents :Element[]

  constructor (ctx :ElementContext, parent :Element, readonly config :AbsLayoutConfig) {
    super(ctx, parent, config)
    this.contents = config.contents.map(cc => ctx.elem.create(ctx, this, cc))
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

  gaps (gap :number) :number { return gap * Math.max(0, this.count-1) }
}

/** Layout constraints for elements contained by a group that lays out along an axis. */
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
  return c.stretch ? Math.round(availSize * axisWeight(c) / totalWeight) : size
}

function computeMetrics (group :Group, hintX :number, hintY :number,
                         gap :number, vert :boolean) {
  const m = new Metrics()
  for (const elem of group.contents) {
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
  for (const elem of group.contents) {
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

/** Defines the behavior of axis-layout groups on their off-axis (width for vertical groups, height
  * for horizontal groups).
  *  - `stretch` - size all elements to the group's off-axis size.
  *  - `equalize` - size all elements to the size of the largest element in the off-axis dimension.
  *  - `constrain` - size all elements to their preferred size, but constrain any that prefer a size
  *                  larger than the group's off-axis size to that maximum size.
  */
export type OffAxisPolicy = "stretch" | "equalize" | "constrain"

function computeOffSize (policy :OffAxisPolicy, size :number, maxSize :number, extent :number) {
  switch (policy) {
  case "stretch": return extent
  case "equalize": return Math.min(maxSize, extent)
  case "constrain": return Math.min(size, extent)
  }
}

export interface AxisConfig extends ElementConfig {
  gap? :number
  offPolicy? :OffAxisPolicy
}

export abstract class VGroup extends Group {

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const gap = this.config.gap || 0
    const m = computeMetrics(this, hintX, hintY, gap, true)
    dim2.set(into, m.maxWidth, m.prefHeight + m.gaps(gap))
  }

  protected relayout () {
    const offPolicy = this.config.offPolicy || this.defaultOffPolicy
    const gap = this.config.gap || 0
    const bounds = this.bounds
    const left = bounds[0], top = bounds[1], width = bounds[2], height = bounds[3]
    const m = computeMetrics(this, width, height, gap, true)
    const stretchHeight = Math.max(0, height - m.gaps(gap) - m.fixHeight)
    let y = top
    for (const elem of this.contents) {
      if (!elem.visible.current) continue
      const psize = elem.preferredSize(width, height) // will be cached
      const c = axisConstraints(elem)
      const ewidth = computeOffSize(offPolicy, psize[0], m.maxWidth, width)
      const eheight = computeSize(c, psize[1], m.totalWeight, stretchHeight)
      // if the element is constrained (rather than stretched or equalized), it might be slimmer
      // than the column width, so we center it; this is a more useful default I think, and if you
      // really want left-aligned elements, you can equalize or stretch and put your sub-elements in
      // a left-aligned box
      elem.setBounds(rect.set(tmpr, left+(width-ewidth)/2, y, ewidth, eheight))
      y += (eheight + gap)
    }
    const layHeight = y - this.bounds[1] - gap
    this.overflowed = layHeight > this.bounds[3]
    if (developMode && this.overflowed) log.warn(
      "Vertical group overflowed bounds", "group", this, "height", layHeight)
  }
}

/** Defines configuration for [[Column]] elements. */
export interface ColumnConfig extends AxisConfig {
  type :"column"
  contents: ElementConfig[]
}

/** A column lays out its child elements along a vertical axis. */
export class Column extends VGroup {
  readonly contents :Element[]

  constructor (ctx :ElementContext, parent :Element, readonly config :ColumnConfig) {
    super(ctx, parent, config)
    this.contents = config.contents.map(cc => ctx.elem.create(ctx, this, cc))
  }
}

export abstract class HGroup extends Group {

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    const gap = this.config.gap || 0
    const m = computeMetrics(this, hintX, hintY, gap, true)
    dim2.set(into, m.prefWidth + m.gaps(gap), m.maxHeight)
  }

  protected relayout () {
    const offPolicy = this.config.offPolicy || this.defaultOffPolicy
    const gap = this.config.gap || 0
    const bounds = this.bounds
    const left = bounds[0], top = bounds[1], width = bounds[2], height = bounds[3]
    const m = computeMetrics(this, width, height, gap, true)
    const stretchWidth = Math.max(0, width - m.gaps(gap) - m.fixWidth)
    let x = left
    for (const elem of this.contents) {
      if (!elem.visible.current) continue
      const psize = elem.preferredSize(width, height) // will be cached
      const c = axisConstraints(elem)
      const ewidth = computeSize(c, psize[0], m.totalWeight, stretchWidth)
      const eheight = computeOffSize(offPolicy, psize[1], m.maxHeight, height)
      // if the element is constrained (rather than stretched or equalized), it might be slimmer
      // than the row height, so we center it; this is a more useful default I think, and if you
      // really want top-aligned elements, you can equalize or stretch and put your sub-elements in
      // a top-aligned box
      elem.setBounds(rect.set(tmpr, x, top+(height-eheight)/2, ewidth, eheight))
      x += (ewidth + gap)
    }
    const layWidth = x - this.bounds[0] - gap
    this.overflowed = layWidth > this.bounds[2]
    if (developMode && this.overflowed) log.warn(
      "Horizontal group overflowed bounds", "group", this, "width", layWidth)
  }
}

/** Defines configuration for [[Row]] elements. */
export interface RowConfig extends AxisConfig {
  type :"row"
  contents: ElementConfig[]
}

/** A row lays out its child elements along a horizontal axis. */
export class Row extends HGroup {
  readonly contents :Element[]

  constructor (ctx :ElementContext, parent :Element, readonly config :RowConfig) {
    super(ctx, parent, config)
    this.contents = config.contents.map(cc => ctx.elem.create(ctx, this, cc))
  }
}

/** Defines configuration for [[Spacer]] elements. */
export interface SpacerConfig extends ElementConfig {
  type :"spacer"
  width? :number
  height? :number
}

/** An element that simply takes up space. */
export class Spacer extends Element {

  constructor (ctx :ElementContext, parent :Element, readonly config :SpacerConfig) {
    super(ctx, parent, config)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, getValue(this.config.width, 0), getValue(this.config.height, 0))
  }

  protected relayout () {}
  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {}
}

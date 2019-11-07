import {dim2, vec2, rect} from "../core/math"
import {refEquals} from "../core/data"
import {Noop, Remover, PMap, getValue} from "../core/util"
import {Mutable, Subject, Value, falseValue} from "../core/react"
import {Control, ControlConfig, ControlStates, Element, ElementConfig, ElementContext,
        PointerInteraction} from "./element"
import {Spec, FontConfig, Paint, PaintConfig, ShadowConfig, Span, EmptySpan,
        insetsToCSS} from "./style"
import {Model, Action, NoopAction} from "./model"
import {CtrlMask, MetaMask, Bindings} from "./keymap"
import {CursorConfig, Cursor} from "./cursor"
import {Box} from "./box"

const tmpr = rect.create()

/** Defines the styles that apply to [[Label]]. */
export interface LabelStyle {
  font? :Spec<FontConfig>
  fill? :Spec<PaintConfig>
  stroke? :Spec<PaintConfig>
  shadow? :Spec<ShadowConfig>
  selection? :{
    fill? :Spec<PaintConfig>
  }
}

/** Defines configuration for [[Label]]. */
export interface AbstractLabelConfig extends ElementConfig {
  style :PMap<LabelStyle>
}

/** Base class for elements that display styled text. */
export abstract class AbstractLabel extends Element {
  readonly xoffset = Mutable.local(0)
  readonly selection = Mutable.localData<[number,number]>([0,0])
  readonly span = this.observe(EmptySpan)
  readonly selFill = this.observe<Paint|undefined>(undefined)
  readonly text :Value<string>
  private selOff = 0
  private selWid = 0
  // sneaky toggle that allows `text` element to disable rendering of its internal label when it is
  // overlayed by a DOM input element
  public rendered = true

  constructor (ctx :ElementContext, parent :Element, readonly config :AbstractLabelConfig) {
    super(ctx, parent, config)
    this.text = this.resolveText(ctx, config)
    this.invalidateOnChange(this.selection)
    const style = config.style
    const fillS = this.resolveStyle(
      style, s => s.fill, f => ctx.style.resolvePaintOpt(f), undefined)
    const strokeS = this.resolveStyle(
      style, s => s.stroke, s => ctx.style.resolvePaintOpt(s), undefined)
    const fontS = this.mapStyle(style, s => s.font).map(f => ctx.style.resolveFontOpt(f))
    const shadowS = this.mapStyle(style, s => s.shadow).map(s => ctx.style.resolveShadowOpt(s))
    this.span.observe(Subject.join<any>(this.text, fillS, strokeS, fontS, shadowS).map(
      ([text, fill, stroke, font, shadow]) => new Span(text, font, fill, stroke, shadow)))
    this.selFill.observe(this.resolveStyle(style, s => s.selection ? s.selection.fill : undefined,
                                           f => ctx.style.resolvePaint(f), undefined))
  }

  protected abstract resolveText (ctx :ElementContext, config :AbstractLabelConfig) :Value<string>

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.copy(into, this.span.current.size)
  }

  protected relayout () {
    // clamp our x offset so we don't have empty space on the right (TODO: or left?)
    const width = this.width, span = this.span.current, swidth = span.size[0]
    if (swidth > width && this.xoffset.current + swidth < width) this.xoffset.update(width-swidth)
    // if we have a selection, compute its x position & width
    const [ss, se] = this.selection.current
    if (ss < se) {
      this.selOff = span.measureAdvance(ss)
      this.selWid = span.measureAdvance(se) - this.selOff
    } else this.selWid = 0
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    if (!this.rendered) return
    const {x, y, width, height, xoffset} = this
    const span = this.span.current, rx = x + xoffset.current
    const needClip = rx < 0 || span.size[0] > width
    if (needClip) {
      canvas.save()
      canvas.beginPath()
      canvas.rect(x, y, width, height)
      canvas.clip()
    }
    // if we have a selection fill and a selection, render it
    const selFill = this.selFill.current, selOff = this.selOff, selWid = this.selWid
    if (selFill && selWid > 0) {
      selFill.prepFill(canvas)
      canvas.fillRect(rx + selOff, y, selWid, height)
    }
    // render our label
    span.render(canvas, rx, y)
    if (needClip) canvas.restore()
  }
}

/** Defines configuration for [[Label]]. */
export interface LabelConfig extends AbstractLabelConfig {
  type :"label"
  text? :Spec<Value<string>>
}

/** Displays styled text. */
export class Label extends AbstractLabel {

  constructor (ctx :ElementContext, parent :Element, readonly config :LabelConfig) {
    super(ctx, parent, config)
  }
  protected resolveText (ctx :ElementContext, config :LabelConfig) {
    return ctx.model.resolve(config.text, Value.constant(""))
  }
}

async function readClipText () :Promise<string|undefined> {
  if (navigator.clipboard.readText) return navigator.clipboard.readText()
  // note: Firefox doesn't support clipboard-read permission yet... sigh
  const desc = {name: "clipboard-read"} as any as PermissionDescriptor
  const res = await navigator.permissions.query(desc)
  if (res.state === "granted" || res.state === "prompt") return navigator.clipboard.readText()
  else return undefined
}

type TextState = {
  text: Mutable<string>,
  cursor: Mutable<number>,
  selection: Mutable<[number,number]>
}

function replace (state :TextState, start :number, end :number, text :string, cpos :number) {
  const ctext = state.text.current
  state.text.update(ctext.substring(0, start) + text + ctext.substring(end))
  state.cursor.update(cpos)
  state.selection.update([0, 0])
}

type TextAction = (state :TextState, typed :string) => void

const textActions :PMap<TextAction> = {
  // text edits
  insert: (state, typed) => {
    const [sstart, send] = state.selection.current, ipos = state.cursor.current
    if (sstart < send) replace(state, sstart, send, typed, sstart+typed.length)
    else replace(state, ipos, ipos, typed, ipos+typed.length)
  },
  delete: (state, typed) => {
    const ctext = state.text.current, ipos = state.cursor.current
    const [sstart, send] = state.selection.current
    if (sstart < send) replace(state, sstart, send, "", sstart)
    else if (ipos < ctext.length) replace(state, ipos, ipos+1, "", ipos)
  },
  backspace: (state, typed) => {
    const [sstart, send] = state.selection.current, ipos = state.cursor.current
    if (sstart < send) replace(state, sstart, send, "", sstart)
    else if (ipos > 0) replace(state, ipos-1, ipos, "", ipos-1)
  },
  // clipboard interaction
  cut: (state, typed) => {
    const [sstart, send] = state.selection.current
    if (send > sstart) {
      const cut = state.text.current.substring(sstart, send)
      replace(state, sstart, send, "", sstart)
      navigator.clipboard.writeText(cut)
    }
  },
  copy: (state, typed) => {
    const [sstart, send] = state.selection.current
    if (send > sstart) navigator.clipboard.writeText(state.text.current.substring(sstart, send))
  },
  paste: (state, typed) => {
    readClipText().then(text => {
      if (text) textActions.insert(state, text.replace("\n", "").replace("\r", ""))
    })
  },
  // moving the cursor around
  cursorStart: (state, typed) => {
    state.cursor.update(0)
  },
  cursorLeft: (state, typed) => {
    state.cursor.update(Math.max(state.cursor.current-1, 0))
  },
  cursorRight: (state, typed) => {
    state.cursor.update(Math.min(state.cursor.current+1, state.text.current.length))
  },
  cursorEnd: (state, typed) => {
    state.cursor.update(state.text.current.length)
  },
}

// "Standard" key bindings
const textBindings = new Bindings({
  Backspace: {0: "backspace"},
  Delete: {0: "delete"},
  NumpadDecimal: {0: "delete"},

  // TODO: Shift-Arrow should extend selection left & right
  ArrowLeft: {0: "cursorLeft", [CtrlMask]: "cursorStart"},
  ArrowRight: {0: "cursorRight", [CtrlMask]: "cursorEnd"},
  Home: {0: "cursorStart"},
  End: {0: "cursorEnd"},

  // TODO: make keymap dynamically, passing "standard" modifier mask so we can
  // create macOS keymaps that use Meta & Linux/Windows keymaps that use Ctrl
  KeyX: {[CtrlMask]: "cut", [MetaMask]: "cut"},
  KeyC: {[CtrlMask]: "copy", [MetaMask]: "copy"},
  KeyV: {[CtrlMask]: "paste", [MetaMask]: "paste"},

  // Emacs key bindings
  KeyA: {[CtrlMask]: "cursorStart"},
  KeyE: {[CtrlMask]: "cursorEnd"},
  KeyD: {[CtrlMask]: "delete"},
  KeyH: {[CtrlMask]: "backspace"},
}, new Model(textActions))

const wordBRegex = new RegExp("\\b")

function wordBounds (words :string[], pos :number) :[number, number] {
  let off = 0
  for (let ww = 0; ww < words.length; ww += 1) {
    const wend = off + words[ww].length
    if (wend > pos) return [off, wend]
    off = wend
  }
  // if we fell off the end, say we're in the final word
  return [off-words[words.length-1].length, off]
}

type Selector = (moff :number, state :TextState) => void

function charSelector (text :string, doff :number, state :TextState) :Selector {
  state.selection.update([doff, doff])
  state.cursor.update(doff)
  return (moff, state) => {
    state.cursor.update(moff)
    const mino = Math.min(doff, moff), maxo = Math.max(doff, moff)
    state.selection.update([mino, maxo])
  }
}

function wordSelector (text :string, doff :number, state :TextState) :Selector {
  const words = text.split(wordBRegex)
  const dbounds = wordBounds(words, doff)
  state.selection.update(dbounds)
  // put the cursor at the end of the selection
  state.cursor.update(dbounds[1])
  return (moff, state) => {
    const mbounds = wordBounds(words, moff)
    if (mbounds[0] < dbounds[0]) {
      state.selection.update([mbounds[0], dbounds[1]])
      state.cursor.update(mbounds[0])
    } else {
      state.selection.update([dbounds[0], mbounds[1]])
      state.cursor.update(mbounds[1])
    }
  }
}

function allSelector (text :string, doff :number, state :TextState) :Selector {
  state.selection.update([0, text.length])
  return (moff, state) => state.cursor.update(moff)
}

const DefaultBlinkPeriod = 0.6
const DefaultCursor :CursorConfig = {type: "cursor", style: {}}

/** Defines configuration for text edit elements. */
export interface AbstractTextConfig extends ControlConfig {
  cursor? :CursorConfig
  onEnter? :Spec<Action>
}

const TextStyleScope = {id: "text", states: [...ControlStates, "invalid"]}

/** Base class for text edit elements. */
export abstract class AbstractText extends Control {
  private readonly jiggle = Mutable.local(false)
  private readonly textState :TextState
  private readonly _onEnter :Action
  readonly coffset = Mutable.local(0)
  readonly label :Label
  readonly cursor :Cursor

  constructor (
    ctx :ElementContext,
    parent :Element,
    readonly config :AbstractTextConfig,
    readonly text :Mutable<string>,
    private readonly shadowed = Mutable.local(false)
  ) {
    super(ctx.inject({label: {text}}), parent, config)
    this.invalidateOnChange(this.coffset)
    this._onEnter = ctx.model.resolveAction(config.onEnter, NoopAction)

    // update state when text changes; we may become invalid
    this.disposer.add(text.onValue(() => this._state.update(this.computeState)))

    const label = this.contents.findChild("label") as Label|undefined
    if (label) this.label = label
    else throw new Error(`Text control must have Label child [config=${JSON.stringify(config)}].`)

    // disable rendering of our label when we're shadowed
    this.disposer.add(shadowed.onValue(shadowed => label.rendered = !shadowed))

    // hide the cursor when the label has a selection
    const hasSel = this.label.selection.map(([ss, se]) => se > ss)
    // we include jiggle here so that we can reset the clock fold on demand when the user clicks the
    // mouse even when we're already focused
    const blinking = Value.join<any>(this.focused, hasSel, this.shadowed, this.jiggle).switchMap(
      ([focused, hasSel, shadowed, jiggle]) => {
        if (!focused || hasSel || shadowed) return falseValue
        else {
          const blinkPeriod = this.cursor.config.blinkPeriod || DefaultBlinkPeriod
          return this.root.clock.fold(0, (acc, c) => acc+c.dt, refEquals).
            map(acc => Math.floor(acc/blinkPeriod) % 2 === 0)
        }
      })
    const cconfig = {...(config.cursor || DefaultCursor), visible: blinking}
    this.cursor = ctx.elem.create(ctx, this, cconfig) as Cursor

    this.textState = {text: this.text, cursor: this.coffset, selection: this.label.selection}
  }

  get styleScope () { return TextStyleScope }

  applyToChildren (op :(elem :Element) => void) {
    super.applyToChildren(op)
    op(this.cursor)
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    if (event instanceof MouseEvent && event.button !== 0) return undefined

    // figure out where the click landed
    const label = this.label, dp = pos[0] - label.x - label.xoffset.current
    const doff = label.span.current.computeOffset(dp)

    // update selection depending on number of clicks
    let sel :Selector
    switch (event.detail) {
    case 1: sel = charSelector(label.text.current, doff, this.textState) ; break
    case 2: sel = wordSelector(label.text.current, doff, this.textState) ; break
    default:
    case 3: sel = allSelector(label.text.current, doff, this.textState) ; break
    }

    // if we're already focused, jiggle the cursor blinker so it restarts; this ensures that the
    // user immediately sees the cursor at the new location
    if (this.isFocused) this.jiggle.update(!this.jiggle.current)
    else this.focus()

    // as the mouse moves, move the cursor and update the selection
    return {
      move: (event, pos) => {
        const mp = pos[0] - label.x - label.xoffset.current
        sel(label.span.current.computeOffset(mp), this.textState)
      },
      release: Noop,
      cancel: Noop,
    }
  }

  handleKeyEvent (event :KeyboardEvent) {
    if (event.type !== "keydown") return false
    const supportsChar = typeof event.char === "string"
    const isPrintable = (
      (supportsChar && event.char !== "") || // new hotness
      (event.key.length === 1) // old and busted
    )
    const typed = isPrintable ? (supportsChar ? event.char : event.key) : ""
    const binding = textBindings.getBinding(event)
    const action = textBindings.model.resolveAction<TextAction>(binding)
    if (action) {
      action(this.textState, typed)
    } else if (isPrintable) {
      textActions.insert(this.textState, typed)
    } else if (event.code === "Enter") {
      this.onEnter()
    } else {
      return false
    }
    if (binding !== 'copy') this.label.selection.update([0, 0])
    this.jiggle.update(!this.jiggle.current)
    return true
  }

  configInput (input :HTMLInputElement) :Remover {
    const root = this.root, ibounds = this.bounds
    const unsizer = this.valid.when(v => v, v => {
      const fx = root.origin[0] + ibounds[0], fy = root.origin[1] + ibounds[1]
      input.style.left = `${fx}px`
      input.style.top = `${fy}px`
      input.style.width = `${ibounds[2]}px`
      input.style.height = `${ibounds[3]}px`
      input.value = this.textState.text.current
    })

    // TODO: we should perhaps use the bounds of the box instead of the bounds of the text,
    // in case someone is doing something extra tricky...
    const box = this.findChild("box")
    if (box) {
      const bstyle = (box as Box).style
      if (bstyle.padding) input.style.padding = insetsToCSS(bstyle.padding)
      if (bstyle.margin) input.style.margin = insetsToCSS(bstyle.margin)
    }
    this.label.span.current.syncStyle(input.style)

    const onInput = (event :Event) => this.textState.text.update(input.value)
    input.addEventListener("input", onInput)
    const onPress = (event :KeyboardEvent) => {
      if (event.key === "Enter") this.onEnter()
      // TODO: move focus on Tab/Shift-Tab when we support that (may need to do that in keydown)
    }
    input.addEventListener("keypress", onPress)
    this.shadowed.update(true)

    input.value = this.textState.text.current
    const cpos = this.coffset.current
    input.setSelectionRange(cpos, cpos)

    return () => {
      input.removeEventListener("input", onInput)
      input.removeEventListener("keypress", onPress)
      this.shadowed.update(false)
      unsizer()
    }
  }

  protected get computeState () :string {
    return this.inputValid ? super.computeState : "invalid"
  }

  protected actionSpec (config :ControlConfig) { return (config as AbstractTextConfig).onEnter }

  protected get inputValid () :boolean { return true }

  protected onEnter () { this._onEnter() }

  protected relayout () {
    super.relayout()
    // bound the cursor into the text length
    const coffset = Math.max(0, Math.min(this.text.current.length, this.coffset.current))
    this.coffset.update(coffset)
    // compute the advance of the cursor based on the text contents
    const lx = this.label.x, ly = this.label.y, lw = this.label.width, lh = this.label.height
    const cadvance = this.label.span.current.measureAdvance(coffset)
    // if the cursor is out of bounds, adjust the label x offset to bring it to the edge
    const ll = -this.label.xoffset.current
    if (cadvance < ll) this.label.xoffset.update(-cadvance)
    else if (cadvance > ll+lw) this.label.xoffset.update(lw-cadvance)
    // finally position the cursor based on our calculations
    const cx = lx + this.label.xoffset.current + cadvance
    this.cursor.setBounds(rect.set(tmpr, cx, ly, this.cursor.lineWidth, lh))
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    this.cursor.render(canvas, region)
  }
}

/** Defines configuration for [[Text]]. */
export interface TextConfig extends AbstractTextConfig {
  type :"text"
  text :Spec<Mutable<string>>
}

/** Displays a span of editable text. */
export class Text extends AbstractText {

  constructor (ctx :ElementContext, parent :Element, readonly config :TextConfig) {
    super(ctx, parent, config, ctx.model.resolve(config.text))
  }
}

/** Defines configuration for [[NumberText]]. */
export interface NumberTextConfig extends AbstractTextConfig {
  type :"numberText"
  min? :number
  max? :number
  maxDecimals? :number
  wheelStep? :number
  number :Spec<Mutable<number>>
}

/** Displays an editable number. */
export class NumberText extends AbstractText {
  readonly number :Mutable<number>

  constructor (ctx :ElementContext, parent :Element, readonly config :NumberTextConfig) {
    super(ctx, parent, config, Mutable.local(""))
    this.number = ctx.model.resolve(config.number)
    const maxDecimals = getValue(config.maxDecimals, 3)
    this.disposer.add(this.number.onValue(value => {
      const textValue = parseFloat(this.text.current)
      if (value !== textValue) this.text.update(numberToString(value, maxDecimals))
    }))
    this.disposer.add(
      this.text.onChange(text => {
        const value = parseFloat(text)
        if (this._isValueValid(value)) this.number.update(value)
      })
    )
  }

  handleWheel (event :WheelEvent, pos :vec2) :boolean {
    const wheelStep = getValue(this.config.wheelStep, 1)
    this.number.update(this._clamp(this.number.current - wheelStep * Math.sign(event.deltaY)))
    return true
  }

  protected get inputValid () :boolean {
    // can be called before constructor finishes
    return this.text ? this._isValueValid(parseFloat(this.text.current)) : true
  }

  private _isValueValid (value :number) :boolean {
    return !(
      isNaN(value) ||
      this.config.min !== undefined && value < this.config.min ||
      this.config.max !== undefined && value > this.config.max
    )
  }

  private _clamp (value :number) :number {
    if (this.config.min !== undefined) value = Math.max(this.config.min, value)
    if (this.config.max !== undefined) value = Math.min(this.config.max, value)
    return value
  }
}

function numberToString (value :number, maxDecimals :number) :string {
  const scale = 10 ** maxDecimals
  return String(Math.round(value * scale) / scale)
}

/** Defines configuration for [[ColorText]]. */
export interface ColorTextConfig extends AbstractTextConfig {
  type :"colorText"
  color :Spec<Mutable<string>>
}

const ColorPattern = /^[\da-fA-F]{6}$/

/** Displays a hex color value. */
export class ColorText extends AbstractText {
  readonly color :Mutable<string>

  constructor (ctx :ElementContext, parent :Element, readonly config :ColorTextConfig) {
    super(ctx, parent, config, Mutable.local(""))
    this.color = ctx.model.resolve(config.color)
    this.disposer.add(
      this.color.onValue(value => this.text.update(value)),
    )
    this.disposer.add(
      this.text.onChange(text => {
        if (this._isValueValid(text)) this.color.update(text)
      })
    )
  }

  protected get inputValid () :boolean {
    // can be called before constructor finishes
    return this.text ? this._isValueValid(this.text.current) : true
  }

  private _isValueValid (value :string) :boolean {
    return ColorPattern.test(value)
  }
}

/** Defines configuration for [[EditableLabel]]. */
export interface EditableLabelConfig extends AbstractTextConfig {
  type :"editableLabel"
  text :Spec<Mutable<string>>
}

const EditableLabelStyleScope = {id: "editableLabel", states: ControlStates}

/** A label that one can edit by double-clicking. */
export class EditableLabel extends AbstractText {

  constructor (ctx :ElementContext, parent :Element, readonly config :EditableLabelConfig) {
    super(ctx, parent, config, ctx.model.resolve(config.text))
    this.focused.onValue(focused => {
      if (!focused) this.label.selection.update([0, 0])
    })
  }

  get styleScope () { return EditableLabelStyleScope }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    return this.isFocused ? super.handlePointerDown(event, pos) : undefined
  }

  handleDoubleClick (event :MouseEvent, pos :vec2) :boolean {
    // we might have a Value instead of a Mutable, in which case we just act as a normal label
    if (this.isFocused || !(this.text instanceof Mutable)) return false
    this.focus()
    const interaction = this.handlePointerDown(event, pos)
    if (interaction) interaction.release(event, pos)
    return true
  }

  protected onEnter () { this.blur() }
}

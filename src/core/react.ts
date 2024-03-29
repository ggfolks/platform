import {Remover, NoopRemover, RProp, Prop, VProp, addListener, removeListener} from "./util"
import {Data, dataEquals, refEquals} from "./data"

// TypeScript infers literal types for type parameters with bounds, so when we bound our reactive
// value types by Data, that causes calls like `mutable("")` to yield types like `Mutable<"">`
// instead of `Mutable<string>` which is not desirable. This helper type allows us to force the type
// checker to widen the types in places where we need it.
type Widen<T> =
  T extends string  ? string :
  T extends number  ? number :
  T extends boolean ? boolean : T;

/** An equality function used to test whether values have actually changed during reactive value
  * propagation. */
export type Eq<T> = (a:T, b:T) => boolean

//
// Listener plumbing

/** An error that encapsulates multiple errors. Thrown when dispatching to reactive callbacks
  * triggers multiple failures. */
export class MultiError extends Error {
  constructor (readonly errors :Error[]) {
    super(`${errors.length} errors: ${errors}`)
  }
}

/** A sentinel value that can be returned by listener functions to indicate that their registration
  * should be removed. */
export const Remove = {}

/** A callback "function" that consumes a value from a reactive source. If the function returns
  * `Remove` it will be removed from the reactive source, any other return value will be ignored. */
export type ValueFn<T> = (value :T) => any

/** Dispatches `value` to `listeners`.
 * @return true if any listeners were removed. */
export function dispatchValue<T> (listeners :ValueFn<T>[], value :T) :boolean {
  let removed = false, errors
  // TODO: revamp to avoid duping array
  for (let listener of listeners.slice()) {
    try {
      if (listener(value) === Remove) {
        removeListener(listeners, listener)
        removed = true
      }
    } catch (error :any) {
      if (!errors) errors = []
      errors.push(error)
    }
  }
  if (errors) {
    if (errors.length === 1) throw errors[0]
    else throw new MultiError(errors)
  }
  return removed
}

/** A callback "function" that consumes a change in value, from a reactive source. Return value may
  * be anything, but is ignored. */
export type ChangeFn<T> = (value :T, oldValue :T) => any

/**
 * Dispatches the change from `oldValue` to `value` to `listeners`.
 * @return true if any listeners were removed. */
export function dispatchChange<T> (listeners :ChangeFn<T>[], value :T, oldValue :T) :boolean {
  let removed = false, errors :Error[]|void
  // TODO: revamp to avoid duping array
  for (let listener of listeners.slice()) {
    try {
      if (listener(value, oldValue) === Remove) {
        removeListener(listeners, listener)
        removed = true
      }
    } catch (error :any) {
      if (!errors) {
        errors = []
      }
      errors.push(error)
    }
  }
  if (errors) {
    if (errors.length === 1) {
      throw errors[0]
    } else {
      throw new MultiError(errors)
    }
  }
  return removed
}

//
// Reactive source & helpers

/** A function used to dispatch new values on reactive primitives. */
export type DispatchFn<T> = (value :T) => void

/** A predicate which tests something about a `value`. */
export type Pred<T> = (value :T) => boolean

/** A reactive source: an API that abstracts over `Stream`, `Subject`, `Value` and `Buffer`. */
export abstract class Source<T> {

  /** Registers `fn` to be called when `source` contains or emits non-`undefined` values.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  static whenDefined<T> (source :Source<T|undefined>, fn :ValueFn<T>) :Remover {
    return source.onValue(v => (v === undefined) ? undefined : fn(v))
  }

  /** Registers `fn` to be called the first time `source` contains or emits a non-`undefined` value.
    * `fn` will be called zero or one times.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  static onceDefined<T> (source :Source<T|undefined>, fn :ValueFn<T>) :Remover {
    return source.onValue(v => {
      if (v === undefined) return undefined
      else { fn(v) ; return Remove }
    })
  }

  /** Returns a source which "switches" between successive underlying sources. The "latest" value
    * emitted by `sources` will be the "live" source and values emitted by that source will be
    * emitted by the switched source. When the live source changes, the values emitted by the old
    * source are ignored and only values by the new live source are emitted. */
  static switch<T> (sources :Source<Source<T>>) :Source<T> {
    return Subject.deriveSubject(disp => {
      let disconnect = NoopRemover
      let unlisten = sources.onValue(source => {
        disconnect()
        disconnect = source.onValue(disp)
      })
      return () => { disconnect() ; unlisten() }
    })
  }

  /** Registers `fn` to be called with values emitted by this source. If the source has a current
    * value, `fn` will _not_ be called with the current value. */
  abstract onEmit (fn :ValueFn<T>) :Remover

  /** Registers `fn` to be called with values emitted by this source. If the source has a current
    * value, `fn` will also be called immediately with the current value. */
  abstract onValue (fn :ValueFn<T>) :Remover

  /** Registers `fn` to be called the first time this source contains or emits a value. If the
    * source contains a current value, `fn` will be called before this call returns. `fn` will be
    * called zero or one times.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  once (fn :ValueFn<T>) :Remover {
    return this.onValue(v => { fn(v) ; return Remove })
  }

  /** Registers `fn` to be called the next time this source emits a value. If source contains a
    * current value `fn` will _not_ be called with the current value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  next (fn :ValueFn<T>) :Remover {
    return this.onEmit(v => { fn(v) ; return Remove })
  }

  /** Registers `fn` to be called when this source contains or emits values which satisfy `pred`.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  when (pred :Pred<T>, fn :ValueFn<T>) :Remover {
    return this.onValue(v => pred(v) ? fn(v) : undefined)
  }

  /** Registers `fn` to be called the first time this source contains or emits a value which
    * satisfies `pred`. `fn` will be called zero or one times.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  whenOnce (pred :Pred<T>, fn :ValueFn<T>) :Remover {
    return this.onValue(v => {
      if (pred(v)) { fn(v) ; return Remove }
      else return undefined
    })
  }

  /** Returns a source which transforms the values of this source via `fn`. Whenever `this` source
    * emits a `value`, the returned source will emit `fn(value)`. */
  abstract map<U> (fn :(v:T) => U) :Source<U>

  /** Returns a reactive [[Value]] which starts with value `start` and is updated by combining
    * values emitted by this source with the latest value via `fn` when they arrive.
    *
    * *Note:* the fold value is only "live" while it has listeners. When it has no listeners, it
    * will not listen to `this` underlying source and will not observe events it emits. Thus it is
    * advisable to only ever create a value using this method and immediately listen to it. If you
    * will be listening and unlistening to the value, you are better off recreating it each time so
    * that it's more apparent to readers of the code that the value will contain `start` until a new
    * value arrives.
    *
    * @param fn used to compute new folded values when values arrive on `this` source.
    * @param eq used to check whether computed new values have actually changed.
    * [[Value]]s emit notifications only when values change. */
  fold<Z> (start :Z, fn :(a:Z, v:T) => Z, eq :Eq<Z> = refEquals) :Value<Z> {
    let current = start
    return Value.deriveValue(eq, disp => this.onValue(value => {
      const ovalue = current, nvalue = fn(ovalue, value)
      if (!eq(ovalue, nvalue)) {
        current = nvalue
        disp(nvalue, ovalue)
      }
    }), () => current)
  }
}

/** A [[Source]] whose current value can be read immediately. Both `Value` and `Buffer` are readable
  * sources. */
export abstract class ReadableSource<T> extends Source<T> implements RProp<T> {

  /** The current value of this source. */
  abstract get current () :T

  /** Returns a source which transforms the values of this source via `fn`. Whenever `this` sourceq
    * emits a `value`, the returned source will emit `fn(value)`. */
  abstract map<U> (fn :(v:T) => U) :ReadableSource<U>

  /** Transforms the value of this source via `fn` and exposes it as a value, which emits when the
    * transformed value differs per the supplied `eq` tester. */
  mapValue<U> (fn :(v:T) => U, eq :Eq<U> = refEquals) :Value<U> {
    return Value.deriveValue(eq, disp => {
      let prev = fn(this.current)
      return this.onEmit(value => {
        const next = fn(value)
        if (!eq(next, prev)) {
          disp(next, prev)
          prev = next
        }
      })
    }, () => fn(this.current))
  }

  /** Returns a `Subject` that contains this source's current value and changes whenever this
    * source's value changes. */
  toSubject () :Subject<T> {
    return new Subject((lner, wantValue) => {
      const remover = this.onEmit(lner)
      if (wantValue) lner(this.current)
      return remover
    })
  }

  /** Returns a `Promise` that completes when this source's current value satisfies `pred`. If the
    * current value satisfies pred, a completed promise will be returned. Otherwise an uncompleted
    * promise is returned and that promise is completed when this value next changes to a satisfying
    * value. */
  toPromise (pred :Pred<T>) :Promise<T> {
    let current = this.current
    return pred(current) ? Promise.resolve(current) : new Promise((resolve, reject) => {
      let remover = this.onEmit(value => {
        if (pred(value)) {
          remover()
          resolve(value)
        }
      })
    })
  }

  once (fn :ValueFn<T>) :Remover {
    fn(this.current)
    return NoopRemover
  }

  whenOnce (pred :Pred<T>, fn :ValueFn<T>) :Remover {
    if (!pred(this.current)) return super.whenOnce(pred, fn)
    fn(this.current)
    return NoopRemover
  }
}

//
// Reactive streams

/** A reactive primitive that emits a stream of values. A stream does not have a current value, it
  * emits values which are distributed to any registered listeners and then forgotten. */
export class Stream<T> extends Source<T> {

  /** Creates a stream derived from one or more external event sources.
    * @param connect a function called when the stream receives its first listener. This should
    * subscribe to the underlying source and call the supplied `dispatch` function to dispatch
    * values as they are received. It should return a remover thunk that can be used to clear the
    * subscription, which will be called when the last listener is removed. */
  static deriveStream<T> (connect :(dispatch :DispatchFn<T>) => Remover) :Stream<T> {
    const listeners :ValueFn<T>[] = []
    let disconnect :Remover = NoopRemover
    function checkEmpty () {
      if (listeners.length == 0) {
        disconnect()
        disconnect = NoopRemover
      }
    }
    function dispatch (value :T) {
      if (dispatchValue(listeners, value)) checkEmpty()
    }
    return new Stream(listener => {
      const needConnect = listeners.length === 0
      const remover = addListener(listeners, listener)
      if (needConnect) disconnect = connect(dispatch)
      return () => { remover() ; checkEmpty() }
    })
  }

  /** Merges `sources` streams into a single stream that emits a value whenever any of the
    * underlying streams emit a value. */
  static merge<E> (...sources :Stream<E>[]) :Stream<E> {
    return new Stream(fn => {
      const removers = sources.map(s => s.onEmit(fn))
      return () => removers.forEach(r => r())
    })
  }

  constructor (protected readonly _onEmit :(fn :ValueFn<T>) => Remover) { super() }

  /** Registers `fn` to be invoked when this stream emits a value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onEmit (fn :ValueFn<T>) :Remover { return this._onEmit(fn) }

  /** Registers `fn` to be invoked when this stream emits a value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onValue (fn :ValueFn<T>) :Remover { return this._onEmit(fn) }

  /** Returns a stream which transforms the values of this stream via `fn`. Whenever `this` stream
    * emits a `value`, the returned stream will emit `fn(value)`. */
  map<U> (fn :(v:T) => U) :Stream<U> {
    const onEmit = this._onEmit
    return new Stream(lner => onEmit((value :T) => lner(fn(value))))
  }

  /** Returns a stream which filters the values of this stream via `pred`. Only the values emitted
    * by this stream that satisfy `pred` (cause it to return `true`) will be emitted by the returned
    * stream. */
  filter (pred :Pred<T>) :Stream<T> {
    const onEmit = this._onEmit
    return new Stream(lner => onEmit(value => pred(value) && lner(value)))
  }
}

/* A stream which can have values emitted on it by external callers. */
export class Emitter<T> extends Stream<T> {
  private readonly _listeners :ValueFn<T>[] = []

  /** Checks whether the emitter has any listeners. */
  get active () { return this._listeners.length > 0 }

  constructor () { super(lner => addListener(this._listeners, lner)) }

  /** Emits `value` on this stream. Any current listeners will be notified of the value. */
  emit (value :T) { dispatchValue(this._listeners, value) }

  // TODO: should we provide onWake/onSleep callbacks?
}

//
// Reactive subjects - an intermediate point between streams and values

/** A reactive primitive that (eventually) contains a value, and which may subsequently change.
  * Unlike [[Value]]s (or [[Stream]]s), subjects are conceptually only "active" when they are
  * observed. In general, when a subject is first observed, it materializes its initial underlying
  * value and notifies that observer. While it continues to be observed, it will notify new
  * observers of its current value immediately and notify all observers of any changes in its value.
  * When its last observer is removed, it goes dormant and forgets its current value. If a new
  * observer comes along again, a new initial value is materialized.
  *
  * Subjects also do not necessarily not compare successive values for equality and suppress change
  * notification for successive equal values. A given subject may choose to emit all changes
  * regardless of equality (like subjects derived from [[Stream]]s) or suppress change notifications
  * for successive equal values (like [[Value]] which is also a [[Subject]]). */
export class Subject<T> extends Source<T> {

  /** Creates a constant subject which always contains `value`. */
  static constant<T> (value :T) :Subject<T> {
    return new Subject((lner, want) => {
      if (want) lner(value)
      return NoopRemover
    })
  }

  /** Creates a subject derived from an external event source. The `connect` function should
    * subscribe to the underlying source, call the supplied `dispatch` function with the initial
    * value as soon as it is known (possibly immediately), then call `dispatch` with any future
    * values that arrive. It should return a remover thunk that can be used to clear the
    * subscription. The remover thunk will be called when the last listener to the subject is
    * removed and the subject goes dormant. If a new listener subsequently arrives, `connect` will
    * be called anew to resume wakefulness.
    * @param connect called when the subject receives its first listener after being in a dormant
    * state. */
  static deriveSubject<T> (connect :(dispatch :DispatchFn<T>) => Remover) :Subject<T> {
    const listeners :ValueFn<T>[] = []
    let disconnect = NoopRemover
    let occupied = false
    let latest :T // initialized when connected; only used thereafter
    function checkEmpty () {
      if (listeners.length == 0) {
        disconnect()
        disconnect = NoopRemover
        occupied = false
        latest = undefined as any // don't retain a reference to latest
      }
    }
    function dispatch (value :T) {
      occupied = true
      latest = value
      if (dispatchValue(listeners, value)) checkEmpty()
    }
    function onValue (fn :ValueFn<T>, wantValue :boolean) :Remover {
      const needConnect = listeners.length === 0
      let remover :Remover
      if (needConnect) {
        if (wantValue) {
          remover = addListener(listeners, fn)
          disconnect = connect(dispatch)
        } else {
          disconnect = connect(dispatch)
          remover = addListener(listeners, fn)
        }
      } else {
        remover = addListener(listeners, fn)
        if (wantValue && occupied) fn(latest)
      }
      return () => { remover() ; checkEmpty() }
    }
    return new Subject(onValue)
  }

  /** Returns a [[Subject]] that is initialized with the current value if available, or the next
    * value emitted by `source` and then changed by each subsequent emitted value. */
  static from<T> (source :Source<T>) :Subject<T> {
    return Subject.deriveSubject(d => source.onValue(d))
  }

  /** Returns a [[Subject]] that is emits values from `source` that pass the predicate `p`. */
  static filtered<T> (source :Source<T>, p :(v:T) => boolean) :Subject<T> {
    return Subject.deriveSubject(d => source.onValue(v => p(v) && d(v)))
  }

  /** Joins `sources` into a single subject which contains the underlying sources combined into a
    * single array. This subject will initially complete once all of the underlying sources have
    * initially completed. Then, when any of the underlying sources changes, this subject will
    * change and the changed element will be reflected in its new value. */
  static join<A> (...sources :Source<A>[]) :Subject<A[]> {
    return Subject.deriveSubject(dispatch => {
      const ready :boolean[] = []
      const current :A[] = []
      const removers = sources.map((source, idx) => source.onValue(value => {
        ready[idx] = true
        current[idx] = value
        const rcount = ready.reduce((rt, rs) => rs ? rt+1 : rt, 0)
        if (rcount == sources.length) dispatch(current)
      }))
      return () => removers.forEach(r => r())
    })
  }

  /** Joins two sources into a single "tuple" subject. See [[Subject.join]] for details. */
  static join2<A,B> (a :Source<A>, b :Source<B>) :Subject<[A,B]> {
    return Subject.join(a as any, b as any) as Subject<[A, B]>
  }

  /** Joins three sources into a single "triple" subject. See [[Subject.join]] for details. */
  static join3<A,B,C> (a :Source<A>, b :Source<B>, c :Source<C>) :Subject<[A,B,C]> {
    return Subject.join(a as any, b as any, c as any) as Subject<[A, B, C]>
  }

  constructor (readonly _connect :(lner :ValueFn<T>, wantValue :boolean) => Remover) { super() }

  /** Registers `fn` to be called only with new values whenever this subject changes, _not_ with the
    * current value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onEmit (fn :ValueFn<T>) :Remover { return this._connect(fn, false) }

  /** Registers `fn` to be called with the current value (if one is available), and with new values
    * whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onValue (fn :ValueFn<T>) :Remover { return this._connect(fn, true) }

  /** Creates a subject which transforms this subject via `fn`. The new subject will emit
    * transformed changes whenever this subject changes.
    * @param fn a referentially transparent transformer function. */
  map<U> (fn :(v:T) => U) :Subject<U> {
    const {_connect} = this
    return new Subject((lner, wantValue) => _connect((v:T) => lner(fn(v)), wantValue))
  }

  /** Creates a subject which transforms this subject via `fn`. The new subject will emit
    * transformed changes whenever this subject changes.
    * @param onWake a function called when the mapped subject receives its first listener. It can
    * optionally return an initial value for the mapped subject.
    * @param fn a referentially transparent transformer function.
    * @param onSleep a function called when the mapped subject loses its last listener. It is passed
    * the most recently computed mapped value, if one is available. */
  mapTrace<U> (onWake :() => U|void, fn :(v:T) => U, onSleep :(v:U|void) => void) :Subject<U> {
    const {_connect} = this
    return Subject.deriveSubject(dispatch => {
      let latest = onWake()
      if (latest) dispatch(latest)
      const unsub = _connect(value => dispatch(latest = fn(value)), true)
      return () => {
        unsub()
        onSleep(latest)
      }
    })
  }

  /** Transforms values of this subject into new mapped subjects and observes (and forwards values
    * from) the most recently obtained mapped subject. */
  switchMap<R> (fn :(v:T) => Subject<R>) :Subject<R> {
    const {_connect} = this
    return Subject.deriveSubject<R>(disp => {
      let disconnect = NoopRemover
      return _connect(v => { disconnect() ; disconnect = fn(v).onValue(disp) }, true)
    })
  }
}

//
// Reactive values

/** A reactive primitive that contains a value, which may subsequently change. The current value may
  * be observed by listening via [[Value.onValue]], or by calling [[Value.current]]. */
export class Value<T> extends ReadableSource<T> {

  /** A constant value which is always `true`. */
  static true = Value.constant(true)

  /** A constant value which is always `false`. */
  static false = Value.constant(false)

  /** A constant value which is always the empty string. */
  static blank = Value.constant("")

  /** Creates a constant value which always contains `value`. */
  static constant<T> (value :T) :Value<T> {
    // note: we use refEquals here as we must provide something for eq, but it's never used because
    // constant values never change, thus we never have to compare an old and a new value
    return new Value(refEquals, lner => NoopRemover, () => value)
  }

  /** Creates a constant (data) value which always contains `value` or `undefined`. */
  static constantOpt<T> (value? :T) :Value<T|undefined> {
    return this.constant(value)
  }

  /** Creates a value from `source` which starts with the value `start` and is updated by values
    * emitted by `source` whenever they arrive. The values emitted by `source` are compared for
    * equality via `eq` (which defaults to `refEquals`).
    *
    * *Note*: the returned value is only "live" while it has listeners. When it has no listeners, it
    * will not listen to the underlying source and will not observe events it emits. While it has no
    * listeners the value will be the last observed value and when it gains new listeners that value
    * will be reported until some new value is emitted by the underlying source. Thus it is
    * advisable to only ever create a value using this method and immediately listen to it. If you
    * will be listening and unlistening to the value, you are better off recreating it each time so
    * that it's more apparent to readers of the code that the value will contain `start` until a new
    * value arrives.
    */
  static from<T> (source :Source<T>, start :T, eq :Eq<T> = refEquals) :Value<T> {
    return source.fold(start, (o, n) => n, eq)
  }

  /** Creates a value derived from an external source. The `current` function should return the
    * current value. The `connect` function should subscribe to the underlying source, and call
    * `dispatch` when any future values that arrive. It should return a remover thunk that can be
    * used to clear the subscription. The remover thunk will be called when the last listener to the
    * subject is removed and the subject goes dormant. If a new listener subsequently arrives,
    * `connect` will be called anew to resume wakefulness.
    * @param connect called when the value receives its first listener after being in a dormant
    * state. */
  static deriveValue<T> (eq :Eq<T>, connect :(dispatch :ChangeFn<T>) => Remover,
                         current :() => T) :Value<T> {
    const listeners :ChangeFn<T>[] = []
    let disconnect = NoopRemover
    function checkEmpty () {
      if (listeners.length === 0) {
        disconnect()
        disconnect = NoopRemover
      }
    }
    function dispatch (value :T, ovalue :T) {
      if (dispatchChange(listeners, value, ovalue)) checkEmpty()
    }
    return new Value(eq, listener => {
      const needConnect = listeners.length === 0
      const remover = addListener(listeners, listener)
      if (needConnect) disconnect = connect(dispatch)
      return () => { remover() ; checkEmpty() }
    }, current)
  }

  /** Joins `sources` into a single value which contains the underlying values combined into a
    * single array. When any of the underlying values changes, this value will change and the
    * changed element will be reflected in its new value. */
  static join<A> (...sources :Value<A>[]) :Value<A[]> {
    const current = () => sources.map(source => source.current)
    return Value.deriveValue((as, bs) => {
      for (let ii = 0, ll = sources.length; ii < ll; ii += 1) {
        if (!sources[ii].eq(as[ii], bs[ii])) return false
      }
      return true
    }, disp => {
      const prev = current()
      const curr = current()
      const removers = sources.map((source, idx) => source.onChange((val, oval) => {
        prev[idx] = oval
        curr[idx] = val
        disp(curr, prev)
      }))
      return () => removers.forEach(r => r())
    }, current)
  }

  /** Joins two values into a single "tuple" value. When either of the underlying values changes,
    * this value will change and the changed element will be reflected in its new value. */
  static join2<A,B> (a :Value<A>, b :Value<B>) :Value<[A,B]> {
    return this.join<any>(a, b) as any as Value<[A,B]>
  }

  /** Joins three values into a single "triple" value. When any of the underlying values changes,
    * this value will change and the changed element will be reflected in its new value. */
  static join3<A,B,C> (a :Value<A>, b :Value<B>, c :Value<C>) :Value<[A,B,C]> {
    return this.join<any>(a, b, c) as any as Value<[A,B,C]>
  }

  /** Returns a value which is false if any of `values` are false, `true` otherwise. */
  static and (...values :Value<boolean>[]) :Value<boolean> {
    return this.join(...values).map(vs => vs.reduce((a, b) => a && b, true))
  }

  /** Returns a value which is true if any of `values` are true, `false` otherwise. */
  static or (...values :Value<boolean>[]) :Value<boolean> {
    return this.join(...values).map(vs => vs.reduce((a, b) => a || b, false))
  }

  /** Returns a value which "switches" between successive underlying values. The switched value will
    * always reflect the contents and events of the "latest" value from `values`. When `values`
    * changes, the switched value will only emit a change if the current (inner) value of the old
    * (outer) value differs from the current (inner) value of the new (outer) value. Note: this
    * equality test is performed using the equality testing function of the new value. To avoid
    * unexpected behavior, all values emitted by `values` should use the same equality testing
    * semantics. */
  static switch<T> (values :Value<Value<T>>) :Value<T> {
    return Value.deriveValue(values.current.eq, disp => {
      let disconnect = values.current.onChange(disp)
      let unlisten = values.onChange((value, ovalue) => {
        disconnect()
        disconnect = value.onChange(disp)
        let previous = ovalue.current, current = value.current
        if (!value.eq(current, previous)) disp(current, previous)
      })
      return () => { disconnect() ; unlisten() }
    }, () => values.current.current)
  }

  constructor (
    /** The function used to test new values for equality with old values. */
    readonly eq :Eq<T>,
    protected readonly _onChange :(fn :ChangeFn<T>) => Remover,
    protected readonly _current :() => T) { super() }

  /** The current value contained by this value. */
  get current () :T { return this._current() }

  /** Registers `fn` to be called with the new value whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onEmit (fn :ValueFn<T>) :Remover { return this._onChange(fn) }

  /** Registers `fn` to be called with the most recently observed value (immediately) and again with
    * the new value whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onValue (fn :ValueFn<T>) :Remover {
    if (fn(this.current) === Remove) return NoopRemover
    return this._onChange(fn)
  }

  /** Registers `fn` to be called with old and new values whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onChange (fn :ChangeFn<T>) :Remover { return this._onChange(fn) }

  /** Creates a value which transforms this value via `fn`. The new value will emit changes
    * whenever this value changes and the transformed value differs from the previous transformed
    * value. [[refEquals]] will be used to determine when the transformed value changes.
    * @param fn a referentially transparent transformer function.
    * @param eq used to determine when the transformed value changes. Defaults to [[refEquals]]. */
  map<U> (fn :(v:T) => U, eq :Eq<U> = refEquals) :Value<U> {
    const {_current, _onChange} = this
    let connected = false, latest :U
    return Value.deriveValue(eq, disp => {
      connected = true
      latest = fn(_current())
      const unlisten = _onChange((value, ovalue) => {
        let current = fn(value), previous = latest
        if (!eq(current, previous)) {
          latest = current
          disp(current, previous)
        }
      })
      return () => { connected = false ; unlisten() }
    }, () => connected ? latest : fn(_current()))
  }

  /** Creates a value which transforms this value via `fn`. The new value will emit changes
    * whenever this value changes and the transformed value differs from the previous transformed
    * value. [[dataEquals]] will be used to determine when the transformed value changes.
    * @param fn a referentially transparent transformer function. */
  mapData<U extends Data> (fn :(v:T) => U) :Value<U> {
    return this.map(fn, dataEquals)
  }

  /** Creates a value which transforms this value via `fn` into a result value. The value of the
    * transformed value will be the value of the most recent result value. When the result value
    * changes, the transformed value will change. When this underlying value changes, a new result
    * value will be computed and this value will emit a change at that time iff the current value
    * of the new result value differs from the current value of the old result value. Note: this
    * equality test is performed using the equality testing function of the new result value. To
    * avoid unexpected behavior, all values returned by `fn` should use the same equality testing
    * semantics. */
  switchMap<R> (fn :(v:T) => Value<R>) :Value<R> {
    return Value.switch(this.map(fn))
  }

  /** Returns a `Stream` that emits values whenever this value changes. */
  toStream () :Stream<T> {
    return new Stream<T>(this._onChange)
  }

  toString () { return `Value(${this.current})` }
}

/** A `Value` which can be mutated by external callers. */
export class Mutable<T> extends Value<T> implements Prop<T> {

  /** Creates a local mutable value, which starts with value `start`.
    * Changes to this value will be determined using `eq` which defaults to `refEquals`. */
  static local<T> (start :T, eq :Eq<T> = refEquals) :Mutable<T> {
    const listeners :ChangeFn<T>[] = []
    let current = start
    return new Mutable(eq, lner => addListener(listeners, lner), () => current, newValue => {
      const oldValue = current
      if (!eq(oldValue, newValue)) {
        current = newValue
        dispatchChange(listeners, newValue, oldValue)
      }
    })
  }

  /** Creates a local mutable value, which starts with value `start`.
    * Changes to this value will be determined using [[dataEquals]]. */
  static localData<T extends Data> (start :T) :Mutable<Widen<T>> {
    return this.local(start as Widen<T>, dataEquals)
  }

  /** Creates a local mutable value, which starts with value `start` or `undefined`.
    * Changes to this value will be determined using [[dataEquals]]. */
  static localOpt<T extends Data> (start? :T) :Mutable<Widen<T|undefined>> {
    return this.local(start as Widen<T|undefined>, dataEquals)
  }

  /** Creates a mutable value derived from an external source. The `current` function should return
    * the current value and the `update` function should update it. The `connect` function should
    * subscribe to the underlying source, and call `dispatch` when any future values that arrive. It
    * should return a remover thunk that can be used to clear the subscription. The remover thunk
    * will be called when the last listener to the subject is removed and the subject goes dormant.
    * If a new listener subsequently arrives, `connect` will be called anew to resume wakefulness.
    * @param connect called when the mutable receives its first listener after being in a dormant
    * state. */
  static deriveMutable<T> (connect :(dispatch :ChangeFn<T>) => Remover,
                           current :() => T, update :(t:T) => void, eq :Eq<T>) :Mutable<T> {
    const listeners :ChangeFn<T>[] = []
    let disconnect = NoopRemover
    function checkEmpty () {
      if (listeners.length === 0) {
        disconnect()
        disconnect = NoopRemover
      }
    }
    function dispatch (value :T, ovalue :T) {
      if (dispatchChange(listeners, value, ovalue)) checkEmpty()
    }
    return new Mutable(eq, lner => {
      const needConnect = listeners.length === 0
      const remover = addListener(listeners, lner)
      if (needConnect) disconnect = connect(dispatch)
      return () => { remover() ; checkEmpty() }
    }, current, update)
  }

  constructor (eq :Eq<T>, onChange :(fn:ChangeFn<T>) => Remover, current :() => T,
               protected readonly _update :(v:T) => void) {
    super(eq, onChange, current)
  }

  /** Updates this mutable value to `newValue`. If `newValue` differs from the current value,
    * listeners will be notified of the change. */
  update (newValue :T) { this._update(newValue) }

  /** Updates this mutable value to `newValue` iff `pred` is true when applied to the current value.
    * If `newValue` differs from the current value, listeners will be notified of the change. */
  updateIf (pred :(v:T) => boolean, newValue :T) {
    if (pred(this.current)) this._update(newValue)
  }

  /** Applies `fn` to this mutable's current value and updates it to contain the result.
    * @return the result. */
  updateVia (fn :(v:T) => T) :T {
    const nvalue = fn(this.current)
    this.update(nvalue)
    return nvalue
  }

  /** Creates a two way mapping between `this` mutable value and a projection of it given a
    * projection and injection function. Changes to `this` value will be projected out and used to
    * reflect the bimapped value, and changes to the bimapped value will be injected back into
    * `this` value which will then be updated. Equality for the projected value will be tested using
    * the same function used by `this` value.
    * @param project a function that projects out from `this` value, for example, one that projects
    * a single property of an object.
    * @param inject a function that injects the projected value `u` back into the larger value `t`,
    * for example if `t` were an object it could create a new object that copied all properties from
    * `t` and replaced the projected property with the updated `u`.
    */
  bimap<U> (project :(t:T) => U, inject :(t:T, u:U) => T) :Mutable<U> {
    const {eq, _onChange, _current, _update} = this
    const eqU = eq as any as Eq<U> // shenanigans, but should generally be OK
    return new Mutable(eqU, disp => _onChange((value:T, ovalue:T) => {
      let current = project(value), previous = project(ovalue)
      if (!eqU(current, previous)) disp(current, previous)
    }), () => project(_current()), (u:U) => _update(inject(_current(), u)))
  }
}

type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array
                | Int32Array | Uint32Array | Float32Array | Float64Array

/** A reactive primitive that contains a changing value. It is similar to [[Value]] except that it
  * is designed for values which are mutated in place. For reactive values which must change every
  * frame, for example, it may be desirable to use a buffer instead of a value to avoid generating a
  * lot of garbage. */
export abstract class Buffer<T> extends ReadableSource<T> implements Prop<T> {
  protected _listeners :ValueFn<T>[] = []
  private static readonly defaultUpdater :(o :any, n :any) => any = (o, n) => n

  /** Creates a buffer containing `init`.
    * @param updater an optional updating function that merges a new value into the old value and
    * returns the value that should be placed back into the buffer. */
  static create<T> (init :T, updater? :(o :T, n :T) => T) :Buffer<T> {
    return new ValueBuffer(init, updater || Buffer.defaultUpdater)
  }

  /** Creates a buffer wrapping `init`, a typed array. The buffer will always contain this array,
    * updates will be copied into it. `T` should be a type that represents a fixed sized buffer. It
    * is _not_ safe to call `update` on a `Buffer` with mismatched array sizes. */
  static wrap<T extends TypedArray> (init :T) :Buffer<T> & VProp<T> {
    return new ArrayBuffer(init)
  }

  /** Returns the current value of the buffer. */
  abstract get current () :T

  /** Registers `fn` to be called with the updated value whenever this buffer changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onEmit (fn :ValueFn<T>) :Remover { return addListener(this._listeners, fn) }

  /** Registers `fn` to be called with the current value and again whenever this buffer's value changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onValue (fn :ValueFn<T>) :Remover {
    if (fn(this.current) === Remove) return NoopRemover
    return this.onEmit(fn)
  }

  /** Updates this buffer to `newValue` and notifies listeners. */
  abstract update (newValue :T) :void

  /** Updates this buffer to `newValue` and notifies listeners, iff it differs from the current
    * value based on `eq`. `eq` defaults to reference equality. */
  updateIf (newValue :T, eq :Eq<T> = refEquals) {
    if (!eq(newValue, this.current)) this.update(newValue)
  }

  /** Updates this buffer's current value with `fn` (which presumably mutates it in place) and then
    * notifies listeners of the change. */
  updateVia (fn :(v:T) => void) {
    fn(this.current)
    dispatchValue(this._listeners, this.current)
  }

  /** Notifies listeners that this buffer's value was updated. If the value was mutated in place
    * this should be called to notify listeners of the change. */
  updated () {
    dispatchValue(this._listeners, this.current)
  }

  /** Creates a source which transforms this buffer via `fn`. The source will emit changes whenever
    * this buffer changes. Note that no check is made to ensure that the mapped value differs from
    * the previous mapped value. `Buffer`s do not check equality like [[Value]]s do.
    * @param fn a referentially transparent transformer function. */
  map<U> (fn :(v:T) => U) :ReadableSource<U> {
    let connected = false, latest :U
    return Value.deriveValue(refEquals, disp => {
      connected = true
      latest = fn(this.current)
      const unlisten = this.onEmit(value => {
        let current = fn(value)
        latest = current
        disp(current, current)
      })
      return () => { connected = false ; unlisten() }
    }, () => connected ? latest : fn(this.current))
  }

  /** Creates a two way mapping between `this` buffer and some part of it, given a projection and
    * injection function. Changes to `this` value will be projected out and used to update the
    * bimapped value, and changes to the bimapped value will be injected back into `this` value
    * which will then be updated. Equality for the projected value is tested using the supplied
    * equality function (defaulting to `refEquals`).
    * @param project a function that projects out from `this` value, for example, one that projects
    * a single property of an object.
    * @param inject a function that injects the projected value `u` back into the buffer value `t`.
    * Because the buffer value can be mutated in place, this is usually a simple assignment.
    */
  bimap<U> (project :(t:T) => U, inject :(t:T, u:U) => void, eq :Eq<U> = refEquals) :Mutable<U> {
    let previous = project(this.current)
    return new Mutable(eq, disp => this.onEmit(value => {
      let current = project(value)
      if (!eq(current, previous)) disp(current, previous)
    }), () => project(this.current), (u:U) => {
      inject(this.current, u)
      this.updated()
    })
  }

  toString () { return `Buffer(${this.current})` }
}

class ValueBuffer<T> extends Buffer<T> {

  constructor (public current :T, private readonly updater :(o :T, n :T) => T) { super() }

  update (newValue :T) {
    dispatchValue(this._listeners, this.current = this.updater(this.current, newValue))
  }
}

function arrayEquals (a :TypedArray, b :TypedArray) {
  for (let ii = 0, ll = a.length; ii < ll; ii += 1) if (a[ii] !== b[ii]) return false
  return true
}

class ArrayBuffer<T extends TypedArray> extends Buffer<T> implements VProp<T> {

  constructor (public current :T) { super() }

  read (into :T) :T { into.set(this.current) ; return into }

  update (newValue :T) {
    this.current.set(newValue)
    dispatchValue(this._listeners, this.current)
  }

  updateIf (newValue :T) {
    if (!arrayEquals(this.current, newValue)) this.update(newValue)
  }
}

import {Remover, NoopRemover} from "./util"
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

function addListener<T> (listeners :T[], listener :T) :Remover {
  listeners.push(listener)
  return () => {
    let ii = listeners.indexOf(listener)
    if (ii >= 0) {
      listeners.splice(ii, 1)
    }
  }
}

/** An error that encapsulates multiple errors. Thrown when dispatching to reactive callbacks
  * triggers multiple failures. */
export class MultiError extends Error {
  constructor (readonly errors :Error[]) {
    super(`${errors.length} errors`)
  }
}

/** A callback "function" that consumes a value from a reactive source. Return value may be
  * anything, but is ignored. */
export type ValueFn<T> = (value :T) => any

function dispatchValue<T> (listeners :ValueFn<T>[], value :T) {
  let errors
  for (let listener of listeners.slice()) {
    try {
      listener(value)
    } catch (error) {
      if (!errors) errors = []
      errors.push(error)
    }
  }
  if (errors) {
    if (errors.length === 1) throw errors[0]
    else throw new MultiError(errors)
  }
}

/** A callback "function" that consumes a change in value, from a reactive source. Return value may
  * be anything, but is ignored. */
export type ChangeFn<T> = (value :T, oldValue :T) => any

function dispatchChange<T> (listeners :ChangeFn<T>[], value :T, oldValue :T) {
  let errors
  for (let listener of listeners.slice()) {
    try {
      listener(value, oldValue)
    } catch (error) {
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
}

//
// Reactive source & helpers

/** A function used to dispatch new values on reactive primitives. */
export type DispatchFn<T> = (value :T) => void

/** A predicate which tests something about a `value`. */
export type Pred<T> = (value :T) => boolean

/** A reactive source: an API that abstracts over `Stream`, `Subject` and `Value`. */
export abstract class Source<T> {

  /** Registers `fn` to be called when `source` contains or emits non-`undefined` values.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  static whenDefined<T> (source :Source<T|undefined>, fn :ValueFn<T>) :Remover {
    return source.onValue(v => { if (v !== undefined) fn(v) })
  }

  /** Registers `fn` to be called the first time `source` contains or emits a non-`undefined` value.
    * `fn` will be called zero or one times.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  static onceDefined<T> (source :Source<T|undefined>, fn :ValueFn<T>) :Remover {
    let remover :Remover
    return (remover = source.onValue(v => { if (v !== undefined) { remover() ; fn(v) } }))
  }

  /** Registers `fn` to be called with values emitted by this source. If the source has a current
    * value, `fn` will _not_ be called with the current value. */
  abstract onEmit (fn :ValueFn<T>) :Remover

  /** Registers `fn` to be called with values emitted by this source. If the source has a current
    * value, `fn` will also be called immediately with the current value. */
  abstract onValue (fn :ValueFn<T>) :Remover

  /** Returns a new source that transforms the value of this source via `fn`. */
  abstract map<U> (fn :(v:T) => U) :Source<U>

  /** Registers `fn` to be called the first time this source contains or emits a value. If the
    * source contains a current value, `fn` will be called before this call returns. `fn` will be
    * called zero or one times.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  once (fn :ValueFn<T>) :Remover {
    let remover :Remover
    return (remover = this.onValue(v => { remover() ; fn(v) }))
  }

  /** Registers `fn` to be called the next time this source emits a value. If source contains a
    * current value `fn` will _not_ be called with the current value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  next (fn :ValueFn<T>) :Remover {
    let remover :Remover
    return (remover = this.onEmit(v => { remover() ; fn(v) }))
  }

  /** Registers `fn` to be called when this source contains or emits values which satisfy `pred`.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  when (pred :Pred<T>, fn :ValueFn<T>) :Remover {
    return this.onValue(v => { if (pred(v)) fn(v) })
  }

  /** Registers `fn` to be called the first time this source contains or emits a value which
    * satisfies `pred`. `fn` will be called zero or one times.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  whenOnce (pred :Pred<T>, fn :ValueFn<T>) :Remover {
    let remover :Remover
    return (remover = this.onValue(v => { if (pred(v)) { remover() ; fn(v) } }))
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
  static derive<T> (connect :(dispatch :DispatchFn<T>) => Remover) :Stream<T> {
    const listeners :ValueFn<T>[] = []
    let disconnect :Remover = NoopRemover
    const dispatch = (value :T) => { dispatchValue(listeners, value) }
    return new Stream(listener => {
      const needConnect = listeners.length === 0
      const remover = addListener(listeners, listener)
      if (needConnect) disconnect = connect(dispatch)
      return () => {
        remover()
        if (listeners.length == 0) {
          disconnect()
          disconnect = NoopRemover
        }
      }
    })
  }

  /** Merges `sources` streams into a single stream that emits a value whenever any of the
    * underlying streams emit a value. */
  static merge<E> (...sources :Stream<E>[]) :Stream<E> {
    return Stream.derive(dispatch => {
      let removers :Remover[] = sources.map(s => s.onEmit(dispatch))
      return () => removers.forEach(r => r())
    })
  }

  constructor (private readonly _onEmit :(fn :ValueFn<T>) => Remover) { super() }

  /** Registers `fn` to be invoked when this stream emits a value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onEmit (fn :ValueFn<T>) :Remover { return this._onEmit(fn) }

  /** Registers `fn` to be invoked when this stream emits a value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onValue (fn :ValueFn<T>) :Remover { return this._onEmit(fn) }

  /** Returns a stream which transforms the values of this stream via `fn`. Whenever `this` stream
    * emits a `value`, the returned stream will emit `fn(value)`. */
  map<U> (fn :(v:T) => U) :Stream<U> {
    return Stream.derive(dispatch => this.onEmit(value => dispatch(fn(value))))
  }

  /** Returns a stream which filters the values of this stream via `pred`. Only the values emitted
    * by this stream that satisfy `pred` (cause it to return `true`) will be emitted by the returned
    * stream. */
  filter (pred :Pred<T>) :Stream<T> {
    return Stream.derive(dispatch => this.onEmit(value => pred(value) && dispatch(value)))
  }

  /** Returns a reactive [[Value]] which starts with value `start` and is updated by values emitted
    * by this stream whenever they arrive.
    * @param eq used to check whether successive values from this stream have actually changed.
    * [[Value]]s emit notifications only when values change. */
  toValue (start :T, eq :Eq<T>) :Value<T> {
    const stream = this
    class StreamValue extends DerivedValue<T> {
      private _current = start
      get current () :T { return this._current }
      _connectToSource () {
        return stream.onEmit(value => {
          const previous = this._current
          if (!this.eq(previous, value)) {
            this._current = value
            this._dispatchValue(value, previous)
          }
        })
      }
    }
    return new StreamValue(eq)
  }

  /** Returns a reactive [[Subject]] that is initialized with the next value emitted by this stream
    * and then changed by each subsequent value emitted by this stream. */
  toSubject () :Subject<T> {
    return Subject.derive(dispatch => this.onValue(dispatch))
  }
}

/* A stream which can have values emitted on it by external callers. */
export class Emitter<T> extends Stream<T> {
  private _listeners :ValueFn<T>[] = []

  constructor () { super(lner => addListener(this._listeners, lner)) }

  /** Emits `value` on this stream. Any current listeners will be notified of the value. */
  emit (value :T) {
    dispatchValue(this._listeners, value)
  }

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
export abstract class Subject<T> extends Source<T> {

  /** Creates a subject derived from an external event source. The `connect` function should
    * subscribe to the underlying source, call the supplied `dispatch` function with the initial
    * value as soon as it is known (possibly immediately), then call `dispatch` with any future
    * values that arrive. It should return a remover thunk that can be used to clear the
    * subscription. The remover thunk will be called when the last listener to the subject is
    * removed and the subject goes dormant. If a new listener subsequently arrives, `connect` will
    * be called anew to resume wakefulness.
    * @param connect called when the subject receives its first listener after being in a dormant
    * state. */
  static derive<T> (connect :(dispatch :DispatchFn<T>) => Remover) :Subject<T> {
    const listeners :ValueFn<T>[] = []
    let disconnect = NoopRemover
    let occupied = false
    let latest :T // initialized when connected; only used thereafter
    const dispatch = (value :T) => {
      occupied = true
      latest = value
      dispatchValue(listeners, value)
    }
    class DerivedSubject extends Subject<T> {
      onEmit (fn :ValueFn<T>) :Remover { return this.addListener(fn, false) }
      onValue (fn :ValueFn<T>) :Remover { return this.addListener(fn, true) }
      protected addListener (fn :ValueFn<T>, wantValue :boolean) :Remover {
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
        return () => {
          remover()
          if (listeners.length == 0) {
            disconnect()
            disconnect = NoopRemover
            occupied = false
            latest = undefined as any // don't retain a reference to latest
          }
        }
      }
      toString () { return `Subject(${latest})` }
    }
    return new DerivedSubject()
  }

  /** Joins `sources` into a single subject which contains the underlying subjects combined into a
    * single array. This subject will initially complete once all of the underlying subjects have
    * initially completed. Then, when any of the underlying subjects changes, this subject will
    * change and the changed element will be reflected in its new value. */
  static join<A> (...sources :Subject<A>[]) :Subject<A[]> {
    return Subject.derive(dispatch => {
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

  /** Joins two subjects into a single "tuple" subject. See [[Subject.join]] for details. */
  static join2<A,B> (a :Subject<A>, b :Subject<B>) :Subject<[A,B]> {
    return Subject.join(a as any, b as any) as Subject<[A, B]>
  }

  /** Joins three subjects into a single "triple" subject. See [[Subject.join]] for details. */
  static join3<A,B,C> (a :Subject<A>, b :Subject<B>, c :Subject<C>) :Subject<[A,B,C]> {
    return Subject.join(a as any, b as any, c as any) as Subject<[A, B, C]>
  }

  /** Registers `fn` to be called only with new values whenever this subject changes, _not_ with the
    * current value.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  abstract onEmit (fn :ValueFn<T>) :Remover

  /** Registers `fn` to be called with the current value (if one is available), and with new values
    * whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  abstract onValue (fn :ValueFn<T>) :Remover

  /** Creates a subject which transforms this subject via `fn`. The new subject will emit
    * transformed changes whenever this subject changes.
    * @param fn a referentially transparent transformer function. */
  map<U> (fn :(v:T) => U) :Subject<U> {
    return Subject.derive(dispatch => this.onValue(value => dispatch(fn(value))))
  }

  /** Creates a subject which transforms this subject via `fn`. The new subject will emit
    * transformed changes whenever this subject changes.
    * @param onWake a function called when the mapped subject receives its first listener. It can
    * optionally return an initial value for the mapped subject.
    * @param fn a referentially transparent transformer function.
    * @param onSleep a function called when the mapped subject loses its last listener. It is passed
    * the most recently computed mapped value, if one is available. */
  mapTrace<U> (onWake :() => U|void, fn :(v:T) => U, onSleep :(v:U|void) => void) :Subject<U> {
    return Subject.derive(dispatch => {
      let latest = onWake()
      if (latest) dispatch(latest)
      const unsub = this.onValue(value => dispatch(latest = fn(value)))
      return () => {
        unsub()
        onSleep(latest)
      }
    })
  }

  // TODO: switchMap &c?
}

//
// Reactive values

/** A reactive primitive that contains a value, which may subsequently change. The current value may
  * be observed by listening via [[Value.onValue]], or by calling [[Value.current]]. */
export abstract class Value<T> extends Subject<T> {

  /** Creates a constant value which always contains `value`. */
  static constant<T> (value :T) :Value<T> {
    return new ConstantValue(value)
  }

  /** Creates a constant (data) value which always contains `value` or `undefined`. */
  static constantOpt<T> (value? :T) :Value<T|undefined> {
    return new ConstantValue(value)
  }

  /** Creates a value from `stream` which starts with the value `start` and is updated by values
    * emitted by `stream` whenever they arrive. The values emitted by `stream` are `Data` and are
    * compared for equality structurally (via [dataEquals]). */
  static fromStream<T extends Data> (stream :Stream<T>, start :T) :Value<T> {
    return stream.toValue(start, dataEquals)
  }

  /** Creates a value from `stream` which starts with the value `start` and is updated by values
    * emitted by `stream` whenever they arrive. The values emitted by `stream` may be of any type,
    * but are compared for equality by reference. */
  static fromStreamRef<T> (stream :Stream<T>, start :T) :Value<T> {
    return stream.toValue(start, refEquals)
  }

  /** Joins `sources` into a single value which contains the underlying values combined into a
    * single array. When any of the underlying values changes, this value will change and the
    * changed element will be reflected in its new value. */
  static join<A> (...sources :Value<A>[]) :Value<A[]> {
    return new JoinedValue(sources)
  }

  /** Joins two values into a single "tuple" value. When either of the underlying values changes,
    * this value will change and the changed element will be reflected in its new value. */
  static join2<A,B> (a :Value<A>, b :Value<B>) :Value<[A,B]> {
    return (new JoinedValue([a, b]) as any) as Value<[A,B]>
  }

  /** Joins three values into a single "triple" value. When any of the underlying values changes,
    * this value will change and the changed element will be reflected in its new value. */
  static join3<A,B,C> (a :Value<A>, b :Value<B>, c :Value<C>) :Value<[A,B,C]> {
    return (new JoinedValue([a, b, c]) as any) as Value<[A,B,C]>
  }

  constructor (
    /** The function used to test new values for equality with old values. */
    readonly eq :Eq<T>
  ) { super() }

  /** The current value contained by this value. */
  abstract get current () :T

  /** Registers `fn` to be called with old and new values whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  abstract onChange (fn :ChangeFn<T>) :Remover

  /** Registers `fn` to be called with the new value whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onEmit (fn :ValueFn<T>) :Remover {
    return this.onChange(fn)
  }

  /** Registers `fn` to be called with the most recently observed value (immediately) and again with
    * the new value whenever this subject changes.
    * @return a remover thunk (invoke with no args to unregister `fn`). */
  onValue (fn :ValueFn<T>) :Remover {
    const remover = this.onChange(fn)
    fn(this.current)
    return remover
  }

  /** Creates a value which transforms this value via `fn`. The new value will emit changes
    * whenever this value changes and the transformed value differs from the previous transformed
    * value. [[refEquals]] will be used to determine when the transformed value changes.
    * @param fn a referentially transparent transformer function. */
  map<U> (fn :(v:T) => U) :Value<U> {
    return new MappedValue(this, fn, refEquals)
  }

  /** Creates a value which transforms this value via `fn`. The new value will emit changes
    * whenever this value changes and the transformed value differs from the previous transformed
    * value. [[dataEquals]] will be used to determine when the transformed value changes.
    * @param fn a referentially transparent transformer function. */
  mapData<U extends Data> (fn :(v:T) => U) :Value<U> {
    return new MappedValue(this, fn, dataEquals)
  }

  /** Creates a value which transforms this value via `fn`. The new value will emit changes
    * whenever this value changes and the transformed value differs from the previous transformed
    * value.
    * @param fn a referentially transparent transformer function.
    * @param eq used to determine when the transformed value changes. */
  mapEq<U> (fn :(v:T) => U, eq :Eq<U>) :Value<U> {
    return new MappedValue(this, fn, eq)
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
    const source = this
    let savedSourceValue = source.current
    let mappedValue = fn(savedSourceValue)
    let latest = mappedValue.current
    function onSourceValue (value :T) :R {
      savedSourceValue = value
      mappedValue = fn(value)
      return latest = mappedValue.current
    }

    class SwitchMappedValue extends DerivedValue<R> {
      get current () :R {
        // rather than recreate a mapped reactive value every time our value is requested,
        // we cache the source value from which we most recently created our mapped value
        // if it has not changed, we reuse the mapped value; this assumes referential
        // transparency on the part of fn
        let sourceValue = source.current
        if (!source.eq(sourceValue, savedSourceValue)) {
          savedSourceValue = sourceValue
          mappedValue = fn(sourceValue)
        }
        return mappedValue.current
      }

      _connectToSource () {
        if (!source.eq(source.current, savedSourceValue)) onSourceValue(source.current)
        const dispatcher = (value :R, ovalue :R) => {
          const previous = latest
          latest = value
          this._dispatchValue(value, previous)
        }
        let disconnect = mappedValue.onChange(dispatcher)
        let unlisten = source.onChange((value, ovalue) => {
          disconnect()
          let previous = latest, current = onSourceValue(value)
          disconnect = mappedValue.onChange(dispatcher)
          if (!mappedValue.eq(current, previous)) {
            this._dispatchValue(current, previous)
          }
        })
        return () => {
          disconnect()
          return unlisten()
        }
      }
    }
    return new SwitchMappedValue(refEquals)
  }

  /** Returns a `Stream` that emits values whenever this value changes. */
  toStream () :Stream<T> {
    return new Stream<T>(fn => this.onChange(fn))
  }

  /** Returns a `Promise` that completes when this value's current value satisfies `pred`. If the
    * current value satisfies pred, a completed promise will be returned. Otherwise an uncompleted
    * promise is returned and that promise is completed when this value next changes to a
    * satisfying value. */
  toPromise (pred :Pred<T>) :Promise<T> {
    let current = this.current
    if (pred(current)) {
      return Promise.resolve(current)
    }
    return new Promise((resolve, reject) => {
      let remover = this.onChange(value => {
        if (pred(value)) {
          remover()
          resolve(value)
        }
      })
    })
  }

  toString () { return `Value(${this.current})` }
}

abstract class DerivedValue<T> extends Value<T> {
  private _listeners :ChangeFn<T>[] = []
  private _disconnect = NoopRemover

  abstract _connectToSource () :Remover

  _dispatchValue (current :T, previous :T) {
    dispatchChange(this._listeners, current, previous)
  }

  onChange (listener :ChangeFn<T>) :Remover {
    const needConnect = this._listeners.length === 0
    const remover = addListener(this._listeners, listener)
    if (needConnect) this._disconnect = this._connectToSource()
    return () => {
      remover()
      if (this._listeners.length === 0) {
        this._disconnect()
        this._disconnect = NoopRemover
      }
    }
  }

  protected get isConnected () :boolean { return this._disconnect !== NoopRemover }
}

class ConstantValue<T> extends Value<T> {
  // note: we always use refEquals here as some equality fn is needed, but it is never used because
  // constant values never change and thus never have to compare an old value and a new value
  constructor (readonly current :T) { super(refEquals) }
  onChange (fn :ChangeFn<T>) :Remover { return NoopRemover }
}

class JoinedValue extends DerivedValue<any[]> {
  constructor (readonly sources :Value<any>[]) {
    super((as, bs) => {
      for (let ii = 0, ll = sources.length; ii < ll; ii += 1) {
        if (!sources[ii].eq(as[ii], bs[ii])) return false
      }
      return true
    })
  }

  get current () { return this.sources.map(source => source.current) }

  _connectToSource () :Remover {
    const prev = this.current
    const curr = this.current
    const removers = this.sources.map((source, idx) => source.onChange((val, oval) => {
      prev[idx] = oval
      curr[idx] = val
      this._dispatchValue(curr, prev)
    }))
    return () => removers.forEach(r => r())
  }
}

/** A `Value` which can be mutated by external callers. */
export abstract class Mutable<T> extends Value<T> {

  /** Creates a local mutable value, which starts with value `start`.
    * Changes to this value will be determined using [[dataEquals]]. */
  static local<T extends Data> (start :T) :Mutable<Widen<T>> {
    return new LocalMutable(start as Widen<T>, dataEquals)
  }

  /** Creates a local mutable value, which starts with value `start` or `undefined`.
    * Changes to this value will be determined using [[dataEquals]]. */
  static localOpt<T extends Data> (start? :T) :Mutable<Widen<T|undefined>> {
    return new LocalMutable(start as Widen<T|undefined>, dataEquals)
  }

  /** Creates a local mutable value, which starts with value `start`.
    * Changes to this value will be determined using [[refEquals]]. */
  static localRef<T> (start :T) :Mutable<T> {
    return new LocalMutable(start, refEquals)
  }

  /** Creates a local mutable value, which starts with value `start`.
    * Changes to this value will be determined using `eq`. */
  static localEq<T> (start :T, eq :Eq<T>) :Mutable<T> {
    return new LocalMutable(start, eq)
  }

  /** Updates this mutable value to `newValue`. If `newValue` differs from the current value,
    * listeners will be notified of the change. */
  abstract update (newValue :T) :void
}

class LocalMutable<T> extends Mutable<T> {
  private _listeners :ChangeFn<T>[] = []

  constructor (private _value :T, eq :Eq<T>) { super(eq) }

  get current () :T { return this._value }

  update (newValue :T) {
    const oldValue = this._value
    if (!this.eq(oldValue, newValue)) {
      this._value = newValue
      dispatchChange(this._listeners, newValue, oldValue)
    }
  }

  onChange (listener :ChangeFn<T>) :Remover {
    return addListener(this._listeners, listener)
  }
}

class MappedValue<S,T> extends DerivedValue<T> {
  private _latest! :T // initialized in _connectToSource; only used when connected

  get current () :T { return this.isConnected ? this._latest : this.fn(this.source.current) }

  constructor (readonly source :Value<S>, readonly fn :(value :S) => T, eq :Eq<T>) { super(eq) }

  _connectToSource () {
    this._latest = this.current
    return this.source.onChange((value :S, ovalue :S) => {
      let current = this.fn(value), previous = this._latest
      if (!this.eq(current, previous)) {
        this._latest = current
        this._dispatchValue(current, previous)
      }
    })
  }
}

// TODO: these are just interface definitions for now, to sketch out the API
// eventually they'll be abstract classes like RStream/RValue

//
// Reactive maps

export interface RMap<K,V> extends Iterable<[K,V]> {

  size :number
  has (key :K) :boolean
  get (key :K) :V|undefined

  set (key :K, value :V) :this
  delete (key :K) :boolean
  clear (): void

  // entries () :Iterator<[K,V]>
  keys () :Iterator<K>
  values () :Iterator<V>
  forEach (fn :(k:K, v:V) => void) :void
}

//
// Reactive sets

export interface RSet<E> extends Iterable<E> {

  size :number
  has (elem :E) :boolean

  add (elem :E) :this
  delete (elem :E) :boolean
  clear (): void

  // entries () :Iterator<[E,E]>
  // keys () :Iterator<E>
  // values () :Iterator<E>
  forEach (fn :(e:E) => void) :void
}

//
// Reactive lists

export interface RList<E> extends Iterable<E> {

  size :number
  length :number

  elemAt (index :number) :E
  append (elem :E) :void
  insert (elem :E, index :number) :void
  update (elem :E, index :number) :void
  delete (index :number) :void
  clear (): void

  forEach (fn :(e:E) => void) :void

  slice (start :number|void, length :number|void) :E[]
}
